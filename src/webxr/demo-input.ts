/**
 * Dev VM only (XR_SYNTH_INPUT): inject a pulsing left trigger (select) and
 * a right-stick aim+release teleport gesture — flows OpenXR->IWER->WebXR
 * API->Babylon motion-controller component events. Never on real
 * controllers: the override REPLACES their trigger/stick values.
 */
import type { OpenXrIwerDriver } from "./openxr-driver.js";
import { logger } from "../log.js";

const mainLog = logger("main");

export function installDemoInput(driver: OpenXrIwerDriver): void {
  driver.inputOverride = (hand) => {
    if (hand === 0) return Date.now() % 4000 < 2000 ? { trigger: 1 } : undefined;
    return Date.now() % 8000 < 1500 ? { thumbstick: { x: 0, y: -1 } } : undefined;
  };
  mainLog.info("demo input injection on (XR_SYNTH_INPUT): left trigger pulses, right stick teleport gesture");
}
