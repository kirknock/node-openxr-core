/**
 * OpenXR -> IWER per-frame driver.
 *
 * Bridges the native OpenXR session into the emulated WebXR device:
 *   head pose + IPD + vertical FOV   <- xrLocateViews eye poses
 *   controller poses/gamepad         <- OpenXR action states (grip/aim,
 *                                       select/squeeze, thumbstick)
 * followed by one rAF pump, which makes IWER construct XRFrames and deliver
 * them to every session.requestAnimationFrame consumer (Babylon's WebXR
 * layer in Phase 4).
 *
 * WebXR and OpenXR share the same right-handed, +Y-up, -Z-forward
 * convention, so poses are copied directly (no axis flipping).
 *
 * XR_SYNTH_INPUT=1 (dev VM only) replaces controller poses with fixed
 * synthesized ones (pitched down so rays reach the floor) — deterministic
 * input for exercising the full WebXR pipeline end-to-end on Monado, whose
 * simulated Remote controllers sit still and aim level.
 */
import { xrEnv } from "../config.js";
import { setEyeViewSource } from "./iwer-runtime.js";
import type { XRDevice } from "iwer";
import type { RafPump } from "../platform/env-shims.js";
import type { EyeViewPose } from "../xr/session.js";
import type { OpenXrInput } from "../xr/input.js";
import type { XrSessionSurface } from "../xr/input.js";
import { debugLogger, logger } from "../log.js";

const driverDebugLog = debugLogger("input", "driver:debug");
const iwerDriverLog = logger("iwer-driver");

/** Default synthesized controller poses (LOCAL space, forward-facing,
 *  pitched 30° down so their rays reach the floor — the demo teleport
 *  gesture needs a floor hit to land). */
const SYNTH_GRIP: [number, number, number][] = [
  [-0.25, 1.3, -0.35],
  [0.25, 1.3, -0.35],
];

export interface DriverStats {
  framesDriven: number;
  lastHead: { x: number; y: number; z: number } | null;
  connectedHands: [boolean, boolean];
}

/** Optional per-hand input injection applied on top of OpenXR state. */
export interface InputOverride {
  trigger?: number;
  squeeze?: number;
  thumbstick?: { x: number; y: number };
}


export class OpenXrIwerDriver {
  readonly stats: DriverStats = { framesDriven: 0, lastHead: null, connectedHands: [false, false] };

  /** Test hook: override/synthesize button+axis values after OpenXR reads. */
  inputOverride?: (hand: 0 | 1, state: import("../xr/input.js").HandInputState) => InputOverride | undefined;

  /** One-shot flags for the aim→grip fallback warning, per hand. */
  private readonly warnedAimFallback: [boolean, boolean] = [false, false];

  private readonly synthInput: boolean;

  constructor(
    private readonly device: XRDevice,
    private readonly session: XrSessionSurface,
    private readonly input: OpenXrInput,
    private readonly pump: RafPump,
    private readonly timing?: import("../timing.js").FrameTiming,
  ) {
    // Read at construction (not module load) so entry points can default it.
    this.synthInput = xrEnv().synthInput;
    // XRView poses and projections come from the exact OpenXR eyes.
    setEyeViewSource(() => this.latestEyes);
  }

  /** This frame's located eyes (xrLocateViews), for the XRView poses/projections. */
  private latestEyes: EyeViewPose[] | null = null;

