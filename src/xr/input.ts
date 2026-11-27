/**
 * OpenXR input (actions/bindings) over the existing FFI layer.
 *
 * Creates one action set with per-hand subactions (/user/hand/{left,right}),
 * suggests bindings for the profiles the installed Monado supports
 * (khr/simple_controller guaranteed; valve/index + microsoft/motion_controller
 * for richer devices), attaches to the session, and provides per-frame
 * sync + typed state reads that map onto the WebXR xr-standard gamepad
 * layout (trigger/select, squeeze, thumbstick, trackpad, grip/aim poses,
 * haptics).
 */
import koffi from "koffi";
import * as gen from "./generated/xr-abi.gen.js";
import { xrCheck, type XrHandle } from "./xr-loader.js";
import { logger } from "../log.js";

const inputLog = logger("input");

const {
  XR_ACTION_TYPE_BOOLEAN_INPUT,
  XR_ACTION_TYPE_FLOAT_INPUT,
  XR_ACTION_TYPE_VECTOR2F_INPUT,
  XR_ACTION_TYPE_POSE_INPUT,
  XR_ACTION_TYPE_VIBRATION_OUTPUT,
  XR_TYPE_ACTION_SET_CREATE_INFO,
  XR_TYPE_ACTION_CREATE_INFO,
  XR_TYPE_ACTION_STATE_GET_INFO,
  XR_TYPE_ACTION_STATE_BOOLEAN,
  XR_TYPE_ACTION_STATE_FLOAT,
  XR_TYPE_ACTION_STATE_VECTOR2F,
  XR_TYPE_ACTION_STATE_POSE,
  XR_TYPE_ACTION_SPACE_CREATE_INFO,
  XR_TYPE_ACTIONS_SYNC_INFO,
  XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING,
  XR_TYPE_INTERACTION_PROFILE_STATE,
  XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO,
  XR_TYPE_HAPTIC_ACTION_INFO,
  XR_TYPE_HAPTIC_VIBRATION,
  XR_TYPE_SPACE_LOCATION,
  XR_NULL_PATH,
  XR_SPACE_LOCATION_ORIENTATION_VALID_BIT,
  XR_SPACE_LOCATION_POSITION_VALID_BIT,
  XR_TRUE,
} = gen;

export const HAND_PATHS = ["/user/hand/left", "/user/hand/right"] as const;
export type Hand = 0 | 1;

export interface PoseState {
  valid: boolean;
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
}

export interface HandInputState {
  /** Grip pose action is active — the WebXR "input source connected" signal. */
  connected: boolean;
  grip: PoseState;
  aim: PoseState;
  select: { pressed: boolean; changed: boolean; lastChangeTime: number };
  squeeze: { pressed: boolean; changed: boolean; lastChangeTime: number };
  triggerValue: number;
  /** Lower face button: X on the left hand, A on the right. */
  buttonLower: boolean;
  /** Upper face button: Y on the left hand, B on the right. */
  buttonUpper: boolean;
  thumbstick: { active: boolean; x: number; y: number };
  trackpad: { active: boolean; x: number; y: number };
}

/** Session surface the input layer needs (implemented by OpenXrSession). */
export interface XrSessionSurface {
  readonly sessionHandle: unknown;
  readonly localSpaceHandle: unknown;
  /** True when the reference space is floor-anchored (no eye-height offset). */
  readonly floorAnchored: boolean;
}

interface ActionEntry {
  handle: unknown;
  type: number;
}

/**
 * Interaction-profile binding tables. Values are profile-relative paths; the
 * full binding path is /user/hand/{left|right} + path. Vector2f actions bind
 * the PARENT vector path (e.g. /input/thumbstick) — the runtime supplies the
 * whole x/y vector. A pair gives different paths for the left and right hand.
 */
