/**
 * Installs IWER (Immersive Web Emulation Runtime) as the process-wide WebXR
 * Device API implementation: navigator.xr + XR* globals, exactly like a
 * browser. The emulated device is then DRIVEN per-frame by the OpenXR side
 * (openxr-driver.ts): head pose, per-eye projections, controller poses and
 * gamepad values are written into the device just before each rAF pump.
 */
import { XRDevice, XRFrame, XRReferenceSpace, generic as genericController, metaQuest3 } from "iwer";
// Not re-exported by the package index (no "exports" map, so the deep import resolves).
import { XRSpaceUtils } from "iwer/lib/spaces/XRSpace.js";
import type { XRDevice as XRDeviceType, XRDeviceConfig } from "iwer";
import { createFakeCanvas, installIwerEnvShims, installRafPump, type RafPump } from "../platform/env-shims.js";
import { logger } from "../log.js";

const iwerLog = logger("iwer");

export interface IwerRuntime {
  device: XRDeviceType;
  pump: RafPump;
}

let installed: IwerRuntime | null = null;

/**
 * Installs env shims, constructs an XRDevice (base: Meta Quest 3 preset,
 * trimmed to what our OpenXR session actually supports, generic controller
 * layout matching our action bindings), and installs it on globalThis.
 */
export function installIwerRuntime(passthrough = false): IwerRuntime {
  if (installed) return installed;

  installIwerEnvShims();
  const pump = installRafPump();

  // Advertise 'oculus-touch' as the primary profile id: Babylon registers
  // its layout locally (no repository/network), and it covers the full xr-
  // standard set — trigger/squeeze/thumbstick — matching the OpenXR touch
  // bindings we suggest first (Pico/WiVRn/Quest). 'generic-trigger' (which
  // resolves even without the vendor classes imported) stays the fallback;
  // its layout exposes the trigger only. The generic layout (no per-profile
  // grip offset) plus the face buttons, at the gamepad indices 4 and 5 where
  // Babylon's oculus-touch layout reads them.
  const withFaceButtons = (hand: "left" | "right", lower: string, upper: string): (typeof genericController.layout)["left"] => {
    const base = genericController.layout[hand];
    if (base === undefined) throw new Error(`generic controller layout has no ${hand} hand`);
    return {
      ...base,
      numHapticActuators: base.numHapticActuators ?? 1,
      gamepad: { ...base.gamepad, buttons: [...base.gamepad.buttons, { id: lower, type: "binary" }, { id: upper, type: "binary" }] },
    };
  };
  const controllerConfig = {
    ...genericController,
    profileId: "oculus-touch",
    fallbackProfileIds: ["generic-trigger"],
    layout: {
      ...genericController.layout,
      left: withFaceButtons("left", "x-button", "y-button"),
      right: withFaceButtons("right", "a-button", "b-button"),
    },
  };

  const config: XRDeviceConfig = {
    ...metaQuest3,
    name: "Monado via OpenXR (node-openxr)",
    // immersive-ar is advertised (and requested by main) when XR_PASSTHROUGH
    // is on, so Babylon's WebXR layer sees the same session mode a browser
    // would grant for see-through. The actual passthrough switch is the
    // environment blend mode on the native OpenXR side.
    supportedSessionModes: passthrough ? ["inline", "immersive-vr", "immersive-ar"] : ["inline", "immersive-vr"],
    supportedFeatures: ["viewer", "local", "local-floor"],
    controllerConfig,
  };

  const deviceOptions = {
    canvasContainer: createFakeCanvas(1, 1),
  } as unknown as ConstructorParameters<typeof XRDevice>[1];

  const device = new XRDevice(config, deviceOptions);
  device.installRuntime({ globalObject: globalThis });
  patchOffsetReferenceSpace();
  patchExactViewProjections();

  iwerLog.info("WebXR Device API installed (navigator.xr + XR globals)");
  installed = { device, pump };
  return installed;
}

/**
 * IWER 2.7.0 bug: XRReferenceSpace.getOffsetReferenceSpace(originOffset)
 * hands the XRRigidTransform itself to XRSpace as its offset MATRIX
 * (mat4.clone of a non-array object), so poses in the offset space equal
 * the parent's. Babylon applies every teleport / snap turn through such an
 * offset space (WebXRCamera._updateReferenceSpace) — without this the
 * camera snaps straight back. Pass the transform's 4x4 matrix instead.
 */
function patchOffsetReferenceSpace(): void {
  const proto = XRReferenceSpace.prototype as unknown as {
    getOffsetReferenceSpace(offset: unknown): unknown;
    __offsetPatched?: boolean;
  };
  if (proto.__offsetPatched) return;
  const original = proto.getOffsetReferenceSpace;
  proto.getOffsetReferenceSpace = function (this: unknown, offset: unknown) {
    const matrix = (offset as { matrix?: Float32Array } | null)?.matrix;
    return original.call(this, matrix ?? offset);
  };
  proto.__offsetPatched = true;
}

