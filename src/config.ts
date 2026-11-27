/**
 * Every XR_* environment variable the app reads, parsed in one place.
 *
 *   XR_PROFILE        dev | perf | auto (default auto)       see profile.ts
 *   XR_RENDER_SCALE   0 < s <= 1 (default 1)                 swapchain + RTT scale
 *   XR_TIMING         1 | 0 (default: on under perf)         per-stage frame timing
 *   XR_PASSTHROUGH    1                                      see-through presentation
 *   XR_RENDERER       webgl2 | webgpu (default webgl2)       the app's engine; --renderer overrides; never falls back
 *   XR_WEBGPU_VALIDATE 1                                     WebGPU runs: Vulkan validation layers, if installed
 *   XR_PT_PREMULT     0 = straight layer alpha (default premultiplied)
 *   XR_EYE_HEIGHT     metres (default 1.6)                   LOCAL fallback floor offset
 *   XR_NET            auto | offline | online (default auto) remote fetches vs mirror/ (platform/mirror.ts)
 *   XR_SYNTH_INPUT    1 (dev VM only)                        fixed controller poses + demo input
 *   XR_INPUT_DEBUG    1                                      input/pose/controller debug logs
 *   XR_SCENE_DEBUG    1                                      per-frame floor-flash probe (costs fps)
 *   XR_PIXEL_DEBUG    1                                      swapchain pixel samples every 30 frames (costs fps)
 *   XR_GL_DEBUG       1                                      WebGL2 shim: glGetError after every call
 *   XR_GL_TRACE       all                                    ... plus logging of key pipeline calls
 *
 * XR_RUNTIME_JSON is deliberately not here: it is the OpenXR loader's own
 * contract (the native loader reads it too) and stays in xr/xr-loader.ts.
 *
 * Parsed lazily on first use, then cached: a script may still set
 * process.env in its body (which runs after its hoisted imports).
 */
export type Renderer = "webgl2" | "webgpu";

/** An unknown name is an error: a typo must not silently run the other renderer. */
export function parseRenderer(value: string | undefined): Renderer {
  if (value === undefined || value === "" || value === "webgl2") return "webgl2";
  if (value === "webgpu") return "webgpu";
  throw new Error(`unknown renderer "${value}" (webgl2 | webgpu)`);
}

export interface XrEnv {
  profile: "dev" | "perf" | "auto";
  renderScale: number;
  /** undefined = profile default. */
  timing: boolean | undefined;
  passthrough: boolean;
  renderer: Renderer;
  webgpuValidate: boolean;
  premultipliedAlpha: boolean;
  eyeHeight: number;
  net: "auto" | "offline" | "online";
  synthInput: boolean;
  debug: { input: boolean; scene: boolean; pixel: boolean; gl: boolean; glTraceAll: boolean };
}

let cached: XrEnv | null = null;

export function xrEnv(): XrEnv {
  if (cached !== null) return cached;
  const e = process.env;
  const scale = Number(e.XR_RENDER_SCALE ?? "1");
  const eyeHeight = Number(e.XR_EYE_HEIGHT ?? "1.6");
  cached = Object.freeze({
    profile: e.XR_PROFILE === "perf" || e.XR_PROFILE === "dev" ? e.XR_PROFILE : "auto",
    renderScale: Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 1,
    timing: e.XR_TIMING !== undefined ? e.XR_TIMING === "1" : undefined,
    passthrough: e.XR_PASSTHROUGH === "1",
    renderer: parseRenderer(e.XR_RENDERER),
    webgpuValidate: e.XR_WEBGPU_VALIDATE === "1",
    premultipliedAlpha: e.XR_PT_PREMULT !== "0",
    eyeHeight: Number.isFinite(eyeHeight) && eyeHeight > 0 ? eyeHeight : 1.6,
    net: e.XR_NET === "offline" || e.XR_NET === "online" ? e.XR_NET : "auto",
    synthInput: e.XR_SYNTH_INPUT === "1",
    debug: Object.freeze({
      input: e.XR_INPUT_DEBUG === "1",
      scene: e.XR_SCENE_DEBUG === "1",
      pixel: e.XR_PIXEL_DEBUG === "1",
      gl: e.XR_GL_DEBUG === "1",
      glTraceAll: e.XR_GL_TRACE === "all",
    }),
  });
  return cached;
}
