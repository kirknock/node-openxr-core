/**
 * Browser-environment shims required by IWER (the Immersive Web Emulation
 * Runtime) inside plain Node.js. No real DOM/WebGL exists here — IWER only
 * touches a small, well-known surface, which we satisfy with inert stubs:
 *
 *  - document (createElement/body.appendChild for the canvas container path)
 *  - window (innerWidth/innerHeight read on baseLayer set)
 *  - WebGL2RenderingContext / WebGLRenderingContext (bare classes; IWER
 *    references the identifier unguarded during installRuntime)
 *  - requestAnimationFrame/cancelAnimationFrame pump that WE own and drain
 *    from the native OpenXR frame loop (IWER's session rAF self-reschedules
 *    through the global each frame)
 *  - a duck-typed fake-GL context object for the mandatory XRWebGLLayer
 *    (IWER requires a baseLayer before delivering frames; it only calls a
 *    handful of no-op-able methods on it)
 */
import { debugLogger } from "../log.js";

const pumpDebugLog = debugLogger("input", "pump:debug");

export interface RafPump {
  /** Drains all queued rAF callbacks once (one "frame"). */
  pump(timeMs?: number): void;
  /** Number of currently queued callbacks. */
  readonly pending: number;
}

type RafCallback = (time: number) => void;

export function installRafPump(): RafPump {
  const callbacks = new Map<number, RafCallback>();
  let nextId = 1;
  let pumpDebugCount = 0;
  const globals = globalThis as {
    requestAnimationFrame?: unknown;
    cancelAnimationFrame?: unknown;
  };

  globals.requestAnimationFrame = (cb: RafCallback): number => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  };

  globals.cancelAnimationFrame = (handle: number): void => {
    callbacks.delete(handle);
  };

  return {
    pump(timeMs?: number): void {
      const time = timeMs ?? performance.now();
      const queued = [...callbacks.entries()];
      callbacks.clear();
      // IWER re-schedules itself inside each callback via the global rAF;
      // clearing first means re-queues land in the next pump.
      if (pumpDebugLog.enabled && queued.length > 0 && pumpDebugCount < 5) {
        pumpDebugCount++;
        pumpDebugLog.info(
          `#${pumpDebugCount} draining ${queued.length}: ` +
            queued.map(([, cb]) => cb.name || "anonymous").join(","),
        );
      }
      for (const [, cb] of queued) {
        cb(time);
      }
    },
    get pending(): number {
      return callbacks.size;
    },
  };
}

/** Fake HTMLCanvasElement-ish object for IWER's baseLayer reparenting path. */
export interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  dataset: Record<string, string>;
  parentElement: unknown;
  appendChild(child: unknown): void;
  removeChild(child: unknown): void;
}

export function createFakeCanvas(width = 512, height = 512): FakeCanvas {
  return {
    width,
    height,
    style: {},
    dataset: {},
    parentElement: null,
    appendChild(): void {
      /* no-op */
    },
    removeChild(): void {
      /* no-op */
    },
  };
}

/**
 * Duck-typed WebGL context for `new XRWebGLLayer(session, context)`.
 * IWER reads drawingBufferWidth/Height, queries a few clear-state enums and
 * calls clear()/deleteTexture on the session frame path — all inert here.
 */
export function createFakeGlContext(width = 1344, height = 1512): Record<string, unknown> {
  const canvas = createFakeCanvas(width, height);
  return {
    canvas,
    drawingBufferWidth: width,
    drawingBufferHeight: height,
    COLOR_CLEAR_VALUE: 0x0D22,
    DEPTH_CLEAR_VALUE: 0x0B73,
    STENCIL_CLEAR_VALUE: 0x0B91,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    STENCIL_BUFFER_BIT: 0x0400,
    getParameter(): number {
      return 0;
    },
    clearColor(): void {
      /* no-op */
    },
    clearDepth(): void {
      /* no-op */
    },
    clearStencil(): void {
      /* no-op */
    },
    clear(): void {
      /* no-op */
    },
    deleteTexture(): void {
      /* no-op */
    },
  };
}

/** Installs the document/window/WebGL-class stubs IWER needs. */
export function installIwerEnvShims(): void {
  const globals = globalThis as unknown as Record<string, unknown>;

  if (globals.document === undefined) {
    globals.document = {
      createElement(_tag: string): FakeCanvas {
        // Only reached for the canvas-container/visibility-mask paths; an
        // inert element suffices.
        return createFakeCanvas(1, 1);
      },
      body: {
        appendChild(): void {
          /* no-op */
        },
        removeChild(): void {
          /* no-op */
        },
      },
      addEventListener(): void {
        /* no-op */
      },
      removeEventListener(): void {
        /* no-op */
      },
      dispatchEvent(): boolean {
        return true;
      },
    };
  }
  if (globals.window === undefined) {
    // A real EventTarget satisfies IWER's session-end event dispatch.
    globals.window = Object.assign(new EventTarget(), {
      innerWidth: 1344,
      innerHeight: 1512,
    });
  }
  // IWER references these identifiers unguarded in installRuntime
  // (XRDevice.installRuntime does getOwnPropertyDescriptor(navigator, "xr")).
  // navigator only exists as a global from Node 21+ — older runtimes need it.
  globals.navigator ??= {
    userAgent: "node-openxr",
    hardwareConcurrency: 1,
    language: "en-US",
    languages: ["en-US"],
    maxTouchPoints: 0,
  };
  globals.WebGL2RenderingContext ??= class WebGL2RenderingContext {};
  globals.WebGLRenderingContext ??= class WebGLRenderingContext {};
  globals.DOMException ??= class DOMException extends Error {};
  // Babylon's simulated XR pointer events (InputManager.simulatePointer*)
  // construct real PointerEvents; Node has Event but not PointerEvent.
  // Duck-typed: fields copied from the init dict the caller passes.
  globals.PointerEvent ??= class PointerEvent extends Event {
    pointerId = 0;
    pointerType = "";
    button = 0;
    buttons = 0;
    clientX = 0;
    clientY = 0;
    pageX = 0;
    pageY = 0;
    screenX = 0;
    screenY = 0;
    movementX = 0;
    movementY = 0;
    pressure = 0;
    isPrimary = true;
    constructor(type: string, init?: Record<string, unknown>) {
      super(type, { bubbles: true });
      if (init !== undefined) Object.assign(this, init);
    }
  };
  // XRRigidTransform's position/orientation are DOMPointReadOnly.
  globals.DOMPointReadOnly ??= class DOMPointReadOnly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
    }
  };
  // XRSession ctor recovers persistent anchors through localStorage.
  // Node 26 defines a warning getter for it unless --localstorage-file is
  // given, so check the flag and replace the property instead of reading it.
  const nodeStorageFile = [...process.execArgv, process.env.NODE_OPTIONS ?? ""].some((a) => a.includes("--localstorage-file"));
  const existing = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  if (!nodeStorageFile && (existing === undefined || existing.get !== undefined)) {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true, enumerable: true });
  }
}
