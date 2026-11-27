/**
 * node-openxr platform: everything that makes a plain browser-style
 * Babylon.js WebXR app run in Node.js against a native OpenXR runtime, around a
 * renderer (nodexr-webgl or nodexr-webgpu, each platform.ts). The app sees only standard
 * objects: a canvas whose getContext works, `navigator.xr`, `document`,
 * `XMLHttpRequest`, requestAnimationFrame. It uses Babylon exactly as in a
 * browser.
 *
 * How the pieces line up:
 *   - IWER provides navigator.xr; the OpenXR->IWER driver feeds it head,
 *     controllers and the exact per-eye projections every frame.
 *   - The renderer owns the session's graphics and draws straight into the
 *     acquired swapchain images. Zero copy.
 *   - Presentation follows the WebXR session mode: immersive-ar switches the
 *     OpenXR session to see-through (blend mode + XR_FB_passthrough feed).
 *     `passthrough: true` (or XR_PASSTHROUGH=1) is the device capability.
 *   - Frame order per OpenXR frame: wait/begin/locate -> sync IWER state ->
 *     acquire, the renderer's beginFrame -> one event-loop turn ->
 *     pump IWER's rAF (Babylon renders here, in its own XR render loop) ->
 *     haptics -> the renderer's endFrame -> finish, release -> end.
 */
import { resolveProfile, type AppProfile } from "../profile.js";
import { FrameTiming } from "../timing.js";
import { logger, rawLog } from "../log.js";
import { xrEnv } from "../config.js";
import { checkDependencyVersions, checkSingleCopies } from "../compat.js";
import { buildIdentity, collectStaticData, printEnvReport } from "../env-report.js";
import type { EyeViewPose, OpenXrSession } from "../xr/session.js";
import type { OpenXrIwerDriver } from "../webxr/openxr-driver.js";
import type { AppCanvas } from "./browser-env.js";

export type { AppCanvas };

const mainLog = logger("main");
const platformLog = logger("platform");
const timingLog = logger("timing");
const timingFinalLog = logger("timing final");


export interface RunStats {
  framesSubmitted: number;
  /** WebXR frames the app's session delivered (should track framesSubmitted). */
  webxrFrames: number;
  /** Last head position pushed into the WebXR device (session space). */
  viewerPosition: { x: number; y: number; z: number } | null;
  /** Last swapchain pixel sample (XR_PIXEL_DEBUG; empty otherwise). */
  lastSample: string;
  /** Distinct errors thrown out of the WebXR frame (message -> count). */
  frameErrors: Map<string, number>;
}

export interface NodeXrPlatform<Internals> {
  /** Hand to `new Engine(canvas, ...)`, exactly like a browser canvas. */
  canvas: AppCanvas;
  /** Starts the OpenXR session and drives `frames` frames (0 = until stopped). */
  run(frames: number): Promise<RunStats>;
  /** Tears the native session down. */
  shutdown(): Promise<void>;
  /** Diagnostics access (not for app code). */
  readonly internals: Internals & { driver: OpenXrIwerDriver };
}

/** The renderer's part of the platform; the session lifecycle, input, IWER and the frame loop are shared. */
export interface PlatformRenderer<Image, Internals> {
  session: OpenXrSession<Image>;
  canvas: AppCanvas;
  internals: Internals;
  /** For the `ready` log line. */
  readonly description: string;
  /** Last swapchain pixel sample, for the DONE line (empty if none). */
  readonly lastSample: string;
  /** Before the session begins. */
  prepare(): Promise<void>;
  /** Fills the graphics part of the environment report. */
  describe(report: ReturnType<typeof collectStaticData>): void;
  /** The acquired images become what WebXR content renders into. */
  beginFrame(images: Image[]): void;
  /** WebXR content has rendered; the images are still acquired. */
  endFrame(frame: number, images: Image[], views: EyeViewPose[]): void;
  /** Before the native session is torn down. */
  shutdown(): void;
}

