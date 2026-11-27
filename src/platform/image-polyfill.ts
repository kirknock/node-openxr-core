/**
 * Headless image support: a minimal PNG decoder (node:zlib), JPEG decoding
 * (jpeg-js: baseline & progressive, YCbCr/grayscale, any subsampling), plus
 * DOM `Image`/`createImageBitmap` polyfills.
 *
 * Babylon loads every data-URI/image-buffer texture through
 * `new Image()` + `engine.createImageBitmap()` (Engines/engine.common.js),
 * which is pure DOM — in Node the onload never fires and the texture (and
 * every material gating on it) hangs "not ready" forever. The polyfills
 * decode image bytes and hand Babylon a bitmap object that
 * the WebGL2 shim can upload: its texImage2D/texSubImage2D accept it as a
 * source ({ width, height } + it IS the RGBA byte array).
 *
 * Format support mirrors what a browser's image pipeline accepts for the
 * texture kinds glTF assets embed (glb embedded textures are commonly JPEG —
 * e.g. DamagedHelmet/lord_inquisitor_servo_skull): PNG 8-bit
 * gray / gray+alpha / palette / RGB / RGBA non-interlaced, and JPEG via
 * jpeg-js. Textures referenced through a glb data: URL are re-extracted from
 * the embedded container (see decodeGlbTextureUri). Compressed textures
 * (KTX2/Basis) and WebP remain unsupported.
 */
import { inflateSync } from "node:zlib";
import { decode as decodeJpegImpl } from "jpeg-js";
import { decodeOnWorker, ImageDecodeWorkerError, startImageDecodeWorkers } from "./image-decode-pool.js";

/** A decoded image: RGBA8 bytes (top-row-first) carrying width/height. */
export class DecodedImage extends Uint8Array {
  readonly imageWidth: number;
  readonly imageHeight: number;

  /** Takes over `data`'s buffer without copying: pass a freshly decoded array. */
  constructor(data: Uint8Array, width: number, height: number) {
    super(data.buffer as ArrayBuffer, data.byteOffset, data.length);
    this.imageWidth = width;
    this.imageHeight = height;
  }

  get width(): number {
    return this.imageWidth;
  }

  get height(): number {
    return this.imageHeight;
  }

  close(): void {
    /* no-op (duck-types an ImageBitmap for Babylon's engine checks) */
  }

  /**
   * subarray/slice/map make plain Uint8Arrays. By default they would call
   * this constructor with (buffer, offset, length), which takes its first
   * argument for decoded data: the rows the WebGL2 shim copies for FLIP_Y
   * came out empty, and every invertY image texture uploaded black.
   */
  static get [Symbol.species](): Uint8ArrayConstructor {
    return Uint8Array;
  }
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes a non-interlaced 8-bit PNG (gray/gray+alpha/palette/RGB/RGBA) to RGBA8. */
export function decodePng(bytes: Uint8Array): DecodedImage {
  const buf = Buffer.isBuffer(bytes)
    ? (bytes)
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("image-polyfill: not a PNG");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;

  let off = 8;
  while (off + 8 <= buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = new Uint8Array(data);
    } else if (type === "tRNS") {
      trns = new Uint8Array(data);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + length;
  }

  if (width === 0 || height === 0) throw new Error("image-polyfill: missing IHDR");
  if (bitDepth !== 8) throw new Error(`image-polyfill: unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("image-polyfill: interlaced PNG not supported");

  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : colorType === 3 ? 1 : 0;
  if (channels === 0) throw new Error(`image-polyfill: unsupported color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);

  // Unfilter (PNG spec: 0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth).
  let pos = 0;
  let prev: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev !== null ? prev[x] : 0;
      const upLeft = prev !== null && x >= channels ? prev[x - channels] : 0;
      let value = raw[pos++];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default:
          throw new Error(`image-polyfill: bad filter ${filter}`);
      }
      row[x] = value & 0xff;
    }
    prev = row;
  }

  // Expand to RGBA.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const s = i * channels;
    switch (colorType) {
      case 6:
        rgba[o] = pixels[s];
        rgba[o + 1] = pixels[s + 1];
        rgba[o + 2] = pixels[s + 2];
        rgba[o + 3] = pixels[s + 3];
        break;
      case 2:
        rgba[o] = pixels[s];
        rgba[o + 1] = pixels[s + 1];
        rgba[o + 2] = pixels[s + 2];
        rgba[o + 3] = 255;
        break;
      case 0: {
        const g = pixels[s];
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = 255;
        break;
      }
      case 4: {
        const g = pixels[s];
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = pixels[s + 1];
        break;
      }
      case 3: {
        const idx = pixels[s] * 3;
        if (palette === null || idx + 2 > palette.length - 1) {
          throw new Error("image-polyfill: palette missing/too small");
        }
        rgba[o] = palette[idx];
        rgba[o + 1] = palette[idx + 1];
        rgba[o + 2] = palette[idx + 2];
        rgba[o + 3] = trns !== null && pixels[s] < trns.length ? trns[pixels[s]] : 255;
        break;
      }
    }
  }

  return new DecodedImage(rgba, width, height);
}