  /**
   * Called once per OpenXR frame (from OpenXrSession.runFrames hook):
   * pushes head, eyes and controllers into IWER, then delivers the WebXR
   * frame to rAF consumers — unless `pump: false`, when the caller pumps
   * later with pumpFrame() (e.g. after binding the swapchain image as the
   * render target, so content renders straight into it).
   */
  syncFrame(displayTime: number, eyePoses?: EyeViewPose[], options: { pump?: boolean } = {}): void {
    if (driverDebugLog.enabled && this.stats.framesDriven < 3) {
      driverDebugLog.info(
        `syncFrame #${this.stats.framesDriven} pending=${this.pump.pending}`,
      );
    }
    const t = this.timing;
    // Timing is optional — stages must run either way.
    const stage = <T>(name: string, fn: () => T): T => (t !== undefined ? t.stage(name, fn) : fn());

    // 1. Actions tick.
    stage("xrSyncActions", () => this.input.sync(this.session.sessionHandle));

    // 2. Head: average eye positions, shared orientation, IPD, vertical FOV.
    // IWER device space is floor-anchored (WebXR 'local-floor' semantics);
    // so is the session's reference space in every mode (the LOCAL fallback
    // is offset to the floor at creation — session.ts), so poses pass as-is.
    if (eyePoses !== undefined && eyePoses.length >= 2) {
      const [l, r] = eyePoses;
      const hx = (l.position.x + r.position.x) / 2;
      const hy = (l.position.y + r.position.y) / 2;
      const hz = (l.position.z + r.position.z) / 2;
      this.device.position.set(hx, hy, hz);
      this.device.quaternion.set(
        l.orientation.x,
        l.orientation.y,
        l.orientation.z,
        l.orientation.w,
      );
      const dx = r.position.x - l.position.x;
      const dy = r.position.y - l.position.y;
      const dz = r.position.z - l.position.z;
      this.device.ipd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.device.fovy = l.fov.angleUp - l.fov.angleDown;
      this.device.stereoEnabled = true;
      this.latestEyes = eyePoses;
      this.stats.lastHead = { x: hx, y: hy, z: hz };
    }

    // 3. Controllers -> IWER device gamepads. The generic layout also defines
    // a 'none'-handedness controller that IWER connects by default — a
    // phantom input source we never want.
    const none = this.device.controllers.none;
    if (none !== undefined && none.connected) {
      none.connected = false;
    }

    const hands = stage("readHands", () => this.input.readHands(this.session, displayTime));
    for (const hand of [0, 1] as const) {
      const controller = hand === 0 ? this.device.controllers.left : this.device.controllers.right;
      if (controller === undefined) continue;
      const state = hands[hand];

      // XR_INPUT_DEBUG: raw OpenXR poses once a second-ish — the bisector
      // for "controller meshes positioned wrong on some runtime".
      if (driverDebugLog.enabled && this.stats.framesDriven % 72 === 0) {
        const fmt = (p: import("../xr/input.js").PoseState): string =>
          p.valid
            ? `(${p.position.x.toFixed(2)},${p.position.y.toFixed(2)},${p.position.z.toFixed(2)})`
            : "invalid";
        driverDebugLog.info(
          `hand ${hand}: grip=${fmt(state.grip)} aim=${fmt(state.aim)} connected=${state.connected}`,
        );
      }

      const useSynth = this.synthInput;
      controller.connected = state.connected || useSynth;
      this.stats.connectedHands[hand] = controller.connected;

      if (controller.connected) {
        // IWER's controller transform drives the TARGET RAY space (the
        // grip space is derived from it via a per-profile offset), so push
        // the AIM pose — the pointer ray must point where the controller
        // aims, not where it is held. Raw session-frame coordinates: with
        // Babylon's reference space at local-floor (IWER world identity),
        // delivered poses land in the same frame the eye cameras render.
        // Sanity: a hand-held controller can never sit exactly at the
        // floor origin, and NaN locates happen on some runtimes — in both
        // cases fall back to the grip pose (flagged once for the log).
        const p = state.aim.position;
        const aimDegenerate =
          !state.aim.valid ||
          !Number.isFinite(p.x + p.y + p.z) ||
          (p.x === 0 && p.y === 0 && p.z === 0);
        if (aimDegenerate && state.grip.valid && !this.warnedAimFallback[hand]) {
          this.warnedAimFallback[hand] = true;
          iwerDriverLog.warn(
            `${hand === 0 ? "left" : "right"} aim pose invalid/zeroed — using grip pose`,
          );
        }
        const pose = !useSynth
          ? aimDegenerate
            ? state.grip
            : state.aim
          : SYNTH_POSE[hand];
        controller.position.set(pose.position.x, pose.position.y, pose.position.z);
        controller.quaternion.set(
          pose.orientation.x,
          pose.orientation.y,
          pose.orientation.z,
          pose.orientation.w,
        );
      }

      // xr-standard layout: [0]=trigger(analog, select), [1]=squeeze(analog),
      // [3]=thumbstick(binary); axes 2/3 = thumbstick x/y. Test overrides
      // land on top of the OpenXR reads.
      const ov = this.inputOverride?.(hand, state) ?? {};
      const trigger = ov.trigger ?? Math.max(state.triggerValue, state.select.pressed ? 1 : 0);
      const squeeze = ov.squeeze ?? (state.squeeze.pressed ? 1 : 0);
      controller.updateButtonValue("trigger", trigger);
      controller.updateButtonValue("squeeze", squeeze);
      controller.updateButtonValue("thumbstick", 0);
      controller.updateButtonValue(hand === 0 ? "x-button" : "a-button", state.buttonLower ? 1 : 0);
      controller.updateButtonValue(hand === 0 ? "y-button" : "b-button", state.buttonUpper ? 1 : 0);
      const stick = ov.thumbstick ?? (state.thumbstick.active ? state.thumbstick : { x: 0, y: 0 });
      controller.updateAxis("thumbstick", "x-axis", stick.x);
      controller.updateAxis("thumbstick", "y-axis", stick.y);
    }

    this.stats.framesDriven++;
    // 4. Deliver the WebXR frame to all rAF consumers.
    if (options.pump !== false) this.pumpFrame();
  }

