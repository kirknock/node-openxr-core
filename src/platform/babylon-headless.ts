/**
 * Makes ordinary Babylon.js content work headless, for any app, before the
 * app creates its engine. Everything here is global (prototypes, statics,
 * module registries) so app code never calls it:
 *
 *   - images: DOM Image/createImageBitmap polyfills (PNG/JPEG decode) and an
 *     engine image loader decoding buffers on worker threads
 *     (image-polyfill.ts, image-decode-pool.ts); every engine
 *     gets features.forceBitmapOverHTMLImageElement (there is no
 *     HTMLImageElement), set through a prototype setter at construction.
 *   - PBR: CPU expansion of the RGBD environment-BRDF LUT, whose GPU
 *     post-process never becomes ready headless (headless-rgbd.ts).
 *
 * preloadStandardMaterialShaders is the one piece each renderer calls itself,
 * for its own shader language.
 */
export async function installBabylonHeadless(): Promise<void> {
  const { AbstractEngine } = await import("@babylonjs/core/Engines/abstractEngine.js");
  Object.defineProperty(AbstractEngine.prototype, "_features", {
    configurable: true,
    set(this: object, features: Record<string, unknown>) {
      features.forceBitmapOverHTMLImageElement = true;
      Object.defineProperty(this, "_features", { value: features, writable: true, configurable: true, enumerable: true });
    },
  });

  const { installImagePolyfills, installHeadlessImageLoading } = await import("./image-polyfill.js");
  installImagePolyfills();
  await installHeadlessImageLoading();
  const { installHeadlessRgbdExpansion } = await import("./headless-rgbd.js");
  await installHeadlessRgbdExpansion();
}

/** Babylon's ShaderLanguage values. */
export const SHADER_LANGUAGE = { GLSL: 0, WGSL: 1 } as const;
export type ShaderLanguageValue = (typeof SHADER_LANGUAGE)[keyof typeof SHADER_LANGUAGE];

/**
 * Materials lazy-load their shader sources via dynamic import() inside
 * Effect._processShaderCodeAsync; under tsx that import can never settle and
 * the floating promise stalls effect compilation silently. Running a material
 * class's _ShaderLoader up front populates ShaderStore and marks it loaded, so
 * the lazy path is skipped entirely. Harmless under plain node too.
 */
export async function preloadMaterialShaders(material: object, language: ShaderLanguageValue): Promise<void> {
  const { _ShaderLoader: loader } = material as { _ShaderLoader: { getLoadCallback(language: number): (() => Promise<void>) | undefined } };
  await loader.getLoadCallback(language)?.();
}

/** preloadMaterialShaders for the Standard and PBR materials, the ones every renderer needs. */
export async function preloadStandardMaterialShaders(language: ShaderLanguageValue): Promise<void> {
  const { StandardMaterial } = await import("@babylonjs/core/Materials/standardMaterial.js");
  const { PBRBaseMaterial } = await import("@babylonjs/core/Materials/PBR/pbrBaseMaterial.js");
  await Promise.all([preloadMaterialShaders(StandardMaterial, language), preloadMaterialShaders(PBRBaseMaterial, language)]);
}
