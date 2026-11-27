/**
 * Host-side OpenXR diagnostics (Phase 2 gate check).
 *
 * Walks the loader bootstrap chain against the live runtime:
 *   XR_RUNTIME_JSON -> manifest -> loader -> xrCreateInstance
 *   -> runtime identity -> system -> view configurations
 * No graphics, no session — purely instance-level.
 */
import {
  bootstrapOpenXrLoader,
  createXrInstance,
  enumerateInstanceExtensions,
  getRuntimeInfo,
  xrCheck,
  xrResultName,
  type XrHandle,
} from "../xr/xr-loader.js";
import { xrSplitVersion } from "../xr/xr-abi.js";
import * as gen from "../xr/generated/xr-abi.gen.js";

const {
  XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY,
  XR_TYPE_SYSTEM_GET_INFO,
  XR_TYPE_SYSTEM_PROPERTIES,
  XR_TYPE_VIEW_CONFIGURATION_VIEW,
  XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
} = gen;

function fmtVersion(v: number): string {
  const { major, minor, patch } = xrSplitVersion(v);
  return `${major}.${minor}.${patch}`;
}

function main(): void {
  console.log("== OpenXR probe (instance level) ==");

  const bootstrap = bootstrapOpenXrLoader();

  // 1. Extensions advertised by the selected runtime.
  const extensions = enumerateInstanceExtensions(bootstrap);
  console.log(`\n[probe] runtime advertises ${extensions.length} instance extensions:`);
  for (const name of extensions) {
    console.log(`  - ${name}`);
  }
  const interesting = [
    "XR_KHR_opengl_es_enable",
    "XR_MNDX_egl_enable",
    "XR_MND_headless",
    "XR_KHR_vulkan_enable",
  ];
  console.log("[probe] graphics-relevant extensions:");
  for (const name of interesting) {
    console.log(`  ${extensions.includes(name) ? "[x]" : "[ ]"} ${name}`);
  }

  // 2. Instance + runtime identity.
  const xr: XrHandle = createXrInstance({
    applicationName: "node-openxr-probe",
    extensions: [],
    bootstrap,
  });
  try {
    const runtime = getRuntimeInfo(xr);
    console.log(
      `\n[probe] runtime identity: "${runtime.name}" version ${fmtVersion(runtime.version)}`,
    );

    // 3. System for the HMD form factor.
    const systemOut = [0];
    const sysRes = xr.fn.xrGetSystem(
      xr.raw,
      { type: XR_TYPE_SYSTEM_GET_INFO, next: null, formFactor: XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY },
      systemOut,
    );
    if (sysRes !== 0) {
      console.log(`[probe] xrGetSystem(HMD): ${xrResultName(sysRes)} — no HMD system available`);
      return;
    }
    const systemId = systemOut[0];
    console.log(`[probe] systemId = ${systemId}`);

    const sysProps: Record<string, unknown> = { type: XR_TYPE_SYSTEM_PROPERTIES, next: null };
    xrCheck(
      xr.fn.xrGetSystemProperties(xr.raw, systemId, sysProps),
      "xrGetSystemProperties",
    );
    const gfx = sysProps.graphicsProperties as Record<string, number>;
    const tracking = sysProps.trackingProperties as Record<string, number>;
    console.log(`[probe] system name     : ${String(sysProps.systemName)}`);
    console.log(`[probe] max swapchain    : ${gfx.maxSwapchainImageWidth}x${gfx.maxSwapchainImageHeight}`);
    console.log(`[probe] max layer count  : ${gfx.maxLayerCount}`);
    console.log(
      `[probe] tracking         : orientation=${tracking.orientationTracking === 1} position=${tracking.positionTracking === 1}`,
    );

    // 4. View configurations.
    const cfgCount = [0];
    xrCheck(
      xr.fn.xrEnumerateViewConfigurations(xr.raw, systemId, 0, cfgCount, null),
      "xrEnumerateViewConfigurations(count)",
    );
    const cfgs = new Int32Array(cfgCount[0]);
    xrCheck(
      xr.fn.xrEnumerateViewConfigurations(xr.raw, systemId, cfgCount[0], cfgCount, cfgs),
      "xrEnumerateViewConfigurations",
    );
    console.log(`[probe] view configurations: ${cfgs.length}`);
    for (const cfg of cfgs) {
      const label = cfg === XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO ? " (PRIMARY_STEREO)" : "";
      console.log(`  - ${cfg}${label}`);
    }

    // 5. Stereo view details (per-eye image sizes from the null HMD).
    const viewCountOut = [0];
    xrCheck(
      xr.fn.xrEnumerateViewConfigurationViews(
        xr.raw,
        systemId,
        XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
        0,
        viewCountOut,
        null,
      ),
      "xrEnumerateViewConfigurationViews(count)",
    );
    const viewCount = viewCountOut[0];
    const views: Array<Record<string, unknown>> = Array.from({ length: viewCount }, () => ({
      type: XR_TYPE_VIEW_CONFIGURATION_VIEW,
      next: null,
    }));
    xrCheck(
      xr.fn.xrEnumerateViewConfigurationViews(
        xr.raw,
        systemId,
        XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
        viewCount,
        viewCountOut,
        views,
      ),
      "xrEnumerateViewConfigurationViews",
    );
    console.log(`[probe] stereo views: ${viewCount}`);
    views.forEach((v, i) => {
      console.log(
        `  eye ${i}: recommended ${v.recommendedImageRectWidth}x${v.recommendedImageRectHeight}` +
          `, max ${v.maxImageRectWidth}x${v.maxImageRectHeight}` +
          `, samples ${v.recommendedSwapchainSampleCount}`,
      );
    });

    // 6. Environment blend modes (needed later for xrBeginSession/xrEndFrame).
    const blendCount = [0];
    xrCheck(
      xr.fn.xrEnumerateEnvironmentBlendModes(
        xr.raw,
        systemId,
        XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
        0,
        blendCount,
        null,
      ),
      "xrEnumerateEnvironmentBlendModes(count)",
    );
    const modes = new Int32Array(blendCount[0]);
    xrCheck(
      xr.fn.xrEnumerateEnvironmentBlendModes(
        xr.raw,
        systemId,
        XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
        blendCount[0],
        blendCount,
        modes,
      ),
      "xrEnumerateEnvironmentBlendModes",
    );
    const modeNames: Record<number, string> = {
      [gen.XR_ENVIRONMENT_BLEND_MODE_OPAQUE]: "OPAQUE",
      [gen.XR_ENVIRONMENT_BLEND_MODE_ADDITIVE]: "ADDITIVE",
      [gen.XR_ENVIRONMENT_BLEND_MODE_ALPHA_BLEND]: "ALPHA_BLEND",
    };
    console.log(
      `[probe] blend modes: ${Array.from(modes, (m) => modeNames[m] ?? m).join(", ")}`,
    );
  } finally {
    xr.destroy();
    console.log("\n[probe] instance destroyed — PROBE OK");
  }
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error("[probe] FAILED:", err);
  process.exit(1);
}
