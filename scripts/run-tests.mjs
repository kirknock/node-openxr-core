#!/usr/bin/env node
/**
 * Test runner (bin: nodexr-test), shared by every nodexr package and app.
 * Runs the smoke scripts of the repo it is started in (each a standalone
 * program that prints PASS/FAIL and exits non-zero on failure), grouped by
 * what they need from the machine:
 *
 *   pure  — IWER + Babylon NullEngine only; runs anywhere
 *   gl    — a GLES 3 EGL context (llvmpipe ok)
 *   xr    — a live OpenXR runtime (Monado null HMD on the dev VM;
 *           XR_RUNTIME_JSON as for the app)
 *   webgpu — the patched Dawn package (nodexr-dawn), a Vulkan device and a
 *           live OpenXR runtime; only on request, not part of "all"
 *
 * Usage: nodexr-test [pure|gl|xr|webgpu|all ...]   (default: all)
 *
 * The groups come from tests/groups.mjs in the current directory:
 *   export const GROUPS = { pure: ["tests/x-smoke.ts", ...], ... };
 * An entry is a tsx command line, or { label, args, check(out) } where check
 * returns null (pass), { detail } (pass) or a failure reason string.
 *
 * The application is deliberately not run here: it is only ever run by
 * hand, on the target machine.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tsx = join(root, "node_modules", ".bin", "tsx");
const { GROUPS } = await import(pathToFileURL(join(root, "tests", "groups.mjs")).href);
const ON_REQUEST = ["webgpu"];
const ALL = ["pure", "gl", "xr", "webgpu"];

function run(args, env) {
  const started = Date.now();
  const res = spawnSync(tsx, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 10 * 60_000,
    maxBuffer: 64 << 20,
  });
  return { ...res, seconds: ((Date.now() - started) / 1000).toFixed(1) };
}

function lastLine(text) {
  const lines = (text ?? "").trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

const requested = process.argv.slice(2);
const groups = requested.length === 0 || requested.includes("all") ? ALL.filter((g) => !ON_REQUEST.includes(g)) : requested;
for (const g of groups) {
  if (!ALL.includes(g)) {
    console.error(`unknown group "${g}" (pure | gl | xr | webgpu | all)`);
    process.exit(2);
  }
}

const failures = [];
for (const group of groups) {
  const tests = GROUPS[group] ?? [];
  if (tests.length === 0) continue;
  console.log(`\n== ${group}`);
  for (const test of tests) {
    if (typeof test === "object") {
      const res = run(test.args, test.env ?? {});
      const out = `${res.stdout}\n${res.stderr}`;
      const verdict = res.status !== 0 ? `exit ${res.status}` : test.check(out);
      const label = test.label.padEnd(46);
      if (verdict === null || typeof verdict === "object") {
        console.log(`PASS ${label} ${res.seconds}s  ${verdict?.detail ?? ""}`);
      } else {
        console.log(`FAIL ${label} ${res.seconds}s  ${verdict}`);
        failures.push({ test: test.label, output: out });
      }
      continue;
    }
    const res = run(test.split(" "), {});
    const ok = res.status === 0;
    console.log(`${ok ? "PASS" : "FAIL"} ${test.padEnd(46)} ${res.seconds}s  ${lastLine(res.stdout || res.stderr)}`);
    if (!ok) failures.push({ test, output: `${res.stdout}\n${res.stderr}` });
  }
}

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`\n---- ${f.test} (last 30 lines) ----\n${f.output.trim().split("\n").slice(-30).join("\n")}`);
  }
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nALL PASSED");
