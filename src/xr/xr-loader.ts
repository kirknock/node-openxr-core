/**
 * OpenXR loader bootstrap.
 *
 * Runtime selection follows the canonical OpenXR mechanism: the
 * XR_RUNTIME_JSON environment variable names the runtime manifest
 * (JSON) whose runtime.library_path points at the runtime shared
 * library (Monado here). The loader itself also honors XR_RUNTIME_JSON,
 * so we validate the manifest first, export the variable, then dlopen
 * libopenxr_loader.so.1 — both sides agree on the selected runtime.
 */
import koffi from "koffi";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import {
  XR_BOOTSTRAP_FNS,
  resolveXrFunctions,
  verifyAbi,
  xrMakeVersion,
  type XrFn,
  type XrFunctionTable,
} from "./xr-abi.js";
import * as gen from "./generated/xr-abi.gen.js";
import { cachedProto } from "../ffi.js";
import { logger } from "../log.js";

const xrLog = logger("xr");

const { XR_RESULT_SUCCESS, XR_TYPE_INSTANCE_CREATE_INFO } = gen;

export const DEFAULT_XR_RUNTIME_JSON = "/usr/share/openxr/1/openxr_monado.json";
export const OPENXR_LOADER_SONAME = "libopenxr_loader.so.1";

export interface RuntimeManifest {
  manifestPath: string;
  libraryPath: string;
  source: "XR_RUNTIME_JSON" | "default";
}

export interface XrHandle {
  /** Opaque native instance handle — pass back into FFI functions. */
  readonly raw: unknown;
  readonly fn: XrFunctionTable;
  readonly manifest: RuntimeManifest;
  readonly enabledExtensions: string[];
  destroy(): void;
}

interface RuntimeManifestJson {
  file_format_version?: string;
  runtime?: { library_path?: string };
}

/** Symbolic name for an XrResult value (best effort, from generated table). */
const RESULT_NAMES: Record<number, string> = {};
for (const [key, value] of Object.entries(gen)) {
  if (key.startsWith("XR_RESULT_") && typeof value === "number") {
    RESULT_NAMES[value] = key.replace("XR_RESULT_", "XR_");
  }
}

export function xrResultName(result: number): string {
  return RESULT_NAMES[result] ?? `XrResult(${result})`;
}

/** Throws unless result is one of the acceptable codes. */
export function xrCheck(result: number, call: string, ...ok: number[]): void {
  if (result === XR_RESULT_SUCCESS || ok.includes(result)) return;
  throw new Error(`${call} failed: ${xrResultName(result)} (${result})`);
}

function selectedManifestPath(): { manifestPath: string; fromEnv: boolean } {
  const fromEnv = process.env.XR_RUNTIME_JSON !== undefined;
  return { manifestPath: fromEnv ? process.env.XR_RUNTIME_JSON! : DEFAULT_XR_RUNTIME_JSON, fromEnv };
}

/** The loader resolves a relative library_path against the manifest's directory. */
function manifestLibraryPath(manifestPath: string, libraryPath: string): string {
  return path.isAbsolute(libraryPath) ? libraryPath : path.resolve(path.dirname(path.resolve(manifestPath)), libraryPath);
}

/**
 * The manifest the loader will use and the runtime library it names, resolved
 * as resolveRuntimeManifest does, for reports: never throws, checks nothing
 * and sets nothing (libraryPath is null when the manifest cannot be read).
 */
export function describeRuntimeManifest(): { manifestPath: string; libraryPath: string | null } {
  const { manifestPath } = selectedManifestPath();
  try {
    const raw = (JSON.parse(readFileSync(manifestPath, "utf8")) as RuntimeManifestJson).runtime?.library_path;
    return { manifestPath, libraryPath: typeof raw === "string" && raw.length > 0 ? manifestLibraryPath(manifestPath, raw) : null };
  } catch {
    return { manifestPath, libraryPath: null };
  }
}

/**
 * Resolves and validates the runtime manifest selected by XR_RUNTIME_JSON.
 * Exports the variable so the OpenXR loader discovers the same runtime.
 */
export function resolveRuntimeManifest(): RuntimeManifest {
  const { manifestPath, fromEnv } = selectedManifestPath();

  if (!fromEnv) {
    xrLog.warn(
      `XR_RUNTIME_JSON is not set; defaulting to ${manifestPath}. ` +
        "Export it explicitly for a deterministic runtime choice.",
    );
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`OpenXR runtime manifest not found: ${manifestPath}`);
  }

  let parsed: RuntimeManifestJson;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as RuntimeManifestJson;
  } catch (err) {
    throw new Error(`Invalid runtime manifest JSON (${manifestPath}): ${(err as Error).message}`);
  }
  const libraryPathRaw = parsed.runtime?.library_path;
  if (typeof libraryPathRaw !== "string" || libraryPathRaw.length === 0) {
    throw new Error(`Runtime manifest ${manifestPath} has no runtime.library_path`);
  }

  const libraryPath = manifestLibraryPath(manifestPath, libraryPathRaw);

  if (!existsSync(libraryPath)) {
    throw new Error(
      `Runtime library from manifest does not exist: ${libraryPath} (manifest: ${manifestPath})`,
    );
  }

  // Make sure the loader and this process agree on the selected runtime.
  process.env.XR_RUNTIME_JSON = manifestPath;

  return { manifestPath, libraryPath, source: fromEnv ? "XR_RUNTIME_JSON" : "default" };
}