const BINDING_TABLES: Array<{
  profile: string;
  bindings: Record<string, string | [left: string, right: string]>; // action -> relative path
}> = [
  {
    // Pico/Oculus-style controllers (WiVRn, Quest) — the primary target.
    // Touch has NO trigger/click or squeeze/click paths (only analog
    // values); bind the float actions instead.
    profile: "/interaction_profiles/oculus/touch_controller",
    bindings: {
      trigger_value: "/input/trigger/value",
      squeeze_value: "/input/squeeze/value",
      button_lower: ["/input/x/click", "/input/a/click"],
      button_upper: ["/input/y/click", "/input/b/click"],
      thumbstick: "/input/thumbstick",
      grip_pose: "/input/grip/pose",
      aim_pose: "/input/aim/pose",
      haptic: "/output/haptic",
    },
  },
  {
    profile: "/interaction_profiles/khr/simple_controller",
    bindings: {
      // No squeeze on the simple controller (select/menu/grip/aim/haptic).
      select_click: "/input/select/click",
      grip_pose: "/input/grip/pose",
      aim_pose: "/input/aim/pose",
      haptic: "/output/haptic",
    },
  },
  {
    profile: "/interaction_profiles/valve/index_controller",
    bindings: {
      // Index squeeze is analog only (value/force) — no squeeze/click.
      select_click: "/input/trigger/click",
      squeeze_value: "/input/squeeze/value",
      trigger_value: "/input/trigger/value",
      thumbstick: "/input/thumbstick",
      trackpad: "/input/trackpad",
      grip_pose: "/input/grip/pose",
      aim_pose: "/input/aim/pose",
      haptic: "/output/haptic",
    },
  },
  {
    // WMR controllers have no select/click or trigger/click (analog trigger
    // only — the driver derives select from trigger_value). One invalid path
    // makes the runtime reject the WHOLE profile's suggestion.
    profile: "/interaction_profiles/microsoft/motion_controller",
    bindings: {
      squeeze_click: "/input/squeeze/click",
      trigger_value: "/input/trigger/value",
      thumbstick: "/input/thumbstick",
      trackpad: "/input/trackpad",
      grip_pose: "/input/grip/pose",
      aim_pose: "/input/aim/pose",
      haptic: "/output/haptic",
    },
  },
];

export class OpenXrInput {
  private readonly xr: XrHandle;
  private actionSet: unknown = null;
  private readonly actions = new Map<string, ActionEntry>();
  private readonly subactionPaths: number[] = [];
  private readonly gripSpaces: unknown[] = [];
  private readonly aimSpaces: unknown[] = [];
  private suggestedProfiles: string[] = [];

  constructor(xr: XrHandle) {
    this.xr = xr;
  }

  private stringToPath(path: string): number {
    const out = [0];
    xrCheck(this.xr.fn.xrStringToPath(this.xr.raw, path, out), `xrStringToPath(${path})`);
    return out[0];
  }

  private pathToString(path: number): string {
    const count = [0];
    xrCheck(
      this.xr.fn.xrPathToString(this.xr.raw, path, 0, count, null),
      "xrPathToString(count)",
    );
    const buffer = Buffer.alloc(count[0]);
    xrCheck(
      this.xr.fn.xrPathToString(this.xr.raw, path, count[0], count, buffer),
      "xrPathToString",
    );
    return buffer.toString("utf8").replace(/\0+$/, "");
  }