  /** Delivers the pending WebXR frame to the rAF consumers (see syncFrame). */
  pumpFrame(): void {
    const t = this.timing;
    if (t !== undefined) t.stage("iwerPump", () => this.pump.pump());
    else this.pump.pump();
  }

  private readonly hapticsWrapped = new WeakSet<object>();

  /**
   * Forwards WebXR gamepad haptics to the OpenXR vibration action:
   * hapticActuators[].pulse -> xrApplyHapticFeedback, .reset() ->
   * xrStopHapticFeedback. Idempotent —
   * call once per frame with the session's input sources.
   */
  forwardHaptics(
    sources: Array<{
      handedness: string;
      gamepad?: {
        hapticActuators?: Array<{
          pulse(value: number, duration: number): Promise<boolean>;
          reset?(): unknown;
        }>;
      };
    }>,
  ): void {
    for (const source of sources) {
      const actuators = source.gamepad?.hapticActuators ?? [];
      const hand: 0 | 1 = source.handedness === "right" ? 1 : 0;
      for (const actuator of actuators) {
        if (this.hapticsWrapped.has(actuator)) continue;
        this.hapticsWrapped.add(actuator);
        const original = actuator.pulse.bind(actuator);
        actuator.pulse = async (value: number, durationMs: number): Promise<boolean> => {
          try {
            this.input.applyHaptics(
              this.session.sessionHandle,
              hand,
              Math.max(0, Math.min(1, value)),
              Math.max(0, Math.round(durationMs * 1e6)),
            );
          } catch (err) {
            iwerDriverLog.warn("haptic forward failed:", err);
          }
          return original(value, durationMs);
        };
        // reset() (Gamepad: stop any ongoing effect) -> xrStopHapticFeedback.
        // IWER's actuator has no reset(), so provide the standard method
        // (resolves "complete"); wrap one if a later IWER adds it.
        const originalReset = typeof actuator.reset === "function" ? actuator.reset.bind(actuator) : null;
        actuator.reset = () => {
          try {
            this.input.stopHaptics(this.session.sessionHandle, hand);
          } catch (err) {
            iwerDriverLog.warn("haptic stop failed:", err);
          }
          return originalReset !== null ? originalReset() : Promise.resolve("complete");
        };
      }
    }
  }
}

const SYNTH_PITCH = -Math.PI / 6;
const SYNTH_POSE = SYNTH_GRIP.map((p) => ({
  position: { x: p[0], y: p[1], z: p[2] },
  orientation: { x: Math.sin(SYNTH_PITCH / 2), y: 0, z: 0, w: Math.cos(SYNTH_PITCH / 2) },
}));
