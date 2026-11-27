/**
 * Hardware/environment capability report — one human-readable block plus a
 * single-line JSON form (XR_ENV_JSON=... on stdout) so logs from target
 * machines can be collected and diffed easily. Data is filled in
 * progressively as components initialize (static -> GL -> OpenXR).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import type { AppProfile } from "./profile.js";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { logger, rawLog } from "./log.js";
import { describeRuntimeManifest } from "./xr/xr-loader.js";

const mainLog = logger("main");

export interface EnvReportData {
  /** Build identity (package version + git rev) so target logs are
   *  self-describing — a stale deployment is visible at a glance. */
  build: string;
  profile: AppProfile;
  cpuModel: string;
  drmRenderNodes: string[];
  xrRuntimeJson: string;
  runtimeLibrary: string | null;
  gl?:
    | {
        platform: string;
        vendor: string;
        renderer: string;
        version: string;
        software: boolean;
      }
    | { error: string };
  openxr?:
    | {
        runtimeName: string;
        runtimeVersion: string;
        systemName?: string;
        eyeRecommended?: string;
        eyeMax?: string;
        instanceExtensions?: string;
        refreshRatesHz?: number[];
        blendModes?: number[];
        blendModeActive?: number;
      }
    | { error: string };
}

let identity: string | undefined;

/**
 * Build identity of the APP being run, from its STAMPED BINARY (build.json
 * written at build time next to the app's entry script, e.g. dist/main.js),
 * with staleness detection against the live checkout. A runtime
 * `git rev-parse` alone reports the checkout, not the compiled dist — an
 * updated checkout with an unrebuilt dist would otherwise masquerade as the
 * new build. Computed once (it runs git) and remembered.
 */
export function buildIdentity(): string {
  identity ??= computeBuildIdentity();
  return identity;
}

function computeBuildIdentity(): string {
  // The app's entry script, not this module: nodexr-core is a library every
  // app installs, and its own location says nothing about the app. Its root
  // is the nearest folder with a package.json (dist/main.js, src/main.ts and
  // src/tools/*.ts alike).
  const entryDir = dirname(resolve(process.argv[1] ?? "."));
  let root = entryDir;
  while (!existsSync(join(root, "package.json")) && dirname(root) !== root) root = dirname(root);
  let pkgVersion = "?";
  try {
    pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
  } catch {
    // packaged layout without package.json
  }

  // Prefer the stamp next to the entry script (dist/ for compiled runs),
  // then the root's (source/tsx runs).
  let stamp: { rev?: string; dirty?: boolean; builtAt?: string } | null = null;
  for (const dir of [entryDir, root]) {
    try {
      stamp = JSON.parse(readFileSync(join(dir, "build.json"), "utf8"));
      break;
    } catch {
      // no stamp there
    }
  }

  // Compare against the app's OWN checkout only: a package (scripts/
  // package.sh) is not tracked by git, and git would otherwise walk up into
  // whatever repository it was unpacked in (apps/demo-app/out/ included).
  let checkoutRev = "unknown";
  try {
    execSync("git ls-files --error-unmatch package.json", { cwd: root, stdio: "ignore" });
    checkoutRev = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // not a git checkout
  }

  if (stamp?.rev !== undefined && stamp.rev !== "unknown" && checkoutRev !== "unknown" && stamp.rev !== checkoutRev) {
    mainLog.warn(`STALE BUILD: binary is ${stamp.rev} but the checkout is ${checkoutRev} — rerun npm run build`);
    return `v${pkgVersion} (binary ${stamp.rev}, checkout ${checkoutRev} — STALE)`;
  }
  const rev = (stamp?.rev ?? checkoutRev) + (stamp?.dirty === true ? "+dirty" : "");
  // Full timestamp (to the minute): uncommitted work keeps the rev fixed,
  // and a date-only stamp cannot tell same-day builds apart.
  const age = stamp?.builtAt ? `, built ${stamp.builtAt.slice(0, 16).replace("T", " ")}Z` : "";
  return `v${pkgVersion} (git ${rev}${age}${checkoutRev === "unknown" ? ", packaged" : ""})`;
}

export function collectStaticData(profile: AppProfile): EnvReportData {
  let drmRenderNodes: string[] = [];
  try {
    drmRenderNodes = readdirSync("/dev/dri").filter((n) => n.startsWith("render"));
  } catch {
    drmRenderNodes = [];
  }

  const { manifestPath, libraryPath: runtimeLibrary } = describeRuntimeManifest();

  return {
    build: buildIdentity(),
    profile,
    cpuModel: cpus()[0]?.model ?? "unknown",
    drmRenderNodes,
    xrRuntimeJson: manifestPath,
    runtimeLibrary,
  };
}

export function printEnvReport(data: EnvReportData): void {
  const lines: string[] = [];
  lines.push("== environment report ==");
  lines.push(`build          : ${data.build}`);
  lines.push(`profile        : ${data.profile.requested} -> ${data.profile.mode} (renderScale=${data.profile.renderScale}, timing=${data.profile.timing})`);
  lines.push(`cpu            : ${data.cpuModel}`);
  lines.push(`drm nodes      : ${data.drmRenderNodes.join(", ") || "none"}`);
  lines.push(`xr manifest    : ${data.xrRuntimeJson} -> ${data.runtimeLibrary ?? "?"}`);
  if (data.gl !== undefined) {
    const g = data.gl;
    lines.push(
      "gl/egl         : " +
        ("error" in g
          ? `ERROR ${g.error}`
          : `${g.platform} vendor=${g.vendor} renderer=${g.renderer}${g.software ? " (SOFTWARE)" : ""} version=${g.version}`),
    );
  }
  if (data.openxr !== undefined) {
    const x = data.openxr;
    lines.push(
      "openxr         : " +
        ("error" in x
          ? `ERROR ${x.error}`
          : `${x.runtimeName} ${x.runtimeVersion}` +
            (x.systemName ? ` system="${x.systemName}"` : "") +
            (x.eyeRecommended ? ` eyes(recommended)=${x.eyeRecommended}` : "") +
            (x.blendModes ? ` blend=[${x.blendModes.join(",")}] active=${x.blendModeActive}` : "") +
            (x.eyeMax ? ` max=${x.eyeMax}` : "") +
            (x.refreshRatesHz ? ` refreshHz=[${x.refreshRatesHz.join(",")}]` : "")),
    );
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("XR_")) {
      lines.push(`env ${key.padEnd(14)}: ${process.env[key]}`);
    }
  }
  rawLog(lines.join("\n"));
  rawLog(`XR_ENV_JSON=${JSON.stringify(data)}`);
}