  /** Creates the action set, all actions, and suggested bindings. */
  init(): void {
    const createSetInfo = {
      type: XR_TYPE_ACTION_SET_CREATE_INFO,
      next: null,
      actionSetName: "app-input",
      localizedActionSetName: "Application Input",
      priority: 0,
    };
    const setOut = [null];
    xrCheck(
      this.xr.fn.xrCreateActionSet(this.xr.raw, createSetInfo, setOut),
      "xrCreateActionSet",
    );
    this.actionSet = setOut[0];

    this.subactionPaths.push(...HAND_PATHS.map((p) => this.stringToPath(p)));

    // Struct fields that point to arrays marshal unreliably from JS arrays
    // (unlike direct function parameters) — use explicit C memory.
    const subactionPathsPtr = koffi.alloc("uint64_t", this.subactionPaths.length);
    this.subactionPaths.forEach((p, i) => {
      koffi.encode(subactionPathsPtr, i * 8, "uint64_t", p);
    });

    const createAction = (name: string, type: number): void => {
      const info = {
        type: XR_TYPE_ACTION_CREATE_INFO,
        next: null,
        actionName: name,
        actionType: type,
        countSubactionPaths: this.subactionPaths.length,
        subactionPaths: subactionPathsPtr,
        localizedActionName: name,
      };
      const out = [null];
      xrCheck(
        this.xr.fn.xrCreateAction(this.actionSet, info, out),
        `xrCreateAction(${name})`,
      );
      this.actions.set(name, { handle: out[0], type });
    };

    createAction("select_click", XR_ACTION_TYPE_BOOLEAN_INPUT);
    createAction("squeeze_click", XR_ACTION_TYPE_BOOLEAN_INPUT);
    createAction("squeeze_value", XR_ACTION_TYPE_FLOAT_INPUT);
    createAction("trigger_value", XR_ACTION_TYPE_FLOAT_INPUT);
    createAction("button_lower", XR_ACTION_TYPE_BOOLEAN_INPUT);
    createAction("button_upper", XR_ACTION_TYPE_BOOLEAN_INPUT);
    createAction("thumbstick", XR_ACTION_TYPE_VECTOR2F_INPUT);
    createAction("trackpad", XR_ACTION_TYPE_VECTOR2F_INPUT);
    createAction("grip_pose", XR_ACTION_TYPE_POSE_INPUT);
    createAction("aim_pose", XR_ACTION_TYPE_POSE_INPUT);
    createAction("haptic", XR_ACTION_TYPE_VIBRATION_OUTPUT);

    // Suggest bindings per profile. The runtime validates every path against
    // its own profile definition and rejects the whole set atomically
    // (XR_ERROR_PATH_UNSUPPORTED = -22). On rejection, probe each binding on
    // its own to find the unsupported ones, then suggest the rest — the
    // last successful call per profile wins, so the final full call is what
    // counts. (Dropping the LAST entry until accepted used to discard every
    // valid binding after a single bad one.)
    const bindingStride = koffi.sizeof("XrActionSuggestedBinding");
    for (const table of BINDING_TABLES) {
      const profilePath = this.stringToPath(table.profile);
      const pending: Array<{ action: unknown; binding: number; label: string }> = [];
      for (const [actionName, relPath] of Object.entries(table.bindings)) {
        const action = this.actions.get(actionName);
        if (action === undefined) continue;
        for (let hand = 0; hand < 2; hand++) {
          const fullPath = `${HAND_PATHS[hand]}${typeof relPath === "string" ? relPath : relPath[hand]}`;
          pending.push({
            action: action.handle,
            binding: this.stringToPath(fullPath),
            label: fullPath,
          });
        }
      }

      const suggest = (entries: typeof pending): number => {
        const ptr = koffi.alloc(koffi.resolve("XrActionSuggestedBinding"), entries.length);
        entries.forEach((entry, i) => {
          koffi.encode(ptr, i * bindingStride, "XrActionSuggestedBinding", {
            action: entry.action,
            binding: entry.binding,
          });
        });
        return this.xr.fn.xrSuggestInteractionProfileBindings(this.xr.raw, {
          type: XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING,
          next: null,
          interactionProfile: profilePath,
          countSuggestedBindings: entries.length,
          suggestedBindings: ptr,
        });
      };

      let accepted = pending;
      let res = suggest(accepted);
      if (res === gen.XR_RESULT_PATH_UNSUPPORTED) {
        accepted = pending.filter((entry) => suggest([entry]) === 0);
        const dropped = pending.filter((entry) => !accepted.includes(entry)).map((e) => e.label);
        inputLog.warn(`${table.profile}: unsupported path(s) dropped: ${dropped.join(", ")}`);
        res = accepted.length > 0 ? suggest(accepted) : gen.XR_RESULT_PATH_UNSUPPORTED;
      }
      if (res === 0) {
        this.suggestedProfiles.push(`${table.profile} (${accepted.length} bindings)`);
      } else {
        inputLog.warn(`bindings for ${table.profile} rejected (${res}) — skipped`);
      }
    }
    inputLog.info(
      `action set created; accepted profiles: ${this.suggestedProfiles.join(" | ") || "none"}`,
    );
  }

