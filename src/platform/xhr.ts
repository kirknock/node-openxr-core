/**
 * XMLHttpRequest for the platform, as a browser page has it. Babylon loads
 * through it (WebRequest / FileTools): snippet-server materials, glTF and
 * texture URLs, .env files. http(s) goes through Node's fetch and the local
 * mirror (mirror.ts — works offline, per XR_NET); file: URLs
 * and relative paths (resolved against the process cwd, the "page") are read
 * from disk (a missing one answers 404); a local directory answers with a JSON index the way a web
 * server's directory index does (nginx `autoindex_format json`:
 * [{"name","type":"file"|"directory","mtime","size"?}], sorted by name).
 * Covers the surface Babylon uses: open/send/abort,
 * setRequestHeader, responseType (""|"text"|"json"|"arraybuffer"|"blob"),
 * response/responseText/responseURL, status/statusText/readyState,
 * getResponseHeader/getAllResponseHeaders, timeout, on* handlers and
 * add/removeEventListener for readystatechange/load/error/progress/
 * loadend/abort/timeout.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { fetchRemote, RemoteTimeoutError } from "./mirror.js";

type Listener = (event: { type: string; target: unknown; loaded?: number; total?: number; lengthComputable?: boolean }) => void;

export class NodeXMLHttpRequest {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readyState = 0;
  status = 0;
  statusText = "";
  responseType: "" | "text" | "json" | "arraybuffer" | "blob" | "document" = "";
  response: unknown = null;
  responseURL = "";
  timeout = 0;
  withCredentials = false;
  onreadystatechange: Listener | null = null;
  onload: Listener | null = null;
  onerror: Listener | null = null;
  onprogress: Listener | null = null;
  onloadend: Listener | null = null;
  onabort: Listener | null = null;
  ontimeout: Listener | null = null;

  private method = "GET";
  private url = "";
  private readonly headers: Record<string, string> = {};
  private responseHeaders = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private controller: AbortController | null = null;

  get responseText(): string {
    if (this.responseType !== "" && this.responseType !== "text") {
      throw new Error(`responseText is unavailable for responseType "${this.responseType}"`);
    }
    return typeof this.response === "string" ? this.response : "";
  }

  open(method: string, url: string | URL): void {
    this.method = method.toUpperCase();
    this.url = String(url);
    this.readyState = 1;
    this.emit("readystatechange");
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders.get(name.toLowerCase()) ?? null;
  }

  getAllResponseHeaders(): string {
    return [...this.responseHeaders].map(([k, v]) => `${k}: ${v}\r\n`).join("");
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  abort(): void {
    this.controller?.abort();
    this.finish("abort");
  }

  send(body?: unknown): void {
    void this.perform(body);
  }

  private async perform(body: unknown): Promise<void> {
    const target = resolveUrl(this.url);
    this.responseURL = target.href;
    try {
      let bytes: Uint8Array;
      if (target.protocol === "file:") {
        const path = fileURLToPath(target);
        const info = await stat(path).catch((err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
          throw err;
        });
        if (info === null) {
          // As a web server answers: 404 (a load, not a network error).
          bytes = new Uint8Array(0);
          this.status = 404;
          this.statusText = "Not Found";
        } else {
          if (info.isDirectory()) {
            bytes = new TextEncoder().encode(JSON.stringify(await directoryIndex(path)));
            this.responseHeaders = new Map([["content-type", "application/json"]]);
          } else {
            bytes = await readFile(path);
          }
          this.status = 200;
          this.statusText = "OK";
        }
      } else {
        // http(s): network and/or the local mirror, per XR_NET (mirror.ts).
        this.controller = new AbortController();
        const res = await fetchRemote(target, {
          method: this.method,
          headers: this.headers,
          body: body as RequestInit["body"],
          timeoutMs: this.timeout,
          signal: this.controller.signal,
        });
        this.status = res.status;
        this.statusText = res.statusText;
        this.responseHeaders = res.headers;
        bytes = res.bytes;
      }
      this.readyState = 2;
      this.emit("readystatechange");
      this.readyState = 3;
      this.emit("readystatechange");
      this.emit("progress", { loaded: bytes.byteLength, total: bytes.byteLength, lengthComputable: true });
      this.response = decodeResponse(bytes, this.responseType);
      this.finish("load");
    } catch (err) {
      if (this.controller?.signal.aborted === true && this.readyState === 4) return; // aborted by us
      const timedOut = err instanceof RemoteTimeoutError;
      this.status = 0;
      this.statusText = err instanceof Error ? err.message : String(err);
      this.finish(timedOut ? "timeout" : "error");
    }
  }

  /** readyState DONE + the terminal event + loadend. */
  private finish(kind: "load" | "error" | "abort" | "timeout"): void {
    this.readyState = 4;
    this.emit("readystatechange");
    this.emit(kind);
    this.emit("loadend");
  }

  private emit(type: string, extra: { loaded?: number; total?: number; lengthComputable?: boolean } = {}): void {
    const event = { type, target: this, ...extra };
    const handler = (this as unknown as Record<string, Listener | null>)[`on${type}`];
    handler?.call(this, event);
    for (const listener of this.listeners.get(type) ?? []) listener.call(this, event);
  }
}

interface DirectoryEntry {
  name: string;
  type: "file" | "directory";
  mtime: string;
  size?: number;
}

/** A web server's JSON directory index (nginx autoindex_format json). Symlinks are followed; broken ones skipped. */
async function directoryIndex(dir: string): Promise<DirectoryEntry[]> {
  const entries: DirectoryEntry[] = [];
  for (const name of (await readdir(dir)).sort((a, b) => a.localeCompare(b))) {
    const info = await stat(join(dir, name)).catch(() => null);
    if (info === null) continue;
    const mtime = info.mtime.toUTCString();
    if (info.isDirectory()) entries.push({ name, type: "directory", mtime });
    else if (info.isFile()) entries.push({ name, type: "file", mtime, size: info.size });
  }
  return entries;
}

/** Absolute URLs as-is; anything else is a path relative to the cwd. */
function resolveUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    return new URL(url, pathToFileURL(`${process.cwd()}/`));
  }
}

function decodeResponse(bytes: Uint8Array, type: NodeXMLHttpRequest["responseType"]): unknown {
  switch (type) {
    case "arraybuffer":
      // No copy when the bytes are the whole buffer: 20 MB of GLB is 10 ms on the main thread.
      if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    case "blob":
      return new Blob([bytes]);
    case "json":
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    default:
      return new TextDecoder().decode(bytes);
  }
}

/** Installs XMLHttpRequest globally (unless the host already has one). */
export function installXmlHttpRequest(): void {
  const G = globalThis as Record<string, unknown>;
  G.XMLHttpRequest ??= NodeXMLHttpRequest;
}
