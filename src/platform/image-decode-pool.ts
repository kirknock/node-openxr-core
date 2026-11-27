/**
 * Decodes images on worker threads, because a decode on the main thread
 * stops the frame loop: jpeg-js and the PNG decoder are plain JavaScript
 * (about 300 ms for a 2048x2048 JPEG), and an asset brings several textures
 * at once. Workers hold the event loop only while they have a job, so they
 * never keep the process alive.
 *
 * A worker that dies (or cannot start) fails its job with
 * ImageDecodeWorkerError; the caller still has the bytes and decodes them
 * itself.
 */
import { availableParallelism } from "node:os";
import { extname } from "node:path";
import { Worker } from "node:worker_threads";
import { logger } from "../log.js";

const renderLog = logger("render");

/** Leaves cores to the frame loop and the compositor running beside it. */
const MAX_WORKERS = 3;

export interface DecodeRequest {
  bytes: Uint8Array;
  flipY: boolean;
}

export type DecodeReply = { pixels: Uint8Array; width: number; height: number } | { error: string };

export interface DecodedPixels {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/** The pool could not run the job (as opposed to an image that does not decode). */
export class ImageDecodeWorkerError extends Error {}

interface Job extends DecodeRequest {
  resolve(result: DecodedPixels): void;
  reject(err: Error): void;
}

interface PoolWorker {
  worker: Worker;
  job: Job | null;
}

const queue: Job[] = [];
const idle: PoolWorker[] = [];
let workers: PoolWorker[] | null = null;

function spawn(url: URL): PoolWorker {
  const entry: PoolWorker = { worker: new Worker(url), job: null };
  entry.worker.on("message", (reply: DecodeReply) => {
    const job = entry.job!;
    entry.job = null;
    entry.worker.unref();
    idle.push(entry);
    if ("error" in reply) job.reject(new Error(reply.error));
    else job.resolve(reply);
    dispatch();
  });
  entry.worker.on("error", (err: unknown) => {
    renderLog.warn("image decode worker failed:", err);
  });
  entry.worker.on("exit", () => {
    workers = workers!.filter((w) => w !== entry);
    const index = idle.indexOf(entry);
    if (index !== -1) idle.splice(index, 1);
    entry.job?.reject(new ImageDecodeWorkerError("image decode worker exited"));
    if (workers.length > 0) return;
    for (const job of queue.splice(0)) job.reject(new ImageDecodeWorkerError("no image decode workers left"));
  });
  entry.worker.unref();
  return entry;
}

/** Starts the workers (idempotent); call before the frame loop, as spawning takes the main thread a moment. */
export function startImageDecodeWorkers(): void {
  if (workers !== null) return;
  // The sibling module as it exists here: .ts under tsx, .js in dist/.
  const url = new URL(`./image-decode-worker${extname(import.meta.url)}`, import.meta.url);
  const count = Math.max(1, Math.min(MAX_WORKERS, availableParallelism() - 1));
  workers = Array.from({ length: count }, () => spawn(url));
  idle.push(...workers);
}

function dispatch(): void {
  while (queue.length > 0 && idle.length > 0) {
    const entry = idle.shift()!;
    const job = queue.shift()!;
    entry.job = job;
    entry.worker.ref();
    const request: DecodeRequest = { bytes: job.bytes, flipY: job.flipY };
    entry.worker.postMessage(request, [job.bytes.buffer as ArrayBuffer]);
  }
}

/** Decodes encoded image bytes to RGBA8 off the main thread; `bytes` stays usable. */
export function decodeOnWorker(bytes: Uint8Array, flipY: boolean): Promise<DecodedPixels> {
  startImageDecodeWorkers();
  if (workers!.length === 0) return Promise.reject(new ImageDecodeWorkerError("no image decode workers left"));
  // An own copy: posting a view would clone its whole buffer (a texture's
  // view spans the entire GLB), and transferring it would detach that buffer.
  const copy = new Uint8Array(bytes);
  return new Promise((resolve, reject) => {
    queue.push({ bytes: copy, flipY, resolve, reject });
    dispatch();
  });
}