/** JPEG magic: SOI marker (FF D8) followed by the first marker's FF. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** PNG magic (the 8-byte signature decodePng also checks). */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIG.equals(Buffer.from(bytes.buffer, bytes.byteOffset, 8));
}

/** Decodes a JPEG (baseline or progressive, via jpeg-js) to RGBA8. */
function decodeJpeg(bytes: Uint8Array): DecodedImage {
  const { width, height, data } = decodeJpegImpl(bytes, {
    useTArray: true,
    formatAsRGBA: true,
  });
  return new DecodedImage(data, width, height);
}

/**
 * Decodes an image buffer by sniffing its magic bytes — the browser
 * equivalent, which decodes by content rather than declared container
 * (glTF images can carry a wrong/missing mimeType; the GLB bufferView
 * arrives here with no mime at all). PNG and JPEG only.
 */
export function decodeImage(bytes: Uint8Array): DecodedImage {
  if (isJpeg(bytes)) return decodeJpeg(bytes);
  if (isPng(bytes)) return decodePng(bytes);
  throw new Error("image-polyfill: unsupported image format (PNG/JPEG only)");
}

/**
 * Resolves the texture data URIs Babylon's glTF loader mints when the GLB
 * itself was loaded from a data: URL:
 *
 *   data:model/gltf-binary;base64,<entire glb><timestamp>/…#image<N>
 *
 * The loader calls Texture.updateURL with the real image bytes as `buffer`,
 * but because the root URL contains ";base64," the engine's _createTextureBase
 * takes its isBase64 branch, DROPS the buffer and hands _FileToolsLoadImage
 * only this URL string (abstractEngine.js: `!fromData || isBase64`). The
 * string embeds the whole GLB, though, and the #image<N> fragment (the
 * loader's own naming) says which embedded image is wanted — so re-extract
 * it: parse the GLB container and slice json.images[N].bufferView out of the
 * binary chunk. Browsers survive the same path only because their <img>/
 * createImageBitmap fetch machinery re-fetches and sniffs; Node must do the
 * equivalent here.
 */
function decodeGlbTextureUri(src: string, comma: number): DecodedImage {
  const frag = src.lastIndexOf("#");
  const fragMatch = frag === -1 ? null : /^#image(\d+)$/.exec(src.slice(frag));
  if (fragMatch === null) {
    throw new Error("image-polyfill: glb data URI without #imageN texture fragment");
  }
  const index = Number(fragMatch[1]);
  // Decode up to the fragment (browsers strip it too). Node's base64 decoder
  // stops at "=" padding, so the loader's <timestamp>/junk suffix decodes to
  // trailing bytes the GLB chunk walk below ignores.
  const payload = src.slice(comma + 1, frag);
  const glb = new Uint8Array(Buffer.from(payload, "base64"));
  const target = glbEmbeddedImage(glb, index);
  return typeof target === "string" ? decodeDataUriImpl(target) : decodeImage(target);
}

/**
 * Extracts one embedded image from GLB (binary glTF 2.0) bytes. Returns the
 * image's raw bytes, or a data: URI string when the image stores one instead
 * of a bufferView (caller decodes that recursively). External file URIs are
 * not resolvable from an in-memory GLB.
 */
