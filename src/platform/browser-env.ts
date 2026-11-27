/**
 * The browser surface a Babylon.js app expects, whichever renderer it runs on:
 * globals (self/navigator/window/document), a real 2D canvas behind
 * document.createElement("canvas"), XMLHttpRequest, the headless Babylon bridges
 * (images, PBR), and the app's canvas, which the renderer provides along with
 * its own globals (nodexr-webgl webgl2-engine.ts, nodexr-webgpu platform.ts).
 */
import { pathToFileURL } from "node:url";
import { documentShim } from "./headless-canvas.js";

/** What a browser app passes to `new Engine(canvas)` (an HTMLCanvasElement). */
export type AppCanvas = ConstructorParameters<typeof import("@babylonjs/core").Engine>[0];

/** Browser globals Babylon's engines touch at import/construction. */
export function installBrowserGlobals(): void {
  const G = globalThis as Record<string, unknown>;
  G.self ??= globalThis;
  G.navigator ??= { userAgent: "node-openxr", maxTouchPoints: 0, hardwareConcurrency: 1 };
  G.window ??= {
    addEventListener(): void {
      /* no-op */
    },
    removeEventListener(): void {
      /* no-op */
    },
    matchMedia: () => ({ matches: false, addEventListener(): void {} }),
    devicePixelRatio: 1,
  };
  documentShim();
}

/** The browser surface around whichever canvas the renderer's context lives on. */
export async function installBrowserEnvironment(width: number, height: number, createCanvas: () => unknown): Promise<AppCanvas> {
  installBrowserGlobals();
  const { installCanvas2d } = await import("./canvas-2d.js");
  installCanvas2d(); // document.createElement("canvas") -> real 2D canvas
  const { installXmlHttpRequest } = await import("./xhr.js");
  installXmlHttpRequest(); // Babylon's loaders: http(s) via fetch + mirror, files from disk
  const { configureMirror } = await import("./mirror.js");
  const { xrEnv } = await import("../config.js");
  configureMirror({ mode: xrEnv().net });
  const { installBabylonHeadless } = await import("./babylon-headless.js");
  await installBabylonHeadless(); // images, PBR — for any app content
  const canvas = (await createCanvas()) as AppCanvas;
  // Browser invariant IWER relies on: an immersive session sizes the canvas
  // to the window (IWER's XRWebGLLayer then splits it left|right) — the
  // window IS the side-by-side image.
  const G = globalThis as unknown as Record<string, unknown> & { window: Record<string, unknown> };
  // window.requestAnimationFrame is the frame-pumped one (env-shims): Babylon
  // queues render-loop iterations through the host window, and its
  // setTimeout fallback would only run when the event loop gets a turn.
  // The "page" lives in the working directory: relative URLs (asset loads)
  // resolve against it, as against a browser page's location.
  const location = new URL(pathToFileURL(`${process.cwd()}/index.html`).href);
  Object.assign(G.window, {
    innerWidth: width,
    innerHeight: height,
    requestAnimationFrame: G.requestAnimationFrame,
    cancelAnimationFrame: G.cancelAnimationFrame,
    location,
  });
  G.location ??= location;
  return canvas;
}
