/**
 * XR camera smoke: Babylon's WebXRCamera rig on the exact OpenXR eyes
 * (iwer-runtime.ts setEyeViewSource; NullEngine, no GL, no OpenXR).
 * view-pose-smoke checks the WebXR views themselves; this checks what
 * Babylon makes of them.
 *
 * Asserts:
 *   - the camera's minZ/maxZ reach the session's renderState
 *     (depthNear/depthFar), also when changed during the session
 *   - each rig camera's projection (Babylon is left-handed) has those near
 *     and far planes and that eye's asymmetric FOV edges
 *   - the rig cameras sit at the eyes (z mirrored into Babylon's
 *     left-handed space), 64 mm apart, and look where the eyes look
 *   - one rig camera per eye (their viewports come from Babylon's layer
 *     render target: session-lifecycle-smoke)
 */
import { setEyeViewSource, type EyeView } from "../src/webxr/iwer-runtime.js";
import { Checks, createPureXr } from "./pure-xr.js";

const checks = new Checks("XR-CAMERA");

const IPD = 0.064;
// Head straight ahead at 1.6 m; asymmetric FOVs, wider on the outer side.
const eyes: EyeView[] = [-1, 1].map((side) => ({
  position: { x: (side * IPD) / 2, y: 1.6, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  fov: side < 0 ? { angleLeft: -0.95, angleRight: 0.7, angleUp: 0.8, angleDown: -0.9 } : { angleLeft: -0.7, angleRight: 0.95, angleUp: 0.8, angleDown: -0.9 },
}));

/** Near, far and the tangents of the FOV edges of a left-handed GL projection (column-major m). */
function frustum(m: ArrayLike<number>) {
  const [m0, m5, m8, m9, m10, m14] = [m[0], m[5], m[8], m[9], m[10], m[14]];
  // ndc = (m0 x + m8 z) / z, z forward; an edge is where ndc = -1 or +1.
  return {
    near: -m14 / (m10 + 1),
    far: m14 / (1 - m10),
    left: (-1 - m8) / m0,
    right: (1 - m8) / m0,
    down: (-1 - m9) / m5,
    up: (1 - m9) / m5,
  };
}

checks.run(async () => {
  const xr = await createPureXr();
  const { BABYLON, xrCamera, sessionManager } = xr;
  xr.device.position.set(0, 1.6, 0);
  xr.device.stereoEnabled = true;
  setEyeViewSource(() => eyes);

  xrCamera.minZ = 0.05;
  xrCamera.maxZ = 200;
  const session = await xr.enter();
  xr.connectOnly();
  await xr.runFrames(4);

  const state = session.renderState;
  checks.check("minZ/maxZ -> depthNear/depthFar", Math.abs(state.depthNear - 0.05) < 1e-6 && Math.abs(state.depthFar - 200) < 1e-3, `${state.depthNear} / ${state.depthFar}`);
  checks.check("one rig camera per eye", xrCamera.rigCameras.length === 2);

  const verifyRig = (near: number, far: number): void => {
    xrCamera.rigCameras.forEach((rig, i) => {
      const eye = eyes[i];
      const side = i === 0 ? "left" : "right";
      const f = frustum(rig.getProjectionMatrix().m);
      checks.check(`${side} rig: near/far ${near}/${far}`, Math.abs(f.near - near) < 1e-4 && Math.abs(f.far - far) / far < 1e-3, `${f.near.toFixed(4)} / ${f.far.toFixed(2)}`);
      const want = { left: Math.tan(eye.fov.angleLeft), right: Math.tan(eye.fov.angleRight), down: Math.tan(eye.fov.angleDown), up: Math.tan(eye.fov.angleUp) };
      const err = Math.max(...(["left", "right", "down", "up"] as const).map((k) => Math.abs(f[k] - want[k])));
      checks.check(`${side} rig: asymmetric FOV edges`, err < 1e-4, `tan l/r/d/u ${[f.left, f.right, f.down, f.up].map((v) => v.toFixed(3)).join(" ")} (max err ${err.toExponential(1)})`);
    });
  };
  verifyRig(0.05, 200);

  const [leftRig, rightRig] = xrCamera.rigCameras;
  if (leftRig === undefined || rightRig === undefined) return;
  const l = leftRig.globalPosition;
  const r = rightRig.globalPosition;
  checks.check("rig cameras 64 mm apart", Math.abs(BABYLON.Vector3.Distance(l, r) - IPD) < 1e-4, `${(BABYLON.Vector3.Distance(l, r) * 1000).toFixed(1)} mm`);
  checks.check("rig cameras at the eyes", Math.abs(l.x + IPD / 2) < 1e-4 && Math.abs(r.x - IPD / 2) < 1e-4 && Math.abs(l.y - 1.6) < 1e-4 && Math.abs(l.z) < 1e-4, `left (${l.x.toFixed(3)}, ${l.y.toFixed(3)}, ${l.z.toFixed(3)})`);
  // Eyes looking straight ahead: WebXR -Z is Babylon +Z.
  const forward = leftRig.getDirection(BABYLON.Vector3.Forward());
  checks.check("rig cameras look forward (+Z in Babylon)", forward.z > 0.999, `(${forward.x.toFixed(3)}, ${forward.y.toFixed(3)}, ${forward.z.toFixed(3)})`);

  // Changing the clip planes during the session.
  xrCamera.minZ = 0.2;
  xrCamera.maxZ = 50;
  await xr.runFrames(3);
  checks.check("changed minZ/maxZ reach renderState", Math.abs(session.renderState.depthNear - 0.2) < 1e-6 && Math.abs(session.renderState.depthFar - 50) < 1e-4, `${session.renderState.depthNear} / ${session.renderState.depthFar}`);
  verifyRig(0.2, 50);

  // A turned head: the rig follows (yaw 90° left in WebXR = looking along -X; Babylon mirrors z, not x).
  const q = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  xr.device.quaternion.set(q.x, q.y, q.z, q.w);
  eyes.forEach((e, i) => {
    e.orientation = q;
    e.position = { x: 0, y: 1.6, z: (i === 0 ? 1 : -1) * (IPD / 2) };
  });
  await xr.runFrames(3);
  const turned = leftRig.getDirection(BABYLON.Vector3.Forward());
  checks.check("turned head: rig looks along -X", turned.x < -0.999, `(${turned.x.toFixed(3)}, ${turned.y.toFixed(3)}, ${turned.z.toFixed(3)})`);

  setEyeViewSource(() => null);
  sessionManager.dispose();
});
