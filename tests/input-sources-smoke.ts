/**
 * Input-source smoke: controllers coming and going, as when one sleeps or
 * loses tracking (iwer device -> Babylon WebXRInput + the
 * xr-controller-pointer-selection feature with a laser on each hand, as the
 * app sets it up; NullEngine, no GL, no OpenXR).
 *
 * Asserts:
 *   - two connected controllers: two WebXRInputSources, one laser each
 *   - disconnecting one: onControllerRemovedObservable once, with that hand;
 *     its laser and selection disc are disposed, the other hand keeps its
 *     laser and still selects (scene POINTERDOWN on a box)
 *   - reconnecting it: onControllerAddedObservable once, a fresh motion
 *     controller, a laser again, and it selects again
 *   - three disconnect/reconnect cycles leave no meshes behind
 *   - with no controller left, the input has none and nothing throws
 */
import { Checks, createPureXr, type Hand } from "./pure-xr.js";

const checks = new Checks("INPUT-SOURCES");

checks.run(async () => {
  const xr = await createPureXr();
  const { BABYLON, scene, xrInput, featuresManager } = xr;
  featuresManager.enableFeature(BABYLON.WebXRFeatureName.POINTER_SELECTION, "stable", {
    xrInput,
    useUtilityLayer: false,
    disableScenePointerVectorUpdate: true,
    enablePointerSelectionOnAllControllers: true,
    disablePointerUpOnTouchOut: false,
    forceGazeMode: false,
  });

  // A box 1 m ahead of each hand (Babylon is left-handed: forward is +Z).
  for (const hand of ["left", "right"] as const) {
    const box = BABYLON.MeshBuilder.CreateBox(`box-${hand}`, { size: 0.3 }, scene);
    box.position.set(hand === "left" ? -0.2 : 0.2, 1.4, 1);
    box.computeWorldMatrix(true);
  }
  const downs: string[] = [];
  scene.onPointerObservable.add((info) => {
    if (info.type === BABYLON.PointerEventTypes.POINTERDOWN) downs.push(info.pickInfo?.pickedMesh?.name ?? "-");
  });
  const added: string[] = [];
  const removed: string[] = [];
  xrInput.onControllerAddedObservable.add((c) => added.push(c.inputSource.handedness));
  xrInput.onControllerRemovedObservable.add((c) => removed.push(c.inputSource.handedness));

  await xr.enter();
  xr.aim("left", 0);
  xr.aim("right", 0);
  xr.connectOnly("left", "right");
  await xr.runFrames(8);

  const lasers = (): number => scene.meshes.filter((m) => m.name === "laserPointer").length;
  const discs = (): number => scene.meshes.filter((m) => m.name === "gazeTracker").length;
  const hands = (): string => xrInput.controllers.map((c) => c.inputSource.handedness).sort().join(",");
  const select = async (hand: Hand): Promise<boolean> => {
    downs.length = 0;
    const c = xr.controller(hand);
    c.updateButtonValue("trigger", 1);
    await xr.runFrames(3);
    c.updateButtonValue("trigger", 0);
    await xr.runFrames(3);
    return downs.includes(`box-${hand}`);
  };

  checks.check("two controllers, two input sources", hands() === "left,right", hands());
  checks.check("a laser and a disc per controller", lasers() === 2 && discs() === 2, `${lasers()} lasers, ${discs()} discs`);
  checks.check("both select", (await select("left")) && (await select("right")));
  const meshCount = scene.meshes.length;

  added.length = 0;
  xr.controller("right").connected = false;
  await xr.runFrames(4);
  checks.check("disconnect: removed once, that hand", removed.join(",") === "right", `removed [${removed.join(",")}]`);
  checks.check("disconnect: one input source left", hands() === "left", hands());
  checks.check("disconnect: its laser and disc are gone", lasers() === 1 && discs() === 1, `${lasers()} lasers, ${discs()} discs`);
  checks.check("disconnect: the other hand still selects", await select("left"));

  const before = xrInput.controllers.find((c) => c.inputSource.handedness === "left")?.motionController;
  xr.controller("right").connected = true;
  await xr.runFrames(8);
  const rightAgain = xrInput.controllers.find((c) => c.inputSource.handedness === "right");
  checks.check("reconnect: added once, that hand", added.join(",") === "right", `added [${added.join(",")}]`);
  checks.check("reconnect: a motion controller again", rightAgain?.motionController?.profileId === "oculus-touch", rightAgain?.motionController?.profileId ?? "none");
  checks.check("reconnect: the other hand's controller is untouched", xrInput.controllers.find((c) => c.inputSource.handedness === "left")?.motionController === before);
  checks.check("reconnect: laser back", lasers() === 2 && discs() === 2, `${lasers()} lasers`);
  checks.check("reconnect: it selects again", await select("right"));

  for (let i = 0; i < 3; i++) {
    xr.controller("right").connected = false;
    await xr.runFrames(3);
    xr.controller("right").connected = true;
    await xr.runFrames(6);
  }
  checks.check("three cycles leave no meshes behind", scene.meshes.length === meshCount, `${meshCount} -> ${scene.meshes.length} meshes`);

  removed.length = 0;
  xr.connectOnly();
  await xr.runFrames(4);
  checks.check("all disconnected: no input sources, no lasers", xrInput.controllers.length === 0 && lasers() === 0, `${xrInput.controllers.length} sources, ${lasers()} lasers`);
  checks.check("all disconnected: both removed", removed.sort().join(",") === "left,right", `removed [${removed.join(",")}]`);

  featuresManager.dispose();
  xr.sessionManager.dispose();
});