/** The platform around a renderer; `createRenderer` runs after IWER is installed and before input. */
export async function startPlatform<Image, Internals>(
  options: { applicationName?: string; passthrough?: boolean },
  createRenderer: (profile: AppProfile, timing: FrameTiming, applicationName: string, iwerDevice: { supportedFeatures: string[] }) => Promise<PlatformRenderer<Image, Internals>>,
): Promise<NodeXrPlatform<Internals>> {
  const profile = resolveProfile();
  profile.passthrough ||= options.passthrough === true;
  mainLog.info(`node-openxr ${buildIdentity()}`);
  checkDependencyVersions();
  checkSingleCopies();
  const timing = new FrameTiming(profile.timing);
  const envReport = collectStaticData(profile);

  // 1. WebXR Device API (IWER) before anything Babylon loads.
  const { installIwerRuntime } = await import("../webxr/iwer-runtime.js");
  const iwer = installIwerRuntime(profile.passthrough);
  const activeSession = trackActiveSession();

  // 2. The renderer: OpenXR session + the browser surface the app's Babylon uses.
  const renderer = await createRenderer(profile, timing, options.applicationName ?? "node-openxr-app", iwer.device);
  const { session } = renderer;

  // 3. Native input + the driver that feeds IWER.
  const { OpenXrInput } = await import("../xr/input.js");
  const { OpenXrIwerDriver } = await import("../webxr/openxr-driver.js");
  const input = new OpenXrInput(session.xrHandle);
  input.init();
  input.attach(session);
  const driver = new OpenXrIwerDriver(iwer.device, session, input, iwer.pump, timing);
  if (xrEnv().synthInput) {
    const { installDemoInput } = await import("../webxr/demo-input.js");
    installDemoInput(driver);
  }
  platformLog.info(`ready: ${renderer.description}`);

  return {
    canvas: renderer.canvas,
    internals: Object.assign(renderer.internals as Internals & object, { driver }),
    async run(frames: number) {
      await renderer.prepare();
      // Presentation follows the app's session mode, as in a browser:
      // immersive-ar = see-through (blend mode + passthrough feed).
      const followSessionMode = (): void => session.setSeeThrough(activeSession.current?.mode === "immersive-ar");
      followSessionMode();
      await session.begin();
      renderer.describe(envReport);
      printEnvReport(fillEnvReport(envReport, session));
      // Ctrl+C / SIGTERM / SIGHUP end the session the spec way (request
      // exit -> STOPPING -> xrEndSession); the frame loop then returns
      // normally. A second signal forces the process out.
      let signals = 0;
      const onSignal = (signal: NodeJS.Signals): void => {
        if (++signals > 1) process.exit(130);
        mainLog.info(`${signal}: ending the XR session (again to force)`);
        session.requestExit();
      };
      const signalNames: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
      for (const name of signalNames) process.on(name, onSignal);

      const frameErrors = new Map<string, number>();
      const summaryTimer = profile.timing ? setInterval(() => timingLog.info(`\n${timing.summary()}`), 5000) : null;
      let latestViews: EyeViewPose[] = [];
      const stats = await session.runFrames(
        null,
        frames,
        undefined,
        (displayTime, eyePoses) => {
          if (eyePoses !== undefined) latestViews = eyePoses;
          driver.syncFrame(displayTime, eyePoses, { pump: false });
        },
        async (frame, _views, images) => {
          // One event-loop turn per frame, as a browser gives between frames:
          // timer-deferred work (e.g. Babylon's Tools.SetImmediate) runs here.
          await new Promise<void>((resolve) => setImmediate(resolve));
          followSessionMode();
          renderer.beginFrame(images);
          try {
            driver.pumpFrame();
          } catch (err) {
            // A browser would report an exception in a rAF callback and go
            // on; keep the native loop alive and count it for the summary.
            const key = err instanceof Error ? err.message : String(err);
            const seen = frameErrors.get(key) ?? 0;
            frameErrors.set(key, seen + 1);
            if (seen === 0) mainLog.error("WebXR frame error — loop continues:", err);
          }
          // Haptics: wraps any new gamepad actuators so content pulses reach
          // xrApplyHapticFeedback (idempotent per actuator).
          const active = activeSession.current;
          if (active !== null) driver.forwardHaptics(active.session.inputSources as never);
          renderer.endFrame(frame, images, latestViews);
        },
      );
      for (const name of signalNames) process.off(name, onSignal);
      if (summaryTimer !== null) clearInterval(summaryTimer);
      if (profile.timing) timingFinalLog.info(`\n${timing.summary()}`);
      return {
        framesSubmitted: stats.framesSubmitted,
        webxrFrames: activeSession.frames,
        viewerPosition: driver.stats.lastHead,
        lastSample: renderer.lastSample,
        frameErrors,
      };
    },
    async shutdown() {
      // The session is shut down even if the renderer or input fail to.
      try {
        renderer.shutdown();
        input.dispose(); // action spaces + action set, before the session goes
      } finally {
        await session.shutdown();
      }
    },
  };
}

