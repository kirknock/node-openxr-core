/**
 * What an OpenXR session needs from its graphics API (session.ts holds the rest
 * of the lifecycle): the instance extensions, the session's graphics binding,
 * the swapchains and what ends a frame's rendering. `Image` is how the API names
 * an acquired swapchain image.
 */
import koffi from "koffi";
import * as gen from "./generated/xr-abi.gen.js";
import { xrSplitVersion, type XrFn } from "./xr-abi.js";
import { xrCheck, type LoaderBootstrap, type XrHandle } from "./xr-loader.js";

/** Where one eye's view lives: swapchain index + pixel rect within it (+ array layer, default 0). */
export interface EyeSubImage {
  swapchain: number;
  arrayIndex?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionContext {
  xr: XrHandle;
  bootstrap: LoaderBootstrap;
  systemId: number;
}

export interface SessionSwapchains<Image> {
  /** Native swapchain handles. */
  readonly handles: unknown[];
  readonly eyeCount: number;
  /** The per-eye view size. */
  readonly width: number;
  readonly height: number;
  /** Width of one swapchain image. */
  readonly imageWidth: number;
  /** Where eye `eye`'s view is rendered (for the projection layer). */
  subImage(eye: number): EyeSubImage;
  /** Acquires + waits the next image of swapchain `index`. */
  acquire(index: number): Image;
  release(index: number): void;
  destroy(): void;
}

export interface SessionGraphics<Image> {
  /** Instance extensions the binding requires. */
  readonly extensions: readonly string[];
  /** Timing stage name of finishRendering. */
  readonly finishStage: string;
  /** Sets up the graphics API, then calls xrCreateSession with its binding. */
  createSession(context: SessionContext): unknown | Promise<unknown>;
  createSwapchains(context: SessionContext, session: unknown, eyeCount: number, width: number, height: number): SessionSwapchains<Image>;
  /** Everything rendered into the acquired images reaches the GPU; called before they are released. */
  finishRendering(): void;
  /** CPU pixel path, for APIs that offer it: acquire, upload the RGBA8 rows verbatim, release. */
  uploadPixels?(eye: number, pixels: Uint8Array): void;
  /** After the session is destroyed, before the instance. */
  destroy?(): void;
}

/**
 * Queries the graphics API's version requirements, which the spec requires
 * before xrCreateSession; `getRequirements` is the API's
 * xrGet…GraphicsRequirements… function and `type` its struct's structure type.
 * Returns the supported range as "major.minor .. major.minor", for the log.
 */
export function queryGraphicsRequirements(getRequirements: XrFn, { xr, systemId }: SessionContext, type: number, call: string): string {
  const requirements: Record<string, unknown> = { type, next: null };
  xrCheck(getRequirements(xr.raw, systemId, requirements), call);
  const min = xrSplitVersion(Number(requirements.minApiVersionSupported));
  const max = xrSplitVersion(Number(requirements.maxApiVersionSupported));
  return `${min.major}.${min.minor} .. ${max.major}.${max.minor}`;
}

/**
 * xrCreateSession with the graphics binding `binding` (a struct of koffi
 * type `bindingStruct`, encoded to C memory) in the create info's next
 * chain. `label` names the call in errors.
 */
export function createBoundSession({ xr, systemId }: SessionContext, bindingStruct: string, binding: Record<string, unknown>, label: string): unknown {
  const bindingPtr = koffi.alloc(koffi.resolve(bindingStruct), 1);
  koffi.encode(bindingPtr, 0, bindingStruct, binding);
  const sessionOut = [null];
  xrCheck(
    xr.fn.xrCreateSession(xr.raw, { type: gen.XR_TYPE_SESSION_CREATE_INFO, next: bindingPtr, createFlags: 0, systemId }, sessionOut),
    label,
  );
  return sessionOut[0];
}
