/**
 * Worker thread of image-decode-pool.ts: decodes one encoded image per
 * message (any format decodeImage reads) and transfers the RGBA8 pixels back.
 */
import { parentPort } from "node:worker_threads";
import { decodeImage, flipImage } from "./image-polyfill.js";
import type { DecodeReply, DecodeRequest } from "./image-decode-pool.js";

const port = parentPort!;

port.on("message", ({ bytes, flipY }: DecodeRequest) => {
  let reply: DecodeReply;
  const transfer: ArrayBuffer[] = [];
  try {
    let image = decodeImage(bytes);
    if (flipY) image = flipImage(image);
    const pixels = new Uint8Array(image.buffer, image.byteOffset, image.length);
    transfer.push(pixels.buffer);
    reply = { pixels, width: image.width, height: image.height };
  } catch (err) {
    reply = { error: err instanceof Error ? err.message : String(err) };
  }
  port.postMessage(reply, transfer);
});
