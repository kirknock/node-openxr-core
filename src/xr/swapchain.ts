/**
 * The swapchain calls every graphics API makes the same way: the format list,
 * creation, image enumeration, acquire + wait, release and destroy. What
 * differs stays with the renderer: which format it prefers, its image struct
 * (resolved with resolveXrFunction, since xrEnumerateSwapchainImages is typed
 * by it), and how its images are laid out.
 */
import * as gen from "./generated/xr-abi.gen.js";
import type { XrFn } from "./xr-abi.js";
import { xrCheck, type XrHandle } from "./xr-loader.js";

const ACQUIRE_INFO = { type: gen.XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO, next: null };
const WAIT_INFO = { type: gen.XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO, next: null, timeout: 10_000_000_000n };
const RELEASE_INFO = { type: gen.XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO, next: null };

/** The session's swapchain formats (the graphics API's own format numbers), in the runtime's order of preference. */
export function enumerateSwapchainFormats(xr: XrHandle, session: unknown): number[] {
  const count = [0];
  xrCheck(xr.fn.xrEnumerateSwapchainFormats(session, 0, count, null), "xrEnumerateSwapchainFormats(count)");
  const buf = Buffer.alloc(count[0] * 8);
  xrCheck(xr.fn.xrEnumerateSwapchainFormats(session, count[0], count, buf), "xrEnumerateSwapchainFormats");
  return Array.from({ length: count[0] }, (_, i) => Number(buf.readBigInt64LE(i * 8)));
}

export interface SwapchainOptions {
  format: number;
  width: number;
  height: number;
  /** Default 1. */
  arraySize?: number;
  /** Default XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT. */
  usageFlags?: number;
}

/** A single-sample, single-mip 2D swapchain. `label` names the call in errors. */
export function createSwapchain(xr: XrHandle, session: unknown, options: SwapchainOptions, label = "xrCreateSwapchain"): unknown {
  const out = [null];
  xrCheck(
    xr.fn.xrCreateSwapchain(
      session,
      {
        type: gen.XR_TYPE_SWAPCHAIN_CREATE_INFO,
        next: null,
        createFlags: 0,
        usageFlags: options.usageFlags ?? gen.XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT,
        format: options.format,
        sampleCount: 1,
        width: options.width,
        height: options.height,
        faceCount: 1, // Monado rejects 0; 1 = plain 2D texture
        arraySize: options.arraySize ?? 1,
        mipCount: 1,
      },
      out,
    ),
    label,
  );
  return out[0];
}

/**
 * The `image` field of each of the swapchain's images. `enumerate` is
 * xrEnumerateSwapchainImages resolved with the API's image struct, whose
 * structure type is `imageType`.
 */
export function enumerateSwapchainImages(enumerate: XrFn, swapchain: unknown, imageType: number): unknown[] {
  const count = [0];
  xrCheck(enumerate(swapchain, 0, count, null), "xrEnumerateSwapchainImages(count)");
  const images: Array<Record<string, unknown>> = Array.from({ length: count[0] }, () => ({ type: imageType, next: null, image: 0 }));
  xrCheck(enumerate(swapchain, count[0], count, images), "xrEnumerateSwapchainImages");
  return images.map((image) => image.image);
}

/** Acquires the next image and waits for it (a timeout is tolerated); returns its index. */
export function acquireSwapchainImage(xr: XrHandle, swapchain: unknown): number {
  const indexOut = [0];
  xrCheck(xr.fn.xrAcquireSwapchainImage(swapchain, ACQUIRE_INFO, indexOut), "xrAcquireSwapchainImage");
  const waitResult = xr.fn.xrWaitSwapchainImage(swapchain, WAIT_INFO);
  if (waitResult !== 0 && waitResult !== gen.XR_RESULT_TIMEOUT_EXPIRED) xrCheck(waitResult, "xrWaitSwapchainImage");
  return indexOut[0];
}

export function releaseSwapchainImage(xr: XrHandle, swapchain: unknown, label = "xrReleaseSwapchainImage"): void {
  xrCheck(xr.fn.xrReleaseSwapchainImage(swapchain, RELEASE_INFO), label);
}

/** Destroys every swapchain in `handles` and empties it. */
export function destroySwapchains(xr: XrHandle, handles: unknown[]): void {
  for (const swapchain of handles) xrCheck(xr.fn.xrDestroySwapchain(swapchain), "xrDestroySwapchain");
  handles.length = 0;
}
