# @kirknock/node-openxr-core

[![CI](https://github.com/kirknock/node-openxr-core/actions/workflows/ci.yml/badge.svg)](https://github.com/kirknock/node-openxr-core/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kirknock/node-openxr-core)](https://www.npmjs.com/package/@kirknock/node-openxr-core)

OpenXR over koffi (`src/xr`), the IWER WebXR runtime driven from the native
session (`src/webxr`), and the Node platform Babylon.js apps run on Linux
(`src/platform`: browser globals, canvas, XHR, images, the frame loop).
Also `config.ts` (every `XR_*` variable), `log.ts`, `compat.ts` (pinned
third-party internals), and the test runner bin `nodexr-test`.

## Install

```bash
npm install @kirknock/node-openxr-core @babylonjs/core@9.33.2 iwer@2.7.0 koffi@2.16.3 @napi-rs/canvas@1.0.11
```

Peer dependencies are exact pins (see `src/compat.ts`); `@babylonjs/loaders`
is optional. Modules are imported by path, e.g.
`@kirknock/node-openxr-core/xr/session.js`.

Requires Node.js >= 24 and, at runtime, an OpenXR loader
(`libopenxr_loader.so.1`) and runtime.

## Development

```bash
npm ci
npm run build        # dist/
npm run lint && npm run typecheck
npm test             # pure group: IWER, pointer selection, teleportation, view pose, mirror, ...
npm run gen:abi      # regenerate src/xr/generated/xr-abi.gen.ts (needs gcc)
npm run probe        # OpenXR instance/system info (live runtime)
npm run push         # build + yalc push to local consumers
```

## Releasing

Bump `version` in `package.json`, commit, then push a matching tag:

```bash
npm version patch    # or minor / major / prerelease --preid beta
git push --follow-tags
```

The `Release` workflow checks the tag, lints, tests, publishes to npm via
trusted publishing (with provenance) and creates a GitHub release with the
tarball attached.

## License

MIT. The vendored OpenXR headers in `third_party/openxr` are
© The Khronos Group Inc., `Apache-2.0 OR MIT`.
