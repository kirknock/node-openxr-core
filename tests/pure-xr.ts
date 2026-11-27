/**
 * Shared setup for the pure Babylon WebXR smokes (NullEngine, no GL, no
 * OpenXR), and a check list that keeps going after a failure and ends with
 * one "<NAME> SMOKE: PASS|FAIL" line.
 *
 * createPureXr: IWER device -> Babylon's WebXRSessionManager, WebXRCamera,
 * WebXRInput and a features manager, put together by hand. Frames are driven by hand, as in teleportation-smoke.ts: each one delivers
 * an XRFrame to Babylon's frame observable, renders the scene (NullEngine:
 * camera update and before-render callbacks, no drawing) and lets promises
 * settle. The engine's
 * delta time and fps are fixed (FRAME_MS), so features that scale by them
 * (movement, walking locomotion) move the same on every run.
 *
 * createLoopXr: Babylon's WebXRExperienceHelper on its own XR render loop
 * (engine.runRenderLoop with the session as the frame requester), as the app
 * runs; frames come from pumping the rAF queue.
 */
import { installIwerRuntime } from "../src/webxr/iwer-runtime.js";
import { createFakeGlContext } from "../src/platform/env-shims.js";

export type Babylon = typeof import("@babylonjs/core");
/** The engine's frame time in these tests: 72 Hz, a headset rate. */
export const FRAME_MS = 1000 / 72;
export type Hand = "left" | "right";

export class Checks {
  private readonly failures: string[] = [];
  constructor(private readonly name: string) {}

  check(label: string, ok: boolean, detail = ""): boolean {
    console.log(`[smoke] ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : `: ${detail}`}`);
    if (!ok) this.failures.push(label);
    return ok;
  }

  /** Prints the verdict and exits: non-zero when any check failed. */
  done(): never {
    if (this.failures.length === 0) {
      console.log(`${this.name} SMOKE: PASS`);
      process.exit(0);
    }
    console.error(`${this.name} SMOKE: FAIL (${this.failures.length} failed: ${this.failures.join("; ")})`);
    process.exit(1);
  }

  /** Runs main; an exception fails the smoke. */
  run(main: () => Promise<void>): void {
    main().then(
      () => this.done(),
      (err: unknown) => {
        console.error(`${this.name} SMOKE: ERROR`, err);
        process.exit(1);
      },
    );
  }
}

export const fmt = (v: { x: number; y: number; z: number }): string => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

