/**
 * Duck-typed canvas + document shims for running Babylon's engines headless,
 * on any renderer. Babylon must get a canvas (not a bare context) because
 * Engine._CommonInit hooks focus/blur/contextmenu/pointerout events, and it
 * obtains the context via canvas.getContext(type, options).
 */

export interface HeadlessCanvas {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  style: Record<string, string>;
  dataset: Record<string, string>;
  tabIndex: number;
  parentElement: unknown;
  ownerDocument: unknown;
  getContext(type: string, _options?: unknown): unknown;
  addEventListener(_type: string, _listener: unknown): void;
  removeEventListener(_type: string, _listener: unknown): void;
  getBoundingClientRect(): DOMRectLike;
  focus(): void;
  blur(): void;
  appendChild(_child: unknown): void;
  removeChild(_child: unknown): void;
}

export interface DOMRectLike {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** `getContext` answers the canvas's getContext(type): the renderer's context, or null. */
export function createHeadlessCanvas(width: number, height: number, getContext: (type: string) => unknown): HeadlessCanvas {
  const rect = { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height };
  const canvas: HeadlessCanvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    dataset: {},
    tabIndex: 0,
    parentElement: null,
    ownerDocument: null,
    getContext,
    addEventListener(): void {
      /* no-op — no DOM event source headless */
    },
    removeEventListener(): void {
      /* no-op */
    },
    getBoundingClientRect: () => ({ ...rect }),
    focus(): void {
      /* no-op */
    },
    blur(): void {
      /* no-op */
    },
    appendChild(): void {
      /* no-op */
    },
    removeChild(): void {
      /* no-op */
    },
  };
  canvas.ownerDocument = documentShim();
  return canvas;
}

let cachedDocument: Record<string, unknown> | null = null;

/**
 * Minimal document stub for Babylon's fullscreen/pointerlock listeners in
 * Engine._CommonInit. Co-exists with IWER's richer shims: if a document
 * already exists (IWER installed first), missing methods are patched onto
 * it instead of replacing it.
 */
export function documentShim(): Record<string, unknown> {
  if (cachedDocument !== null) return cachedDocument;
  const existing = (globalThis as Record<string, unknown>).document as
    | Record<string, unknown>
    | undefined;
  if (existing !== undefined) {
    existing.addEventListener ??= () => {};
    existing.removeEventListener ??= () => {};
    existing.createElement ??= () => createCanvasStub();
    existing.documentElement ??= { style: {} };
    existing.body = documentBody(existing.body as Record<string, unknown> | undefined);
    existing.fullscreenElement ??= null;
    existing.pointerLockElement ??= null;
    cachedDocument = existing;
    return existing;
  }
  const doc: Record<string, unknown> = {
    addEventListener(): void {
      /* no-op */
    },
    removeEventListener(): void {
      /* no-op */
    },
    createElement(): unknown {
      return createCanvasStub();
    },
    documentElement: { style: {} },
    body: documentBody(undefined),
    fullscreenElement: null,
    pointerLockElement: null,
    elementFromPoint: () => null,
  };
  (globalThis as Record<string, unknown>).document = doc;
  cachedDocument = doc;
  return doc;
}

/**
 * document.body: keeps track of what is appended to it, so contains() answers
 * as in a browser. Babylon's WebXRManagedOutputCanvas appends its canvas on
 * entering XR and asks contains() before removing it when the session ends;
 * without contains() exitXRAsync threw out of the session's end event.
 */
function documentBody(body: Record<string, unknown> | undefined): Record<string, unknown> {
  const children = new Set<unknown>();
  return Object.assign(body ?? {}, {
    style: body?.style ?? {},
    appendChild(node: unknown): unknown {
      children.add(node);
      return node;
    },
    removeChild(node: unknown): unknown {
      children.delete(node);
      return node;
    },
    contains: (node: unknown): boolean => children.has(node),
  });
}

function createCanvasStub(): Record<string, unknown> {
  return {
    width: 1,
    height: 1,
    clientWidth: 1,
    clientHeight: 1,
    style: {},
    dataset: {},
    addEventListener(): void {
      /* no-op */
    },
    removeEventListener(): void {
      /* no-op */
    },
    appendChild(): void {
      /* no-op */
    },
    removeChild(): void {
      /* no-op */
    },
  };
}
