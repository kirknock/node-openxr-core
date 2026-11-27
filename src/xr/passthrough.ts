/**
 * XR_FB_passthrough activation (passthrough mode): on runtimes whose client
 * owns the camera (WiVRn + Pico), merely submitting ALPHA_BLEND layers does
 * not turn the feed on — the extension's create + start does. Returns null
 * (with a note) when the runtime does not advertise the extension.
 */
import koffi from "koffi";
import { xrCheck, type XrHandle } from "./xr-loader.js";
import { XR_TYPE_PASSTHROUGH_CREATE_INFO_FB } from "./post-1-0-20.js";
import { logger } from "../log.js";

const sessionLog = logger("session");

export function startFbPassthrough(xr: XrHandle, session: unknown): unknown {
  const create = xr.fn.xrCreatePassthroughFB;
  const start = xr.fn.xrPassthroughStartFB;
  if (create === undefined || start === undefined) {
    sessionLog.warn("XR_FB_passthrough not advertised by this runtime — relying on the blend mode alone");
    return null;
  }
  const infoPtr = koffi.alloc(koffi.resolve("XrPassthroughCreateInfoFB"), 1);
  koffi.encode(infoPtr, 0, "XrPassthroughCreateInfoFB", {
    type: XR_TYPE_PASSTHROUGH_CREATE_INFO_FB,
    next: null,
    flags: 0,
  });
  const out = [null];
  xrCheck(create(session, infoPtr, out), "xrCreatePassthroughFB");
  xrCheck(start(out[0]), "xrPassthroughStartFB");
  sessionLog.info("XR_FB_passthrough started (camera feed requested)");
  return out[0];
}

export function destroyFbPassthrough(xr: XrHandle, passthrough: unknown): void {
  xrCheck(xr.fn.xrDestroyPassthroughFB(passthrough), "xrDestroyPassthroughFB");
}

/** Pauses / resumes a created passthrough (XR_FB_passthrough). */
export function setFbPassthroughRunning(xr: XrHandle, passthrough: unknown, running: boolean): void {
  if (running) {
    xrCheck(xr.fn.xrPassthroughStartFB(passthrough), "xrPassthroughStartFB");
  } else {
    xrCheck(xr.fn.xrPassthroughPauseFB(passthrough), "xrPassthroughPauseFB");
  }
  sessionLog.info(`XR_FB_passthrough ${running ? "resumed" : "paused"}`);
}

