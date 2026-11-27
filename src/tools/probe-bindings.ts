/** Bisector: which variable makes xrSuggestInteractionProfileBindings fail.
 * Variant A: real OpenXrInput.init() on an instance WITH graphics extensions.
 * Variant B: hand-rolled minimal suggestion on a plain instance (known-good).
 */
import koffi from "koffi";
import { createXrInstance, xrCheck } from "../xr/xr-loader.js";
import { OpenXrInput } from "../xr/input.js";

// Variant A: real class, extensions instance (mirrors probe-input context).
{
  const xr = createXrInstance({
    applicationName: "bindings-test-a",
    extensions: ["XR_KHR_opengl_es_enable", "XR_MNDX_egl_enable"],
  });
  const input = new OpenXrInput(xr);
  input.init();
  xr.destroy();
}

// Variant C: hand-rolled clone of A's simple-profile subset — same five
// actions (bool, bool, pose, pose, vibration), same 10 bindings.
{
  const xr = createXrInstance({
    applicationName: "bindings-test-c",
    extensions: ["XR_KHR_opengl_es_enable", "XR_MNDX_egl_enable"],
  });
  const path = (s: string): number => {
    const out = [0];
    xrCheck(xr.fn.xrStringToPath(xr.raw, s, out), "xrStringToPath");
    return out[0];
  };
  const left = path("/user/hand/left");
  const right = path("/user/hand/right");
  const subPtr = koffi.alloc("uint64_t", 2);
  koffi.encode(subPtr, 0, "uint64_t", left);
  koffi.encode(subPtr, 8, "uint64_t", right);

  const setOut = [null];
  xrCheck(
    xr.fn.xrCreateActionSet(
      xr.raw,
      { type: 28, next: null, actionSetName: "app-input", localizedActionSetName: "Application Input", priority: 0 },
      setOut,
    ),
    "xrCreateActionSet",
  );

  const mk = (name: string, actionType: number): unknown => {
    const out = [null];
    xrCheck(
      xr.fn.xrCreateAction(
        setOut[0],
        { type: 29, next: null, actionName: name, actionType, countSubactionPaths: 2, subactionPaths: subPtr, localizedActionName: name },
        out,
      ),
      `xrCreateAction(${name})`,
    );
    return out[0];
  };
  const select = mk("select_click", 1);
  const squeeze = mk("squeeze_click", 1);
  const grip = mk("grip_pose", 4);
  const aim = mk("aim_pose", 4);
  const haptic = mk("haptic", 100);

  const rels: Array<[string, unknown, string]> = [
    ["select", select, "/input/select/click"],
    ["squeeze", squeeze, "/input/squeeze/click"],
    ["grip", grip, "/input/grip/pose"],
    ["aim", aim, "/input/aim/pose"],
    ["haptic", haptic, "/output/haptic"],
  ];
  const stride = koffi.sizeof("XrActionSuggestedBinding");
  for (let take = 1; take <= rels.length; take++) {
    const subset = rels.slice(0, take);
    const entries: Array<{ action: unknown; binding: number }> = [];
    for (const handPath of ["/user/hand/left", "/user/hand/right"]) {
      for (const [, action, rel] of subset) {
        entries.push({ action, binding: path(`${handPath}${rel}`) });
      }
    }
    const ptr = koffi.alloc(koffi.resolve("XrActionSuggestedBinding"), entries.length);
    entries.forEach((e, i) => koffi.encode(ptr, i * stride, "XrActionSuggestedBinding", e));
    const r = xr.fn.xrSuggestInteractionProfileBindings(xr.raw, {
      type: 51,
      next: null,
      interactionProfile: path("/interaction_profiles/khr/simple_controller"),
      countSuggestedBindings: entries.length,
      suggestedBindings: ptr,
    });
    console.log(
      `[variant C${take}] ${subset.map((s) => s[0]).join("+")} -> ${r} ${r === 0 ? "SUCCESS" : "FAIL"}`,
    );
    if (r !== 0) break;
  }
  xr.destroy();
}

// Variant B: hand-rolled minimal (known-good from the C mirror).
{
  const xr = createXrInstance({ applicationName: "bindings-test-b", extensions: [] });
  const path = (s: string): number => {
    const out = [0];
    xrCheck(xr.fn.xrStringToPath(xr.raw, s, out), "xrStringToPath");
    return out[0];
  };

  const setOut = [null];
  xrCheck(
    xr.fn.xrCreateActionSet(
      xr.raw,
      {
        type: 28,
        next: null,
        actionSetName: "test",
        localizedActionSetName: "Test",
        priority: 0,
      },
      setOut,
    ),
    "xrCreateActionSet",
  );

  const subactionsPtr = koffi.alloc("uint64_t", 2);
  koffi.encode(subactionsPtr, 0, "uint64_t", path("/user/hand/left"));
  koffi.encode(subactionsPtr, 8, "uint64_t", path("/user/hand/right"));

  const actionOut = [null];
  xrCheck(
    xr.fn.xrCreateAction(
      setOut[0],
      {
        type: 29,
        next: null,
        actionName: "select",
        actionType: 1,
        countSubactionPaths: 2,
        subactionPaths: subactionsPtr,
        localizedActionName: "select",
      },
      actionOut,
    ),
    "xrCreateAction",
  );

  const ptr = koffi.alloc(koffi.resolve("XrActionSuggestedBinding"), 2);
  const stride = koffi.sizeof("XrActionSuggestedBinding");
  koffi.encode(ptr, 0, "XrActionSuggestedBinding", {
    action: actionOut[0],
    binding: path("/user/hand/left/input/select/click"),
  });
  koffi.encode(ptr, stride, "XrActionSuggestedBinding", {
    action: actionOut[0],
    binding: path("/user/hand/right/input/select/click"),
  });

  const r = xr.fn.xrSuggestInteractionProfileBindings(xr.raw, {
    type: 51,
    next: null,
    interactionProfile: path("/interaction_profiles/khr/simple_controller"),
    countSuggestedBindings: 2,
    suggestedBindings: ptr,
  });
  console.log(`[variant B] minimal suggestion -> ${r} ${r === 0 ? "SUCCESS" : "FAIL"}`);
  xr.destroy();
}

process.exit(0);
