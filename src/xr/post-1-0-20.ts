/**
 * OpenXR values newer than the vendored 1.0.20 headers.
 *
 * The vendored headers deliberately match the installed loader
 * (libopenxr_loader 1.0.20), so generated/xr-abi.gen.ts only knows 1.0.20.
 * Everything this app uses from later spec versions is declared here — one
 * place, each with its registry source — instead of inline magic numbers.
 * The instance stays at apiVersion 1.0; these are extension values (or core
 * 1.1 values that equal their 1.0 extension aliases).
 *
 * Enum value rule: 1_000_000_000 + (extension_number - 1) * 1000 + offset.
 */

/** XR_REFERENCE_SPACE_TYPE_LOCAL_FLOOR_EXT (XR_EXT_local_floor, extension
 *  #427; core XR_REFERENCE_SPACE_TYPE_LOCAL_FLOOR in 1.1, same value).
 *  Valid on a 1.0 instance only with XR_EXT_local_floor enabled. */
export const XR_REFERENCE_SPACE_TYPE_LOCAL_FLOOR_EXT = 1000426000;

/** XR_TYPE_PASSTHROUGH_CREATE_INFO_FB (XR_FB_passthrough, extension #119,
 *  offset 1). The struct itself (XrPassthroughCreateInfoFB: type, next,
 *  flags) is hand-declared in xr-abi.ts. */
export const XR_TYPE_PASSTHROUGH_CREATE_INFO_FB = 1000118001;

