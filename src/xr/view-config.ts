/**
 * PRIMARY_STEREO view configuration queries: per-eye recommended sizes,
 * environment blend modes (and the passthrough choice among them), and
 * display refresh rates (XR_FB_display_refresh_rate, when present).
 */
import * as gen from "./generated/xr-abi.gen.js";
import { xrCheck, type XrHandle } from "./xr-loader.js";
import { logger } from "../log.js";

const sessionLog = logger("session");

const STEREO = gen.XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;

export interface EyeViewInfo {
  recommendedWidth: number;
  recommendedHeight: number;
}

const BLEND_MODE_NAMES: Record<number, string> = {
  [gen.XR_ENVIRONMENT_BLEND_MODE_OPAQUE]: "OPAQUE",
  [gen.XR_ENVIRONMENT_BLEND_MODE_ADDITIVE]: "ADDITIVE",
  [gen.XR_ENVIRONMENT_BLEND_MODE_ALPHA_BLEND]: "ALPHA_BLEND",
};
export const blendModeName = (mode: number): string => BLEND_MODE_NAMES[mode] ?? `0x${mode.toString(16)}`;

export function enumerateEyeViews(xr: XrHandle, systemId: number): EyeViewInfo[] {
  const countOut = [0];
  xrCheck(
    xr.fn.xrEnumerateViewConfigurationViews(xr.raw, systemId, STEREO, 0, countOut, null),
    "xrEnumerateViewConfigurationViews(count)",
  );
  const cfgViews: Array<Record<string, unknown>> = Array.from({ length: countOut[0] }, () => ({
    type: gen.XR_TYPE_VIEW_CONFIGURATION_VIEW,
    next: null,
  }));
  xrCheck(
    xr.fn.xrEnumerateViewConfigurationViews(xr.raw, systemId, STEREO, countOut[0], countOut, cfgViews),
    "xrEnumerateViewConfigurationViews",
  );
  return cfgViews.map((v) => ({
    recommendedWidth: Number(v.recommendedImageRectWidth),
    recommendedHeight: Number(v.recommendedImageRectHeight),
  }));
}

export function enumerateBlendModes(xr: XrHandle, systemId: number): number[] {
  const count = [0];
  xrCheck(
    xr.fn.xrEnumerateEnvironmentBlendModes(xr.raw, systemId, STEREO, 0, count, null),
    "xrEnumerateEnvironmentBlendModes(count)",
  );
  // XrEnvironmentBlendMode is a 32-bit C enum (like the
  // environmentBlendMode field in XrFrameEndInfo). A target run showed
  // two values packed into one int64 slot when this was read as 8-byte.
  const buf = Buffer.alloc(count[0] * 4);
  xrCheck(
    xr.fn.xrEnumerateEnvironmentBlendModes(xr.raw, systemId, STEREO, count[0], count, buf),
    "xrEnumerateEnvironmentBlendModes",
  );
  return Array.from({ length: count[0] }, (_, i) => buf.readUInt32LE(i * 4));
}

/**
 * Blend mode to submit: OPAQUE unless passthrough is requested, then
 * ALPHA_BLEND (preferred) or ADDITIVE — so the compositor shows the world
 * through our transparent background. Never fails: falls back to OPAQUE.
 */
export function chooseBlendMode(supported: number[], passthrough: boolean, premultiplied: boolean): number {
  sessionLog.info(`environment blend modes: [${supported.map(blendModeName).join(", ")}]`);
  if (!passthrough) return gen.XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
  const preferred =
    supported.find((m) => m === gen.XR_ENVIRONMENT_BLEND_MODE_ALPHA_BLEND) ??
    supported.find((m) => m === gen.XR_ENVIRONMENT_BLEND_MODE_ADDITIVE);
  if (preferred === undefined) {
    sessionLog.warn("passthrough requested but the runtime only supports OPAQUE — continuing opaque");
    return gen.XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
  }
  sessionLog.info(
    `passthrough requested: blend mode ${blendModeName(preferred)}` +
      (premultiplied ? " + PREMULTIPLIED layer alpha" : " + straight layer alpha"),
  );
  return preferred;
}

/** Refresh rates via XR_FB_display_refresh_rate ([] when unavailable). */
export function enumerateRefreshRates(xr: XrHandle, session: unknown): number[] {
  const fn = xr.fn.xrEnumerateDisplayRefreshRatesFB;
  if (fn === undefined) return [];
  const count = [0];
  if ((fn(session, 0, count, null)) !== 0 || count[0] === 0) return [];
  const buffer = Buffer.alloc(count[0] * 4);
  if ((fn(session, count[0], count, buffer)) !== 0) return [];
  const rates = Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, count[0]));
  sessionLog.info(`display refresh rates (Hz): ${rates.map((r) => r.toFixed(0)).join(", ")}`);
  return rates;
}
