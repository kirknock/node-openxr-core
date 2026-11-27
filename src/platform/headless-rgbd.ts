/**
 * Headless RGBD expansion for Babylon's environment BRDF LUTs.
 *
 * PBR materials gate on the scene's environment BRDF lookup texture. Babylon
 * loads it from an embedded PNG (hangs in Node without the image polyfill)
 * and then expands its RGBD encoding with a GPU post-process — whose effect
 * creation stalls headless (its shader modules are lazy-imported and never
 * settle under tsx). Every PBR material then stays "not ready" forever.
 *
 * This module replaces `RGBDTextureTools.ExpandRGBDTexture` with a CPU
 * equivalent: when the LUT finishes decoding (the image polyfill captured
 * its pixels), expand to half-float — matching the GPU path's output type —
 * and swap it into the existing InternalTexture. Only RGBD-flagged textures
 * (the LUTs) are affected, so GLB textures are never touched.
 */
import { captureImageDecodes, type DecodedImage } from "./image-polyfill.js";
import { logger } from "../log.js";

const renderLog = logger("render");

/** Exact sRGB EOTF (helperFunctions.glsl toLinearSpaceExact). */
const toLinear = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x * 0.07739938080295687 : Math.pow(0.9478672995430183 * (x + 0.055), 2.4);
};

/** Vertical flip of RGBA texel rows (4 components per texel). */
function flipRows<T extends Uint16Array | Float32Array>(
  data: T,
  width: number,
  ctor: new (n: number) => T,
): T {
  const out = new ctor(data.length);
  const rowTexels = width * 4;
  const rows = data.length / rowTexels;
  for (let row = 0; row < rows; row++) {
    out.set(data.subarray(row * rowTexels, (row + 1) * rowTexels), (rows - 1 - row) * rowTexels);
  }
  return out;
}

/** IEEE754 float32 -> float16 bits. */
function toHalfFloat(value: number): number {  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 31) & 0x1;
  let exponent = (x >>> 23) & 0xff;
  let mantissa = x & 0x7fffff;
  if (exponent === 0xff) return (sign << 15) | 0x7c00 | (mantissa !== 0 ? 0x200 : 0);
  exponent = exponent - 127 + 15;
  if (exponent >= 0x1f) return (sign << 15) | 0x7c00;
  if (exponent <= 0) {
    if (exponent < -10) return sign << 15;
    mantissa = (mantissa | 0x800000) >>> (1 - exponent);
    return (sign << 15) | (mantissa >>> 13);
  }
  return (sign << 15) | (exponent << 10) | (mantissa >>> 13);
}

/**
 * Installs the CPU RGBD expansion (once). Must be called after
 * installImagePolyfills; keeps a permanent decode-capture so the LUT's
 * pixels are available when its load completes.
 */
