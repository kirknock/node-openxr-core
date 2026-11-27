/**
 * Operating profiles for the two deployment targets:
 *
 *  dev  — development VM (this machine): llvmpipe software GL + Monado null
 *         HMD. Low fps is expected and fine; nothing warns or aborts.
 *  perf — target hardware (RTX 40-series, WiVRn, Pico 4): hardware GL via
 *         the GBM EGL platform cascade; llvmpipe triggers a loud warning
 *         because it fully explains low fps.
 *  auto — decide after the first GL context exists (llvmpipe => dev).
 *
 * Env (parsed in config.ts): XR_PROFILE, XR_RENDER_SCALE, XR_TIMING,
 * XR_PASSTHROUGH.
 */

import { xrEnv } from "./config.js";

export type ProfileMode = "dev" | "perf";

export interface AppProfile {
  mode: ProfileMode;
  /** Explicit or auto; auto resolves to a mode once GL renderer is known. */
  requested: "dev" | "perf" | "auto";
  renderScale: number;
  timing: boolean;
  /** See-through passthrough requested (XR_PASSTHROUGH). Best effort. */
  passthrough: boolean;
}

export function resolveProfile(): AppProfile {
  const env = xrEnv();
  const requested = env.profile;
  const mode: ProfileMode = requested === "auto" ? "dev" : requested;
  return {
    mode,
    requested,
    renderScale: env.renderScale,
    timing: env.timing ?? mode === "perf",
    passthrough: env.passthrough,
  };
}

/** Resolve the auto profile once the GL renderer string is known. */
export function settleAutoProfile(profile: AppProfile, glRenderer: string): AppProfile {
  if (profile.requested !== "auto") return profile;
  const software = /llvmpipe|softpipe|swiftshader/i.test(glRenderer);
  return {
    ...profile,
    mode: software ? "dev" : "perf",
    timing: xrEnv().timing !== undefined ? profile.timing : !software,
  };
}