  /** Attaches the action set and creates per-hand grip/aim action spaces. */
  attach(session: XrSessionSurface): void {
    if (this.actionSet === null) throw new Error("OpenXrInput.init() not called");
    const actionSetsPtr = koffi.alloc("void *", 1);
    koffi.encode(actionSetsPtr, 0, "void *", this.actionSet);
    const attachInfo = {
      type: XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO,
      next: null,
      countActionSets: 1,
      actionSets: actionSetsPtr,
    };
    xrCheck(
      this.xr.fn.xrAttachSessionActionSets(session.sessionHandle, attachInfo),
      "xrAttachSessionActionSets",
    );

    for (let hand = 0; hand < 2; hand++) {
      for (const [name, spaces] of [
        ["grip_pose", this.gripSpaces],
        ["aim_pose", this.aimSpaces],
      ] as const) {
        const info = {
          type: XR_TYPE_ACTION_SPACE_CREATE_INFO,
          next: null,
          action: this.actions.get(name)!.handle,
          subactionPath: this.subactionPaths[hand],
          poseInActionSpace: {
            orientation: { x: 0, y: 0, z: 0, w: 1 },
            position: { x: 0, y: 0, z: 0 },
          },
        };
        const out = [null];
        xrCheck(
          this.xr.fn.xrCreateActionSpace(session.sessionHandle, info, out),
          `xrCreateActionSpace(${name}, hand ${hand})`,
        );
        spaces.push(out[0]);
      }
    }
    inputLog.info("action set attached; grip/aim action spaces created");
  }

  /** Per-frame action sync (call after xrWaitFrame, before reading states). */
  sync(sessionHandle: unknown): void {
    if (this.syncInfo === undefined) {
      const activePtr = koffi.alloc(koffi.resolve("XrActiveActionSet"), 1);
      koffi.encode(activePtr, 0, "XrActiveActionSet", {
        actionSet: this.actionSet,
        subactionPath: XR_NULL_PATH,
      });
      this.syncInfo = {
        type: XR_TYPE_ACTIONS_SYNC_INFO,
        next: null,
        countActiveActionSets: 1,
        activeActionSets: activePtr,
      };
    }
    // XR_SESSION_NOT_FOCUSED is success-family: actions synced, session
    // just doesn't have focus yet (states hold their last values).
    xrCheck(this.xr.fn.xrSyncActions(sessionHandle, this.syncInfo), "xrSyncActions", gen.XR_RESULT_SESSION_NOT_FOCUSED);
  }

  private syncInfo:
    | {
        type: number;
        next: null;
        countActiveActionSets: number;
        activeActionSets: unknown;
      }
    | undefined;

  /** Interaction profile the runtime selected for a hand ("" if none). */
  currentProfile(sessionHandle: unknown, hand: Hand): string {
    const state: Record<string, unknown> = { type: XR_TYPE_INTERACTION_PROFILE_STATE, next: null };
    xrCheck(
      this.xr.fn.xrGetCurrentInteractionProfile(
        sessionHandle,
        this.subactionPaths[hand],
        state,
      ),
      "xrGetCurrentInteractionProfile",
    );
    const path = Number(state.interactionProfile);
    return path === XR_NULL_PATH ? "" : this.pathToString(path);
  }

