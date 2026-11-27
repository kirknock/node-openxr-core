/**
 * koffi FFI definitions for the OpenXR 1.0 ABI (x86-64 Linux, SysV).
 *
 * Struct layouts are written to match the mechanically generated ground
 * truth in ./generated/xr-abi.gen.ts (gcc + offsetof/sizeof against the
 * vendored headers that match the installed loader). `verifyAbi()` checks
 * every size and offset at runtime before any OpenXR call is made.
 *
 * Handles (XrInstance/XrSession/XrSpace/XrSwapchain) are marshalled as
 * opaque pointers (`void *`) so 64-bit values round-trip losslessly.
 * XrSystemId is a small integer value and uses uint64.
 */
import koffi from "koffi";
import { cachedProto } from "../ffi.js";
import {
  XR_MAX_APPLICATION_NAME_SIZE,
  XR_MAX_ENGINE_NAME_SIZE,
  XR_MAX_EXTENSION_NAME_SIZE,
  XR_MAX_SYSTEM_NAME_SIZE,
  abiOffsets,
  abiSizes,
} from "./generated/xr-abi.gen.js";

const EVENT_BUFFER_PAYLOAD =
  abiSizes.XrEventDataBuffer - abiOffsets.XrEventDataBuffer.varying;

// ---------------------------------------------------------------------------
// Primitive type aliases
// ---------------------------------------------------------------------------
const XrStructureType = "int32_t";
const XrBool32 = "uint32_t";
const XrTime = "int64_t";
const XrVersion = "uint64_t";
const XrFlags64 = "uint64_t";

/** Packs major/minor/patch into an XrVersion (JS number, exact for 1.x.y). */
export function xrMakeVersion(major: number, minor: number, patch: number): number {
  return major * 2 ** 48 + minor * 2 ** 32 + patch;
}

/** Splits an XrVersion into its major/minor/patch components. */
export function xrSplitVersion(version: number): { major: number; minor: number; patch: number } {
  return {
    major: Math.floor(version / 2 ** 48),
    minor: Math.floor(version / 2 ** 32) % 2 ** 16,
    patch: version % 2 ** 32,
  };
}

// ---------------------------------------------------------------------------
// Struct definitions (order matters: dependencies first)
// ---------------------------------------------------------------------------
/** Field values are C type names or fixed arrays (koffi.array results). */
type XrFields = Record<string, string | ReturnType<typeof koffi.array>>;

const S = (name: string, fields: XrFields): void => {
  koffi.struct(name, fields);
};

S("XrVector3f", { x: "float", y: "float", z: "float" });
S("XrQuaternionf", { x: "float", y: "float", z: "float", w: "float" });
S("XrPosef", { orientation: "XrQuaternionf", position: "XrVector3f" });
S("XrFovf", { angleLeft: "float", angleRight: "float", angleUp: "float", angleDown: "float" });

S("XrOffset2Di", { x: "int32_t", y: "int32_t" });
S("XrExtent2Di", { width: "int32_t", height: "int32_t" });
S("XrRect2Di", { offset: "XrOffset2Di", extent: "XrExtent2Di" });

S("XrApplicationInfo", {
  applicationName: koffi.array("char", XR_MAX_APPLICATION_NAME_SIZE),
  applicationVersion: "uint32_t",
  engineName: koffi.array("char", XR_MAX_ENGINE_NAME_SIZE),
  engineVersion: "uint32_t",
  apiVersion: XrVersion,
});

S("XrInstanceCreateInfo", {
  type: XrStructureType,
  next: "void *",
  createFlags: XrFlags64,
  applicationInfo: "XrApplicationInfo",
  enabledApiLayerCount: "uint32_t",
  enabledApiLayerNames: "const char **",
  enabledExtensionCount: "uint32_t",
  enabledExtensionNames: "const char **",
});

S("XrInstanceProperties", {
  type: XrStructureType,
  next: "void *",
  runtimeVersion: XrVersion,
  // Spec quirk: runtimeName uses XR_MAX_RUNTIME_NAME_SIZE (128), not the
  // 256-byte system-name buffer.
  runtimeName: koffi.array("char", 128),
});

S("XrExtensionProperties", {
  type: XrStructureType,
  next: "void *",
  extensionName: koffi.array("char", XR_MAX_EXTENSION_NAME_SIZE),
  extensionVersion: "uint32_t",
});