function glbEmbeddedImage(glb: Uint8Array, imageIndex: number): Uint8Array | string {
  const buf = Buffer.isBuffer(glb) ? (glb) : Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "glTF") {
    throw new Error("image-polyfill: glb payload has no glTF magic");
  }
  if (buf.readUInt32LE(4) !== 2) {
    throw new Error(`image-polyfill: unsupported glb version ${buf.readUInt32LE(4)}`);
  }
  let json: {
    images?: Array<{ bufferView?: number; uri?: string }>;
    bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
  } | null = null;
  let bin: Buffer | null = null;
  let off = 12;
  while (off + 8 <= buf.length && (json === null || bin === null)) {
    const length = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8")); // "JSON"
    else if (type === 0x004e4942) bin = data; // "BIN\0"
    off += 8 + length;
  }
  if (json === null) throw new Error("image-polyfill: glb has no JSON chunk");
  const image = json.images?.[imageIndex];
  if (image === undefined) {
    throw new Error(`image-polyfill: glb has no image ${imageIndex}`);
  }
  if (typeof image.bufferView === "number") {
    if (bin === null) throw new Error("image-polyfill: glb has no BIN chunk");
    const view = json.bufferViews?.[image.bufferView];
    if (view === undefined) throw new Error(`image-polyfill: glb bufferView ${image.bufferView} missing`);
    const start = view.byteOffset ?? 0;
    if (start + view.byteLength > bin.length) {
      throw new Error(`image-polyfill: glb bufferView ${image.bufferView} out of range`);
    }
    return bin.subarray(start, start + view.byteLength);
  }
  if (typeof image.uri === "string") return image.uri;
  throw new Error(`image-polyfill: glb image ${imageIndex} has no embedded data`);
}

const decodeDataUriImpl = (src: string): DecodedImage => {
  const comma = src.indexOf(",");
  if (!src.startsWith("data:") || comma === -1) {
    throw new Error(`image-polyfill: only data: URIs are supported (got ${src.slice(0, 40)}...)`);
  }
  const meta = src.slice(5, comma);
  // The glTF loader builds texture URLs as `data:${uniqueRootUrl}...` where
  // uniqueRootUrl is itself a data: URL for in-memory loads — strip the
  // doubled prefix (`data:model/gltf-binary`) before comparing.
  const mime = meta.split(";")[0].trim().toLowerCase().replace(/^data:/, "");
  if (mime === "model/gltf-binary") {
    return decodeGlbTextureUri(src, comma);
  }
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/jpg") {
    throw new Error(`image-polyfill: unsupported image mime "${meta}" (PNG/JPEG only)`);
  }
  const payload = src.slice(comma + 1);
  const bytes = meta.endsWith(";base64")
    ? new Uint8Array(Buffer.from(payload, "base64"))
    : new Uint8Array(Buffer.from(payload, "utf8"));
  return decodeImage(bytes);
};

/** Decodes a data: URI (PNG or JPEG) — exported for the synchronous image loader. */
export const decodeDataUri = decodeDataUriImpl;

export class HeadlessImage {
  width = 0;
  height = 0;
  naturalWidth = 0;
  naturalHeight = 0;
  complete = false;
  decoded: DecodedImage | null = null;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private srcValue = "";

  get src(): string {
    return this.srcValue;
  }

  set src(value: string) {
    this.srcValue = value;
    // Decode synchronously (headless has no async decode machinery; the
    // decode-capture hook also needs the result before the creating call
    // returns). DOM semantics kept for onload/onerror timing: asynchronous.
    try {
      this.decoded = decodeDataUri(value);
      notifyDecodeCapture(value, this.decoded);
      this.width = this.naturalWidth = this.decoded.width;
      this.height = this.naturalHeight = this.decoded.height;
      this.complete = true;
      queueMicrotask(() => this.onload?.());
    } catch (e) {
      queueMicrotask(() => this.onerror?.(e));
    }
  }

  decode(): Promise<void> {
    if (this.decoded === null) decodeDataUri(this.srcValue); // throws if invalid
    return Promise.resolve();
  }
}

// Decode-capture hook (see headless-rgbd.ts: reuses Babylon's own
// embedded data URIs without reaching into module-private constants).
let decodeCapture: ((src: string, image: DecodedImage) => void) | null = null;

/** Fires the decode-capture hooks (public for the sync image loader). */
export function notifyDecodeCapture(src: string, image: DecodedImage): void {
  try {
    decodeCapture?.(src, image);
  } catch {
    /* capture must never break the load */
  }
}

/** Installs a decode-capture hook; returns a restore function. */
export function captureImageDecodes(hook: ((src: string, image: DecodedImage) => void) | null): () => void {
  const previous = decodeCapture;
  decodeCapture = hook;
  return () => {
    decodeCapture = previous;
  };
}

