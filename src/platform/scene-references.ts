/**
 * The files a Babylon scene file (.babylon, JSON) makes Babylon fetch next to
 * it: textures (cube textures as their six faces, or one .dds/.env/.hdr) and
 * sounds, resolved against the scene's root URL as Babylon's parsers do
 * (Texture.Parse, CubeTexture.Parse, Sound.Parse: root + (url ?? name); a
 * cube texture's own `files` list as it is).
 * The mirror prefetch (tools/mirror-prefetch.ts) follows them, so listing a
 * scene in mirror/urls.txt is enough for it to work offline.
 *
 * A texture is any object with a string name and a texture's serialized
 * fields (coordinatesMode, uOffset, level, hasAlpha), wherever it sits:
 * materials, multi-materials, the environment, probes, lens flares.
 * Render targets (mirrors, probes' own textures) and embedded data are
 * not files and are skipped.
 */

/** Babylon's default cube face suffixes (CubeTexture.Parse without `extensions`). */
const CUBE_FACES = ["_px.jpg", "_py.jpg", "_pz.jpg", "_nx.jpg", "_ny.jpg", "_nz.jpg"];
const SINGLE_FILE_CUBE = /\.(dds|env|hdr|ktx2?|basis)$/i;
const TEXTURE_FIELDS = ["coordinatesMode", "uOffset", "level", "hasAlpha"];

export function babylonSceneReferences(scene: unknown, sceneUrl: URL): URL[] {
  const root = new URL(".", sceneUrl);
  const found = new Map<string, URL>();
  const add = (path: string): void => {
    if (path === "" || path.startsWith("data:") || path.startsWith("blob:")) return;
    const url = new URL(path, root);
    if (url.protocol === "http:" || url.protocol === "https:") found.set(url.href, url);
  };

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (isTexture(node)) {
      const path = typeof node.url === "string" && node.url !== "" ? node.url : (node.name as string);
      if (node.isCube === true && Array.isArray(node.files)) {
        // Babylon takes a cube's own file list verbatim (not under the scene's root):
        // only absolute ones are remote.
        for (const file of node.files) if (typeof file === "string" && /^https?:/i.test(file)) add(file);
      } else if (node.isCube === true && !SINGLE_FILE_CUBE.test(path)) {
        const faces = Array.isArray(node.extensions) ? node.extensions.filter((e): e is string => typeof e === "string") : CUBE_FACES;
        for (const face of faces) add(path + face);
      } else {
        add(path);
      }
    }
    for (const child of Object.values(node)) visit(child);
  };

  const json = scene as Record<string, unknown> | null;
  visit(json);
  // The environment can be a plain file name.
  if (json !== null && typeof json === "object" && typeof json.environmentTexture === "string") add(json.environmentTexture);
  for (const sound of Array.isArray(json?.sounds) ? (json.sounds as Array<Record<string, unknown>>) : []) {
    const path = typeof sound.url === "string" ? sound.url : sound.name;
    if (typeof path === "string") add(path);
  }
  return [...found.values()];
}

function isTexture(node: Record<string, unknown>): boolean {
  if (typeof node.name !== "string" && typeof node.url !== "string") return false;
  if (node.isRenderTarget === true || node.renderTargetSize !== undefined || node.mirrorPlane !== undefined) return false;
  if (typeof node.base64String === "string") return false;
  return TEXTURE_FIELDS.some((field) => field in node);
}