export async function installHeadlessRgbdExpansion(): Promise<void> {
  const { RGBDTextureTools } = await import("@babylonjs/core/Misc/rgbdTextureTools.js");
  const tools = RGBDTextureTools as unknown as Record<string, unknown>;
  if (tools.__headlessPatch === true) return;
  tools.__headlessPatch = true;

  // Only the newest decode: keeping them all would pin every image ever loaded.
  let latestDecode: DecodedImage | undefined;
  captureImageDecodes((_src, image) => {
    latestDecode = image;
  });

  const original = tools.ExpandRGBDTexture as (texture: never) => void;
  tools.ExpandRGBDTexture = (textureArg: unknown): void => {
    const texture = textureArg as {
      _texture?: {
        width: number; height: number; isReady: boolean; type: number; samplingMode: number;
        invertY: boolean; _isRGBD?: boolean; getEngine?: () => import("@babylonjs/core").AbstractEngine;
        _swapAndDie?: (other: unknown) => void;
      };
      isRGBD?: boolean;
      getScene?: () => import("@babylonjs/core").Scene;
      onLoadObservable?: { addOnce(cb: () => void): void };
    };
    const internal = texture._texture;
    if (internal === undefined || internal === null || texture.isRGBD !== true) {
      (original as (t: unknown) => void)(textureArg);
      return;
    }

    const engine = internal.getEngine?.() ?? texture.getScene?.().getEngine();
    if (engine === undefined) return;
    // The original GPU expansion required float RENDERING (its postprocess
    // target), which the caps describe; this CPU expansion only needs float
    // STORAGE + LINEAR FILTERING, which GLES3/WebGL2 core guarantee for
    // RGBA16F — so always expand to half float regardless of caps. Without
    // expansion the LUT's raw RGBD bytes (values near 1.0) are sampled as
    // linear multipliers and every PBR material blows out to white.
    const textureType = 2; // TEXTURETYPE_HALF_FLOAT

    let done = false;
    const expand = (): void => {
      if (done) return; // observable + poll can both fire
      done = true;
      // The most recent captured decode at this point is the LUT itself
      // (its createImageBitmap resolves right before this onLoad fires).
      const image = latestDecode;
      if (image === undefined || image.width !== internal.width || image.height !== internal.height) {
        internal.isReady = true; // pixels unavailable; unblock rather than hang
        return;
      }
      const texels = image.width * image.height;
      const componentCount = texels * 4;
      const expanded =
        textureType === 2
          ? new Uint16Array(componentCount)
          : new Float32Array(componentCount);
      for (let i = 0; i < texels; i++) {
        const s = i * 4;
        const a = Math.max(image[s + 3], 1) / 255;
        const channels = [toLinear(image[s]) / a, toLinear(image[s + 1]) / a, toLinear(image[s + 2]) / a, 1];
        for (let c = 0; c < 4; c++) {
          expanded[s + c] = textureType === 2 ? toHalfFloat(channels[c]) : channels[c];
        }
      }

      // Row-orientation parity with the browser flow. WebGPU: the polyfill
      // already flipped the captured image (imageOrientation "flipY"), so
      // upload as-is. WebGL2: the captured image is still top-first and the
      // browser path flips at upload (UNPACK_FLIP_Y) — the shim only CPU-flips
      // 8-bit data, so flip the float rows here.
      let data: Uint16Array | Float32Array = expanded;
      if ((engine as unknown as { isWebGPU?: boolean }).isWebGPU !== true) {
        data = expanded instanceof Uint16Array
          ? flipRows(expanded, image.width, Uint16Array)
          : flipRows(expanded, image.width, Float32Array);
      }
      internal.type = textureType;
      internal._isRGBD = false;
      internal.invertY = false;
      internal.isReady = false;
      const swapIn = engine.createRawTexture(
        data,
        image.width,
        image.height,
        5, // Engine.TEXTUREFORMAT_RGBA
        false,
        false,
        internal.samplingMode,
        null,
        textureType,
      ) as unknown as { _swapAndDie?: (other: unknown) => void };
      swapIn._swapAndDie?.(internal);
      internal.isReady = true;
      renderLog.info(
        `RGBD LUT expanded on CPU (${image.width}x${image.height}, type=${textureType === 2 ? "half" : "float"})`,
      );
    };

    if (internal.isReady) {
      expand();
      return;
    }
    // Trigger on the ENGINE-level observable: it is notified at the end of
    // the engine's texture-load lambda (the Texture-wrapper's own
    // onLoadObservable is not guaranteed to fire for every creation path).
    const internalAny = internal as unknown as {
      isReady: boolean;
      onLoadedObservable?: { addOnce(cb: () => void): void };
    };
    let armed = false;
    const arm = (): void => {
      if (armed || internalAny.isReady) {
        expand();
        return;
      }
      armed = true;
      internalAny.onLoadedObservable?.addOnce(expand);
      // Belt and braces: poll briefly in case the observable already fired.
      let tries = 0;
      const poll = (): void => {
        if (internalAny.isReady) {
          expand();
          return;
        }
        if (++tries < 500) setTimeout(poll, 10);
      };
      setTimeout(poll, 10);
    };
    arm();
  };
}