/**
 * Installs DOM image globals Babylon's texture path needs
 * (`CreateImageBitmapFromSource` + `engine.createImageBitmap`). Replaces
 * weaker stubs (e.g. IWER's inert Image) — a decoding Image is strictly
 * more capable. `createImageBitmap` accepts Blob/ArrayBuffer/Uint8Array
 * (Blob is what Babylon's forceBitmapOverHTMLImageElement path passes) and
 * decodes those on worker threads, resolving one image per event-loop turn.
 */
export function installImagePolyfills(): void {
  const G = globalThis as Record<string, unknown>;
  if (G.Image !== HeadlessImage) {
    G.Image = HeadlessImage;
  }
  G.createImageBitmap = async (source: unknown, options?: unknown): Promise<DecodedImage> => {
    const flipY = ((options ?? {}) as { imageOrientation?: string }).imageOrientation === "flipY";
    if (source instanceof HeadlessImage) {
      if (source.decoded === null) throw new Error("image-polyfill: image not decoded");
      const image = flipY ? flipImage(source.decoded) : source.decoded;
      notifyDecodeCapture(source.src, image);
      return image;
    }
    let bytes: Uint8Array;
    if (source instanceof Uint8Array) {
      bytes = source;
    } else if (source instanceof ArrayBuffer) {
      bytes = new Uint8Array(source);
    } else {
      // Blob (what Babylon passes via LoadFile -> new Blob([data])).
      const blob = source as { arrayBuffer?: () => Promise<ArrayBuffer> };
      if (typeof blob?.arrayBuffer !== "function") {
        throw new Error("image-polyfill: createImageBitmap source not supported");
      }
      bytes = new Uint8Array(await blob.arrayBuffer());
    }
    const image = await decodeOffThread(bytes, flipY);
    // A caller uploads what it gets right away, like loadImageOffThread's onLoad.
    await new Promise<void>((resolve) => deliverOnePerTurn(resolve));
    return image;
  };
}

/** Vertically flipped copy (imageOrientation: "flipY"). */
export function flipImage(image: DecodedImage): DecodedImage {
  const rowBytes = image.width * 4;
  const out = new Uint8Array(image.length);
  for (let row = 0; row < image.height; row++) {
    out.set(image.subarray(row * rowBytes, (row + 1) * rowBytes), (image.height - 1 - row) * rowBytes);
  }
  return new DecodedImage(out, image.width, image.height);
}

/** Deliveries waiting for their turn; see deliverOnePerTurn. */
const pendingDeliveries: Array<() => void> = [];

/**
 * Runs `deliver` on a later event-loop turn, at most one per turn. Delivering
 * a decoded image uploads it and builds its mipmaps, and images decoded in
 * parallel finish together; the frame loop gives one turn per frame, so this
 * spreads an asset's uploads over as many frames as it has textures.
 */
function deliverOnePerTurn(deliver: () => void): void {
  pendingDeliveries.push(deliver);
  if (pendingDeliveries.length > 1) return;
  const next = (): void => {
    try {
      pendingDeliveries[0]();
    } finally {
      pendingDeliveries.shift();
      if (pendingDeliveries.length > 0) setImmediate(next);
    }
  };
  setImmediate(next);
}

/** Decodes on a worker, or in place if the workers are gone. */
function decodeOffThread(bytes: Uint8Array, flipY: boolean): Promise<DecodedImage> {
  return decodeOnWorker(bytes, flipY).then(
    ({ pixels, width, height }) => new DecodedImage(pixels, width, height),
    (err: unknown) => {
      if (!(err instanceof ImageDecodeWorkerError)) throw err;
      const image = decodeImage(bytes);
      return flipY ? flipImage(image) : image;
    },
  );
}

/** Decodes off the main thread, then hands over the image in a turn of its own. */
/**
 * An image by URL (a .babylon scene's textures, `new Texture(url)`): fetched
 * through the page's XMLHttpRequest (the platform's: files, http(s) with the
 * mirror), as Babylon's own loader does with forceBitmapOverHTMLImageElement,
 * then decoded on a worker like any image buffer.
 */