  private booleanState(sessionHandle: unknown, action: string, hand: Hand): { currentState: boolean; changedSinceLastSync: boolean; lastChangeTime: number } {
    const info = {
      type: XR_TYPE_ACTION_STATE_GET_INFO,
      next: null,
      action: this.actions.get(action)!.handle,
      subactionPath: this.subactionPaths[hand],
    };
    const state: Record<string, unknown> = { type: XR_TYPE_ACTION_STATE_BOOLEAN, next: null };
    xrCheck(
      this.xr.fn.xrGetActionStateBoolean(sessionHandle, info, state),
      "xrGetActionStateBoolean",
    );
    return {
      currentState: Number(state.currentState) === XR_TRUE,
      changedSinceLastSync: Number(state.changedSinceLastSync) === XR_TRUE,
      lastChangeTime: Number(state.lastChangeTime),
    };
  }

  private floatState(sessionHandle: unknown, action: string, hand: Hand): number {
    const info = {
      type: XR_TYPE_ACTION_STATE_GET_INFO,
      next: null,
      action: this.actions.get(action)!.handle,
      subactionPath: this.subactionPaths[hand],
    };
    const state: Record<string, unknown> = { type: XR_TYPE_ACTION_STATE_FLOAT, next: null };
    xrCheck(
      this.xr.fn.xrGetActionStateFloat(sessionHandle, info, state),
      "xrGetActionStateFloat",
    );
    return Number(state.isActive) === XR_TRUE ? Number(state.currentState) : 0;
  }

  private vectorState(
    sessionHandle: unknown,
    action: string,
    hand: Hand,
  ): { active: boolean; x: number; y: number } {
    const info = {
      type: XR_TYPE_ACTION_STATE_GET_INFO,
      next: null,
      action: this.actions.get(action)!.handle,
      subactionPath: this.subactionPaths[hand],
    };
    const state: Record<string, unknown> = { type: XR_TYPE_ACTION_STATE_VECTOR2F, next: null };
    xrCheck(
      this.xr.fn.xrGetActionStateVector2f(sessionHandle, info, state),
      "xrGetActionStateVector2f",
    );
    const vec = state.currentState as Record<string, number> | undefined;
    return {
      active: Number(state.isActive) === XR_TRUE,
      x: Number(vec?.x ?? 0),
      y: Number(vec?.y ?? 0),
    };
  }

  private poseActive(sessionHandle: unknown, action: string, hand: Hand): boolean {
    const info = {
      type: XR_TYPE_ACTION_STATE_GET_INFO,
      next: null,
      action: this.actions.get(action)!.handle,
      subactionPath: this.subactionPaths[hand],
    };
    const state: Record<string, unknown> = { type: XR_TYPE_ACTION_STATE_POSE, next: null };
    xrCheck(
      this.xr.fn.xrGetActionStatePose(sessionHandle, info, state),
      "xrGetActionStatePose",
    );
    return Number(state.isActive) === XR_TRUE;
  }

  private locateSpace(space: unknown, baseSpace: unknown, time: number): PoseState {
    const location: Record<string, unknown> = { type: XR_TYPE_SPACE_LOCATION, next: null };
    xrCheck(
      this.xr.fn.xrLocateSpace(space, baseSpace, time, location),
      "xrLocateSpace",
    );
    const flags = Number(location.locationFlags);
    const pose = location.pose as Record<string, Record<string, number>>;
    return {
      valid:
        (flags & (XR_SPACE_LOCATION_ORIENTATION_VALID_BIT | XR_SPACE_LOCATION_POSITION_VALID_BIT)) !==
        0,
      position: { ...pose.position } as unknown as PoseState["position"],
      orientation: { ...pose.orientation } as unknown as PoseState["orientation"],
    };
  }

