/**
 * 2D canvas for the platform: `document.createElement("canvas")` returns an
 * @napi-rs/canvas canvas (Skia, prebuilt binary) with the few DOM members
 * Babylon touches added. Babylon's DynamicTexture — the stock teleport
 * landing zone, GUI, text textures — draws into it with the standard 2D
 * API; uploads go through the WebGL2 shim, which reads canvases via
 * getImageData (nodexr-webgl webgl2-shim.ts asDomPixels).
 *
 * Only the 2D context is offered: the app's WebGL2 canvas is the platform's
 * own (startNodeXR().canvas), not a document-created one.
 */
import { createCanvas } from "@napi-rs/canvas";

/** A browser-ish canvas element backed by @napi-rs/canvas. */
export function createDomCanvas(width = 300, height = 150): unknown {
  const canvas = createCanvas(width, height);
  const getContext = canvas.getContext.bind(canvas);
  return Object.assign(canvas, {
    style: {},
    dataset: {},
    parentElement: null,
    ownerDocument: (globalThis as { document?: unknown }).document ?? null,
    tagName: "CANVAS",
    nodeName: "CANVAS",
    addEventListener(): void {},
    removeEventListener(): void {},
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: canvas.width, bottom: canvas.height, width: canvas.width, height: canvas.height }),
    // 2D only; WebGL contexts come from the platform canvas.
    getContext: (type: string, options?: unknown) => (type === "2d" ? getContext("2d", options as never) : null),
  });
}

/** Routes document.createElement("canvas") to createDomCanvas. */
export function installCanvas2d(): void {
  const doc = (globalThis as { document?: { createElement?: (tag: string) => unknown } }).document;
  if (doc === undefined || typeof doc.createElement !== "function") {
    throw new Error("installCanvas2d: install the document shim first");
  }
  const original = doc.createElement.bind(doc);
  doc.createElement = (tag: string) => (tag.toLowerCase() === "canvas" ? createDomCanvas() : original(tag));
}