/** The part of XMLHttpRequest loadUrlImage uses (Node's lib has no DOM types). */
interface UrlRequest {
  open(method: string, url: string): void;
  send(): void;
  responseType: string;
  readonly response: unknown;
  readonly status: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

function loadUrlImage(url: string, flipY: boolean, onLoad: (img: unknown) => void, onError: (msg: string, exception?: unknown) => void): void {
  const Xhr = (globalThis as { XMLHttpRequest?: new () => UrlRequest }).XMLHttpRequest;
  if (Xhr === undefined) {
    onError(`Error while trying to load image: ${url} (no XMLHttpRequest)`);
    return;
  }
  const request = new Xhr();
  request.open("GET", url);
  request.responseType = "arraybuffer";
  request.onload = () => {
    // 0: a file: URL in some browsers; the platform answers 200 or 404.
    if ((request.status === 200 || request.status === 0) && request.response instanceof ArrayBuffer) {
      loadImageOffThread(new Uint8Array(request.response), flipY, onLoad, onError);
    } else {
      onError(`Error while trying to load image: ${url} (HTTP ${request.status})`);
    }
  };
  request.onerror = () => onError(`Error while trying to load image: ${url} (network error)`);
  request.send();
}

function loadImageOffThread(
  bytes: Uint8Array,
  flipY: boolean,
  onLoad: (img: unknown) => void,
  onError: (msg: string, exception?: unknown) => void,
): void {
  decodeOffThread(bytes, flipY)
    .then(
      (image) => {
        deliverOnePerTurn(() => {
          try {
            onLoad(image);
          } catch (e) {
            onError(`Error while trying to load image: ${String(e)}`, e);
          }
        });
      },
      (e: unknown) => {
        deliverOnePerTurn(() => onError(`Error while trying to load image: ${String(e)}`, e));
      },
    );
}

/**
 * Installs AbstractEngine._FileToolsLoadImage (a mutable static the engine's
 * texture path calls for every image: data URI, buffer or URL).
 *
 * Image buffers (a glTF asset's textures) decode on worker threads and arrive
 * one per event-loop turn, so loading an asset does not stop the frame loop.
 *
 * Data URIs stay SYNCHRONOUS: Babylon's stock LoadImage is async (DOM Image /
 * Blob+createImageBitmap); under long synchronous frames (software GL) its
 * completion microtasks starve and dependent readiness fixes — like the CPU
 * RGBD expansion of the PBR BRDF LUT, which reads the decode-capture hook —
 * can land frames late. Only these fire that hook, so a texture still
 * decoding on a worker cannot be mistaken for the LUT.
 * URLs are fetched through XMLHttpRequest and decode like buffers.
 * Returns null (the DOM variant returns an ImageElement callers ignore).
 */
export async function installHeadlessImageLoading(): Promise<void> {
  const { AbstractEngine } = await import("@babylonjs/core/Engines/abstractEngine.js");
  const engineClass = AbstractEngine as unknown as Record<string, unknown>;
  if (engineClass.__headlessLoadImage === true) return;
  engineClass.__headlessLoadImage = true;
  startImageDecodeWorkers();

  engineClass._FileToolsLoadImage = (
    input: unknown,
    onLoad: (img: unknown) => void,
    onError: (msg: string, exception?: unknown) => void,
    _offlineProvider: unknown,
    _mimeType: string | undefined,
    imageBitmapOptions: { imageOrientation?: string } | undefined,
  ): null => {
    try {
      const flipY = imageBitmapOptions?.imageOrientation === "flipY";
      if (input instanceof ArrayBuffer) {
        loadImageOffThread(new Uint8Array(input), flipY, onLoad, onError);
        return null;
      }
      if (ArrayBuffer.isView(input)) {
        loadImageOffThread(new Uint8Array(input.buffer, input.byteOffset, input.byteLength), flipY, onLoad, onError);
        return null;
      }
      if (typeof input === "string" && !input.startsWith("data:")) {
        loadUrlImage(input, flipY, onLoad, onError);
        return null;
      }
      let src = "";
      let image: DecodedImage;
      if (typeof input === "string") {
        src = input;
        image = decodeDataUriImpl(input);
      } else {
        // Blob or exotic source: fall back to the async polyfill path.
        const globalCib = (globalThis as { createImageBitmap?: (s: unknown, o?: unknown) => Promise<DecodedImage> }).createImageBitmap;
        if (globalCib === undefined) throw new Error("image-polyfill: no createImageBitmap fallback");
        void globalCib(input, imageBitmapOptions).then(
          (bmp) => onLoad(bmp),
          (e) => onError(`Error while trying to load image: ${String(e)}`, e),
        );
        return null;
      }
      if (flipY) {
        image = flipImage(image);
      }
      notifyDecodeCapture(src, image);
      onLoad(image);
      return null;
    } catch (e) {
      onError(`Error while trying to load image: ${String(e)}`, e);
      return null;
    }
  };
}