S("XrSystemGetInfo", {
  type: XrStructureType,
  next: "void *",
  formFactor: "int32_t",
});

S("XrSystemGraphicsProperties", {
  maxSwapchainImageHeight: "uint32_t",
  maxSwapchainImageWidth: "uint32_t",
  maxLayerCount: "uint32_t",
});

S("XrSystemTrackingProperties", {
  orientationTracking: XrBool32,
  positionTracking: XrBool32,
});

S("XrSystemProperties", {
  type: XrStructureType,
  next: "void *",
  systemId: "uint64_t",
  vendorId: "uint32_t",
  systemName: koffi.array("char", XR_MAX_SYSTEM_NAME_SIZE),
  graphicsProperties: "XrSystemGraphicsProperties",
  trackingProperties: "XrSystemTrackingProperties",
});

S("XrViewConfigurationView", {
  type: XrStructureType,
  next: "void *",
  recommendedImageRectWidth: "uint32_t",
  maxImageRectWidth: "uint32_t",
  recommendedImageRectHeight: "uint32_t",
  maxImageRectHeight: "uint32_t",
  recommendedSwapchainSampleCount: "uint32_t",
  maxSwapchainSampleCount: "uint32_t",
});

S("XrGraphicsBindingEGLMNDX", {
  type: XrStructureType,
  next: "void *",
  getProcAddress: "void *",
  display: "void *",
  config: "void *",
  context: "void *",
});

S("XrSessionCreateInfo", {
  type: XrStructureType,
  next: "void *",
  createFlags: XrFlags64,
  systemId: "uint64_t",
});

S("XrSessionBeginInfo", {
  type: XrStructureType,
  next: "void *",
  primaryViewConfigurationType: "int32_t",
});

S("XrReferenceSpaceCreateInfo", {
  type: XrStructureType,
  next: "void *",
  referenceSpaceType: "int32_t",
  poseInReferenceSpace: "XrPosef",
});

S("XrSpaceLocation", {
  type: XrStructureType,
  next: "void *",
  locationFlags: XrFlags64,
  pose: "XrPosef",
});

// ---- input / actions (OpenXR core input model; XrPath = uint64) ----------
S("XrVector2f", { x: "float", y: "float" });

S("XrActionSetCreateInfo", {
  type: XrStructureType,
  next: "void *",
  actionSetName: koffi.array("char", 64),
  localizedActionSetName: koffi.array("char", 128),
  priority: "uint32_t",
});

S("XrActionCreateInfo", {
  type: XrStructureType,
  next: "void *",
  actionName: koffi.array("char", 64),
  actionType: "int32_t",
  countSubactionPaths: "uint32_t",
  subactionPaths: "const uint64_t *",
  localizedActionName: koffi.array("char", 128),
});

S("XrActionSuggestedBinding", {
  action: "void *",
  binding: "uint64_t",
});

S("XrInteractionProfileSuggestedBinding", {
  type: XrStructureType,
  next: "void *",
  interactionProfile: "uint64_t",
  countSuggestedBindings: "uint32_t",
  suggestedBindings: "const XrActionSuggestedBinding *",
});

S("XrSessionActionSetsAttachInfo", {
  type: XrStructureType,
  next: "void *",
  countActionSets: "uint32_t",
  actionSets: "void **",
});

S("XrInteractionProfileState", {
  type: XrStructureType,
  next: "void *",
  interactionProfile: "uint64_t",
});

S("XrActionStateGetInfo", {
  type: XrStructureType,
  next: "void *",
  action: "void *",
  subactionPath: "uint64_t",
});

S("XrActionStateBoolean", {
  type: XrStructureType,
  next: "void *",
  currentState: XrBool32,
  changedSinceLastSync: XrBool32,
  lastChangeTime: XrTime,
  isActive: XrBool32,
});

S("XrActionStateFloat", {
  type: XrStructureType,
  next: "void *",
  currentState: "float",
  changedSinceLastSync: XrBool32,
  lastChangeTime: XrTime,
  isActive: XrBool32,
});

S("XrActionStateVector2f", {
  type: XrStructureType,
  next: "void *",
  currentState: "XrVector2f",
  changedSinceLastSync: XrBool32,
  lastChangeTime: XrTime,
  isActive: XrBool32,
});

