/**
 * Local mirror for remote (http/https) content the app or Babylon fetches —
 * e.g. snippet-server materials — so the same requests work online and
 * offline without changing app code. Used by the platform's XMLHttpRequest.
 *
 * A remote URL maps to `<dir>/<host>/<path>` (dir: `mirror/` in the working
 * directory, i.e. the package root). Policy (XR_NET, see config.ts):
 *
 *   auto     network first; a successful GET is written through to the
 *            mirror; on a network error, timeout or 5xx the mirror copy is
 *            served (logged once per URL with its date). With a mirror
 *            copy present the network gets a short timeout before falling
 *            back. HTTP errors the server meant (4xx) pass through.
 *   offline  mirror only — a missing copy is a network error
 *   online   network only — the mirror is neither read nor written
 *
 * Only GET requests are mirrored; others always go to the network
 * (online/auto) or fail (offline). Fill the mirror by running online, or
 * explicitly with `npm run mirror:prefetch` (mirror/urls.txt).
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logger } from "../log.js";

const platformLog = logger("platform");

export type NetMode = "auto" | "offline" | "online";

export interface MirrorOptions {
  mode: NetMode;
  /** Mirror root directory. */
  dir: string;
  /** Network timeout (ms) in auto mode when a mirror copy exists. */
  fallbackTimeoutMs: number;
}

let options: MirrorOptions = { mode: "auto", dir: join(process.cwd(), "mirror"), fallbackTimeoutMs: 2000 };

export function configureMirror(update: Partial<MirrorOptions>): void {
  options = { ...options, ...update };
}

export function mirrorOptions(): Readonly<MirrorOptions> {
  return options;
}

/**
 * The mirror file for an http(s) URL: <dir>/<host[_port]>/<path segments>,
 * "index" for a trailing slash, the query appended to the last segment.
 * Segments are percent-encoded to safe file names; "." and ".." are
 * dropped (no traversal out of the mirror).
 */
export function mirrorPath(url: URL, dir = options.dir): string {
  const decode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const host = url.port === "" ? url.hostname : `${url.hostname}_${url.port}`;
  // Decode first, THEN drop "."/"..": "%2E%2E" must not become a traversal.
  const segments = url.pathname
    .split("/")
    .map(decode)
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .map((s) => encodeURIComponent(s));
  if (segments.length === 0 || url.pathname.endsWith("/")) segments.push("index");
  if (url.search !== "") segments[segments.length - 1] += `__q${encodeURIComponent(decode(url.search.slice(1)))}`;
  return join(dir, host.toLowerCase(), ...segments);
}

/** The mirror copy of `url`, or null. */
export async function readMirror(url: URL): Promise<{ bytes: Uint8Array; modified: Date } | null> {
  const file = mirrorPath(url);
  try {
    const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
    return { bytes, modified: info.mtime };
  } catch {
    return null;
  }
}

let tmpCounter = 0;

/** Stores `bytes` as the mirror copy of `url` (atomic: temp file + rename). */
export async function writeMirror(url: URL, bytes: Uint8Array): Promise<void> {
  const file = mirrorPath(url);
  await mkdir(dirname(file), { recursive: true });
  // Unique per write: concurrent requests for the same URL (Babylon issues
  // some twice) must not share — and rename away — one temp file.
  const tmp = `${file}.tmp-${process.pid}-${++tmpCounter}`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
}

export interface RemoteResponse {
  status: number;
  statusText: string;
  headers: Map<string, string>;
  bytes: Uint8Array;
}

export interface RemoteRequest {
  method: string;
  headers: Record<string, string>;
  body?: RequestInit["body"];
  /** The caller's own timeout (0 = none). */
  timeoutMs: number;
  /** The caller's abort signal (XMLHttpRequest.abort). */
  signal: AbortSignal;
}

/** Thrown when the request timed out (caller's timeout) without a fallback. */
export class RemoteTimeoutError extends Error {
  constructor(url: URL) {
    super(`request timed out: ${url.href}`);
    this.name = "RemoteTimeoutError";
  }
}

const announced = new Set<string>();

function fromMirror(url: URL, copy: { bytes: Uint8Array; modified: Date }, why: string): RemoteResponse {
  if (!announced.has(url.href)) {
    announced.add(url.href);
    platformLog.info(`${why}: served ${url.href} from mirror (${copy.modified.toISOString().slice(0, 10)})`);
  }
  return { status: 200, statusText: "OK (mirror)", headers: new Map(), bytes: copy.bytes };
}

/** Fetches an http(s) URL under the mirror policy (see module comment). */
export async function fetchRemote(url: URL, request: RemoteRequest): Promise<RemoteResponse> {
  const mirrored = request.method === "GET" && options.mode !== "online";
  if (options.mode === "offline") {
    const copy = mirrored ? await readMirror(url) : null;
    if (copy === null) throw new Error(`offline (XR_NET=offline): ${url.href} is not in the mirror`);
    return fromMirror(url, copy, "offline");
  }

  const copy = mirrored ? await readMirror(url) : null;
  const timeouts = [request.timeoutMs, copy !== null ? options.fallbackTimeoutMs : 0].filter((t) => t > 0);
  const timeoutMs = timeouts.length > 0 ? Math.min(...timeouts) : 0;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  request.signal.addEventListener("abort", onAbort);
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { method: request.method, headers: request.headers, body: request.body, signal: controller.signal });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (copy !== null && res.status >= 500) return fromMirror(url, copy, `server error ${res.status}`);
    if (mirrored && res.ok) {
      await writeMirror(url, bytes).catch((err: unknown) => platformLog.warn(`mirror write failed for ${url.href}:`, err));
    }
    return {
      status: res.status,
      statusText: res.statusText,
      headers: new Map([...res.headers].map(([k, v]) => [k.toLowerCase(), v])),
      bytes,
    };
  } catch (err) {
    if (request.signal.aborted) throw err; // the caller aborted: no fallback
    if (copy !== null) return fromMirror(url, copy, controller.signal.aborted ? "network timeout" : "network unavailable");
    if (controller.signal.aborted) throw new RemoteTimeoutError(url);
    throw err;
  } finally {
    if (timer !== null) clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
  }
}
