/**
 * Session-lifecycle smoke: Babylon's WebXRExperienceHelper entering and
 * leaving XR on IWER, on Babylon's own XR render loop (engine.runRenderLoop
 * with the session as the frame requester, as in the app; NullEngine, no GL,
 * no OpenXR).
 *
 * Asserts:
 *   - the device offers immersive-vr, and immersive-ar only for passthrough
 *   - entering: NOT_IN_XR -> ENTERING_XR -> IN_XR, the WebXRCamera becomes
 *     the active camera with one rig camera per eye on the layer's left and
 *     right halves, and the scene renders
 *     once per XR frame (the desktop loop is cancelled, not left running)
 *   - exiting through Babylon (exitXRAsync): EXITING_XR -> NOT_IN_XR,
 *     onXRSessionEnded once, the session's 'end' event once, the previous
 *     camera is active again and the render loop goes on, once per frame
 *   - entering again works the same, with a new session
 *   - the session ending from the device side (as when the runtime stops it:
 *     XRSession.end() outside Babylon) leaves Babylon in NOT_IN_XR too
 *   - an unsupported reference space ('unbounded') falls back to Babylon's
 *     viewer space with its height compensation, and frames still arrive
 */
import { Checks, createLoopXr } from "./pure-xr.js";

const checks = new Checks("SESSION-LIFECYCLE");

checks.run(async () => {
  const { BABYLON, scene, desktopCamera, helper, stats, frames, ...xr } = await createLoopXr();
  const xrSystem = (globalThis as unknown as { navigator: { xr: XRSystem } }).navigator.xr;
  checks.check("immersive-vr supported", await xrSystem.isSessionSupported("immersive-vr"));
  checks.check("immersive-ar not offered without passthrough", !(await xrSystem.isSessionSupported("immersive-ar")));

  const states: string[] = [];
  helper.onStateChangedObservable.add((s) => states.push(BABYLON.WebXRState[s]));
  let endedNotices = 0;
  helper.sessionManager.onXRSessionEnded.add(() => endedNotices++);
  const enter = (space: XRReferenceSpaceType): Promise<XRSession> => {
    states.length = 0;
    return xr.enter(space);
  };

  // ---- enter
  const first = await enter("local-floor");
  checks.check("enter: ENTERING_XR then IN_XR", states.join(" ") === "ENTERING_XR IN_XR", states.join(" "));
  checks.check("enter: WebXRCamera is active", scene.activeCamera === helper.camera);
  let rendersBefore = stats.renders;
  await frames(10);
  checks.check("enter: one render per XR frame", stats.renders - rendersBefore === 10, `${stats.renders - rendersBefore} renders in 10 frames`);
  checks.check("enter: one rig camera per eye", helper.camera.rigCameras.length === 2, `${helper.camera.rigCameras.length} rig cameras`);
  const [leftRig, rightRig] = helper.camera.rigCameras;
  const vp = (c: typeof leftRig): string => (c === undefined ? "-" : `${c.viewport.x}+${c.viewport.width}x${c.viewport.y}+${c.viewport.height}`);
  checks.check(
    "enter: rig viewports are the layer's left and right halves",
    leftRig?.viewport.x === 0 && leftRig.viewport.width === 0.5 && rightRig?.viewport.x === 0.5 && rightRig.viewport.width === 0.5 && leftRig.viewport.height === 1,
    `${vp(leftRig)}, ${vp(rightRig)}`,
  );

  // ---- exit through Babylon
  let sessionEndEvents = 0;
  first.addEventListener("end", () => sessionEndEvents++);
  states.length = 0;
  const exiting = helper.exitXRAsync();
  await frames(3);
  await exiting;
  await frames(2);
  checks.check("exit: EXITING_XR then NOT_IN_XR", states.join(" ") === "EXITING_XR NOT_IN_XR", states.join(" "));
  checks.check("exit: onXRSessionEnded once, 'end' once", endedNotices === 1 && sessionEndEvents === 1, `${endedNotices} notices, ${sessionEndEvents} end events`);
  checks.check("exit: the desktop camera is active again", scene.activeCamera === desktopCamera, scene.activeCamera?.name ?? "none");
  rendersBefore = stats.renders;
  await frames(5);
  checks.check("exit: the render loop keeps running, once per frame", stats.renders - rendersBefore === 5, `${stats.renders - rendersBefore} renders in 5 frames`);

  // ---- enter again
  const second = await enter("local-floor");
  checks.check("re-enter: IN_XR with a new session", helper.state === BABYLON.WebXRState.IN_XR && second !== first, states.join(" "));
  rendersBefore = stats.renders;
  await frames(5);
  checks.check("re-enter: one render per XR frame", stats.renders - rendersBefore === 5, `${stats.renders - rendersBefore} renders in 5 frames`);

  // ---- the session ends from the device side
  states.length = 0;
  await second.end();
  await frames(3);
  checks.check("device-side end: NOT_IN_XR", helper.state === BABYLON.WebXRState.NOT_IN_XR, states.join(" "));
  checks.check("device-side end: onXRSessionEnded", endedNotices === 2, `${endedNotices} notices`);
  checks.check("device-side end: desktop camera back", scene.activeCamera === desktopCamera);

  // ---- an unsupported reference space falls back to viewer
  const quiet = BABYLON.Logger.LogLevels;
  BABYLON.Logger.LogLevels = BABYLON.Logger.NoneLogLevel; // the fallback logs an expected error
  await enter("unbounded");
  BABYLON.Logger.LogLevels = quiet;
  checks.check("unbounded: falls back and enters", helper.state === BABYLON.WebXRState.IN_XR, states.join(" "));
  let pose: XRViewerPose | null | undefined;
  helper.sessionManager.session.requestAnimationFrame((_t, frame) => {
    pose = frame.getViewerPose(helper.sessionManager.referenceSpace);
  });
  rendersBefore = stats.renders;
  await frames(5);
  const y = pose?.transform.position.y;
  checks.check("unbounded: viewer space with height compensation", y !== undefined && Math.abs(y - helper.sessionManager.defaultHeightCompensation) < 1e-3, `viewer y ${y?.toFixed(3) ?? "none"} (compensation ${helper.sessionManager.defaultHeightCompensation})`);
  checks.check("unbounded: frames reach the scene", stats.renders - rendersBefore >= 4);
  await helper.exitXRAsync();
  await frames(2);

  xr.engine.stopRenderLoop();
  helper.dispose();
});