S("XrActionStatePose", {
  type: XrStructureType,
  next: "void *",
  isActive: XrBool32,
});

S("XrActiveActionSet", {
  actionSet: "void *",
  subactionPath: "uint64_t",
});

S("XrActionsSyncInfo", {
  type: XrStructureType,
  next: "void *",
  countActiveActionSets: "uint32_t",
  activeActionSets: "const XrActiveActionSet *",
});

S("XrActionSpaceCreateInfo", {
  type: XrStructureType,
  next: "void *",
  action: "void *",
  subactionPath: "uint64_t",
  poseInActionSpace: "XrPosef",
});

S("XrBoundSourcesForActionEnumerateInfo", {
  type: XrStructureType,
  next: "void *",
  action: "void *",
});

S("XrInputSourceLocalizedNameGetInfo", {
  type: XrStructureType,
  next: "void *",
  sourcePath: "uint64_t",
  whichComponents: XrFlags64,
});

S("XrHapticActionInfo", {
  type: XrStructureType,
  next: "void *",
  action: "void *",
  subactionPath: "uint64_t",
});

S("XrHapticBaseHeader", { type: XrStructureType, next: "void *" });

S("XrHapticVibration", {
  type: XrStructureType,
  next: "void *",
  duration: XrTime,
  frequency: "float",
  amplitude: "float",
});

S("XrViewLocateInfo", {
  type: XrStructureType,
  next: "void *",
  viewConfigurationType: "int32_t",
  displayTime: XrTime,
  space: "void *",
});

S("XrViewState", {
  type: XrStructureType,
  next: "void *",
  viewStateFlags: XrFlags64,
});

S("XrView", {
  type: XrStructureType,
  next: "void *",
  pose: "XrPosef",
  fov: "XrFovf",
});

S("XrFrameWaitInfo", { type: XrStructureType, next: "void *" });

S("XrFrameState", {
  type: XrStructureType,
  next: "void *",
  predictedDisplayTime: XrTime,
  predictedDisplayPeriod: XrTime,
  shouldRender: XrBool32,
});

S("XrFrameBeginInfo", { type: XrStructureType, next: "void *" });

S("XrFrameEndInfo", {
  type: XrStructureType,
  next: "void *",
  displayTime: XrTime,
  environmentBlendMode: "int32_t",
  layerCount: "uint32_t",
  layers: "void **",
});

S("XrSwapchainSubImage", {
  swapchain: "void *",
  imageRect: "XrRect2Di",
  imageArrayIndex: "uint32_t",
});

S("XrCompositionLayerProjectionView", {
  type: XrStructureType,
  next: "void *",
  pose: "XrPosef",
  fov: "XrFovf",
  subImage: "XrSwapchainSubImage",
});

S("XrCompositionLayerProjection", {
  type: XrStructureType,
  next: "void *",
  layerFlags: XrFlags64,
  space: "void *",
  viewCount: "uint32_t",
  views: "const XrCompositionLayerProjectionView *",
});

S("XrSwapchainCreateInfo", {
  type: XrStructureType,
  next: "void *",
  createFlags: XrFlags64,
  usageFlags: XrFlags64,
  format: "int64_t",
  sampleCount: "uint32_t",
  width: "uint32_t",
  height: "uint32_t",
  faceCount: "uint32_t",
  arraySize: "uint32_t",
  mipCount: "uint32_t",
});

// XR_FB_passthrough (activation only; no layer composition needed).
// Hand-declared: the vendored 1.0.20 headers predate this extension (its
// structure-type value lives in post-1-0-20.ts).
S("XrPassthroughCreateInfoFB", {
  type: XrStructureType,
  next: "void *",
  flags: XrFlags64,
});


S("XrSwapchainImageAcquireInfo", { type: XrStructureType, next: "void *" });
S("XrSwapchainImageReleaseInfo", { type: XrStructureType, next: "void *" });

S("XrSwapchainImageWaitInfo", {
  type: XrStructureType,
  next: "void *",
  timeout: XrTime,
});

S("XrSwapchainImageOpenGLESKHR", {
  type: XrStructureType,
  next: "void *",
  image: "uint32_t",
});

