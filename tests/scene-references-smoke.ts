/**
 * Scene-references smoke (platform/scene-references.ts, which the mirror
 * prefetch follows): the files a .babylon scene makes Babylon fetch, on a
 * synthetic scene with every kind of reference. Pure: no network, no GL.
 *
 * Asserts: material textures (diffuse, bump, lightmap, ...) and those in
 * sub-folders, resolved against the scene's folder; url over name; cube
 * textures as Babylon's six default faces, or their own extensions, or one
 * .dds/.env file, or their own file list (absolute ones); the environment as a plain file name; sounds; absolute
 * URLs kept; duplicates once; render targets (mirror, probe), embedded
 * base64 and data: URIs skipped; non-ASCII names percent-encoded, as fetch
 * sends them.
 */
import { babylonSceneReferences } from "../src/platform/scene-references.js";

const ROOT = "https://example.test/Scenes/House/";
const texture = (name: string, extra: Record<string, unknown> = {}) => ({ name, level: 1, hasAlpha: false, coordinatesMode: 0, uOffset: 0, ...extra });

const scene = {
  environmentTexture: "env/sky.env",
  materials: [
    { name: "wall", diffuseTexture: texture("wall.jpg"), bumpTexture: texture("textures/wall_normal.png"), lightmapTexture: texture("Allée_lightmap.jpg") },
    { name: "floor", diffuseTexture: texture("wall.jpg") }, // a duplicate
    { name: "url wins", diffuseTexture: texture("ignored.jpg", { url: "real.jpg" }) },
    { name: "absolute", emissiveTexture: texture("https://cdn.test/glow.png") },
    { name: "cube", reflectionTexture: texture("skybox/sky", { isCube: true }) },
    { name: "cube ext", reflectionTexture: texture("room", { isCube: true, extensions: ["_px.png", "_nx.png"] }) },
    { name: "cube dds", reflectionTexture: texture("probe.dds", { isCube: true }) },
    { name: "cube files", reflectionTexture: texture("listed", { isCube: true, files: ["https://cdn.test/a_px.png", "local/a_nx.png"] }) },
    { name: "mirror", reflectionTexture: texture("mirrorTex", { renderTargetSize: 512, mirrorPlane: [0, 1, 0, 0] }) },
    { name: "embedded", diffuseTexture: texture("embedded.png", { base64String: "data:image/png;base64,AAAA" }) },
    { name: "data uri", diffuseTexture: texture("data:image/png;base64,BBBB") },
  ],
  multiMaterials: [{ name: "multi", materials: ["wall", "floor"] }],
  reflectionProbes: [{ name: "probe", renderTargetSize: 256, isRenderTarget: true }],
  sounds: [{ name: "birds.mp3" }, { name: "ignored", url: "sounds/wind.ogg" }],
  meshes: [{ name: "Allée", materialId: "floor" }], // a mesh name is not a file
};

const expected = [
  "env/sky.env",
  "wall.jpg",
  "textures/wall_normal.png",
  "All%C3%A9e_lightmap.jpg",
  "real.jpg",
  "https://cdn.test/glow.png",
  ...["_px", "_py", "_pz", "_nx", "_ny", "_nz"].map((f) => `skybox/sky${f}.jpg`),
  "room_px.png",
  "room_nx.png",
  "probe.dds",
  "https://cdn.test/a_px.png", // a cube's own list: verbatim, the page-relative one is not remote
  "birds.mp3",
  "sounds/wind.ogg",
].map((p) => new URL(p, ROOT).href);

const got = babylonSceneReferences(scene, new URL(`${ROOT}House.babylon`)).map((u) => u.href);
const missing = expected.filter((u) => !got.includes(u));
const extra = got.filter((u) => !expected.includes(u));
for (const u of got) console.log(`[smoke] ${expected.includes(u) ? "ok   " : "EXTRA"} ${u}`);
for (const u of missing) console.log(`[smoke] MISSING ${u}`);
if (missing.length > 0 || extra.length > 0 || got.length !== new Set(got).size) {
  console.error(`SCENE-REFERENCES SMOKE: FAIL (${missing.length} missing, ${extra.length} extra)`);
  process.exit(1);
}
console.log(`SCENE-REFERENCES SMOKE: PASS (${got.length} files)`);