/** Per-eye field of view as OpenXR reports it (radians; left/down negative). */
export interface EyeFov {
  angleLeft: number;
  angleRight: number;
  angleUp: number;
  angleDown: number;
}

/** One eye as located by OpenXR this frame (session space = IWER world). */
export interface EyeView {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  fov: EyeFov;
}

let eyeViewSource: (() => readonly EyeView[] | null) | null = null;

/**
 * Supplies the exact per-eye views (from xrLocateViews) that XRView
 * poses and projection matrices are built from. The OpenXR->IWER driver
 * sets this; index 0 = left, 1 = right.
 */
export function setEyeViewSource(source: (() => readonly EyeView[] | null) | null): void {
  eyeViewSource = source;
}

/**
 * IWER models the eyes as the viewer pose offset by +/- ipd/2 along its X
 * axis, with ONE symmetric projection (mat4.perspective(fovy, aspect)) for
 * both. Real headsets have asymmetric per-eye FOVs, and canted displays
 * rotate each eye. Per getViewerPose call, with the exact OpenXR eyes:
 *
 *   - poses: each eye space's offset (child of the viewer space) is set to
 *     the exact eye-in-head transform — inverse(head) * eye, with the head
 *     pose the driver pushed — so IWER's own space math yields the exact
 *     eye pose in ANY reference space (teleport offset spaces included);
 *   - projections: each view's projectionMatrix (a stable Float32Array,
 *     mutated in place) becomes the off-axis WebXR projection (column-major,
 *     right-handed, GL clip space) of that eye's FOV and the session's
 *     depthNear/depthFar.
 */
function patchExactViewProjections(): void {
  const proto = XRFrame.prototype as unknown as {
    getViewerPose(space: unknown): { views: ReadonlyArray<{ eye: string; projectionMatrix: Float32Array }> } | null;
    session: { renderState: { depthNear: number; depthFar: number } };
    __exactProjections?: boolean;
  };
  if (proto.__exactProjections) return;
  const original = proto.getViewerPose;
  proto.getViewerPose = function (this: typeof proto, space: unknown) {
    const eyes = eyeViewSource?.() ?? null;
    if (eyes !== null && installed !== null) applyEyeOffsets(installed.device, eyes);
    const pose = original.call(this, space);
    if (pose === null || eyes === null) return pose;
    const { depthNear: n, depthFar: f } = this.session.renderState;
    for (const view of pose.views) {
      const eye = eyes[view.eye === "right" ? 1 : 0];
      if (eye !== undefined) writeFovProjection(view.projectionMatrix, eye.fov, n, f);
    }
    return pose;
  };
  proto.__exactProjections = true;
}

const eyeOffsetScratch = new Float32Array(16);

/** Sets IWER's eye spaces to the exact eye-in-head transforms. */
function applyEyeOffsets(device: XRDeviceType, eyes: readonly EyeView[]): void {
  const headPosition = device.position;
  const headInverse = conjugate(device.quaternion);
  const viewSpaces = (device as unknown as { viewSpaces: Record<string, unknown> }).viewSpaces;
  eyes.slice(0, 2).forEach((eye, index) => {
    const viewSpace = viewSpaces[index === 0 ? "left" : "right"];
    if (viewSpace === undefined) return;
    const relativeOrientation = multiply(headInverse, eye.orientation);
    const relativePosition = rotate(headInverse, {
      x: eye.position.x - headPosition.x,
      y: eye.position.y - headPosition.y,
      z: eye.position.z - headPosition.z,
    });
    writeRotationTranslation(eyeOffsetScratch, relativeOrientation, relativePosition);
    XRSpaceUtils.updateOffsetMatrix(viewSpace as never, eyeOffsetScratch);
  });
}

type Quat = { x: number; y: number; z: number; w: number };
type Vec3 = { x: number; y: number; z: number };

const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const r = multiply(multiply(q, { x: v.x, y: v.y, z: v.z, w: 0 }), conjugate(q));
  return { x: r.x, y: r.y, z: r.z };
}

/** Column-major rigid transform (gl-matrix fromRotationTranslation layout). */
function writeRotationTranslation(out: Float32Array, q: Quat, t: Vec3): void {
  const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
  const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
  const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
  const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
  out.set([
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    t.x, t.y, t.z, 1,
  ]);
}

function writeFovProjection(out: Float32Array, fov: EyeFov, n: number, f: number): void {
  const l = Math.tan(fov.angleLeft);
  const r = Math.tan(fov.angleRight);
  const t = Math.tan(fov.angleUp);
  const b = Math.tan(fov.angleDown);
  out.set([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    (r + l) / (r - l), (t + b) / (t - b), -(f + n) / (f - n), -1,
    0, 0, (-2 * f * n) / (f - n), 0,
  ]);
}
