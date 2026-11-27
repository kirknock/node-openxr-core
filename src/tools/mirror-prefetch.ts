/**
 * Fills the local mirror (platform/mirror.ts) with the remote URLs listed in
 * mirror/urls.txt (one per line, # comments), straight from the network, so
 * a package works offline from its first run. Existing copies are kept when
 * a fetch fails. Run by apps/demo-app/scripts/package.sh; also: npm run mirror:prefetch.
 *
 * A Babylon scene file (*.babylon) brings the files it references along
 * (platform/scene-references.ts): its textures and sounds are fetched too,
 * from its copy when the scene itself could not be refreshed.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mirrorOptions, mirrorPath, readMirror, writeMirror } from "../platform/mirror.js";
import { babylonSceneReferences } from "../platform/scene-references.js";

const listFile = join(mirrorOptions().dir, "urls.txt");

async function main(): Promise<void> {
  const urls = (await readFile(listFile, "utf8"))
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line !== "");
  let failed = 0;
  let fetched = 0;
  const queue = urls.map((href) => ({ url: new URL(href), from: "" }));
  const seen = new Set(queue.map((item) => item.url.href));
  while (queue.length > 0) {
    const { url, from } = queue.shift()!;
    const href = url.href;
    let bytes: Uint8Array | null = null;
    try {
      // Scene files run to tens of MB.
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      bytes = new Uint8Array(await res.arrayBuffer());
      await writeMirror(url, bytes);
      fetched++;
      console.log(`[mirror] ok      ${href}${from} (${bytes.byteLength} bytes) -> ${mirrorPath(url)}`);
    } catch (err) {
      failed++;
      const copy = await readMirror(url);
      bytes = copy?.bytes ?? null;
      const kept = copy !== null ? `kept copy from ${copy.modified.toISOString().slice(0, 10)}` : "NO local copy";
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const why = `${err instanceof Error ? err.message : String(err)}${cause !== undefined ? ` (${cause.code ?? cause.message})` : ""}`;
      console.log(`[mirror] FAILED  ${href}${from}: ${why} — ${kept}`);
    }
    if (bytes !== null && url.pathname.endsWith(".babylon")) {
      let references: URL[] = [];
      try {
        references = babylonSceneReferences(JSON.parse(new TextDecoder().decode(bytes)), url);
      } catch (err) {
        console.log(`[mirror] FAILED  ${href}: not a readable scene file (${err instanceof Error ? err.message : String(err)})`);
      }
      const name = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
      for (const reference of references) {
        if (seen.has(reference.href)) continue;
        seen.add(reference.href);
        queue.push({ url: reference, from: ` (from ${name})` });
      }
    }
  }
  console.log(`[mirror] ${fetched}/${seen.size} fetched`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("[mirror] FAILED:", err);
  process.exit(1);
});