  /** Reads both hands' full state (after sync, at the frame's display time). */
  readHands(session: XrSessionSurface, displayTime: number): [HandInputState, HandInputState] {
    const read = (hand: Hand): HandInputState => {
      const connected = this.poseActive(session.sessionHandle, "grip_pose", hand);
      const select = this.booleanState(session.sessionHandle, "select_click", hand);
      const squeeze = this.booleanState(session.sessionHandle, "squeeze_click", hand);
      // Touch-style controllers expose squeeze as an analog value only.
      const squeezeValue = this.floatState(session.sessionHandle, "squeeze_value", hand);
      const squeezePressed = squeeze.currentState || squeezeValue > 0.7;
      return {
        connected,
        grip: connected ? this.locateSpace(this.gripSpaces[hand], session.localSpaceHandle, displayTime) : INVALID_POSE,
        aim: connected ? this.locateSpace(this.aimSpaces[hand], session.localSpaceHandle, displayTime) : INVALID_POSE,
        select: { pressed: select.currentState || this.floatState(session.sessionHandle, "trigger_value", hand) > 0.7, changed: select.changedSinceLastSync, lastChangeTime: select.lastChangeTime },
        squeeze: { pressed: squeezePressed, changed: squeeze.changedSinceLastSync, lastChangeTime: squeeze.lastChangeTime },
        triggerValue: this.floatState(session.sessionHandle, "trigger_value", hand),
        buttonLower: this.booleanState(session.sessionHandle, "button_lower", hand).currentState,
        buttonUpper: this.booleanState(session.sessionHandle, "button_upper", hand).currentState,
        thumbstick: this.vectorState(session.sessionHandle, "thumbstick", hand),
        trackpad: this.vectorState(session.sessionHandle, "trackpad", hand),
      };
    };
    return [read(0), read(1)];
  }

  /** Fires haptic vibration on one hand (amplitude 0..1, duration ns). */
  applyHaptics(sessionHandle: unknown, hand: Hand, amplitude: number, durationNs: number, frequencyHz = 200): void {
    const info = {
      type: XR_TYPE_HAPTIC_ACTION_INFO,
      next: null,
      action: this.actions.get("haptic")!.handle,
      subactionPath: this.subactionPaths[hand],
    };
    const vibration = {
      type: XR_TYPE_HAPTIC_VIBRATION,
      next: null,
      duration: durationNs,
      frequency: frequencyHz,
      amplitude,
    };
    xrCheck(
      this.xr.fn.xrApplyHapticFeedback(sessionHandle, info, vibration),
      "xrApplyHapticFeedback",
    );
  }

  /** Stops any vibration on a hand (WebXR GamepadHapticActuator.reset()). */
  stopHaptics(sessionHandle: unknown, hand: Hand): void {
    xrCheck(
      this.xr.fn.xrStopHapticFeedback(sessionHandle, {
        type: XR_TYPE_HAPTIC_ACTION_INFO,
        next: null,
        action: this.actions.get("haptic")!.handle,
        subactionPath: this.subactionPaths[hand],
      }),
      "xrStopHapticFeedback",
    );
  }

  /**
   * Destroys the action spaces, then the action set (which destroys its
   * actions). Call before the session/instance go away.
   */
  dispose(): void {
    for (const space of [...this.gripSpaces, ...this.aimSpaces]) {
      if (space !== null && space !== undefined) xrCheck(this.xr.fn.xrDestroySpace(space), "xrDestroySpace(action space)");
    }
    this.gripSpaces.length = 0;
    this.aimSpaces.length = 0;
    if (this.actionSet !== null) {
      xrCheck(this.xr.fn.xrDestroyActionSet(this.actionSet), "xrDestroyActionSet");
      this.actionSet = null;
      this.actions.clear();
    }
  }
}

const INVALID_POSE: PoseState = {
  valid: false,
  position: { x: 0, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};
