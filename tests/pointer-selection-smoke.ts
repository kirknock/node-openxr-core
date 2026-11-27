/**
 * Pointer-selection smoke: iwer device -> Babylon WebXRInput + the
 * xr-controller-pointer-selection feature (NullEngine, no GL, no OpenXR).
 *
 * Asserts:
 *   - the feature attaches and creates its laser/selection meshes in the
 *     MAIN scene (useUtilityLayer:false), so this pure test (NullEngine,
 *     nothing rendered) can find them in scene.meshes
 *   - a trigger press with the controller aimed at a pickable box produces
 *     a scene POINTERDOWN carrying the box as the picked mesh
 *   - trigger release produces POINTERUP
 */
import { installIwerRuntime } from "../src/webxr/iwer-runtime.js";
import { createFakeGlContext } from "../src/platform/env-shims.js";

function fail(msg: string): never {
  console.error(`POINTER-SELECTION SMOKE: FAIL (${msg})`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { device, pump } = installIwerRuntime();
  const BABYLON = await import("@babylonjs/core");

  const engine = new BABYLON.NullEngine();
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
  const feature = featuresManager.enableFeature("xr-controller-pointer-selection", undefined, {
    xrInput,
    useUtilityLayer: false,
    disableScenePointerVectorUpdate: true,
    enablePointerSelectionOnAllControllers: true,
    disablePointerUpOnTouchOut: false,
    forceGazeMode: false,
  });

  // Pickable target 1 m ahead of the controller. Babylon scene coords are
  // LEFT-handed: an identity WebXR aim (RH -Z forward) converts to scene +Z
  // — the same conversion the app's eye cameras apply to view poses.
  // computeWorldMatrix: this smoke never calls scene.render() (the app's
  // frame loop would), and ray->mesh intersection reads the world matrix
  // WITHOUT recomputing it — stale identity would make every pick miss.
  const box = BABYLON.MeshBuilder.CreateBox("pickBox", { size: 0.4 }, scene);
  box.position.set(0, 1.4, 1);
  box.computeWorldMatrix(true);

  const events: string[] = [];
  scene.onPointerObservable.add((info) => {
    if (info.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      events.push(`down:${info.pickInfo?.pickedMesh?.name ?? "-"}`);
    } else if (info.type === BABYLON.PointerEventTypes.POINTERUP) {
      events.push(`up:${info.pickInfo?.pickedMesh?.name ?? "-"}`);
    }
  });

  await sessionManager.initializeSessionAsync("immersive-vr", { optionalFeatures: ["local-floor"] });
  // local-floor = IWER world identity: poses arrive as pushed (same frame
  // the app renders in).
  await sessionManager.setReferenceSpaceTypeAsync("local-floor");
  const wxrSession = sessionManager.session;
  const XRWebGLLayerCtor = (globalThis as unknown as {
    XRWebGLLayer: new (s: unknown, c: unknown) => XRWebGLLayer;
  }).XRWebGLLayer;
  void wxrSession.updateRenderState({ baseLayer: new XRWebGLLayerCtor(wxrSession, createFakeGlContext()) });

  const left = device.controllers.left;
  if (left === undefined) fail("iwer device has no left controller");
  for (const key of ["left", "right", "none"] as const) {
    const c = device.controllers[key];
    if (c !== undefined) c.connected = false;
  }
  left.connected = true;
  left.position.set(0, 1.4, 0); // straight ahead of the box, identity aim
  left.quaternion.set(0, 0, 0, 1);

  const runFrames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) {
      wxrSession.requestAnimationFrame((_time, frame) => {
        sessionManager.currentFrame = frame;
        sessionManager.currentTimestamp = performance.now();
        sessionManager.onXRFrameObservable.notifyObservers(frame);
      });
      pump.pump();
      // Motion-controller init resolves on a promise; flush between frames.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  // Warm-up: profile init, feature attach, first pointer pose.
  await runFrames(6);
  if (feature.attached !== true) fail("pointer-selection feature not attached");
  const laser = scene.meshes.find((m) => m.name === "laserPointer");
  if (laser === undefined) fail("laser mesh not created in the MAIN scene (utility layer leak?)");
  console.log(`[smoke] laser mesh in main scene (parent=${laser.parent?.name ?? "none"})`);

  // Select: press aimed at the box.
  left.updateButtonValue("trigger", 1.0);
  await runFrames(3);
  if (!events.some((e) => e === "down:pickBox")) {
    fail(`no POINTERDOWN on pickBox (events: ${events.join(" ") || "none"})`);
  }
  console.log(`[smoke] POINTERDOWN on pickBox ✓ (events: ${events.join(" ")})`);

  left.updateButtonValue("trigger", 0.0);
  await runFrames(3);
  if (!events.some((e) => e.startsWith("up:"))) fail(`no POINTERUP (events: ${events.join(" ")})`);

  featuresManager.dispose();
  sessionManager.dispose();
  console.log("POINTER-SELECTION SMOKE: PASS");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("POINTER-SELECTION SMOKE: ERROR", err);
  process.exit(1);
});