/** The standard DONE line (+ frame-error summary) for entry points. */
export function logRunSummary(stats: RunStats, controllers: string[]): void {
  const p = stats.viewerPosition;
  rawLog("");
  mainLog.info(
    `DONE: ${stats.framesSubmitted} OpenXR frames, ${stats.webxrFrames} WebXR frames, ` +
      `controllers=[${controllers.join(", ") || "none"}]` +
      (p !== null ? ` viewerPose=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})` : "") +
      (stats.lastSample !== "" ? ` — last sample: ${stats.lastSample}` : ""),
  );
  if (stats.frameErrors.size > 0) {
    const total = [...stats.frameErrors.values()].reduce((a, b) => a + b, 0);
    mainLog.info(`WebXR frame errors: ${total} in ${stats.frameErrors.size} kind(s): ${[...stats.frameErrors.keys()].join(" | ")}`);
  }
}

function fillEnvReport<Image>(report: ReturnType<typeof collectStaticData>, session: OpenXrSession<Image>): ReturnType<typeof collectStaticData> {
  report.openxr = {
    runtimeName: session.runtimeName,
    runtimeVersion: session.runtimeVersion,
    eyeRecommended: session.eyeViews.map((e) => `${e.recommendedWidth}x${e.recommendedHeight}`).join("+"),
    refreshRatesHz: session.refreshRatesHz,
    blendModes: session.supportedBlendModes,
    blendModeActive: session.blendModeValue,
  };
  return report;
}

interface XRSessionLike {
  inputSources: unknown;
  addEventListener(type: string, listener: () => void): void;
  requestAnimationFrame(callback: (time: number, frame: unknown) => void): number;
}

interface ActiveSession {
  session: XRSessionLike;
  mode: string;
}

/**
 * Remembers the immersive session the app requests (wraps
 * navigator.xr.requestSession), so the platform can serve it per frame —
 * presentation mode, haptics — and counts the WebXR frames it delivers,
 * without the app handing anything over.
 */
function trackActiveSession(): { current: ActiveSession | null; frames: number } {
  const state: { current: ActiveSession | null; frames: number } = { current: null, frames: 0 };
  const xr = (globalThis as unknown as { navigator: { xr: { requestSession(mode: string, init?: unknown): Promise<XRSessionLike> } } }).navigator.xr;
  const original = xr.requestSession.bind(xr);
  xr.requestSession = async (mode: string, init?: unknown) => {
    const session = await original(mode, init);
    state.current = { session, mode };
    session.addEventListener("end", () => {
      if (state.current?.session === session) state.current = null;
    });
    // Count delivered frames (one per frame time, however many callbacks).
    const requestFrame = session.requestAnimationFrame.bind(session);
    let lastTime = -1;
    session.requestAnimationFrame = (callback) =>
      requestFrame((time, frame) => {
        if (time !== lastTime) {
          lastTime = time;
          state.frames++;
        }
        callback(time, frame);
      });
    return session;
  };
  return state;
}
