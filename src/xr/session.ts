/**
 * An OpenXR session, on any graphics API (session-graphics.ts; GLES in
 * nodexr-webgl's gles-session.ts, Vulkan in nodexr-webgpu's native/).
 *
 * Owns the lifecycle and orchestrates the pieces:
 *   instance (extensions) -> system -> session with the graphics binding ->
 *   floor-level reference space (reference-space.ts) -> view config + blend
 *   mode (view-config.ts) -> swapchains -> frame loop submitting a
 *   projection layer (projection-layer.ts); XR_FB_passthrough in
 *   passthrough.ts.
 *
 * The frame loop has two pixel paths: a `DirectFrameRenderer` that draws
 * straight into the acquired swapchain images (the app), or a per-eye CPU
 * `FrameSource` uploaded into the images (the `pattern` diagnostic).
 */
import { xrEnv } from "../config.js";
import {
  createXrInstance,
  enumerateInstanceExtensions,
  getRuntimeInfo,
  bootstrapOpenXrLoader,
  xrCheck,
  type LoaderBootstrap,
  type XrHandle,
} from "./xr-loader.js";
import * as gen from "./generated/xr-abi.gen.js";
import { xrSplitVersion } from "./xr-abi.js";
import { createFloorReferenceSpace } from "./reference-space.js";
import {
  chooseBlendMode,
  enumerateBlendModes,
  enumerateEyeViews,
  enumerateRefreshRates,
  type EyeViewInfo,
} from "./view-config.js";
import type { SessionContext, SessionGraphics, SessionSwapchains } from "./session-graphics.js";
import { ProjectionLayer } from "./projection-layer.js";
import { destroyFbPassthrough, setFbPassthroughRunning, startFbPassthrough } from "./passthrough.js";
import { logger } from "../log.js";

const sessionLog = logger("session");

const {
  XR_SESSION_STATE_IDLE,
  XR_SESSION_STATE_READY,
  XR_SESSION_STATE_FOCUSED,
  XR_SESSION_STATE_STOPPING,
  XR_SESSION_STATE_EXITING,
  XR_SESSION_STATE_LOSS_PENDING,
  XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
} = gen;

export type { EyeViewInfo };

/** One eye's located pose+fov for the frame being rendered (session space). */
export interface EyeViewPose {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  fov: { angleLeft: number; angleRight: number; angleUp: number; angleDown: number };
}

/** Produces RGBA8 pixels (w*h*4 bytes) for one eye of one frame. */
export type FrameSource = (
  eye: number,
  width: number,
  height: number,
  frame: number,
  views: EyeViewPose[],
) => Uint8Array | Promise<Uint8Array>;

/**
 * Direct-to-swapchain renderer: invoked once per frame with the acquired
 * swapchain images (one per swapchain — per eye, or one shared), as the graphics
 * API names them; renders straight into them. The session handles
 * acquire/wait/release around it.
 */
export type DirectFrameRenderer<Image> = (
  frame: number,
  views: EyeViewPose[],
  images: Image[],
) => void | Promise<void>;

export interface FrameLoopStats {
  framesSubmitted: number;
  framesSkipped: number;
  state: string;
}

