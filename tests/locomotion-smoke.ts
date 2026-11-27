/**
 * Locomotion smoke: iwer device -> Babylon WebXRInput + the locomotion
 * features beyond teleportation-smoke's forward teleport (NullEngine, no GL,
 * no OpenXR).
 *
 * Teleportation (right thumbstick, as the app sets it up):
 *   - snap turn right then left: the camera yaws by rotationAngle each way,
 *     and the offset reference space carries the turn (the IWER
 *     offset-reference-space patch, with a rotation this time)
 *   - pulling the stick back steps backwards by backwardsTeleportationDistance
 *   - the landing ring stays on the floor while aiming (disableAnimation)
 *   - a wall (a blocker mesh) between the controller and the floor hides the
 *     landing zone, and releasing does not move
 *   - one forward teleport fires onAfterCameraTeleport exactly once
 * Movement (WebXRFeatureName.MOVEMENT, replacing teleportation; Babylon's
 * default registrations): the right stick moves the camera forward while
 * held and stops on release; the left stick turns it.
 * Walking locomotion: a head swaying side to side, as when walking in place,
 * moves the camera; a still head does not.
 */
import { Checks, createPureXr, fmt } from "./pure-xr.js";

const checks = new Checks("LOCOMOTION");

/** Yaw of a Babylon rotation quaternion, in degrees. */
const yawDeg = (q: { toEulerAngles(): { y: number } }): number => (q.toEulerAngles().y * 180) / Math.PI;