// XR_KHR_vulkan_enable2 (the WebGPU path, packages/webgpu/src/). Vulkan handles are kept
// as integers: they only pass between OpenXR and Dawn.
S("XrGraphicsBindingVulkan2KHR", {
  type: XrStructureType,
  next: "void *",
  instance: "uint64_t",
  physicalDevice: "uint64_t",
  device: "uint64_t",
  queueFamilyIndex: "uint32_t",
  queueIndex: "uint32_t",
});

S("XrSwapchainImageVulkan2KHR", {
  type: XrStructureType,
  next: "void *",
  image: "uint64_t",
});

S("XrGraphicsRequirementsVulkan2KHR", {
  type: XrStructureType,
  next: "void *",
  minApiVersionSupported: XrVersion,
  maxApiVersionSupported: XrVersion,
});

S("XrGraphicsRequirementsOpenGLESKHR", {
  type: XrStructureType,
  next: "void *",
  minApiVersionSupported: XrVersion,
  maxApiVersionSupported: XrVersion,
});

S("XrEventDataBaseHeader", { type: XrStructureType, next: "void *" });

S("XrEventDataEventsLost", {
  type: XrStructureType,
  next: "void *",
  lostEventCount: "uint32_t",
});

S("XrEventDataInstanceLossPending", {
  type: XrStructureType,
  next: "void *",
  lossTime: XrTime,
});

S("XrEventDataSessionStateChanged", {
  type: XrStructureType,
  next: "void *",
  session: "void *",
  state: "int32_t",
  time: XrTime,
});

S("XrEventDataBuffer", {
  type: XrStructureType,
  next: "void *",
  varying: koffi.array("uint8_t", EVENT_BUFFER_PAYLOAD),
});

// ---------------------------------------------------------------------------
// ABI self-check against generated ground truth
// ---------------------------------------------------------------------------
const STRUCTS_TO_VERIFY = Object.keys(abiOffsets);

