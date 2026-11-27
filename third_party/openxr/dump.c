/*
 * ABI ground-truth generator for the OpenXR FFI bindings.
 *
 * Compiled against the vendored OpenXR 1.0.20 headers (the exact version of
 * the system loader) and prints sizeof/offsetof/enum/constant facts so the
 * koffi struct definitions in src/xr/xr-abi.ts can be verified mechanically.
 * The compiler guarantees every field name below exists; nothing is
 * hand-transcribed.
 *
 * Build: gcc -I third_party/openxr third_party/openxr/dump.c -o /tmp/xr-dump
 */
#include <openxr.h>
#define XR_USE_PLATFORM_EGL 1
#define XR_USE_GRAPHICS_API_OPENGL_ES 1
#define XR_USE_GRAPHICS_API_VULKAN 1
#include <EGL/egl.h>
/* No Vulkan headers on the system. The structs dumped here only hold handles
 * and pointers to these, so opaque declarations give the true layout. */
typedef struct VkInstance_T *VkInstance;
typedef struct VkPhysicalDevice_T *VkPhysicalDevice;
typedef struct VkDevice_T *VkDevice;
typedef struct VkImage_T *VkImage;
typedef int VkResult;
typedef int VkFormat;
typedef int VkFilter;
typedef int VkSamplerMipmapMode;
typedef int VkSamplerAddressMode;
typedef int VkComponentSwizzle;
typedef struct VkInstanceCreateInfo VkInstanceCreateInfo;
typedef struct VkDeviceCreateInfo VkDeviceCreateInfo;
typedef struct VkAllocationCallbacks VkAllocationCallbacks;
typedef void (*PFN_vkVoidFunction)(void);
typedef PFN_vkVoidFunction (*PFN_vkGetInstanceProcAddr)(VkInstance, const char *);
#include <openxr_platform.h>

#include <stddef.h>
#include <stdio.h>
#include <string.h>

#define P_SIZE(t) printf("SIZE %s %zu\n", #t, sizeof(t))
#define P_OFF(t, f) printf("OFF %s %s %zu\n", #t, #f, offsetof(t, f))
#define P_I(name, expr) printf("I %s %d\n", name, (int)(expr))
#define P_L(name, expr) printf("L %s %lld\n", name, (long long)(expr))

