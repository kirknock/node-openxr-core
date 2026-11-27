/**
 * Motion-controller smoke: iwer device -> Babylon WebXRInput's motion
 * controllers on the controller layout installIwerRuntime gives IWER
 * (NullEngine, no GL, no OpenXR).
 *
 * Asserts, for each hand:
 *   - the profile resolves offline to Babylon's oculus-touch controller with
 *     the right handedness, the trigger as main component, and the face
 *     buttons of that hand (X/Y left, A/B right)
 *   - each IWER button reaches exactly its Babylon component: pressed and
 *     value, one state-change notification, and nothing else pressed (the
 *     face buttons sit at gamepad indices 4 and 5, where Babylon reads them)
 *   - touch without press, and analog trigger travel
 *   - thumbstick axes reach the thumbstick component with their sign
 *     (forward = -y), with an axis-change notification
 * And haptics: Babylon's motionController.pulse() goes through
 * OpenXrIwerDriver.forwardHaptics to OpenXR's apply-haptics with that
 * hand, the amplitude clamped to 0..1 and the duration in nanoseconds;
 * the actuator's reset() stops that hand. (A fake OpenXrInput here; the
 * native calls are covered on a live runtime.)
 */
import { OpenXrIwerDriver } from "../src/webxr/openxr-driver.js";
import { Checks, createPureXr, type Hand } from "./pure-xr.js";

const checks = new Checks("MOTION-CONTROLLER");

/** IWER button id -> the Babylon component it must drive, per hand. */
const BUTTONS: Record<Hand, Array<[string, string]>> = {
  left: [["trigger", "xr-standard-trigger"], ["squeeze", "xr-standard-squeeze"], ["thumbstick", "xr-standard-thumbstick"], ["x-button", "x-button"], ["y-button", "y-button"]],
  right: [["trigger", "xr-standard-trigger"], ["squeeze", "xr-standard-squeeze"], ["thumbstick", "xr-standard-thumbstick"], ["a-button", "a-button"], ["b-button", "b-button"]],
};

checks.run(async () => {
  const xr = await createPureXr();
  const { xrInput } = xr;
  await xr.enter();
  xr.connectOnly("left", "right");
  await xr.runFrames(8);

  for (const hand of ["left", "right"] as const) {
    const xrController = xrInput.controllers.find((c) => c.inputSource.handedness === hand);
    const mc = xrController?.motionController;
    if (mc === undefined) {
      checks.check(`${hand}: motion controller`, false, "none after 8 frames");
      continue;
    }
    checks.check(`${hand}: oculus-touch profile`, mc.profileId === "oculus-touch" && mc.constructor.name === "WebXROculusTouchMotionController", `${mc.profileId} (${mc.constructor.name})`);
    checks.check(`${hand}: handedness`, mc.handedness === hand);
    checks.check(`${hand}: trigger is the main component`, mc.getMainComponent().id === "xr-standard-trigger", mc.getMainComponent().id);
    const ids = mc.getComponentIds();
    const expected = BUTTONS[hand].map(([, id]) => id);
    checks.check(`${hand}: components`, expected.every((id) => ids.includes(id)), ids.join(", "));

    const changes = new Map<string, number>();
    for (const id of ids) mc.getComponent(id).onButtonStateChangedObservable.add(() => changes.set(id, (changes.get(id) ?? 0) + 1));
    const device = xr.controller(hand);

    for (const [button, componentId] of BUTTONS[hand]) {
      changes.clear();
      device.updateButtonValue(button, 1);
      await xr.runFrames(2);
      const component = mc.getComponent(componentId);
      const othersPressed = ids.filter((id) => id !== componentId && mc.getComponent(id).pressed);
      checks.check(
        `${hand}: ${button} -> ${componentId}`,
        component.pressed && component.value === 1 && changes.get(componentId) === 1 && othersPressed.length === 0,
        `pressed=${component.pressed} value=${component.value} notified=${changes.get(componentId) ?? 0}${othersPressed.length > 0 ? ` also pressed: ${othersPressed.join(",")}` : ""}`,
      );
      device.updateButtonValue(button, 0);
      await xr.runFrames(2);
      checks.check(`${hand}: ${button} released`, !component.pressed && component.value === 0);
    }

    const trigger = mc.getComponent("xr-standard-trigger");
    device.updateButtonTouch("trigger", true);
    await xr.runFrames(2);
    checks.check(`${hand}: trigger touched without press`, trigger.touched && !trigger.pressed);
    device.updateButtonValue("trigger", 0.4);
    await xr.runFrames(2);
    checks.check(`${hand}: analog trigger travel`, Math.abs(trigger.value - 0.4) < 1e-6, `value ${trigger.value}`);
    device.updateButtonValue("trigger", 0);
    device.updateButtonTouch("trigger", false);
    await xr.runFrames(2);

    const stick = mc.getComponent("xr-standard-thumbstick");
    let axisEvents = 0;
    stick.onAxisValueChangedObservable.add(() => axisEvents++);
    device.updateAxes("thumbstick", 0.5, -1);
    await xr.runFrames(2);
    checks.check(`${hand}: thumbstick axes`, stick.axes.x === 0.5 && stick.axes.y === -1 && axisEvents > 0, `(${stick.axes.x}, ${stick.axes.y}), ${axisEvents} events`);
    device.updateAxes("thumbstick", 0, 0);
    await xr.runFrames(2);
    checks.check(`${hand}: thumbstick centred`, stick.axes.x === 0 && stick.axes.y === 0);
  }

  // ---- haptics through the driver
  const calls: string[] = [];
  const fakeInput = {
    applyHaptics: (session: unknown, hand: number, amplitude: number, durationNs: number) => calls.push(`apply ${String(session)} ${hand} ${amplitude} ${durationNs}`),
    stopHaptics: (session: unknown, hand: number) => calls.push(`stop ${String(session)} ${hand}`),
  };
  const driver = new OpenXrIwerDriver(
    xr.device,
    { sessionHandle: "session#1" } as unknown as ConstructorParameters<typeof OpenXrIwerDriver>[1],
    fakeInput as unknown as ConstructorParameters<typeof OpenXrIwerDriver>[2],
    xr.pump,
  );
  const sources = [...xr.sessionManager.session.inputSources];
  driver.forwardHaptics(sources);
  driver.forwardHaptics(sources); // idempotent: one wrapper per actuator

  const right = xrInput.controllers.find((c) => c.inputSource.handedness === "right")?.motionController;
  const left = xrInput.controllers.find((c) => c.inputSource.handedness === "left")?.motionController;
  if (right === undefined || left === undefined) {
    checks.check("haptics: both motion controllers", false);
    return;
  }
  const pulsed = await right.pulse(0.6, 120);
  checks.check("haptics: pulse resolves true", pulsed);
  checks.check("haptics: right pulse -> apply on hand 1, ns", calls.join("|") === "apply session#1 1 0.6 120000000", calls.join("|"));
  calls.length = 0;
  await left.pulse(1.5, 20);
  checks.check("haptics: left pulse clamps the amplitude", calls.join("|") === "apply session#1 0 1 20000000", calls.join("|"));
  calls.length = 0;
  const actuator = sources.find((s) => s.handedness === "left")?.gamepad?.hapticActuators[0] as unknown as { reset(): Promise<string> } | undefined;
  const reset = await actuator?.reset();
  checks.check("haptics: reset -> stop on that hand", calls.join("|") === "stop session#1 0" && reset === "complete", `${calls.join("|")} -> ${String(reset)}`);

  xr.sessionManager.dispose();
});