/** Validates every koffi struct size/offset against the C-generated table. */
export function verifyAbi(): void {
  const errors: string[] = [];
  for (const name of STRUCTS_TO_VERIFY) {
    const expectedSize = abiSizes[name];
    if (expectedSize === undefined) {
      errors.push(`${name}: no generated size`);
      continue;
    }
    const actualSize = koffi.sizeof(name);
    if (actualSize !== expectedSize) {
      errors.push(`${name}: sizeof ${actualSize} != ${expectedSize}`);
    }
    for (const [field, expectedOffset] of Object.entries(abiOffsets[name])) {
      const actualOffset = koffi.offsetof(name, field);
      if (actualOffset !== expectedOffset) {
        errors.push(`${name}.${field}: offset ${actualOffset} != ${expectedOffset}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`OpenXR koffi ABI mismatch:\n  ${errors.join("\n  ")}`);
  }
}

// ---------------------------------------------------------------------------
// Function prototypes + instance function table
// ---------------------------------------------------------------------------
/** Every OpenXR function returns an XrResult (int32). */
export type XrFn = (...args: unknown[]) => number;
export type XrFunctionTable = Record<string, XrFn>;

/** Loader-level entry point (bound directly from libopenxr_loader.so.1). */
export const XrGetInstanceProcAddrDecl =
  "int32_t xrGetInstanceProcAddr(void *instance, const char *name, _Out_ void **function)";

/** All OpenXR functions used by the app, keyed by their C symbol name. */
export const XR_FUNCTION_PROTOS: Record<string, string> = {
  xrCreateInstance:
    "int32_t xrCreateInstance(const XrInstanceCreateInfo *createInfo, _Out_ void **instance)",
  xrDestroyInstance: "int32_t xrDestroyInstance(void *instance)",
  xrEnumerateInstanceExtensionProperties:
    "int32_t xrEnumerateInstanceExtensionProperties(const char *layerName, uint32_t propertyCapacityInput, _Out_ uint32_t *propertyCountOutput, _Inout_ XrExtensionProperties *properties)",
  xrGetInstanceProperties:
    "int32_t xrGetInstanceProperties(void *instance, _Inout_ XrInstanceProperties *instanceProperties)",
  xrGetSystem:
    "int32_t xrGetSystem(void *instance, const XrSystemGetInfo *getInfo, _Out_ uint64_t *systemId)",
  xrGetSystemProperties:
    "int32_t xrGetSystemProperties(void *instance, uint64_t systemId, _Inout_ XrSystemProperties *properties)",
  xrEnumerateViewConfigurations:
    "int32_t xrEnumerateViewConfigurations(void *instance, uint64_t systemId, uint32_t viewConfigurationTypeCapacityInput, _Out_ uint32_t *viewConfigurationTypeCountOutput, int32_t *viewConfigurationTypes)",
  xrEnumerateViewConfigurationViews:
    "int32_t xrEnumerateViewConfigurationViews(void *instance, uint64_t systemId, int32_t viewConfigurationType, uint32_t viewCapacityInput, _Out_ uint32_t *viewCountOutput, _Inout_ XrViewConfigurationView *views)",
  xrEnumerateEnvironmentBlendModes:
    "int32_t xrEnumerateEnvironmentBlendModes(void *instance, uint64_t systemId, int32_t viewConfigurationType, uint32_t environmentBlendModeCapacityInput, _Out_ uint32_t *environmentBlendModeCountOutput, int32_t *environmentBlendModes)",
  xrEnumerateSwapchainFormats:
    "int32_t xrEnumerateSwapchainFormats(void *session, uint32_t formatCapacityInput, _Out_ uint32_t *formatCountOutput, int64_t *formats)",
  xrCreateSession:
    "int32_t xrCreateSession(void *instance, const XrSessionCreateInfo *createInfo, _Out_ void **session)",
  xrDestroySession: "int32_t xrDestroySession(void *session)",
  xrBeginSession:
    "int32_t xrBeginSession(void *session, const XrSessionBeginInfo *beginInfo)",
  xrCreateReferenceSpace:
    "int32_t xrCreateReferenceSpace(void *session, const XrReferenceSpaceCreateInfo *createInfo, _Out_ void **space)",
  xrDestroySpace: "int32_t xrDestroySpace(void *space)",
  xrCreateSwapchain:
    "int32_t xrCreateSwapchain(void *session, const XrSwapchainCreateInfo *createInfo, _Out_ void **swapchain)",
  xrDestroySwapchain: "int32_t xrDestroySwapchain(void *swapchain)",
  xrAcquireSwapchainImage:
    "int32_t xrAcquireSwapchainImage(void *swapchain, const XrSwapchainImageAcquireInfo *acquireInfo, _Out_ uint32_t *index)",
  xrWaitSwapchainImage:
    "int32_t xrWaitSwapchainImage(void *swapchain, const XrSwapchainImageWaitInfo *waitInfo)",
  xrReleaseSwapchainImage:
    "int32_t xrReleaseSwapchainImage(void *swapchain, const XrSwapchainImageReleaseInfo *releaseInfo)",
  xrWaitFrame:
    "int32_t xrWaitFrame(void *session, const XrFrameWaitInfo *frameWaitInfo, _Inout_ XrFrameState *frameState)",
  xrBeginFrame:
    "int32_t xrBeginFrame(void *session, const XrFrameBeginInfo *frameBeginInfo)",
  xrEndFrame:
    "int32_t xrEndFrame(void *session, const XrFrameEndInfo *frameEndInfo)",
  xrLocateViews:
    "int32_t xrLocateViews(void *session, const XrViewLocateInfo *viewLocateInfo, _Inout_ XrViewState *viewState, uint32_t viewCapacityInput, _Out_ uint32_t *viewCountOutput, _Inout_ XrView *views)",
  xrPollEvent:
    "int32_t xrPollEvent(void *instance, _Inout_ XrEventDataBuffer *eventData)",
  xrRequestExitSession: "int32_t xrRequestExitSession(void *session)",
  xrEndSession: "int32_t xrEndSession(void *session)",
  xrLocateSpace:
    "int32_t xrLocateSpace(void *space, void *baseSpace, int64_t time, _Inout_ XrSpaceLocation *location)",
  xrStringToPath:
    "int32_t xrStringToPath(void *instance, const char *pathString, _Out_ uint64_t *path)",
  xrPathToString:
    "int32_t xrPathToString(void *instance, uint64_t path, uint32_t bufferCapacityInput, _Out_ uint32_t *bufferCountOutput, char *buffer)",
  xrCreateActionSet:
    "int32_t xrCreateActionSet(void *instance, const XrActionSetCreateInfo *createInfo, _Out_ void **actionSet)",
  xrDestroyActionSet: "int32_t xrDestroyActionSet(void *actionSet)",
  xrCreateAction:
    "int32_t xrCreateAction(void *actionSet, const XrActionCreateInfo *createInfo, _Out_ void **action)",
  xrDestroyAction: "int32_t xrDestroyAction(void *action)",
  xrSuggestInteractionProfileBindings:
    "int32_t xrSuggestInteractionProfileBindings(void *instance, const XrInteractionProfileSuggestedBinding *suggestedBindings)",
  xrAttachSessionActionSets:
    "int32_t xrAttachSessionActionSets(void *session, const XrSessionActionSetsAttachInfo *attachInfo)",
  xrGetCurrentInteractionProfile:
    "int32_t xrGetCurrentInteractionProfile(void *session, uint64_t topLevelUserPath, _Inout_ XrInteractionProfileState *interactionProfileState)",
  xrSyncActions:
    "int32_t xrSyncActions(void *session, const XrActionsSyncInfo *syncInfo)",
  xrGetActionStateBoolean:
    "int32_t xrGetActionStateBoolean(void *session, const XrActionStateGetInfo *getInfo, _Inout_ XrActionStateBoolean *state)",
  xrGetActionStateFloat:
    "int32_t xrGetActionStateFloat(void *session, const XrActionStateGetInfo *getInfo, _Inout_ XrActionStateFloat *state)",
  xrGetActionStateVector2f:
    "int32_t xrGetActionStateVector2f(void *session, const XrActionStateGetInfo *getInfo, _Inout_ XrActionStateVector2f *state)",
  xrGetActionStatePose:
    "int32_t xrGetActionStatePose(void *session, const XrActionStateGetInfo *getInfo, _Inout_ XrActionStatePose *state)",
  xrCreateActionSpace:
    "int32_t xrCreateActionSpace(void *session, const XrActionSpaceCreateInfo *createInfo, _Out_ void **space)",
  xrApplyHapticFeedback:
    "int32_t xrApplyHapticFeedback(void *session, const XrHapticActionInfo *hapticActionInfo, const XrHapticBaseHeader *hapticFeedback)",
  xrStopHapticFeedback:
    "int32_t xrStopHapticFeedback(void *session, const XrHapticActionInfo *hapticActionInfo)",
  xrEnumerateDisplayRefreshRatesFB:
    "int32_t xrEnumerateDisplayRefreshRatesFB(void *session, uint32_t displayRefreshRateCapacityInput, _Out_ uint32_t *displayRefreshRateCountOutput, float *displayRefreshRates)",
  // XR_FB_passthrough (optional; resolved only when the runtime advertises it)
  xrCreatePassthroughFB:
    "int32_t xrCreatePassthroughFB(void *session, const void *createInfo, _Out_ void **passthrough)",
  xrPassthroughStartFB: "int32_t xrPassthroughStartFB(void *passthrough)",
  xrPassthroughPauseFB: "int32_t xrPassthroughPauseFB(void *passthrough)",
  xrDestroyPassthroughFB: "int32_t xrDestroyPassthroughFB(void *passthrough)",
};

/** Functions resolvable with a NULL instance (loader-level bootstrap set). */
export const XR_BOOTSTRAP_FNS = [
  "xrCreateInstance",
  "xrEnumerateInstanceExtensionProperties",
];

/**
 * Resolves OpenXR functions through xrGetInstanceProcAddr. `instance` is
 * null before the instance exists — pass XR_BOOTSTRAP_FNS then, otherwise
 * the runtime emits a SPEC validation error per instance-level query.
 * Missing/unsupported entries are simply absent from the result.
 */
export function resolveXrFunctions(
  xrGetInstanceProcAddr: XrFn,
  instance: unknown,
  names?: string[],
): XrFunctionTable {
  const table: XrFunctionTable = {};
  const wanted = names ?? Object.keys(XR_FUNCTION_PROTOS);
  for (const name of wanted) {
    const out = [null];
    const result = xrGetInstanceProcAddr(instance ?? null, name, out);
    if (result !== 0 || out[0] === null || out[0] === undefined) {
      continue; // not available in this runtime/loader configuration
    }
    table[name] = koffi.decode(out[0], cachedProto(XR_FUNCTION_PROTOS[name])) as XrFn;
  }
  return table;
}