export interface LoaderBootstrap {
  manifest: RuntimeManifest;
  xrGetInstanceProcAddr: XrFn;
  /** Function table for loader-level calls (pre-instance). */
  loaderFns: XrFunctionTable;
}

/** Validates the manifest, dlopens the loader, resolves loader-level fns. */
export function bootstrapOpenXrLoader(): LoaderBootstrap {
  const manifest = resolveRuntimeManifest();
  verifyAbi();

  xrLog.info(
    `runtime manifest : ${manifest.manifestPath} (${manifest.source})\n` +
      `[xr] runtime library  : ${manifest.libraryPath}\n` +
      `[xr] openxr loader    : ${OPENXR_LOADER_SONAME}`,
  );

  const lib = koffi.load(OPENXR_LOADER_SONAME);
  const xrGetInstanceProcAddr = lib.func(
    "int32_t xrGetInstanceProcAddr(void *instance, const char *name, _Out_ void **function)",
  ) as XrFn;

  // With instance=NULL only the bootstrap set is resolvable.
  const loaderFns = resolveXrFunctions(xrGetInstanceProcAddr, null, XR_BOOTSTRAP_FNS);
  return { manifest, xrGetInstanceProcAddr, loaderFns };
}

/**
 * One function outside the shared table, by its C declaration: an extension
 * function of one graphics API, or one whose signature depends on it
 * (xrEnumerateSwapchainImages takes the API's image struct). Throws if the
 * runtime does not offer it.
 */
export function resolveXrFunction(bootstrap: LoaderBootstrap, instance: unknown, name: string, declaration: string): XrFn {
  const out = [null];
  xrCheck(bootstrap.xrGetInstanceProcAddr(instance, name, out), `xrGetInstanceProcAddr(${name})`);
  return koffi.decode(out[0], cachedProto(declaration)) as XrFn;
}

function resolveTable(xrGetInstanceProcAddr: XrFn, instance: unknown): XrFunctionTable {
  return resolveXrFunctions(xrGetInstanceProcAddr, instance);
}

export interface CreateInstanceOptions {
  applicationName: string;
  engineName?: string;
  extensions: string[];
  /** Manifest override; defaults to resolveRuntimeManifest(). */
  bootstrap?: LoaderBootstrap;
}

/** Creates an XrInstance with the requested extensions (fatal if missing). */
export function createXrInstance(options: CreateInstanceOptions): XrHandle {
  const bootstrap = options.bootstrap ?? bootstrapOpenXrLoader();
  const { xrGetInstanceProcAddr } = bootstrap;
  // Only xrCreateInstance is resolvable before the instance exists.
  const pre = resolveXrFunctions(xrGetInstanceProcAddr, null, ["xrCreateInstance"]);

  const createInfo = {
    type: XR_TYPE_INSTANCE_CREATE_INFO,
    next: null,
    createFlags: 0,
    applicationInfo: {
      applicationName: options.applicationName,
      applicationVersion: 0,
      engineName: options.engineName ?? "node-openxr",
      engineVersion: 0,
      apiVersion: xrMakeVersion(1, 0, 0),
    },
    enabledApiLayerCount: 0,
    enabledApiLayerNames: null,
    enabledExtensionCount: options.extensions.length,
    enabledExtensionNames: options.extensions,
  };

  const instanceOut = [null];
  const result = pre.xrCreateInstance(createInfo, instanceOut);
  xrCheck(result, "xrCreateInstance");
  const instance = instanceOut[0];

  const fn = resolveTable(xrGetInstanceProcAddr, instance);
  return {
    raw: instance,
    fn,
    manifest: bootstrap.manifest,
    enabledExtensions: options.extensions,
    destroy() {
      const res = fn.xrDestroyInstance(instance);
      xrCheck(res, "xrDestroyInstance");
    },
  };
}

export interface RuntimeInfo {
  name: string;
  version: number;
}

/** Fetches runtime identity via xrGetInstanceProperties (e.g. "Monado"). */
export function getRuntimeInfo(xr: XrHandle): RuntimeInfo {
  // Out-struct: koffi fills in runtimeName / runtimeVersion after the call.
  const props: Record<string, unknown> = { type: gen.XR_TYPE_INSTANCE_PROPERTIES, next: null };
  const res = xr.fn.xrGetInstanceProperties(xr.raw, props);
  xrCheck(res, "xrGetInstanceProperties");
  return {
    name: String(props.runtimeName),
    version: Number(props.runtimeVersion),
  };
}

/** Lists all extensions advertised by the selected runtime (via the loader). */
export function enumerateInstanceExtensions(bootstrap: LoaderBootstrap): string[] {
  const countOut = [0];
  let res = bootstrap.loaderFns.xrEnumerateInstanceExtensionProperties(
    null,
    0,
    countOut,
    null,
  );
  xrCheck(res, "xrEnumerateInstanceExtensionProperties(count)");
  const count = countOut[0];
  if (count === 0) return [];

  const props: Array<Record<string, unknown>> = Array.from({ length: count }, () => ({
    type: gen.XR_TYPE_EXTENSION_PROPERTIES,
    next: null,
  }));
  res = bootstrap.loaderFns.xrEnumerateInstanceExtensionProperties(
    null,
    count,
    countOut,
    props,
  );
  xrCheck(res, "xrEnumerateInstanceExtensionProperties");
  return props.map((p) => String(p.extensionName));
}
