/**
 * Remote-content mirror smoke (platform/mirror.ts through the platform's
 * XMLHttpRequest) against a local HTTP server — no internet needed.
 *
 *   auto:    network first + write-through; a newer server version wins
 *            over the mirror; 404 passes through (not mirrored); 5xx, a
 *            hanging server (short fallback timeout) and a dead server all
 *            fall back to the mirror copy
 *   offline: mirror only (a missing copy is an error, no network attempted)
 *   online:  network only (server down = error even with a mirror copy)
 *   paths:   "%2E%2E" segments cannot escape the mirror directory
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeXMLHttpRequest } from "../src/platform/xhr.js";
import { configureMirror, mirrorPath } from "../src/platform/mirror.js";

function fail(msg: string): never {
  console.error(`MIRROR SMOKE: FAIL (${msg})`);
  process.exit(1);
}

let version = 1;
let mode: "ok" | "error" | "hang" = "ok";
let hits = 0;
const server: Server = createServer((req, res) => {
  hits++;
  if (req.url === "/missing") {
    res.writeHead(404).end("nope");
  } else if (mode === "error") {
    res.writeHead(500).end("boom");
  } else if (mode === "hang") {
    // never answers
  } else {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ v: version }));
  }
});

interface Outcome {
  event: string;
  status: number;
  text: string;
}

function get(url: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const xhr = new NodeXMLHttpRequest();
    xhr.addEventListener("loadend", () => {
      resolve({ event: xhr.status === 0 ? "error" : "load", status: xhr.status, text: xhr.status === 0 ? "" : xhr.responseText });
    });
    xhr.open("GET", url);
    xhr.send();
  });
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "mirror-smoke-"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const dataUrl = `${base}/data/a.json`;
  const copyFile = mirrorPath(new URL(dataUrl), dir);
  configureMirror({ mode: "auto", dir, fallbackTimeoutMs: 400 });

  // auto: network first, written through.
  let r = await get(dataUrl);
  if (r.status !== 200 || r.text !== '{"v":1}') fail(`first fetch: ${JSON.stringify(r)}`);
  if (!existsSync(copyFile) || readFileSync(copyFile, "utf8") !== '{"v":1}') fail("not written through to the mirror");
  version = 2;
  r = await get(dataUrl);
  if (r.text !== '{"v":2}' || readFileSync(copyFile, "utf8") !== '{"v":2}') fail("newer server version did not win / update the mirror");
  // Concurrent requests for one URL (Babylon issues some twice): both
  // write-throughs must succeed (unique temp files) — no failure logged.
  version = 3;
  let writeFailures = 0;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes("mirror write failed")) writeFailures++;
    warn(...args);
  };
  const [c1, c2] = await Promise.all([get(dataUrl), get(dataUrl)]);
  console.warn = warn;
  if (c1.text !== '{"v":3}' || c2.text !== '{"v":3}' || readFileSync(copyFile, "utf8") !== '{"v":3}') fail("concurrent write-through failed");
  if (writeFailures > 0) fail(`concurrent write-through logged ${writeFailures} write failure(s)`);
  version = 2;
  r = await get(dataUrl);
  r = await get(`${base}/missing`);
  if (r.status !== 404 || existsSync(mirrorPath(new URL(`${base}/missing`), dir))) fail("404 must pass through, unmirrored");
  console.log("[smoke] auto: network first, write-through, newer version wins, 404 passes through");

  // auto fallbacks: 5xx, hang (short timeout), dead server.
  mode = "error";
  r = await get(dataUrl);
  if (r.status !== 200 || r.text !== '{"v":2}') fail(`5xx did not fall back to the mirror: ${JSON.stringify(r)}`);
  mode = "hang";
  const t0 = Date.now();
  r = await get(dataUrl);
  const waited = Date.now() - t0;
  if (r.text !== '{"v":2}' || waited > 2000) fail(`hang did not fall back promptly (${waited} ms): ${JSON.stringify(r)}`);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  r = await get(dataUrl);
  if (r.text !== '{"v":2}') fail(`dead server did not fall back: ${JSON.stringify(r)}`);
  console.log(`[smoke] auto fallbacks: 5xx, hang (${waited} ms), server down -> mirror copy`);

  // offline: mirror only, no network attempt.
  configureMirror({ mode: "offline" });
  const hitsBefore = hits;
  r = await get(dataUrl);
  if (r.text !== '{"v":2}' || hits !== hitsBefore) fail("offline must serve the mirror without touching the network");
  r = await get(`${base}/not-mirrored`);
  if (r.event !== "error") fail("offline + no mirror copy must be an error");
  console.log("[smoke] offline: mirror only; missing copy = error");

  // online: network only.
  configureMirror({ mode: "online" });
  r = await get(dataUrl);
  if (r.event !== "error") fail("online + server down must be an error (mirror ignored)");
  console.log("[smoke] online: network only (mirror ignored)");

  // No traversal out of the mirror.
  const sneaky = mirrorPath(new URL("http://h/a/%2E%2E/%2E%2E/%2E%2E/etc/passwd?x=../y"), dir);
  if (!sneaky.startsWith(join(dir, "h"))) fail(`path escapes the mirror: ${sneaky}`);
  console.log(`[smoke] traversal-safe path: ${sneaky.slice(dir.length)}`);

  rmSync(dir, { recursive: true, force: true });
  console.log("MIRROR SMOKE: PASS");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  fail("exception");
});