export async function createPureXr() {
  const { device, pump } = installIwerRuntime();
  const BABYLON = await import("@babylonjs/core");

  const engine = new BABYLON.NullEngine();
  engine.getDeltaTime = () => FRAME_MS;
  engine.getFps = () => 1000 / FRAME_MS;
  const scene = new BABYLON.Scene(engine);
  const sessionManager = new BABYLON.WebXRSessionManager(scene);
  await sessionManager.initializeAsync();

  // WebXRInput BEFORE session init (inputsourceschange attaches on init).
  const xrCamera = new BABYLON.WebXRCamera("xrCam", scene, sessionManager);
  const xrInput = new BABYLON.WebXRInput(sessionManager, xrCamera, {
    disableOnlineControllerRepository: true,
    doNotLoadControllerMeshes: true,
  });
  const featuresManager = new BABYLON.WebXRFeaturesManager(sessionManager);
  scene.activeCamera = xrCamera;

  const XRWebGLLayerCtor = (globalThis as unknown as { XRWebGLLayer: new (s: unknown, c: unknown) => XRWebGLLayer }).XRWebGLLayer;

  /** Starts the session (default immersive-vr in local-floor) with a duck-typed base layer. */
  const enter = async (mode: XRSessionMode = "immersive-vr", space: XRReferenceSpaceType = "local-floor"): Promise<XRSession> => {
    await sessionManager.initializeSessionAsync(mode, { optionalFeatures: [space] });
    await sessionManager.setReferenceSpaceTypeAsync(space);
    const session = sessionManager.session;
    void session.updateRenderState({ baseLayer: new XRWebGLLayerCtor(session, createFakeGlContext()) });
    return session;
  };

  /** Connects only the given controllers (IWER also has a 'none' one). */
  const connectOnly = (...hands: Hand[]): void => {
    for (const key of ["left", "right", "none"] as const) {
      const c = device.controllers[key];
      if (c !== undefined) c.connected = (hands as string[]).includes(key);
    }
  };

  const controller = (hand: Hand) => {
    const c = device.controllers[hand];
    if (c === undefined) throw new Error(`iwer device has no ${hand} controller`);
    return c;
  };

  /** Holds the controller at chest height, pitched `down` radians below the horizon (WebXR: -Z forward). */
  const aim = (hand: Hand, down: number, x = hand === "left" ? -0.2 : 0.2): void => {
    const c = controller(hand);
    c.position.set(x, 1.4, 0);
    c.quaternion.set(Math.sin(-down / 2), 0, 0, Math.cos(-down / 2));
  };

  /** Runs frames; `each(i)` runs before frame i (e.g. to move the head). */
  const runFrames = async (count: number, each?: (i: number) => void): Promise<void> => {
    for (let i = 0; i < count; i++) {
      each?.(i);
      sessionManager.session.requestAnimationFrame((_time, frame) => {
        sessionManager.currentFrame = frame;
        sessionManager.currentTimestamp = performance.now();
        sessionManager.onXRFrameObservable.notifyObservers(frame);
        // What the app's render does here: camera inputs (cameraDirection,
        // cameraRotation), world matrices, and the before-render callbacks
        // features defer work to (pointer selection disposes a removed
        // controller's meshes there). Nothing draws on a NullEngine.
        scene.render();
      });
      pump.pump();
      // Motion-controller init resolves on a promise; flush between frames.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  /** The viewer pose in Babylon's current reference space, read in one frame. */
  const viewerPose = (space: XRReferenceSpace = sessionManager.referenceSpace): XRRigidTransform | undefined => {
    let pose: XRRigidTransform | undefined;
    sessionManager.session.requestAnimationFrame((_time, frame) => {
      pose = (frame).getViewerPose(space)?.transform;
    });
    pump.pump();
    return pose;
  };

  return { BABYLON, device, pump, engine, scene, sessionManager, xrCamera, xrInput, featuresManager, enter, connectOnly, controller, aim, runFrames, viewerPose };
}

export type PureXr = Awaited<ReturnType<typeof createPureXr>>;

export async function createLoopXr() {
  const { device, pump } = installIwerRuntime();
  device.stereoEnabled = true; // as OpenXrIwerDriver sets it from the two located eyes
  // As platform/browser-env.ts: the window's frame functions are the pumped
  // ones. Without them Babylon queues its loop on setTimeout, cannot cancel
  // it when XR starts and renders twice per XR frame.
  const G = globalThis as unknown as { window: Record<string, unknown>; requestAnimationFrame: unknown; cancelAnimationFrame: unknown };
  Object.assign(G.window, { requestAnimationFrame: G.requestAnimationFrame, cancelAnimationFrame: G.cancelAnimationFrame });
  const BABYLON = await import("@babylonjs/core");

  /** Pumps n frames of whatever waits on rAF: the XR session's loop or the engine's own. */
  const frames = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      pump.pump();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const desktopCamera = new BABYLON.FreeCamera("desktop", new BABYLON.Vector3(0, 1.6, -2), scene);
  const stats = { renders: 0 };
  scene.onAfterRenderObservable.add(() => stats.renders++);
  engine.runRenderLoop(() => scene.render());
  const helper = await BABYLON.WebXRExperienceHelper.CreateAsync(scene);

  // A WebGL layer on the fake context: what the platform's canvas gives the app.
  const XRWebGLLayerCtor = (globalThis as unknown as { XRWebGLLayer: new (s: unknown, c: unknown) => XRWebGLLayer }).XRWebGLLayer;
  const renderTarget = (): import("@babylonjs/core").WebXRRenderTarget => ({
    canvasContext: createFakeGlContext() as unknown as WebGLRenderingContext,
    xrLayer: null,
    async initializeXRLayerAsync(session: XRSession) {
      this.xrLayer = new XRWebGLLayerCtor(session, this.canvasContext);
      return this.xrLayer;
    },
    dispose() {},
  });

  /** Enters immersive-vr; IWER grants the session on its own frame loop, so this pumps until Babylon is in XR, or rethrows why not. */
  const enter = async (space: XRReferenceSpaceType = "local-floor"): Promise<XRSession> => {
    const entering = helper.enterXRAsync("immersive-vr", space, renderTarget());
    let settled = false;
    entering.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 20 && !settled; i++) await frames(1);
    await entering;
    // IN_XR comes with the first XR frame.
    for (let i = 0; i < 5 && helper.state !== BABYLON.WebXRState.IN_XR; i++) await frames(1);
    return helper.sessionManager.session;
  };

  return { BABYLON, device, pump, engine, scene, desktopCamera, helper, stats, frames, enter };
}
