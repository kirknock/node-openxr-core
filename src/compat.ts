/**
 * Third-party internals this app depends on, and the exact versions they
 * were verified against. Babylon.js, IWER and the native packages are not
 * used through their public APIs alone — the headless/native integration
 * reaches into private members — so an upgrade must be re-verified (all
 * smokes + an app run) before TESTED is bumped.
 *
 * Private touch-points (grep for the member to find the code). Paths are
 * under packages/<package>/src, nodexr-core's without the package prefix:
 *   @babylonjs/core
 *     StandardMaterial/PBRBaseMaterial
 *       ._ShaderLoader                     platform/babylon-headless.ts (lazy shader imports)
 *     Effect._processShaderCodeAsync       platform/babylon-headless.ts (why the above is needed)
 *     AbstractEngine._features             platform/babylon-headless.ts (bitmap image loads)
 *     AbstractEngine._FileToolsLoadImage   platform/image-polyfill.ts (replaced: workers, data URIs sync, URLs via XHR)
 *     Engine._CommonInit                   platform/headless-canvas.ts (canvas surface it touches)
 *     InternalTexture._isRGBD,
 *       InternalTexture._swapAndDie        platform/headless-rgbd.ts (CPU RGBD expansion)
 *     WebXRCamera._updateReferenceSpace    (behaviour relied on; webxr/iwer-runtime.ts)
 *     InternalTexture._dynamicTextureSource  puppeteer/headless-panel/headless-pane.ts (released after upload)
 *     WebGPUTextureManager.updateTexture   webgpu/babylon-bridges.ts (bitmap and canvas uploads)
 *     WebGPUTintWASM._TwgslDefaultOptions, the self.glslang/self.twgsl lookup  webgpu/babylon-bridges.ts (local shader compilers)
 *     PostProcessManager._finalizeFrame, WebGPUEngine.bindFramebuffer  webgpu/babylon-bridges.ts (XR array layer; re-check, may be fixed upstream)
 *     WebGPU XR path: XRGPUBinding, XRGPUSubImage and their members it reads   webgpu/xr/
 *   @babylonjs/loaders
 *     GLTFLoader._loadMeshPrimitiveAsync   babylon/load-asset.ts (extension hook; re-enters the loader)
 *     behaviour relied on: a mesh's bounds are computed when its load completes   babylon/load-asset.ts
 *   iwer
 *     XRReferenceSpace.getOffsetReferenceSpace (patched)   webxr/iwer-runtime.ts
 *     XRFrame.getViewerPose (patched: exact per-eye poses via the eye
 *       spaces' offsets — XRSpaceUtils.updateOffsetMatrix, a deep import,
 *       on device.viewSpaces — and projections, mutating
 *       XRView.projectionMatrix in place)                  webxr/iwer-runtime.ts
 *     XRSession.updateRenderState, .renderState, XRFrame.getViewerPose (wrapped for layers)  webgpu/xr/install.ts
 *     behaviour relied on: XRWebGLLayer framebuffer = null with left|right
 *       viewports, the canvas sized to window.innerWidth/innerHeight, the
 *       per-frame clear of the default framebuffer         webgl/platform.ts
 *   koffi                                  native ABI — version pinned as well
 *   dawn.node                              patched build: packages/dawn/third_party/dawn (docs/webgpu-zero-copy.md)
 *   puppeteer                              decides the Chrome version the package bundles; repackage after upgrading
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./log.js";

const compatLog = logger("compat");

/** Exact versions everything above was verified with (= package.json pins). */
export const TESTED_VERSIONS: Readonly<Record<string, string>> = {
  "@babylonjs/core": "9.33.2",
  "@babylonjs/loaders": "9.33.2",
  iwer: "2.7.0",
  koffi: "2.16.3",
  puppeteer: "25.16.0",
  "@napi-rs/canvas": "1.0.11",
};

/** The copy of `pkg` that nodexr-core itself resolves, or null if none. */
function resolvedPackageJson(pkg: string): string | null {
  try {
    return fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
  } catch {
    return null;
  }
}

function installedVersion(pkg: string): string | null {
  const file = resolvedPackageJson(pkg);
  if (file === null) return null;
  return (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version ?? null;
}

/**
 * The platform patches the classes of the Babylon and IWER copies it
 * imports, and koffi's struct registry is per copy: an app that resolves a
 * second copy of any of them gets unpatched classes. nodexr packages take
 * these as peer dependencies so the app's copy is the only one; this
 * compares the app's (node_modules/ under the working directory) with
 * nodexr-core's. Returns the packages with two copies.
 */
export function checkSingleCopies(appRoot = process.cwd()): string[] {
  const doubled: string[] = [];
  for (const pkg of Object.keys(TESTED_VERSIONS)) {
    const appCopy = join(appRoot, "node_modules", pkg);
    const coreCopy = resolvedPackageJson(pkg);
    if (!existsSync(appCopy) || coreCopy === null) continue;
    if (realpathSync(appCopy) !== realpathSync(dirname(coreCopy))) doubled.push(`${pkg}: app ${realpathSync(appCopy)}, nodexr-core ${realpathSync(dirname(coreCopy))}`);
  }
  if (doubled.length > 0) {
    compatLog.warn(`TWO COPIES of a shared dependency — the app's is not the one the platform patched:\n  ${doubled.join("\n  ")}`);
  }
  return doubled;
}

/**
 * Warns loudly (does not abort) when an installed dependency differs from
 * the verified version. Returns the mismatches, e.g. for tests.
 */
export function checkDependencyVersions(): string[] {
  const mismatches: string[] = [];
  for (const [pkg, tested] of Object.entries(TESTED_VERSIONS)) {
    const installed = installedVersion(pkg);
    // An app need not install everything (the PoC has no puppeteer).
    if (installed === null) continue;
    if (installed !== tested) mismatches.push(`${pkg} ${installed ?? "(unresolved)"} (verified: ${tested})`);
  }
  if (mismatches.length > 0) {
    compatLog.warn(
      `UNVERIFIED dependency versions — private internals may have changed (see nodexr-core src/compat.ts):\n  ` +
        mismatches.join("\n  "),
    );
  }
  return mismatches;
}
