/**
 * W-Phase 2 gate check: IWER WebXR Device API alive inside plain Node.js.
 *
 * Verifies, with no browser and no WebGL:
 *   navigator.xr + XR globals installed; isSessionSupported('immersive-vr');
 *   requestSession resolves; reference space; duck-typed baseLayer accepted
 *   by updateRenderState; session.requestAnimationFrame delivers XRFrames
 *   when WE pump the global rAF; getViewerPose works; session.end() works.
 */
import { installIwerRuntime } from "../src/webxr/iwer-runtime.js";
import { createFakeGlContext } from "../src/platform/env-shims.js";

async function main(): Promise<void> {
  const { device, pump } = installIwerRuntime();

  const xr = (navigator as { xr?: unknown }).xr;
  if (xr === undefined) throw new Error("navigator.xr missing after installRuntime");
  if (typeof (globalThis as { XRRigidTransform?: unknown }).XRRigidTransform !== "function") {
    throw new Error("XRRigidTransform global missing");
  }
  console.log("[iwer-smoke] navigator.xr + XRRigidTransform present");

  const supported = await (xr as XRSystem).isSessionSupported("immersive-vr");
  if (!supported) throw new Error("immersive-vr not supported");
  console.log("[iwer-smoke] isSessionSupported('immersive-vr') = true");

  const session = await (xr as XRSystem).requestSession("immersive-vr", {
    optionalFeatures: ["local-floor"],
  });
  console.log("[iwer-smoke] requestSession('immersive-vr') resolved");

  const refSpace = await session.requestReferenceSpace("local");
  if (refSpace === null) throw new Error("requestReferenceSpace('local') returned null");
  console.log("[iwer-smoke] reference space 'local' acquired");

  const XRWebGLLayerCtor = (globalThis as unknown as { XRWebGLLayer: new (s: unknown, c: unknown) => unknown }).XRWebGLLayer;
  const layer = new XRWebGLLayerCtor(session, createFakeGlContext());
  void session.updateRenderState({ baseLayer: layer as XRWebGLLayer });
  console.log("[iwer-smoke] fake-GL baseLayer set via updateRenderState");

  // Drive the emulated device a little, then pump frames. IWER defaults
  // controllers to connected=true; make the state explicit.
  device.position.set(0, 1.6, 0);
  for (const key of ["left", "right", "none"] as const) {
    const controller = device.controllers[key];
    if (controller !== undefined) controller.connected = false;
  }
  const left = device.controllers.left;
  if (left !== undefined) {
    left.connected = true;
    left.position.set(-0.2, 1.4, -0.5);
  }

  let frames = 0;
  let viewerPoseOk = false;
  let inputSources = -1;
  const onFrame: XRFrameRequestCallback = (_time, frame) => {
    frames++;
    const pose = frame.getViewerPose(refSpace);
    viewerPoseOk =
      pose != null &&
      typeof pose.transform.position.x === "number" &&
      pose.views.length === 2;
    inputSources = session.inputSources.length;
    if (frames < 3) {
      session.requestAnimationFrame(onFrame);
    }
  };
  session.requestAnimationFrame(onFrame);
  for (let i = 0; i < 3; i++) {
    pump.pump();
  }

  console.log(
    `[iwer-smoke] frames delivered=${frames}/3 viewerPose=${viewerPoseOk ? "ok (2 views)" : "BAD"} inputSources=${inputSources}`,
  );
  if (frames !== 3) throw new Error(`expected 3 pumped frames, got ${frames}`);
  if (!viewerPoseOk) throw new Error("getViewerPose invalid");
  if (inputSources !== 1) throw new Error(`expected 1 input source (left), got ${inputSources}`);

  await session.end();
  console.log("[iwer-smoke] session ended cleanly — IWER SMOKE PASS");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("[iwer-smoke] FAILED:", err);
  process.exit(1);
});