int main(void) {
    /* ---- scalar / handle widths ---- */
    P_SIZE(XrBool32);
    P_SIZE(XrFlags64);
    P_SIZE(XrTime);
    P_SIZE(XrDuration);
    P_SIZE(XrVersion);
    P_SIZE(XrInstance);
    P_SIZE(XrSystemId);
    P_SIZE(XrSession);
    P_SIZE(XrSpace);
    P_SIZE(XrSwapchain);
    P_SIZE(XrInstanceCreateFlags);
    P_SIZE(XrSessionCreateFlags);
    P_SIZE(XrSwapchainCreateFlags);
    P_SIZE(XrSwapchainUsageFlags);
    P_SIZE(XrSpaceLocationFlags);
    P_SIZE(XrViewStateFlags);
    P_SIZE(XrCompositionLayerFlags);
    P_SIZE(XrEnvironmentBlendMode);
    P_SIZE(XrReferenceSpaceType);
    P_SIZE(XrViewConfigurationType);
    P_SIZE(XrFormFactor);
    P_SIZE(XrStructureType);
    P_SIZE(XrSessionState);

    /* ---- math structs ---- */
    P_SIZE(XrVector3f);
    P_OFF(XrVector3f, x);
    P_OFF(XrVector3f, y);
    P_OFF(XrVector3f, z);
    P_SIZE(XrQuaternionf);
    P_OFF(XrQuaternionf, x);
    P_OFF(XrQuaternionf, y);
    P_OFF(XrQuaternionf, z);
    P_OFF(XrQuaternionf, w);
    P_SIZE(XrPosef);
    P_OFF(XrPosef, orientation);
    P_OFF(XrPosef, position);
    P_SIZE(XrFovf);
    P_OFF(XrFovf, angleLeft);
    P_OFF(XrFovf, angleRight);
    P_OFF(XrFovf, angleUp);
    P_OFF(XrFovf, angleDown);

    /* ---- instance / system ---- */
    P_SIZE(XrApplicationInfo);
    P_OFF(XrApplicationInfo, applicationName);
    P_OFF(XrApplicationInfo, engineName);
    P_OFF(XrApplicationInfo, applicationVersion);
    P_OFF(XrApplicationInfo, apiVersion);
    P_SIZE(XrInstanceCreateInfo);
    P_OFF(XrInstanceCreateInfo, type);
    P_OFF(XrInstanceCreateInfo, next);
    P_OFF(XrInstanceCreateInfo, createFlags);
    P_OFF(XrInstanceCreateInfo, applicationInfo);
    P_OFF(XrInstanceCreateInfo, enabledApiLayerCount);
    P_OFF(XrInstanceCreateInfo, enabledApiLayerNames);
    P_OFF(XrInstanceCreateInfo, enabledExtensionCount);
    P_OFF(XrInstanceCreateInfo, enabledExtensionNames);
    P_SIZE(XrInstanceProperties);
    P_OFF(XrInstanceProperties, type);
    P_OFF(XrInstanceProperties, next);
    P_OFF(XrInstanceProperties, runtimeVersion);
    P_OFF(XrInstanceProperties, runtimeName);
    P_SIZE(XrExtensionProperties);
    P_OFF(XrExtensionProperties, type);
    P_OFF(XrExtensionProperties, next);
    P_OFF(XrExtensionProperties, extensionName);
    P_OFF(XrExtensionProperties, extensionVersion);
    P_SIZE(XrSystemGetInfo);
    P_OFF(XrSystemGetInfo, type);
    P_OFF(XrSystemGetInfo, next);
    P_OFF(XrSystemGetInfo, formFactor);
    P_SIZE(XrSystemProperties);
    P_OFF(XrSystemProperties, type);
    P_OFF(XrSystemProperties, next);
    P_OFF(XrSystemProperties, systemId);
    P_OFF(XrSystemProperties, vendorId);
    P_OFF(XrSystemProperties, systemName);
    P_OFF(XrSystemProperties, graphicsProperties);
    P_OFF(XrSystemProperties, trackingProperties);
    P_SIZE(XrSystemGraphicsProperties);
    P_OFF(XrSystemGraphicsProperties, maxSwapchainImageWidth);
    P_OFF(XrSystemGraphicsProperties, maxSwapchainImageHeight);
    P_SIZE(XrSystemTrackingProperties);
    P_OFF(XrSystemTrackingProperties, orientationTracking);
    P_OFF(XrSystemTrackingProperties, positionTracking);
    P_SIZE(XrViewConfigurationView);
    P_OFF(XrViewConfigurationView, type);
    P_OFF(XrViewConfigurationView, next);
    P_OFF(XrViewConfigurationView, recommendedImageRectWidth);
    P_OFF(XrViewConfigurationView, recommendedImageRectHeight);
    P_OFF(XrViewConfigurationView, maxImageRectWidth);
    P_OFF(XrViewConfigurationView, maxImageRectHeight);
    P_OFF(XrViewConfigurationView, recommendedSwapchainSampleCount);
    P_OFF(XrViewConfigurationView, maxSwapchainSampleCount);

    /* ---- session / frame loop ---- */
    P_SIZE(XrSessionCreateInfo);
    P_OFF(XrSessionCreateInfo, type);
    P_OFF(XrSessionCreateInfo, next);
    P_OFF(XrSessionCreateInfo, createFlags);
    P_OFF(XrSessionCreateInfo, systemId);
    P_SIZE(XrSessionBeginInfo);
    P_OFF(XrSessionBeginInfo, type);
    P_OFF(XrSessionBeginInfo, next);
    P_OFF(XrSessionBeginInfo, primaryViewConfigurationType);
    P_SIZE(XrReferenceSpaceCreateInfo);
    P_OFF(XrReferenceSpaceCreateInfo, type);
    P_OFF(XrReferenceSpaceCreateInfo, next);
    P_OFF(XrReferenceSpaceCreateInfo, referenceSpaceType);
    P_OFF(XrReferenceSpaceCreateInfo, poseInReferenceSpace);
    P_SIZE(XrSpaceLocation);
    P_OFF(XrSpaceLocation, type);
    P_OFF(XrSpaceLocation, next);
    P_OFF(XrSpaceLocation, locationFlags);
    P_OFF(XrSpaceLocation, pose);
    P_SIZE(XrViewLocateInfo);
    P_OFF(XrViewLocateInfo, type);
    P_OFF(XrViewLocateInfo, next);
    P_OFF(XrViewLocateInfo, viewConfigurationType);
    P_OFF(XrViewLocateInfo, displayTime);
    P_OFF(XrViewLocateInfo, space);
    P_SIZE(XrViewState);
    P_OFF(XrViewState, type);
    P_OFF(XrViewState, next);
    P_OFF(XrViewState, viewStateFlags);
    P_SIZE(XrView);
    P_OFF(XrView, type);
    P_OFF(XrView, next);
    P_OFF(XrView, pose);
    P_OFF(XrView, fov);
    P_SIZE(XrFrameWaitInfo);
    P_OFF(XrFrameWaitInfo, type);
    P_OFF(XrFrameWaitInfo, next);
    P_SIZE(XrFrameState);
    P_OFF(XrFrameState, type);
    P_OFF(XrFrameState, next);
    P_OFF(XrFrameState, predictedDisplayTime);
    P_OFF(XrFrameState, predictedDisplayPeriod);
    P_OFF(XrFrameState, shouldRender);
    P_SIZE(XrFrameBeginInfo);
    P_OFF(XrFrameBeginInfo, type);
    P_OFF(XrFrameBeginInfo, next);
    P_SIZE(XrFrameEndInfo);
    P_OFF(XrFrameEndInfo, type);
    P_OFF(XrFrameEndInfo, next);
    P_OFF(XrFrameEndInfo, displayTime);
    P_OFF(XrFrameEndInfo, environmentBlendMode);
    P_OFF(XrFrameEndInfo, layerCount);
    P_OFF(XrFrameEndInfo, layers);

    /* ---- composition layers ---- */
    P_SIZE(XrSwapchainSubImage);
    P_OFF(XrSwapchainSubImage, swapchain);
    P_OFF(XrSwapchainSubImage, imageRect);
    P_OFF(XrSwapchainSubImage, imageArrayIndex);
    P_SIZE(XrOffset2Di);
    P_OFF(XrOffset2Di, x);
    P_OFF(XrOffset2Di, y);
    P_SIZE(XrExtent2Di);
    P_OFF(XrExtent2Di, width);
    P_OFF(XrExtent2Di, height);
    P_SIZE(XrRect2Di);
    P_OFF(XrRect2Di, offset);
    P_OFF(XrRect2Di, extent);
    P_SIZE(XrCompositionLayerProjectionView);
    P_OFF(XrCompositionLayerProjectionView, type);
    P_OFF(XrCompositionLayerProjectionView, next);
    P_OFF(XrCompositionLayerProjectionView, pose);
    P_OFF(XrCompositionLayerProjectionView, fov);
    P_OFF(XrCompositionLayerProjectionView, subImage);
    P_SIZE(XrCompositionLayerProjection);
    P_OFF(XrCompositionLayerProjection, type);
    P_OFF(XrCompositionLayerProjection, next);
    P_OFF(XrCompositionLayerProjection, layerFlags);
    P_OFF(XrCompositionLayerProjection, space);
    P_OFF(XrCompositionLayerProjection, viewCount);
    P_OFF(XrCompositionLayerProjection, views);

    /* ---- swapchains ---- */
    P_SIZE(XrSwapchainCreateInfo);
    P_OFF(XrSwapchainCreateInfo, type);
    P_OFF(XrSwapchainCreateInfo, next);
    P_OFF(XrSwapchainCreateInfo, createFlags);
    P_OFF(XrSwapchainCreateInfo, usageFlags);
    P_OFF(XrSwapchainCreateInfo, format);
    P_OFF(XrSwapchainCreateInfo, sampleCount);
    P_OFF(XrSwapchainCreateInfo, width);
    P_OFF(XrSwapchainCreateInfo, height);
    P_OFF(XrSwapchainCreateInfo, faceCount);
    P_OFF(XrSwapchainCreateInfo, arraySize);
    P_OFF(XrSwapchainCreateInfo, mipCount);
    P_SIZE(XrSwapchainImageAcquireInfo);
    P_OFF(XrSwapchainImageAcquireInfo, type);
    P_OFF(XrSwapchainImageAcquireInfo, next);
    P_SIZE(XrSwapchainImageReleaseInfo);
    P_OFF(XrSwapchainImageReleaseInfo, type);
    P_OFF(XrSwapchainImageReleaseInfo, next);
    P_SIZE(XrSwapchainImageWaitInfo);
    P_OFF(XrSwapchainImageWaitInfo, type);
    P_OFF(XrSwapchainImageWaitInfo, next);
    P_OFF(XrSwapchainImageWaitInfo, timeout);

    /* ---- events ---- */
    P_SIZE(XrEventDataBaseHeader);
    P_OFF(XrEventDataBaseHeader, type);
    P_OFF(XrEventDataBaseHeader, next);
    P_SIZE(XrEventDataSessionStateChanged);
    P_OFF(XrEventDataSessionStateChanged, type);
    P_OFF(XrEventDataSessionStateChanged, next);
    P_OFF(XrEventDataSessionStateChanged, session);
    P_OFF(XrEventDataSessionStateChanged, state);
    P_OFF(XrEventDataSessionStateChanged, time);
    P_SIZE(XrEventDataEventsLost);
    P_OFF(XrEventDataEventsLost, type);
    P_OFF(XrEventDataEventsLost, next);
    P_OFF(XrEventDataEventsLost, lostEventCount);
    P_SIZE(XrEventDataInstanceLossPending);
    P_OFF(XrEventDataInstanceLossPending, type);
    P_OFF(XrEventDataInstanceLossPending, next);
    P_OFF(XrEventDataInstanceLossPending, lossTime);
    P_SIZE(XrEventDataBuffer);
    P_OFF(XrEventDataBuffer, type);
    P_OFF(XrEventDataBuffer, next);
    P_OFF(XrEventDataBuffer, varying);

    /* ---- GLES / EGL platform structs ---- */
    P_SIZE(XrGraphicsBindingEGLMNDX);
    P_OFF(XrGraphicsBindingEGLMNDX, type);
    P_OFF(XrGraphicsBindingEGLMNDX, next);
    P_OFF(XrGraphicsBindingEGLMNDX, getProcAddress);
    P_OFF(XrGraphicsBindingEGLMNDX, display);
    P_OFF(XrGraphicsBindingEGLMNDX, config);
    P_OFF(XrGraphicsBindingEGLMNDX, context);
    P_SIZE(XrSwapchainImageOpenGLESKHR);
    P_OFF(XrSwapchainImageOpenGLESKHR, type);
    P_OFF(XrSwapchainImageOpenGLESKHR, next);
    P_OFF(XrSwapchainImageOpenGLESKHR, image);
    P_SIZE(XrGraphicsRequirementsOpenGLESKHR);
    P_OFF(XrGraphicsRequirementsOpenGLESKHR, type);
    P_OFF(XrGraphicsRequirementsOpenGLESKHR, next);
    P_OFF(XrGraphicsRequirementsOpenGLESKHR, minApiVersionSupported);
    P_OFF(XrGraphicsRequirementsOpenGLESKHR, maxApiVersionSupported);
    P_SIZE(XrGraphicsBindingVulkan2KHR);
    P_OFF(XrGraphicsBindingVulkan2KHR, type);
    P_OFF(XrGraphicsBindingVulkan2KHR, next);
    P_OFF(XrGraphicsBindingVulkan2KHR, instance);
    P_OFF(XrGraphicsBindingVulkan2KHR, physicalDevice);
    P_OFF(XrGraphicsBindingVulkan2KHR, device);
    P_OFF(XrGraphicsBindingVulkan2KHR, queueFamilyIndex);
    P_OFF(XrGraphicsBindingVulkan2KHR, queueIndex);
    P_SIZE(XrSwapchainImageVulkan2KHR);
    P_OFF(XrSwapchainImageVulkan2KHR, type);
    P_OFF(XrSwapchainImageVulkan2KHR, next);
    P_OFF(XrSwapchainImageVulkan2KHR, image);
    P_SIZE(XrGraphicsRequirementsVulkan2KHR);
    P_OFF(XrGraphicsRequirementsVulkan2KHR, type);
    P_OFF(XrGraphicsRequirementsVulkan2KHR, next);
    P_OFF(XrGraphicsRequirementsVulkan2KHR, minApiVersionSupported);
    P_OFF(XrGraphicsRequirementsVulkan2KHR, maxApiVersionSupported);

    /* ---- enum values ---- */
    P_I("XR_TYPE_UNKNOWN", XR_TYPE_UNKNOWN);
    P_I("XR_TYPE_API_LAYER_PROPERTIES", XR_TYPE_API_LAYER_PROPERTIES);
    P_I("XR_TYPE_EXTENSION_PROPERTIES", XR_TYPE_EXTENSION_PROPERTIES);
    P_I("XR_TYPE_INSTANCE_CREATE_INFO", XR_TYPE_INSTANCE_CREATE_INFO);
    P_I("XR_TYPE_SYSTEM_GET_INFO", XR_TYPE_SYSTEM_GET_INFO);
    P_I("XR_TYPE_SYSTEM_PROPERTIES", XR_TYPE_SYSTEM_PROPERTIES);
    P_I("XR_TYPE_VIEW_CONFIGURATION_VIEW", XR_TYPE_VIEW_CONFIGURATION_VIEW);
    P_I("XR_TYPE_SESSION_CREATE_INFO", XR_TYPE_SESSION_CREATE_INFO);
    P_I("XR_TYPE_SWAPCHAIN_CREATE_INFO", XR_TYPE_SWAPCHAIN_CREATE_INFO);
    P_I("XR_TYPE_SESSION_BEGIN_INFO", XR_TYPE_SESSION_BEGIN_INFO);
    P_I("XR_TYPE_VIEW_LOCATE_INFO", XR_TYPE_VIEW_LOCATE_INFO);
    P_I("XR_TYPE_VIEW_STATE", XR_TYPE_VIEW_STATE);
    P_I("XR_TYPE_FRAME_STATE", XR_TYPE_FRAME_STATE);
    P_I("XR_TYPE_FRAME_WAIT_INFO", XR_TYPE_FRAME_WAIT_INFO);
    P_I("XR_TYPE_FRAME_BEGIN_INFO", XR_TYPE_FRAME_BEGIN_INFO);
    P_I("XR_TYPE_FRAME_END_INFO", XR_TYPE_FRAME_END_INFO);
    P_I("XR_TYPE_COMPOSITION_LAYER_PROJECTION", XR_TYPE_COMPOSITION_LAYER_PROJECTION);
    P_I("XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW", XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW);
    P_I("XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED", XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED);
    P_I("XR_TYPE_EVENT_DATA_INSTANCE_LOSS_PENDING", XR_TYPE_EVENT_DATA_INSTANCE_LOSS_PENDING);
    P_I("XR_TYPE_EVENT_DATA_EVENTS_LOST", XR_TYPE_EVENT_DATA_EVENTS_LOST);
    P_I("XR_TYPE_EVENT_DATA_BUFFER", XR_TYPE_EVENT_DATA_BUFFER);
    P_I("XR_TYPE_INSTANCE_PROPERTIES", XR_TYPE_INSTANCE_PROPERTIES);
    P_I("XR_TYPE_REFERENCE_SPACE_CREATE_INFO", XR_TYPE_REFERENCE_SPACE_CREATE_INFO);
    P_I("XR_TYPE_VIEW", XR_TYPE_VIEW);
    P_I("XR_TYPE_SPACE_LOCATION", XR_TYPE_SPACE_LOCATION);
    P_I("XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_ES_KHR", XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_ES_KHR);
    P_I("XR_TYPE_GRAPHICS_BINDING_EGL_MNDX", XR_TYPE_GRAPHICS_BINDING_EGL_MNDX);
    P_I("XR_TYPE_GRAPHICS_REQUIREMENTS_OPENGL_ES_KHR", XR_TYPE_GRAPHICS_REQUIREMENTS_OPENGL_ES_KHR);
    P_I("XR_TYPE_GRAPHICS_BINDING_VULKAN2_KHR", XR_TYPE_GRAPHICS_BINDING_VULKAN2_KHR);
    P_I("XR_TYPE_SWAPCHAIN_IMAGE_VULKAN2_KHR", XR_TYPE_SWAPCHAIN_IMAGE_VULKAN2_KHR);
    P_I("XR_TYPE_GRAPHICS_REQUIREMENTS_VULKAN2_KHR", XR_TYPE_GRAPHICS_REQUIREMENTS_VULKAN2_KHR);
    P_I("XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO", XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO);
    P_I("XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO", XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO);
    P_I("XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO", XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO);

    P_I("XR_RESULT_SUCCESS", XR_SUCCESS);
    P_I("XR_RESULT_TIMEOUT_EXPIRED", XR_TIMEOUT_EXPIRED);
    P_I("XR_RESULT_SESSION_LOSS_PENDING", XR_SESSION_LOSS_PENDING);
    P_I("XR_RESULT_EVENT_UNAVAILABLE", XR_EVENT_UNAVAILABLE);
    P_I("XR_RESULT_SESSION_NOT_FOCUSED", XR_SESSION_NOT_FOCUSED);
    P_I("XR_RESULT_SPACE_BOUNDS_UNAVAILABLE", XR_SPACE_BOUNDS_UNAVAILABLE);
    P_I("XR_RESULT_REFERENCE_SPACE_UNSUPPORTED", XR_ERROR_REFERENCE_SPACE_UNSUPPORTED);
    P_I("XR_RESULT_FORM_FACTOR_UNSUPPORTED", XR_ERROR_FORM_FACTOR_UNSUPPORTED);
    P_I("XR_RESULT_FORM_FACTOR_UNAVAILABLE", XR_ERROR_FORM_FACTOR_UNAVAILABLE);
    P_I("XR_RESULT_RUNTIME_UNAVAILABLE", XR_ERROR_RUNTIME_UNAVAILABLE);
    P_I("XR_RESULT_OUT_OF_MEMORY", XR_ERROR_OUT_OF_MEMORY);
    P_I("XR_RESULT_API_VERSION_UNSUPPORTED", XR_ERROR_API_VERSION_UNSUPPORTED);
    P_I("XR_RESULT_INITIALIZATION_FAILED", XR_ERROR_INITIALIZATION_FAILED);
    P_I("XR_RESULT_FUNCTION_UNSUPPORTED", XR_ERROR_FUNCTION_UNSUPPORTED);
    P_I("XR_RESULT_FEATURE_UNSUPPORTED", XR_ERROR_FEATURE_UNSUPPORTED);
    P_I("XR_RESULT_EXTENSION_NOT_PRESENT", XR_ERROR_EXTENSION_NOT_PRESENT);
    P_I("XR_RESULT_LIMIT_REACHED", XR_ERROR_LIMIT_REACHED);
    P_I("XR_RESULT_SIZE_INSUFFICIENT", XR_ERROR_SIZE_INSUFFICIENT);
    P_I("XR_RESULT_HANDLE_INVALID", XR_ERROR_HANDLE_INVALID);
    P_I("XR_RESULT_INSTANCE_LOST", XR_ERROR_INSTANCE_LOST);
    P_I("XR_RESULT_RUNTIME_FAILURE", XR_ERROR_RUNTIME_FAILURE);
    P_I("XR_RESULT_PATH_UNSUPPORTED", XR_ERROR_PATH_UNSUPPORTED);
    P_I("XR_RESULT_SESSION_RUNNING", XR_ERROR_SESSION_RUNNING);
    P_I("XR_RESULT_SESSION_NOT_RUNNING", XR_ERROR_SESSION_NOT_RUNNING);
    P_I("XR_RESULT_SESSION_NOT_READY", XR_ERROR_SESSION_NOT_READY);
    P_I("XR_RESULT_SESSION_NOT_STOPPING", XR_ERROR_SESSION_NOT_STOPPING);
    P_I("XR_RESULT_TIME_INVALID", XR_ERROR_TIME_INVALID);
    P_I("XR_RESULT_SESSION_LOST", XR_ERROR_SESSION_LOST);
    P_I("XR_RESULT_LAYER_INVALID", XR_ERROR_LAYER_INVALID);
    P_I("XR_RESULT_SWAPCHAIN_RECT_INVALID", XR_ERROR_SWAPCHAIN_RECT_INVALID);
    P_I("XR_RESULT_SWAPCHAIN_FORMAT_UNSUPPORTED", XR_ERROR_SWAPCHAIN_FORMAT_UNSUPPORTED);
    P_I("XR_RESULT_GRAPHICS_DEVICE_INVALID", XR_ERROR_GRAPHICS_DEVICE_INVALID);
    P_I("XR_RESULT_GRAPHICS_REQUIREMENTS_CALL_MISSING", XR_ERROR_GRAPHICS_REQUIREMENTS_CALL_MISSING);

    P_I("XR_SESSION_STATE_UNKNOWN", XR_SESSION_STATE_UNKNOWN);
    P_I("XR_SESSION_STATE_IDLE", XR_SESSION_STATE_IDLE);
    P_I("XR_SESSION_STATE_READY", XR_SESSION_STATE_READY);
    P_I("XR_SESSION_STATE_SYNCHRONIZED", XR_SESSION_STATE_SYNCHRONIZED);
    P_I("XR_SESSION_STATE_VISIBLE", XR_SESSION_STATE_VISIBLE);
    P_I("XR_SESSION_STATE_FOCUSED", XR_SESSION_STATE_FOCUSED);
    P_I("XR_SESSION_STATE_STOPPING", XR_SESSION_STATE_STOPPING);
    P_I("XR_SESSION_STATE_EXITING", XR_SESSION_STATE_EXITING);
    P_I("XR_SESSION_STATE_LOSS_PENDING", XR_SESSION_STATE_LOSS_PENDING);

    P_I("XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY", XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY);
    P_I("XR_FORM_FACTOR_HANDHELD_DISPLAY", XR_FORM_FACTOR_HANDHELD_DISPLAY);

    P_I("XR_VIEW_CONFIGURATION_TYPE_PRIMARY_MONO", XR_VIEW_CONFIGURATION_TYPE_PRIMARY_MONO);
    P_I("XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO", XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO);

    P_I("XR_REFERENCE_SPACE_TYPE_VIEW", XR_REFERENCE_SPACE_TYPE_VIEW);
    P_I("XR_REFERENCE_SPACE_TYPE_LOCAL", XR_REFERENCE_SPACE_TYPE_LOCAL);
    P_I("XR_REFERENCE_SPACE_TYPE_STAGE", XR_REFERENCE_SPACE_TYPE_STAGE);

    P_I("XR_ENVIRONMENT_BLEND_MODE_OPAQUE", XR_ENVIRONMENT_BLEND_MODE_OPAQUE);
    P_I("XR_ENVIRONMENT_BLEND_MODE_ADDITIVE", XR_ENVIRONMENT_BLEND_MODE_ADDITIVE);
    P_I("XR_ENVIRONMENT_BLEND_MODE_ALPHA_BLEND", XR_ENVIRONMENT_BLEND_MODE_ALPHA_BLEND);

    /* ---- constants & flag bits (64-bit where applicable) ---- */
    P_L("XR_MAX_APPLICATION_NAME_SIZE", XR_MAX_APPLICATION_NAME_SIZE);
    P_L("XR_MAX_ENGINE_NAME_SIZE", XR_MAX_ENGINE_NAME_SIZE);
    P_L("XR_MAX_SYSTEM_NAME_SIZE", XR_MAX_SYSTEM_NAME_SIZE);
    P_L("XR_MAX_EXTENSION_NAME_SIZE", XR_MAX_EXTENSION_NAME_SIZE);
    P_L("XR_MAX_RESULT_STRING_SIZE", XR_MAX_RESULT_STRING_SIZE);
    P_L("XR_MAX_PATH_LENGTH", XR_MAX_PATH_LENGTH);
    P_L("XR_MAX_EVENT_DATA_SIZE", XR_MAX_EVENT_DATA_SIZE);
    P_L("XR_TRUE", XR_TRUE);
    P_L("XR_FALSE", XR_FALSE);
    P_L("XR_CURRENT_API_VERSION", XR_CURRENT_API_VERSION);
    P_L("XR_VERSION_1_0", XR_VERSION_1_0);

    P_L("XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT", XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT);
    P_L("XR_SWAPCHAIN_USAGE_TRANSFER_SRC_BIT", XR_SWAPCHAIN_USAGE_TRANSFER_SRC_BIT);
    P_L("XR_SWAPCHAIN_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT", XR_SWAPCHAIN_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT);
    P_L("XR_COMPOSITION_LAYER_CORRECT_CHROMATIC_ABERRATION_BIT", XR_COMPOSITION_LAYER_CORRECT_CHROMATIC_ABERRATION_BIT);
    P_L("XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT", XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT);
    P_L("XR_COMPOSITION_LAYER_UNPREMULTIPLIED_ALPHA_BIT", XR_COMPOSITION_LAYER_UNPREMULTIPLIED_ALPHA_BIT);

    P_L("XR_SPACE_LOCATION_ORIENTATION_VALID_BIT", XR_SPACE_LOCATION_ORIENTATION_VALID_BIT);
    P_L("XR_SPACE_LOCATION_POSITION_VALID_BIT", XR_SPACE_LOCATION_POSITION_VALID_BIT);
    P_L("XR_SPACE_LOCATION_ORIENTATION_TRACKED_BIT", XR_SPACE_LOCATION_ORIENTATION_TRACKED_BIT);
    P_L("XR_SPACE_LOCATION_POSITION_TRACKED_BIT", XR_SPACE_LOCATION_POSITION_TRACKED_BIT);

    P_L("XR_VIEW_STATE_ORIENTATION_VALID_BIT", XR_VIEW_STATE_ORIENTATION_VALID_BIT);
    P_L("XR_VIEW_STATE_POSITION_VALID_BIT", XR_VIEW_STATE_POSITION_VALID_BIT);

    /* ---- input / actions ---- */
    P_SIZE(XrVector2f);
    P_OFF(XrVector2f, x);
    P_OFF(XrVector2f, y);

    P_SIZE(XrActionSetCreateInfo);
    P_OFF(XrActionSetCreateInfo, type);
    P_OFF(XrActionSetCreateInfo, next);
    P_OFF(XrActionSetCreateInfo, actionSetName);
    P_OFF(XrActionSetCreateInfo, localizedActionSetName);
    P_OFF(XrActionSetCreateInfo, priority);

    P_SIZE(XrActionCreateInfo);
    P_OFF(XrActionCreateInfo, type);
    P_OFF(XrActionCreateInfo, next);
    P_OFF(XrActionCreateInfo, actionName);
    P_OFF(XrActionCreateInfo, actionType);
    P_OFF(XrActionCreateInfo, countSubactionPaths);
    P_OFF(XrActionCreateInfo, subactionPaths);
    P_OFF(XrActionCreateInfo, localizedActionName);

    P_SIZE(XrActionSuggestedBinding);
    P_OFF(XrActionSuggestedBinding, action);
    P_OFF(XrActionSuggestedBinding, binding);

    P_SIZE(XrInteractionProfileSuggestedBinding);
    P_OFF(XrInteractionProfileSuggestedBinding, type);
    P_OFF(XrInteractionProfileSuggestedBinding, next);
    P_OFF(XrInteractionProfileSuggestedBinding, interactionProfile);
    P_OFF(XrInteractionProfileSuggestedBinding, countSuggestedBindings);
    P_OFF(XrInteractionProfileSuggestedBinding, suggestedBindings);

    P_SIZE(XrSessionActionSetsAttachInfo);
    P_OFF(XrSessionActionSetsAttachInfo, type);
    P_OFF(XrSessionActionSetsAttachInfo, next);
    P_OFF(XrSessionActionSetsAttachInfo, countActionSets);
    P_OFF(XrSessionActionSetsAttachInfo, actionSets);

    P_SIZE(XrInteractionProfileState);
    P_OFF(XrInteractionProfileState, type);
    P_OFF(XrInteractionProfileState, next);
    P_OFF(XrInteractionProfileState, interactionProfile);

    P_SIZE(XrActionStateGetInfo);
    P_OFF(XrActionStateGetInfo, type);
    P_OFF(XrActionStateGetInfo, next);
    P_OFF(XrActionStateGetInfo, action);
    P_OFF(XrActionStateGetInfo, subactionPath);

    P_SIZE(XrActionStateBoolean);
    P_OFF(XrActionStateBoolean, type);
    P_OFF(XrActionStateBoolean, next);
    P_OFF(XrActionStateBoolean, currentState);
    P_OFF(XrActionStateBoolean, changedSinceLastSync);
    P_OFF(XrActionStateBoolean, lastChangeTime);
    P_OFF(XrActionStateBoolean, isActive);

    P_SIZE(XrActionStateFloat);
    P_OFF(XrActionStateFloat, type);
    P_OFF(XrActionStateFloat, next);
    P_OFF(XrActionStateFloat, currentState);
    P_OFF(XrActionStateFloat, changedSinceLastSync);
    P_OFF(XrActionStateFloat, lastChangeTime);
    P_OFF(XrActionStateFloat, isActive);

    P_SIZE(XrActionStateVector2f);
    P_OFF(XrActionStateVector2f, type);
    P_OFF(XrActionStateVector2f, next);
    P_OFF(XrActionStateVector2f, currentState);
    P_OFF(XrActionStateVector2f, changedSinceLastSync);
    P_OFF(XrActionStateVector2f, lastChangeTime);
    P_OFF(XrActionStateVector2f, isActive);

    P_SIZE(XrActionStatePose);
    P_OFF(XrActionStatePose, type);
    P_OFF(XrActionStatePose, next);
    P_OFF(XrActionStatePose, isActive);

    P_SIZE(XrActiveActionSet);
    P_OFF(XrActiveActionSet, actionSet);
    P_OFF(XrActiveActionSet, subactionPath);

    P_SIZE(XrActionsSyncInfo);
    P_OFF(XrActionsSyncInfo, type);
    P_OFF(XrActionsSyncInfo, next);
    P_OFF(XrActionsSyncInfo, countActiveActionSets);
    P_OFF(XrActionsSyncInfo, activeActionSets);

    P_SIZE(XrActionSpaceCreateInfo);
    P_OFF(XrActionSpaceCreateInfo, type);
    P_OFF(XrActionSpaceCreateInfo, next);
    P_OFF(XrActionSpaceCreateInfo, action);
    P_OFF(XrActionSpaceCreateInfo, subactionPath);
    P_OFF(XrActionSpaceCreateInfo, poseInActionSpace);

    P_SIZE(XrBoundSourcesForActionEnumerateInfo);
    P_OFF(XrBoundSourcesForActionEnumerateInfo, type);
    P_OFF(XrBoundSourcesForActionEnumerateInfo, next);
    P_OFF(XrBoundSourcesForActionEnumerateInfo, action);

    P_SIZE(XrInputSourceLocalizedNameGetInfo);
    P_OFF(XrInputSourceLocalizedNameGetInfo, type);
    P_OFF(XrInputSourceLocalizedNameGetInfo, next);
    P_OFF(XrInputSourceLocalizedNameGetInfo, sourcePath);
    P_OFF(XrInputSourceLocalizedNameGetInfo, whichComponents);

    P_SIZE(XrHapticActionInfo);
    P_OFF(XrHapticActionInfo, type);
    P_OFF(XrHapticActionInfo, next);
    P_OFF(XrHapticActionInfo, action);
    P_OFF(XrHapticActionInfo, subactionPath);

    P_SIZE(XrHapticBaseHeader);
    P_OFF(XrHapticBaseHeader, type);
    P_OFF(XrHapticBaseHeader, next);

    P_SIZE(XrHapticVibration);
    P_OFF(XrHapticVibration, type);
    P_OFF(XrHapticVibration, next);
    P_OFF(XrHapticVibration, duration);
    P_OFF(XrHapticVibration, frequency);
    P_OFF(XrHapticVibration, amplitude);

    P_I("XR_TYPE_ACTION_STATE_BOOLEAN", XR_TYPE_ACTION_STATE_BOOLEAN);
    P_I("XR_TYPE_ACTION_STATE_FLOAT", XR_TYPE_ACTION_STATE_FLOAT);
    P_I("XR_TYPE_ACTION_STATE_VECTOR2F", XR_TYPE_ACTION_STATE_VECTOR2F);
    P_I("XR_TYPE_ACTION_STATE_POSE", XR_TYPE_ACTION_STATE_POSE);
    P_I("XR_TYPE_ACTION_SET_CREATE_INFO", XR_TYPE_ACTION_SET_CREATE_INFO);
    P_I("XR_TYPE_ACTION_CREATE_INFO", XR_TYPE_ACTION_CREATE_INFO);
    P_I("XR_TYPE_ACTION_SPACE_CREATE_INFO", XR_TYPE_ACTION_SPACE_CREATE_INFO);
    P_I("XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING", XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING);
    P_I("XR_TYPE_EVENT_DATA_INTERACTION_PROFILE_CHANGED", XR_TYPE_EVENT_DATA_INTERACTION_PROFILE_CHANGED);
    P_I("XR_TYPE_INTERACTION_PROFILE_STATE", XR_TYPE_INTERACTION_PROFILE_STATE);
    P_I("XR_TYPE_ACTION_STATE_GET_INFO", XR_TYPE_ACTION_STATE_GET_INFO);
    P_I("XR_TYPE_HAPTIC_ACTION_INFO", XR_TYPE_HAPTIC_ACTION_INFO);
    P_I("XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO", XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO);
    P_I("XR_TYPE_ACTIONS_SYNC_INFO", XR_TYPE_ACTIONS_SYNC_INFO);
    P_I("XR_TYPE_BOUND_SOURCES_FOR_ACTION_ENUMERATE_INFO", XR_TYPE_BOUND_SOURCES_FOR_ACTION_ENUMERATE_INFO);
    P_I("XR_TYPE_INPUT_SOURCE_LOCALIZED_NAME_GET_INFO", XR_TYPE_INPUT_SOURCE_LOCALIZED_NAME_GET_INFO);
    P_I("XR_TYPE_HAPTIC_VIBRATION", XR_TYPE_HAPTIC_VIBRATION);

    P_I("XR_ACTION_TYPE_BOOLEAN_INPUT", XR_ACTION_TYPE_BOOLEAN_INPUT);
    P_I("XR_ACTION_TYPE_FLOAT_INPUT", XR_ACTION_TYPE_FLOAT_INPUT);
    P_I("XR_ACTION_TYPE_VECTOR2F_INPUT", XR_ACTION_TYPE_VECTOR2F_INPUT);
    P_I("XR_ACTION_TYPE_POSE_INPUT", XR_ACTION_TYPE_POSE_INPUT);
    P_I("XR_ACTION_TYPE_VIBRATION_OUTPUT", XR_ACTION_TYPE_VIBRATION_OUTPUT);

    P_L("XR_NULL_PATH", XR_NULL_PATH);
    P_L("XR_MAX_ACTION_SET_NAME_SIZE", XR_MAX_ACTION_SET_NAME_SIZE);
    P_L("XR_MAX_LOCALIZED_ACTION_SET_NAME_SIZE", XR_MAX_LOCALIZED_ACTION_SET_NAME_SIZE);
    P_L("XR_MAX_ACTION_NAME_SIZE", XR_MAX_ACTION_NAME_SIZE);
    P_L("XR_MAX_LOCALIZED_ACTION_NAME_SIZE", XR_MAX_LOCALIZED_ACTION_NAME_SIZE);
    P_L("XR_INPUT_SOURCE_LOCALIZED_NAME_USER_PATH_BIT", XR_INPUT_SOURCE_LOCALIZED_NAME_USER_PATH_BIT);
    P_L("XR_INPUT_SOURCE_LOCALIZED_NAME_INTERACTION_PROFILE_BIT", XR_INPUT_SOURCE_LOCALIZED_NAME_INTERACTION_PROFILE_BIT);
    P_L("XR_INPUT_SOURCE_LOCALIZED_NAME_COMPONENT_BIT", XR_INPUT_SOURCE_LOCALIZED_NAME_COMPONENT_BIT);

    return 0;
}
