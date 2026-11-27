/**
 * View pose/projection smoke — the WebXR views carry the EXACT OpenXR eyes
 * (iwer-runtime.ts setEyeViewSource), not IWER's emulation (viewer +/-
 * ipd/2, one symmetric projection). Pure test: IWER only, no GL/OpenXR.
 *
 * Setup a real headset could produce but IWER cannot: head yawed 30°, eyes
 * canted +/-10° (outward) and asymmetric, mirrored FOVs.
 *   1. each view's pose equals its eye pose (local-floor), after IWER's own
 *      per-frame view-space reset
 *   2. in an offset reference space the eyes move by exactly the offset
 *   3. projection, checked independently of its formula: a ray along each
 *      FOV edge (left/right/top/bottom tangent) lands on that clip-space
 *      edge (-1/+1); the off-axis terms are non-zero
 */
import { installIwerRuntime, setEyeViewSource, type EyeView } from "../src/webxr/iwer-runtime.js";
import { createFakeGlContext } from "../src/platform/env-shims.js";

function fail(msg: string): never {
  console.error(`VIEW-POSE SMOKE: FAIL (${msg})`);
  process.exit(1);
}

type Quat = { x: number; y: number; z: number; w: number };
const yaw = (deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
};
const mul = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const rot = (q: Quat, v: { x: number; y: number; z: number }) => {
  const r = mul(mul(q, { ...v, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w });
  return { x: r.x, y: r.y, z: r.z };
};

// Head 30° yaw; eyes ±32 mm along the head's X, canted ±10° outward (RH:
// +yaw turns left); asymmetric FOVs, wider on the outer side.
const head = { position: { x: 0.1, y: 1.6, z: 0.2 }, orientation: yaw(30) };
const eye = (side: -1 | 1): EyeView => {
  const offset = rot(head.orientation, { x: 0.032 * side, y: 0, z: 0 });
  return {
    position: { x: head.position.x + offset.x, y: head.position.y + offset.y, z: head.position.z + offset.z },
    orientation: mul(head.orientation, yaw(-10 * side)),
    fov: side < 0
      ? { angleLeft: -0.95, angleRight: 0.7, angleUp: 0.8, angleDown: -0.9 }
      : { angleLeft: -0.7, angleRight: 0.95, angleUp: 0.8, angleDown: -0.9 },
  };
};
const eyes = [eye(-1), eye(1)];

async function main(): Promise<void> {
  const { device, pump } = installIwerRuntime();
  device.position.set(head.position.x, head.position.y, head.position.z);
  device.quaternion.set(head.orientation.x, head.orientation.y, head.orientation.z, head.orientation.w);
  device.stereoEnabled = true;
  setEyeViewSource(() => eyes);

  const xr = (globalThis as unknown as { navigator: { xr: XRSystem } }).navigator.xr;
  const session = await xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] });
  const XRWebGLLayerCtor = (globalThis as unknown as { XRWebGLLayer: new (s: unknown, c: unknown) => XRWebGLLayer }).XRWebGLLayer;
  void session.updateRenderState({ baseLayer: new XRWebGLLayerCtor(session, createFakeGlContext()) });
  const floor = await session.requestReferenceSpace("local-floor");
  const XRRigidTransformCtor = (globalThis as unknown as { XRRigidTransform: typeof XRRigidTransform }).XRRigidTransform;
  const shifted = floor.getOffsetReferenceSpace(new XRRigidTransformCtor({ x: 1, y: 0, z: -2 }));

  let checked = false;
  session.requestAnimationFrame((_t, frame) => {
    const { depthNear: n, depthFar: f } = session.renderState;
    const pose = frame.getViewerPose(floor);
    if (pose === undefined || pose.views.length !== 2) fail("no stereo viewer pose");

    pose.views.forEach((view, i) => {
      const e = eyes[i];
      // 1. Exact pose in local-floor.
      const p = view.transform.position;
      const o = view.transform.orientation;
      const posErr = Math.hypot(p.x - e.position.x, p.y - e.position.y, p.z - e.position.z);
      const dot = Math.abs(o.x * e.orientation.x + o.y * e.orientation.y + o.z * e.orientation.z + o.w * e.orientation.w);
      if (posErr > 1e-4 || dot < 0.99999) fail(`${view.eye} eye pose off: posErr=${posErr.toExponential(1)} quatDot=${dot.toFixed(6)}`);

      // 3. Projection: FOV-edge rays land on the clip-space edges.
      const m = view.projectionMatrix;
      const ndc = (x: number, y: number, z: number): [number, number] => {
        const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        return [cx / cw, cy / cw];
      };
      const fov = e.fov;
      const edges: Array<[string, number, number]> = [
        ["left", ndc(Math.tan(fov.angleLeft), 0, -1)[0], -1],
        ["right", ndc(Math.tan(fov.angleRight), 0, -1)[0], 1],
        ["top", ndc(0, Math.tan(fov.angleUp), -1)[1], 1],
        ["bottom", ndc(0, Math.tan(fov.angleDown), -1)[1], -1],
      ];
      for (const [name, got, want] of edges) {
        if (Math.abs(got - want) > 1e-4) fail(`${view.eye} ${name} FOV edge maps to ${got.toFixed(5)}, expected ${want}`);
      }
      if (Math.abs(m[8]) < 1e-3) fail(`${view.eye} projection is symmetric (m8=${m[8]}) — asymmetric FOV not applied`);
      if (n <= 0 || f <= n) fail("bad depth range");
    });
    console.log("[smoke] eye poses exact (yawed head, canted eyes); FOV edges map to clip edges; off-axis terms present");

    // 2. Offset space: eyes shift by exactly -offset.
    const moved = frame.getViewerPose(shifted);
    moved?.views.forEach((view, i) => {
      const p = view.transform.position;
      const e = eyes[i].position;
      const err = Math.hypot(p.x - (e.x - 1), p.y - e.y, p.z - (e.z + 2));
      if (err > 1e-4) fail(`${view.eye} eye in offset space off by ${err.toExponential(1)}`);
    });
    console.log("[smoke] offset reference space: eyes shifted exactly by the offset");
    checked = true;
  });
  for (let i = 0; i < 5 && !checked; i++) {
    pump.pump();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!checked) fail("frame callback never ran");
  await session.end();
  console.log("VIEW-POSE SMOKE: PASS");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  fail("exception");
});
