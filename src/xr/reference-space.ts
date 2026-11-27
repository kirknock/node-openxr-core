/**
 * The session's reference space: floor-anchored in every mode.
 *
 * Preference: LOCAL_FLOOR (needs XR_EXT_local_floor enabled on this 1.0
 * instance) -> STAGE -> LOCAL. LOCAL originates at the initial HEAD pose, so
 * its fallback is created with the origin XR_EYE_HEIGHT below the head:
 * every pose located in it — eye views, controller grip/aim, the submitted
 * projection layer — then shares one floor-level frame, exactly like
 * LOCAL_FLOOR/STAGE. (Offsetting only some consumers left the WebXR head
 * 1.6 m above the eye cameras and controllers, which broke rays, teleport
 * and floor placement.)
 */
import * as gen from "./generated/xr-abi.gen.js";
import { xrResultName, type XrHandle } from "./xr-loader.js";
import { XR_REFERENCE_SPACE_TYPE_LOCAL_FLOOR_EXT } from "./post-1-0-20.js";
import { logger } from "../log.js";

const sessionLog = logger("session");

export interface ReferenceSpace {
  handle: unknown;
  /** LOCAL_FLOOR | STAGE | LOCAL */
  mode: string;
}

export function createFloorReferenceSpace(
  xr: XrHandle,
  session: unknown,
  localFloorEnabled: boolean,
  eyeHeight: number,
): ReferenceSpace {
  const candidates: Array<[string, number]> = [
    ...(localFloorEnabled ? ([["LOCAL_FLOOR", XR_REFERENCE_SPACE_TYPE_LOCAL_FLOOR_EXT]] as Array<[string, number]>) : []),
    ["STAGE", gen.XR_REFERENCE_SPACE_TYPE_STAGE],
    ["LOCAL", gen.XR_REFERENCE_SPACE_TYPE_LOCAL],
  ];
  const spaceOut = [null];
  for (const [mode, spaceType] of candidates) {
    const originY = mode === "LOCAL" ? -eyeHeight : 0;
    const res = xr.fn.xrCreateReferenceSpace(
      session,
      {
        type: gen.XR_TYPE_REFERENCE_SPACE_CREATE_INFO,
        next: null,
        referenceSpaceType: spaceType,
        poseInReferenceSpace: {
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          position: { x: 0, y: originY, z: 0 },
        },
      },
      spaceOut,
    );
    if (res === 0) {
      sessionLog.info(
        `reference space: ${mode}` +
          (mode === "LOCAL"
            ? ` (head-anchored fallback; origin moved ${eyeHeight} m below the head = estimated floor, XR_EYE_HEIGHT)`
            : " (floor-anchored)"),
      );
      return { handle: spaceOut[0], mode };
    }
    sessionLog.info(`reference space ${mode} unavailable (${xrResultName(res)}) — trying next`);
  }
  throw new Error("no reference space available (LOCAL_FLOOR/STAGE/LOCAL all rejected)");
}
