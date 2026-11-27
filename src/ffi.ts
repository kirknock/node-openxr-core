/** koffi helpers shared by the native bindings (OpenXR, GLES, EGL). */
import koffi from "koffi";

// koffi type names are process-global: registering a named prototype twice
// throws, so every prototype goes through this cache.
const protoCache = new Map<string, ReturnType<typeof koffi.proto>>();

/** The koffi prototype for a C declaration, registered once per process. */
export function cachedProto(declaration: string): ReturnType<typeof koffi.proto> {
  let proto = protoCache.get(declaration);
  if (proto === undefined) {
    proto = koffi.proto(declaration);
    protoCache.set(declaration, proto);
  }
  return proto;
}
