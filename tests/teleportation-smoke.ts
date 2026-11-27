/**
 * Teleportation smoke: iwer device -> Babylon WebXRInput + the
 * xr-controller-teleportation feature (NullEngine, no GL, no OpenXR).
 *
 * Asserts the standard thumbstick-teleportation flow on our WebXR stack:
 *   - the feature attaches and creates its landing-zone meshes
 *   - aiming down uses the straight ray (this test never renders, so it
 *     refreshes the xrCamera world matrix per frame itself — a rendering
 *     app gets that from Babylon's render)
 *   - thumbstick-forward + release teleports the WebXRCamera, which turns
 *     sessionManager.referenceSpace into an offset child of the base space
 *   - the offset space really carries the teleport (needs the IWER
 *     offset-reference-space patch in iwer-runtime.ts)
 */
import { installIwerRuntime } from "../src/webxr/iwer-runtime.js";
import { createFakeGlContext } from "../src/platform/env-shims.js";

function fail(msg: string): never {
  console.error(`TELEPORTATION SMOKE: FAIL (${msg})`);
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
  // Pure test (NullEngine, no platform): give the landing zone plain
  // materials (the stock disc draws into a 2D canvas, which only the
  // platform provides) and keep its meshes in the main scene, so the test
  // can find them in scene.meshes.
  const landingMat = new BABYLON.StandardMaterial("teleportLandingMat", scene);
  const ringMat = new BABYLON.StandardMaterial("teleportRingMat", scene);
  const feature = featuresManager.enableFeature("xr-controller-teleportation", undefined, {
    xrInput,
    floorMeshes: [],
    useUtilityLayer: false,
    defaultTargetMeshOptions: {
      teleportationCircleMaterial: landingMat,
      torusArrowMaterial: ringMat,
    },
  });

  // Pickable floor. computeWorldMatrix: this smoke never calls
  // scene.render() and ray->mesh intersection reads the world matrix
  // WITHOUT recomputing it (same as pointer-selection-smoke).
  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 24, height: 24 }, scene);
  ground.computeWorldMatrix(true);
  feature.addFloorMesh(ground);

  await sessionManager.initializeSessionAsync("immersive-vr", { optionalFeatures: ["local-floor"] });
  await sessionManager.setReferenceSpaceTypeAsync("local-floor");
  const wxrSession = sessionManager.session;
  const XRWebGLLayerCtor = (globalThis as unknown as {
    XRWebGLLayer: new (s: unknown, c: unknown) => XRWebGLLayer;
  }).XRWebGLLayer;
  void wxrSession.updateRenderState({ baseLayer: new XRWebGLLayerCtor(wxrSession, createFakeGlContext()) });

  // Right controller at chest height, pitched 45 degrees down-forward (WebXR
  // is right-handed: -Z forward, so the target ray lands ~2 m ahead on the
  // floor — the straight teleportation ray, no parabola needed).
  const right = device.controllers.right;
  if (right === undefined) fail("iwer device has no right controller");
  for (const key of ["left", "right", "none"] as const) {
    const c = device.controllers[key];
    if (c !== undefined) c.connected = false;
  }
  right.connected = true;
  right.position.set(0.2, 1.4, 0);
  right.quaternion.set(Math.sin(-Math.PI / 8), 0, 0, Math.cos(-Math.PI / 8));

  const runFrames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) {
      wxrSession.requestAnimationFrame((_time, frame) => {
        sessionManager.currentFrame = frame;
        sessionManager.currentTimestamp = performance.now();
        sessionManager.onXRFrameObservable.notifyObservers(frame);
        xrCamera.computeWorldMatrix(); // nothing renders here (a rendering app gets this from scene.render)
      });
      pump.pump();
      // Motion-controller init resolves on a promise; flush between frames.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  // Warm-up: profile init, feature attach, first controller pose.
  await runFrames(6);
  if (feature.attached !== true) fail("teleportation feature not attached");
  const target = scene.meshes.find((m) => m.name === "teleportationTarget");
  if (target === undefined) fail("landing-zone mesh not created in the MAIN scene (utility layer leak?)");
  console.log(`[smoke] landing zone in main scene (torus=${scene.meshes.some((m) => m.name === "torusTeleportation")})`);

  // Aim: thumbstick forward. The feature shows the landing zone on the floor.
  right.updateAxis("thumbstick", "y-axis", -1.0);
  await runFrames(4);
  if (!target.isVisible) fail("landing zone not visible while aiming");
  console.log(
    `[smoke] aiming: landing zone at (${target.position.x.toFixed(2)}, ${target.position.y.toFixed(2)}, ${target.position.z.toFixed(2)})`,
  );
  // Straight ray: 45° down from 1.4 m lands ~1.4 m ahead. A far landing
  // means the floor gate rejected the straight ray (stale xrCamera world
  // matrix) and the parabolic fallback was cast from below the floor.
  if (Math.abs(target.position.z - 1.4) > 0.1) {
    fail(`landing zone at z=${target.position.z.toFixed(2)}, expected ~1.40 (straight ray rejected?)`);
  }
  const before = xrCamera.position.clone();

  // Release: stick back to center teleports.
  right.updateAxis("thumbstick", "x-axis", 0);
  right.updateAxis("thumbstick", "y-axis", 0);
  await runFrames(5);

  const moved = BABYLON.Vector3.Distance(before, xrCamera.position);
  if (moved < 0.5) {
    fail(`camera did not teleport (moved ${moved.toFixed(3)} m, now (${xrCamera.position.x.toFixed(2)}, ${xrCamera.position.y.toFixed(2)}, ${xrCamera.position.z.toFixed(2)}))`);
  }
  console.log(
    `[smoke] teleported ${moved.toFixed(2)} m -> (${xrCamera.position.x.toFixed(2)}, ${xrCamera.position.y.toFixed(2)}, ${xrCamera.position.z.toFixed(2)})`,
  );

  // The teleport must live in the reference space (that is how the app's
  // renderer sees it): referenceSpace is now an offset child of the base.
  if (sessionManager.referenceSpace === sessionManager.baseReferenceSpace) {
    fail("reference space unchanged after teleport (offset space never created)");
  }

  // The offset space must actually carry the teleport (IWER patch): the
  // viewer pose in it is the landing point (WebXR is right-handed, so the
  // Babylon +Z landing is -Z here), while the base space is unchanged.
  let poseChecked = false;
  wxrSession.requestAnimationFrame((_time, frame) => {
    const xrFrame = frame as unknown as { getViewerPose(space: XRReferenceSpace): XRViewerPose | null };
    const base = xrFrame.getViewerPose(sessionManager.baseReferenceSpace)?.transform.position;
    const offset = xrFrame.getViewerPose(sessionManager.referenceSpace)?.transform.position;
    if (base === undefined || offset === undefined) fail("viewer pose unavailable after teleport");
    if (Math.abs(offset.x - 0.2) > 0.05 || Math.abs(offset.z + 1.4) > 0.1) {
      fail(`offset-space viewer pose not at the landing point: (${offset.x.toFixed(2)}, ${offset.y.toFixed(2)}, ${offset.z.toFixed(2)})`);
    }
    if (Math.abs(base.x) > 0.01 || Math.abs(base.z) > 0.01) fail("base-space viewer pose moved");
    poseChecked = true;
    console.log(`[smoke] offset space carries the teleport: viewer at (${offset.x.toFixed(2)}, ${offset.y.toFixed(2)}, ${offset.z.toFixed(2)})`);
  });
  pump.pump();
  if (!poseChecked) fail("offset-space check callback never ran");

  featuresManager.dispose();
  sessionManager.dispose();
  console.log("TELEPORTATION SMOKE: PASS");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("TELEPORTATION SMOKE: ERROR", err);
  process.exit(1);
});