checks.run(async () => {
  const xr = await createPureXr();
  const { BABYLON, scene, xrCamera, xrInput, featuresManager, sessionManager } = xr;

  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 24, height: 24 }, scene);
  ground.computeWorldMatrix(true);
  // Plain materials and the main scene, as in teleportation-smoke (no 2D canvas here).
  const teleport = featuresManager.enableFeature(BABYLON.WebXRFeatureName.TELEPORTATION, "stable", {
    xrInput,
    floorMeshes: [ground],
    blockerMeshesPredicate: (mesh) => mesh.name === "wall",
    useUtilityLayer: false,
    defaultTargetMeshOptions: {
      teleportationCircleMaterial: new BABYLON.StandardMaterial("landingMat", scene),
      torusArrowMaterial: new BABYLON.StandardMaterial("ringMat", scene),
      disableAnimation: true,
    },
  });

  await xr.enter();
  xr.connectOnly("right");
  xr.aim("right", Math.PI / 4);
  const right = xr.controller("right");
  await xr.runFrames(6);
  checks.check("teleportation attached", teleport.attached);

  const stick = async (x: number, y: number, frames = 3): Promise<void> => {
    right.updateAxis("thumbstick", "x-axis", x);
    right.updateAxis("thumbstick", "y-axis", y);
    await xr.runFrames(frames);
  };

  // ---- snap turn
  const step = (teleport.rotationAngle * 180) / Math.PI;
  const yaw0 = yawDeg(xrCamera.rotationQuaternion);
  await stick(1, 0);
  await stick(0, 0);
  const yawRight = yawDeg(xrCamera.rotationQuaternion);
  checks.check("snap turn right yaws by rotationAngle", Math.abs(yawRight - yaw0 - step) < 0.5, `${yaw0.toFixed(1)}° -> ${yawRight.toFixed(1)}° (step ${step.toFixed(1)}°)`);
  const turned = xr.viewerPose();
  const base = xr.viewerPose(sessionManager.baseReferenceSpace);
  if (turned !== undefined && base !== undefined) {
    // WebXR is right-handed: a turn to the right shows as a negative yaw of the viewer in the offset space.
    const q = turned.orientation;
    const viewerYaw = (Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180) / Math.PI;
    checks.check("offset reference space carries the turn", Math.abs(Math.abs(viewerYaw) - step) < 0.5, `viewer yaw ${viewerYaw.toFixed(1)}° in the offset space`);
    checks.check("base reference space unturned", Math.abs(base.orientation.y) < 1e-6);
  } else {
    checks.check("viewer pose after snap turn", false, "no viewer pose");
  }
  await stick(-1, 0);
  await stick(0, 0);
  checks.check("snap turn left turns back", Math.abs(yawDeg(xrCamera.rotationQuaternion) - yaw0) < 0.5, `${yawDeg(xrCamera.rotationQuaternion).toFixed(1)}°`);

  // ---- backwards step (stick pulled back: +y on the gamepad)
  const beforeBack = xrCamera.position.clone();
  await stick(0, 1);
  await stick(0, 0);
  const back = BABYLON.Vector3.Distance(beforeBack, xrCamera.position);
  checks.check("stick back steps backwards", Math.abs(back - teleport.backwardsTeleportationDistance) < 0.05 && xrCamera.position.z < beforeBack.z, `${fmt(beforeBack)} -> ${fmt(xrCamera.position)}`);

  // ---- a wall in the way: no landing zone, no move
  const target = scene.meshes.find((m) => m.name === "teleportationTarget");
  let teleports = 0;
  teleport.onAfterCameraTeleport.add(() => teleports++);
  const wall = BABYLON.MeshBuilder.CreateBox("wall", { width: 6, height: 4, depth: 0.1 }, scene);
  // 1 m ahead (Babylon is left-handed: forward is +Z), where the ray to the floor is 0.4 m up.
  wall.position.set(xrCamera.position.x, 2, xrCamera.position.z + 1);
  wall.computeWorldMatrix(true);
  const beforeWall = xrCamera.position.clone();
  await stick(0, -1, 4);
  checks.check("a wall in the way hides the landing zone", target !== undefined && !target.isVisible);
  await stick(0, 0);
  checks.check("releasing without a landing zone does not move", BABYLON.Vector3.Distance(beforeWall, xrCamera.position) < 1e-6 && teleports === 0, `${teleports} teleports`);
  wall.dispose();

  // ---- forward teleport: ring on the floor, one event
  right.updateAxis("thumbstick", "y-axis", -1);
  const ringHeights: number[] = [];
  await xr.runFrames(6, () => target !== undefined && ringHeights.push(target.position.y));
  checks.check("landing zone stays on the floor while aiming", target !== undefined && target.isVisible && ringHeights.slice(1).every((y) => Math.abs(y - ringHeights[1]) < 1e-6 && Math.abs(y) < 0.02), `heights ${ringHeights.map((y) => y.toFixed(3)).join(" ")}`);
  await stick(0, 0, 4);
  checks.check("one teleport fires onAfterCameraTeleport once", teleports === 1, `${teleports} events, camera ${fmt(xrCamera.position)}`);

  // ---- smooth movement replaces teleportation
  featuresManager.disableFeature(BABYLON.WebXRFeatureName.TELEPORTATION);
  const movement = featuresManager.enableFeature(BABYLON.WebXRFeatureName.MOVEMENT, "latest", {
    xrInput,
    movementSpeed: 1,
    rotationSpeed: 1,
    movementOrientationFollowsViewerPose: true,
    movementOrientationFollowsController: false,
  });
  xr.connectOnly("left", "right");
  await xr.runFrames(6);
  checks.check("movement attached", movement.attached);
  const left = xr.controller("left");
  // The camera glides on after a release (inertia): wait it out.
  const settle = (): Promise<void> => xr.runFrames(150);
  const startMove = xrCamera.position.clone();
  const yawStart = yawDeg(xrCamera.rotationQuaternion);
  right.updateAxis("thumbstick", "y-axis", -1);
  await xr.runFrames(62);
  const lastHeld = xrCamera.position.clone();
  await xr.runFrames(10);
  const heldStep = BABYLON.Vector3.Distance(lastHeld, xrCamera.position);
  const moved = xrCamera.position.subtract(startMove);
  // Facing +Z (the forward teleport above landed straight ahead): forward is +Z in Babylon.
  checks.check("right stick forward moves the camera forward", moved.z > 0.3 && Math.abs(moved.x) < 0.05 && Math.abs(moved.y) < 1e-3, `${fmt(moved)} in 1 s`);
  right.updateAxis("thumbstick", "y-axis", 0);
  await settle();
  const settled = xrCamera.position.clone();
  await xr.runFrames(10);
  const drift = BABYLON.Vector3.Distance(settled, xrCamera.position);
  checks.check("releasing the stick stops", drift < 0.01 * heldStep, `${drift.toFixed(4)} m in 10 frames after the glide, ${heldStep.toFixed(2)} m while held`);
  checks.check("moving does not turn", Math.abs(yawDeg(xrCamera.rotationQuaternion) - yawStart) < 0.5);
  const yawBefore = yawDeg(xrCamera.rotationQuaternion);
  const posBeforeTurn = xrCamera.position.clone();
  left.updateAxis("thumbstick", "x-axis", 1);
  await xr.runFrames(6);
  const yawAfter = yawDeg(xrCamera.rotationQuaternion);
  left.updateAxis("thumbstick", "x-axis", 0);
  await settle();
  // Babylon is left-handed: a turn to the right is a positive yaw.
  const turn = ((yawAfter - yawBefore + 540) % 360) - 180;
  checks.check("left stick right turns the camera right", turn > 1 && turn < 90, `${turn.toFixed(1)}° in 6 frames`);
  checks.check("turning does not move", BABYLON.Vector3.Distance(posBeforeTurn, xrCamera.position) < 1e-3);
  featuresManager.disableFeature(BABYLON.WebXRFeatureName.MOVEMENT);

  // ---- walking in place
  const walking = featuresManager.enableFeature(BABYLON.WebXRFeatureName.WALKING_LOCOMOTION, "latest", { locomotionTarget: xrCamera });
  await xr.runFrames(2);
  checks.check("walking locomotion attached", walking.attached);
  const still = xrCamera.position.clone();
  await xr.runFrames(60);
  checks.check("a still head does not walk", BABYLON.Vector3.Distance(still, xrCamera.position) < 1e-3);
  // Sway 5 cm each side, one step every 0.8 s (the detector samples at 15 Hz).
  const startWalk = xrCamera.position.clone();
  await xr.runFrames(400, (i) => xr.device.position.set(0.05 * Math.sin((2 * Math.PI * i) / 58), 1.6, 0));
  const walked = BABYLON.Vector3.Distance(startWalk, xrCamera.position);
  checks.check("swaying side to side walks the camera", walked > 0.05, `${walked.toFixed(2)} m, ${fmt(startWalk)} -> ${fmt(xrCamera.position)}`);
  xr.device.position.set(0, 1.6, 0);

  featuresManager.dispose();
  sessionManager.dispose();
});
