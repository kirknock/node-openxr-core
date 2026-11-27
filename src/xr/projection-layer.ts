/**
 * The per-frame projection layer, encoded into reused C memory: one
 * XrCompositionLayerProjectionView per eye (pose + fov from xrLocateViews,
 * the eye's swapchain sub-image: its own swapchain, its half of a
 * side-by-side one, or its array layer) and the layer pointer array that
 * xrEndFrame takes.
 */
import koffi from "koffi";
import * as gen from "./generated/xr-abi.gen.js";
import type { SessionSwapchains } from "./session-graphics.js";

export class ProjectionLayer {
  private readonly viewsPtr: unknown;
  private readonly layerPtr: unknown;
  /** The `layers` array for XrFrameEndInfo (one entry). */
  readonly layersPtr: unknown;
  private readonly viewStride = koffi.sizeof("XrCompositionLayerProjectionView");

  constructor(
    private readonly space: unknown,
    private readonly swapchains: Pick<SessionSwapchains<unknown>, "eyeCount" | "handles" | "subImage">,
  ) {
    this.viewsPtr = koffi.alloc(koffi.resolve("XrCompositionLayerProjectionView"), swapchains.eyeCount);
    this.layerPtr = koffi.alloc(koffi.resolve("XrCompositionLayerProjection"), 1);
    this.layersPtr = koffi.alloc(koffi.resolve("void *"), 1);
  }

  /** Encodes this frame's located views into the layer chain. */
  encode(views: Array<Record<string, unknown>>, blendMode: number, premultipliedAlpha: boolean): void {
    const eyeCount = this.swapchains.eyeCount;
    for (let eye = 0; eye < eyeCount; eye++) {
      const pose = views[eye].pose as Record<string, Record<string, number>>;
      const fov = views[eye].fov as Record<string, number>;
      const sub = this.swapchains.subImage(eye);
      koffi.encode(this.viewsPtr, eye * this.viewStride, "XrCompositionLayerProjectionView", {
        type: gen.XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW,
        next: null,
        pose: { orientation: { ...pose.orientation }, position: { ...pose.position } },
        fov: { ...fov },
        subImage: {
          swapchain: this.swapchains.handles[sub.swapchain],
          imageRect: {
            offset: { x: sub.x, y: sub.y },
            extent: { width: sub.width, height: sub.height },
          },
          imageArrayIndex: sub.arrayIndex ?? 0,
        },
      });
    }

    koffi.encode(this.layerPtr, 0, "XrCompositionLayerProjection", {
      type: gen.XR_TYPE_COMPOSITION_LAYER_PROJECTION,
      next: null,
      // Non-opaque blend modes require telling the compositor to USE the
      // layer texture's alpha; without this flag it composites the layer
      // as fully opaque (passthrough never shows, except in reprojection
      // gaps during fast head motion — the on-device symptom). OpenXR layers
      // are premultiplied unless flagged, which matches what the app renders
      // (blending over an alpha-0 clear); XR_PT_PREMULT=0 flags them as
      // straight alpha instead.
      layerFlags:
        blendMode !== gen.XR_ENVIRONMENT_BLEND_MODE_OPAQUE
          ? gen.XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT |
            (premultipliedAlpha ? 0 : gen.XR_COMPOSITION_LAYER_UNPREMULTIPLIED_ALPHA_BIT)
          : 0,
      space: this.space,
      viewCount: eyeCount,
      views: this.viewsPtr,
    });
    koffi.encode(this.layersPtr, 0, "void *", this.layerPtr);
  }
}