const SESSION_STATE_NAMES: Record<number, string> = {
  [XR_SESSION_STATE_IDLE]: "IDLE",
  2: "READY",
  3: "SYNCHRONIZED",
  4: "VISIBLE",
  [XR_SESSION_STATE_FOCUSED]: "FOCUSED",
  [XR_SESSION_STATE_STOPPING]: "STOPPING",
  [XR_SESSION_STATE_LOSS_PENDING]: "LOSS_PENDING",
  [XR_SESSION_STATE_EXITING]: "EXITING",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OpenXrSession<Image> {
  private xr!: XrHandle;
  private bootstrap!: LoaderBootstrap;
  private systemId = 0;
  private session: unknown = null;
  private space: unknown = null;
  private blendMode: number = gen.XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
  /** XR_FB_passthrough handle (null when unused/unavailable). */
  private passthrough: unknown = null;
  private passthroughRunning = false;
  /** See-through presentation requested (setSeeThrough; initially the profile). */
  private seeThrough = false;
  private swapchains: SessionSwapchains<Image> | null = null;
  private layer: ProjectionLayer | null = null;
  private sessionState = XR_SESSION_STATE_IDLE;
  /** Frames may be submitted (begun and not stopping). */
  private running = false;
  /** Between xrBeginSession and xrEndSession. */
  private begun = false;
  /** requestExit() was called: do not resume after STOPPING. */
  private exitRequested = false;

  /** Blend modes the runtime supports for PRIMARY_STEREO (XR_*_BLEND_*). */
  supportedBlendModes: number[] = [];
  eyeViews: EyeViewInfo[] = [];
  /** Refresh rates the runtime supports (via XR_FB_display_refresh_rate). */
  refreshRatesHz: number[] = [];
  runtimeName = "";
  runtimeVersion = "";
  /** Which reference space was created (LOCAL_FLOOR / STAGE / LOCAL). */
  spaceMode = "";
  /** True when the runtime's reference space is floor-anchored natively
   *  (LOCAL_FLOOR/STAGE). The LOCAL fallback is floor-anchored too, by an
   *  XR_EYE_HEIGHT origin offset (reference-space.ts) — poses are
   *  floor-level either way. */
  get floorAnchored(): boolean {
    return this.spaceMode !== "" && this.spaceMode !== "LOCAL";
  }

  constructor(
    private readonly profile: import("../profile.js").AppProfile,
    private readonly timing: import("../timing.js").FrameTiming,
    private readonly graphics: SessionGraphics<Image>,
  ) {}

  /** Actual swapchain size (recommended size scaled by the profile). */
  get swapchainSize(): { width: number; height: number } {
    return { width: this.swapchains?.width ?? 0, height: this.swapchains?.height ?? 0 };
  }

  /** Handles exposed for the input layer / WebXR driver. */
  get xrHandle(): XrHandle {
    return this.xr;
  }

  get sessionHandle(): unknown {
    return this.session;
  }

  get localSpaceHandle(): unknown {
    return this.space;
  }

  /** Size of one swapchain image (side-by-side: both eyes). */
  get swapchainImageSize(): { width: number; height: number } {
    return { width: this.swapchains?.imageWidth ?? 0, height: this.swapchains?.height ?? 0 };
  }

  /** Active environment blend mode (submitted with every xrEndFrame). */
  get blendModeValue(): number {
    return this.blendMode;
  }

  /** Current session state as a readable label (IDLE/FOCUSED/...). */
  get stateLabel(): string {
    return SESSION_STATE_NAMES[this.sessionState] ?? String(this.sessionState);
  }

  /**
   * `seeThrough`: initial presentation (default: the profile's passthrough;
   * a caller that follows the WebXR session mode starts opaque and calls
   * setSeeThrough later).
   */
  async init(applicationName: string, options: { seeThrough?: boolean } = {}): Promise<void> {
    this.bootstrap = bootstrapOpenXrLoader();
    const extensions = this.chooseExtensions(enumerateInstanceExtensions(this.bootstrap));
    this.xr = createXrInstance({ applicationName, extensions, bootstrap: this.bootstrap });
    const runtime = getRuntimeInfo(this.xr);
    const v = xrSplitVersion(runtime.version);
    this.runtimeName = runtime.name;
    this.runtimeVersion = `${v.major}.${v.minor}.${v.patch}`;
    sessionLog.info(`runtime: ${runtime.name} ${this.runtimeVersion}`);

    // System for HMD form factor.
    const systemOut = [0];
    xrCheck(
      this.xr.fn.xrGetSystem(
        this.xr.raw,
        { type: gen.XR_TYPE_SYSTEM_GET_INFO, next: null, formFactor: gen.XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY },
        systemOut,
      ),
      "xrGetSystem",
    );
    this.systemId = systemOut[0];

    const context: SessionContext = { xr: this.xr, bootstrap: this.bootstrap, systemId: this.systemId };
    this.session = await this.graphics.createSession(context);

    const space = createFloorReferenceSpace(
      this.xr,
      this.session,
      extensions.includes("XR_EXT_local_floor"),
      xrEnv().eyeHeight,
    );
    this.space = space.handle;
    this.spaceMode = space.mode;

    this.eyeViews = enumerateEyeViews(this.xr, this.systemId);
    sessionLog.info(
      `stereo eyes: ${this.eyeViews.map((e) => `${e.recommendedWidth}x${e.recommendedHeight}`).join(" + ")}`,
    );
    this.supportedBlendModes = enumerateBlendModes(this.xr, this.systemId);
    this.seeThrough = options.seeThrough ?? this.profile.passthrough;
    this.blendMode = chooseBlendMode(this.supportedBlendModes, this.seeThrough, xrEnv().premultipliedAlpha);

    // Per-eye swapchains at the recommended size scaled by the profile.
    const rec = this.eyeViews[0];
    const width = Math.max(1, Math.round(rec.recommendedWidth * this.profile.renderScale));
    const height = Math.max(1, Math.round(rec.recommendedHeight * this.profile.renderScale));
    if (width !== rec.recommendedWidth) {
      sessionLog.info(
        `render scale ${this.profile.renderScale}: swapchains ${width}x${height} ` +
          `(runtime recommends ${rec.recommendedWidth}x${rec.recommendedHeight}; compositor upscales)`,
      );
    }
    this.swapchains = this.graphics.createSwapchains(context, this.session, this.eyeViews.length, width, height);
    this.layer = new ProjectionLayer(this.space, this.swapchains);
  }

  private chooseExtensions(advertised: string[]): string[] {
    const extensions = [...this.graphics.extensions];
    if (advertised.includes("XR_FB_display_refresh_rate")) {
      extensions.push("XR_FB_display_refresh_rate");
    }
    // Floor-level LOCAL space (core in OpenXR 1.1; this instance is 1.0, so
    // it must be ENABLED as an extension before LOCAL_FLOOR may be created —
    // requesting it otherwise is a validation error on strict runtimes).
    if (advertised.includes("XR_EXT_local_floor")) {
      extensions.push("XR_EXT_local_floor");
    }
    if (this.profile.passthrough && advertised.includes("XR_FB_passthrough")) {
      // Activates the headset camera feed (create + start after session
      // begin); blend-mode ALPHA_BLEND alone leaves the feed off on WiVRn.
      extensions.push("XR_FB_passthrough");
    }
    return extensions;
  }

  /** Drains xrPollEvent; tracks the session state and stop conditions. */
  private pollEvents(): void {
    for (;;) {
      const event: Record<string, unknown> = { type: gen.XR_TYPE_EVENT_DATA_BUFFER, next: null };
      const res = this.xr.fn.xrPollEvent(this.xr.raw, event);
      if (res === gen.XR_RESULT_EVENT_UNAVAILABLE) return;
      xrCheck(res, "xrPollEvent");

      const eventType = Number(event.type);
      if (eventType === gen.XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED) {
        // Session(8) + state int32 live at varying offsets 0 and 8.
        const varying = event.varying as Uint8Array | number[];
        const bytes = varying instanceof Uint8Array ? varying : new Uint8Array(varying);
        const state = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
        const previous = this.sessionState;
        this.sessionState = state;
        // The runtime's first event repeats the initial IDLE.
        if (state !== previous) {
          sessionLog.info(
            `state: ${SESSION_STATE_NAMES[previous] ?? previous} -> ${SESSION_STATE_NAMES[state] ?? state}`,
          );
        }
        if (state === XR_SESSION_STATE_STOPPING || state === XR_SESSION_STATE_EXITING || state === XR_SESSION_STATE_LOSS_PENDING) {
          this.running = false;
        }
        // The spec requires xrEndSession in STOPPING (runtime- or
        // app-initiated); the session then returns to IDLE and may become
        // READY again (e.g. headset reconnected) or EXITING.
        if (state === XR_SESSION_STATE_STOPPING && this.begun) this.endSession();
      } else if (eventType === gen.XR_TYPE_EVENT_DATA_INSTANCE_LOSS_PENDING) {
        sessionLog.info("instance loss pending — stopping");
        this.running = false;
      } else if (eventType === gen.XR_TYPE_EVENT_DATA_EVENTS_LOST) {
        sessionLog.info("events lost (queue overflow)");
      }
    }
  }

  /** Waits until the session reaches READY, then calls xrBeginSession. */
  async begin(): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (this.sessionState !== XR_SESSION_STATE_READY) {
      this.pollEvents();
      if (this.sessionState === XR_SESSION_STATE_READY) break;
      if (this.sessionState === XR_SESSION_STATE_EXITING || this.sessionState === XR_SESSION_STATE_LOSS_PENDING) {
        throw new Error(`session cannot begin (state ${SESSION_STATE_NAMES[this.sessionState]})`);
      }
      if (Date.now() > deadline) {
        throw new Error(`timeout waiting for session READY (stuck in ${SESSION_STATE_NAMES[this.sessionState]})`);
      }
      await sleep(20);
    }
    this.beginSession();
    this.refreshRatesHz = enumerateRefreshRates(this.xr, this.session);
  }

  private beginSession(): void {
    xrCheck(
      this.xr.fn.xrBeginSession(this.session, {
        type: gen.XR_TYPE_SESSION_BEGIN_INFO,
        next: null,
        primaryViewConfigurationType: XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
      }),
      "xrBeginSession",
    );
    this.running = true;
    this.begun = true;
    sessionLog.info("session begun (PRIMARY_STEREO)");
    this.applyPassthroughFeed();
  }

  private endSession(): void {
    xrCheck(this.xr.fn.xrEndSession(this.session), "xrEndSession");
    this.begun = false;
    this.passthroughRunning = false; // the feed does not outlive the session's run
    sessionLog.info(this.exitRequested ? "session ended (exit requested)" : "session ended by the runtime — waiting for READY to resume");
  }

  /**
   * Ends the session the spec way: xrRequestExitSession; the runtime moves
   * it to STOPPING, where pollEvents calls xrEndSession, then EXITING.
   * runFrames returns once it is no longer running; shutdown() completes it.
   */
  requestExit(): void {
    if (this.exitRequested) return;
    this.exitRequested = true;
    if (this.begun && this.session !== null) {
      xrCheck(this.xr.fn.xrRequestExitSession(this.session), "xrRequestExitSession");
      sessionLog.info("exit requested");
    }
  }

  /** True while frames can be submitted. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Switches see-through presentation at runtime — e.g. following the WebXR
   * session mode (immersive-ar vs immersive-vr). On: ALPHA_BLEND/ADDITIVE
   * environment blend mode (when supported) and the XR_FB_passthrough feed
   * (when the extension was enabled at init — `profile.passthrough`, the
   * device capability). Off: OPAQUE and the feed paused.
   */
  setSeeThrough(on: boolean): void {
    if (on === this.seeThrough) return;
    this.seeThrough = on;
    this.blendMode = chooseBlendMode(this.supportedBlendModes, on, xrEnv().premultipliedAlpha);
    if (this.running) this.applyPassthroughFeed();
  }

  /** Brings the XR_FB_passthrough feed in line with `seeThrough`. */
  private applyPassthroughFeed(): void {
    if (this.seeThrough === this.passthroughRunning) return;
    if (this.seeThrough && this.passthrough === null) {
      if (!this.xr.enabledExtensions.includes("XR_FB_passthrough")) {
        if (this.profile.passthrough) startFbPassthrough(this.xr, this.session); // logs "not advertised"
        return;
      }
      this.passthrough = startFbPassthrough(this.xr, this.session);
      this.passthroughRunning = this.passthrough !== null;
      return;
    }
    if (this.passthrough !== null) {
      setFbPassthroughRunning(this.xr, this.passthrough, this.seeThrough);
      this.passthroughRunning = this.seeThrough;
    }
  }

  /**
   * Runs the frame loop for `frameCount` frames (0 = until stopped),
   * submitting a projection layer each renderable frame. `frameHook(
   * displayTime, eyePoses?)` runs once per frame after xrBeginFrame — with
   * the located eye poses on renderable frames — and is the integration
   * slot for the action sync + WebXR driver.
   *
   * Pixels come from `direct` when given (acquire every eye, draw straight
   * into the images, finish, release — `source` may then be null),
   * otherwise from `source` per eye (CPU pixels uploaded into the images).
   */
  async runFrames(
    source: FrameSource | null,
    frameCount: number,
    onProgress?: (stats: FrameLoopStats) => void,
    frameHook?: (displayTime: number, eyePoses?: EyeViewPose[]) => void,
    direct?: DirectFrameRenderer<Image>,
  ): Promise<FrameLoopStats> {
    if (direct === undefined && source === null) {
      throw new Error("runFrames: no source and no direct renderer provided");
    }
    const swapchains = this.swapchains!;
    const layer = this.layer!;
    const eyeCount = swapchains.eyeCount;
    const premultiplied = xrEnv().premultipliedAlpha;
    const stats: FrameLoopStats = { framesSubmitted: 0, framesSkipped: 0, state: "" };
    const frameState: Record<string, unknown> = { type: gen.XR_TYPE_FRAME_STATE, next: null };
    const viewState: Record<string, unknown> = { type: gen.XR_TYPE_VIEW_STATE, next: null };
    const views: Array<Record<string, unknown>> = Array.from({ length: eyeCount }, () => ({
      type: gen.XR_TYPE_VIEW,
      next: null,
    }));
    const viewCountOut = [0];

    let frame = 0;
    while (frameCount === 0 || frame < frameCount) {
      if (!this.running && !(await this.resumeAfterRuntimeStop())) break;
      this.timing.beginFrame();
      this.timing.frameWallClock();
      // Frame pacing + predicted display time.
      this.timing.stage("xrWaitFrame", () =>
        xrCheck(this.xr.fn.xrWaitFrame(this.session, { type: gen.XR_TYPE_FRAME_WAIT_INFO, next: null }, frameState), "xrWaitFrame"),
      );
      const displayTime = frameState.predictedDisplayTime as number;
      const period = Number(frameState.predictedDisplayPeriod);
      if (period > 0 && this.timing.targetFramePeriodMs === 0) {
        this.timing.targetFramePeriodMs = period / 1e6;
      }
      this.timing.stage("pollEvents", () => this.pollEvents());
      // Stopped (STOPPING handled in pollEvents): the loop top resumes or ends.
      if (!this.running) continue;

      this.timing.stage("xrBeginFrame", () =>
        xrCheck(this.xr.fn.xrBeginFrame(this.session, { type: gen.XR_TYPE_FRAME_BEGIN_INFO, next: null }), "xrBeginFrame"),
      );

      let layerCount = 0;
      if (frameState.shouldRender === gen.XR_TRUE && Number(displayTime) !== 0) {
        this.timing.stage("xrLocateViews", () =>
          xrCheck(
            this.xr.fn.xrLocateViews(
              this.session,
              {
                type: gen.XR_TYPE_VIEW_LOCATE_INFO,
                next: null,
                viewConfigurationType: XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
                displayTime,
                space: this.space,
              },
              viewState,
              eyeCount,
              viewCountOut,
              views,
            ),
            "xrLocateViews",
          ),
        );
        this.timing.locatedViews();
        const eyePoses = toEyePoses(views, viewCountOut[0]);

        this.timing.stage("frameHook", () => frameHook?.(Number(displayTime), eyePoses));
        if (direct !== undefined) {
          await this.renderDirect(direct, frame, eyePoses);
        } else {
          await this.renderFromSource(source!, frame, eyePoses);
        }

        this.timing.stage("encodeLayer", () => layer.encode(views, this.blendMode, premultiplied));
        layerCount = 1;
        stats.framesSubmitted++;
      } else {
        stats.framesSkipped++;
        this.timing.countSkipped();
        this.timing.stage("frameHook", () => frameHook?.(Number(displayTime)));
      }

      const endInfo = {
        type: gen.XR_TYPE_FRAME_END_INFO,
        next: null,
        displayTime,
        environmentBlendMode: this.blendMode,
        layerCount,
        layers: layerCount === 1 ? layer.layersPtr : null,
      };
      this.timing.stage("xrEndFrame", () => xrCheck(this.xr.fn.xrEndFrame(this.session, endInfo), "xrEndFrame"));
      this.timing.endedFrame();
      frame++;

      stats.state = this.stateLabel;
      if (onProgress && (frame % 30 === 0 || !this.running)) onProgress(stats);
    }
    return stats;
  }

  /**
   * After a runtime-initiated stop (STOPPING -> xrEndSession -> IDLE),
   * waits for READY and begins again — e.g. the headset reconnected. Gives
   * up (false) on EXITING / LOSS_PENDING, or when an exit was requested.
   */
  private async resumeAfterRuntimeStop(): Promise<boolean> {
    for (;;) {
      if (this.exitRequested) return false;
      const state = this.sessionState;
      if (state === XR_SESSION_STATE_EXITING || state === XR_SESSION_STATE_LOSS_PENDING) return false;
      if (state === XR_SESSION_STATE_READY) {
        this.beginSession();
        sessionLog.info("session resumed");
        return true;
      }
      await sleep(50);
      this.pollEvents();
    }
  }

  /** Zero-copy path: acquire every swapchain, render into the images, flush, release. */
  private async renderDirect(direct: DirectFrameRenderer<Image>, frame: number, eyePoses: EyeViewPose[]): Promise<void> {
    const swapchains = this.swapchains!;
    const images: Image[] = [];
    for (let i = 0; i < swapchains.handles.length; i++) {
      images.push(this.timing.stage(`acquire${i}`, () => swapchains.acquire(i)));
    }
    await this.timing.stageAsync("directRender", () => Promise.resolve(direct(frame, eyePoses, images)));
    this.timing.stage(this.graphics.finishStage, () => this.graphics.finishRendering());
    for (let i = 0; i < swapchains.handles.length; i++) {
      this.timing.stage(`release${i}`, () => swapchains.release(i));
    }
  }

  /** CPU path: per eye, produce RGBA8 pixels and upload them into the image. */
  private async renderFromSource(source: FrameSource, frame: number, eyePoses: EyeViewPose[]): Promise<void> {
    const swapchains = this.swapchains!;
    if (this.graphics.uploadPixels === undefined) throw new Error("this graphics API has no CPU pixel path");
    for (let eye = 0; eye < swapchains.eyeCount; eye++) {
      const pixels = await this.timing.stageAsync(`sourceEye${eye}`, () =>
        source(eye, swapchains.width, swapchains.height, frame, eyePoses),
      );
      this.timing.stage(`uploadEye${eye}`, () => this.graphics.uploadPixels!(eye, pixels));
    }
  }

  /**
   * Ends a still-running session the spec way (request exit -> STOPPING ->
   * xrEndSession in pollEvents -> EXITING), waiting up to 5 s for the
   * runtime. Returns whether the session is ended; shutdown() calls it, and
   * destroys a session that was never ended as the fallback.
   */
  async end(): Promise<boolean> {
    if (this.session !== null && this.begun) {
      this.requestExit();
      const deadline = Date.now() + 5_000;
      while (this.begun && Date.now() < deadline) {
        this.pollEvents();
        await sleep(10);
      }
      if (this.begun) sessionLog.warn("runtime never reached STOPPING — destroying the session without xrEndSession");
    }
    return !this.begun;
  }

  /**
   * Ends the session if it is still running (end()), then destroys
   * everything. Each step runs even if an earlier one throws, so a failing
   * xrDestroySwapchain still destroys the session and instance; the first
   * failure is rethrown at the end.
   */
  async shutdown(): Promise<void> {
    await this.end();
    const failures: unknown[] = [];
    const step = (name: string, run: () => void): void => {
      try {
        run();
      } catch (error) {
        sessionLog.error(`shutdown: ${name} failed —`, error);
        failures.push(error);
      }
    };
    step("swapchains", () => this.swapchains?.destroy());
    this.swapchains = null;
    this.layer = null;
    if (this.passthrough !== null) step("passthrough", () => destroyFbPassthrough(this.xr, this.passthrough));
    this.passthrough = null;
    if (this.space !== null) step("space", () => xrCheck(this.xr.fn.xrDestroySpace(this.space), "xrDestroySpace"));
    this.space = null;
    if (this.session !== null) step("session", () => xrCheck(this.xr.fn.xrDestroySession(this.session), "xrDestroySession"));
    this.session = null;
    step("graphics", () => this.graphics.destroy?.());
    if (this.xr !== undefined) step("instance", () => this.xr.destroy());
    if (failures.length > 0) throw failures[0];
    sessionLog.info("shut down cleanly");
  }
}

/** Copies the located XrView poses/fovs out of the reused koffi objects. */
function toEyePoses(views: Array<Record<string, unknown>>, count: number): EyeViewPose[] {
  const eyePoses: EyeViewPose[] = [];
  for (let eye = 0; eye < count; eye++) {
    const pose = views[eye].pose as Record<string, Record<string, number>>;
    const fov = views[eye].fov as Record<string, number>;
    eyePoses.push({
      position: { ...pose.position } as unknown as EyeViewPose["position"],
      orientation: { ...pose.orientation } as unknown as EyeViewPose["orientation"],
      fov: { ...fov } as unknown as EyeViewPose["fov"],
    });
  }
  return eyePoses;
}
