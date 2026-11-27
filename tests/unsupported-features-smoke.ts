/**
 * Unsupported-features smoke: Babylon WebXR features this platform cannot
 * back (no hit-test, anchors, planes or hands in OpenXR -> IWER; no
 * see-through in immersive-vr) asked for as an app would, on Babylon's own
 * XR render loop (NullEngine, no GL, no OpenXR).
 *
 * Asserts:
 *   - enabled as optional (the default), each one: the session still starts,
 *     the native feature is not granted, the Babylon feature does not attach
 *     (or attaches harmlessly, for the ones with no native part), and the
 *     scene keeps rendering every frame: nothing throws into the XR frame
 *   - a controller connected meanwhile still gets its motion controller
 *   - one of them marked required: entering rejects, Babylon is back in
 *     NOT_IN_XR, and a later plain enter works
 */
import { Checks, createLoopXr } from "./pure-xr.js";

const checks = new Checks("UNSUPPORTED-FEATURES");

checks.run(async () => {
  const { BABYLON, helper, stats, frames, enter, device } = await createLoopXr();
  const input = new BABYLON.WebXRInput(helper.sessionManager, helper.camera, { disableOnlineControllerRepository: true, doNotLoadControllerMeshes: true });
  const fm = helper.featuresManager;
  const names = [
    BABYLON.WebXRFeatureName.HIT_TEST,
    BABYLON.WebXRFeatureName.ANCHOR_SYSTEM,
    BABYLON.WebXRFeatureName.PLANE_DETECTION,
    BABYLON.WebXRFeatureName.HAND_TRACKING,
    BABYLON.WebXRFeatureName.BACKGROUND_REMOVER,
  ];
  const features = new Map(
    names.map((name) => [name, fm.enableFeature(name, "latest", name === BABYLON.WebXRFeatureName.HAND_TRACKING ? { xrInput: input } : {}, true, false)]),
  );

  let frameErrors = 0;
  const original = helper.sessionManager.onXRFrameObservable.notifyObservers.bind(helper.sessionManager.onXRFrameObservable);
  helper.sessionManager.onXRFrameObservable.notifyObservers = (...args: Parameters<typeof original>) => {
    try {
      return original(...args);
    } catch (err) {
      frameErrors++;
      throw err;
    }
  };

  for (const key of ["left", "right", "none"] as const) {
    const c = device.controllers[key];
    if (c !== undefined) c.connected = false;
  }
  const session = await enter();
  checks.check("optional: session starts", helper.state === BABYLON.WebXRState.IN_XR, BABYLON.WebXRState[helper.state]);
  const granted = [...((session as unknown as { enabledFeatures?: string[] }).enabledFeatures ?? [])];
  checks.check("optional: none of the native features granted", !["hit-test", "anchors", "plane-detection", "hand-tracking"].some((f) => granted.includes(f)), `granted [${granted.join(", ")}]`);
  for (const [name, feature] of features) {
    // The background remover has no native part: it may attach (it only hides meshes in AR).
    const ok = name === BABYLON.WebXRFeatureName.BACKGROUND_REMOVER || !feature.attached;
    checks.check(`optional: ${name} ${feature.attached ? "attached" : "not attached"}`, ok);
  }
  const before = stats.renders;
  await frames(20);
  checks.check("optional: a render every frame, nothing thrown", stats.renders - before === 20 && frameErrors === 0, `${stats.renders - before} renders in 20 frames, ${frameErrors} frame errors`);

  const right = device.controllers.right;
  if (right !== undefined) right.connected = true;
  await frames(8);
  const mc = input.controllers.find((c) => c.inputSource.handedness === "right")?.motionController;
  checks.check("optional: a controller still gets its motion controller", mc?.profileId === "oculus-touch", mc?.profileId ?? "none");
  checks.check("optional: still rendering with a controller", frameErrors === 0);
  await helper.exitXRAsync();
  await frames(3);

  // ---- required: entering must fail cleanly
  fm.disableFeature(BABYLON.WebXRFeatureName.HIT_TEST);
  fm.enableFeature(BABYLON.WebXRFeatureName.HIT_TEST, "latest", {}, true, true);
  const quiet = BABYLON.Logger.LogLevels;
  BABYLON.Logger.LogLevels = BABYLON.Logger.NoneLogLevel; // the rejection is logged as an error
  let rejected: unknown;
  await enter().catch((err: unknown) => (rejected = err ?? "rejected"));
  BABYLON.Logger.LogLevels = quiet;
  checks.check("required: entering rejects", rejected !== undefined, String(rejected));
  await frames(2);
  checks.check("required: back in NOT_IN_XR", helper.state === BABYLON.WebXRState.NOT_IN_XR, BABYLON.WebXRState[helper.state]);

  for (const name of names) fm.disableFeature(name);
  await enter();
  checks.check("a plain enter afterwards works", helper.state === BABYLON.WebXRState.IN_XR, BABYLON.WebXRState[helper.state]);
  const after = stats.renders;
  await frames(5);
  checks.check("and renders", stats.renders - after === 5);
  await helper.exitXRAsync();
  await frames(2);
});
