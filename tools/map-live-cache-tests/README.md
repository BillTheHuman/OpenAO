# Published-map cache follow-up for OpenAO PR #346

Base: Aduersarius/OpenAO `5f37ec59e4a17f57421273e3810d85170434ff1b`.
The existing live-publish implementation remains the original author's work.

Run on Node 24 or newer:

```sh
node --experimental-vm-modules tools/map-live-cache-tests/regressions.mjs
```

The tests execute the actual complete `frontend/utils/gameLoader.ts` module,
with only its API-base import and HTTP transport supplied by deterministic
fixtures. They control response order; they are not a browser or whole-game
integration test.

Original PR module: 4 pass, 6 fail. Patched module: 10 pass, 0 fail.
The failures reproduce stale in-flight loads, obsolete request cleanup,
clear-all invalidation, removed override restoration, competing refreshes,
and refresh error propagation. Controls cover cloned cached results,
unchanged terrain, retained live tile references, and first-load fallback.

The patch uses generation identities, starts each refresh from the static
baseline, commits only the latest completed refresh, and leaves the displayed
map untouched on a failed refresh. The packet handler catches that failure.

This is a supplemental repair, not a claim to the original author's work or reward.
The module results below are complemented by the later full local multiplayer
and rendering validation under `live-stack/gameplay/`. No payment is claimed.

Strict TypeScript 6.0.3 module check: `tsc -p tools/map-live-cache-tests/tsconfig.json`. This checks the actual loader and local imports, not the entire Next.js application.

## Server reload and relocation regression coverage

Run from the repository root after installing the server development dependencies:

```sh
TS_COMPILER_PATH="$(pwd)/server/node_modules/typescript/lib/typescript.js" \
  node tools/map-live-cache-tests/server-regressions.mjs
```

These thirteen scenarios execute the actual `gameDataSync`, `mapLiveApply` and
`mapLivePublish` modules. The harness also extracts and compiles the exact
`game.ts` occupancy, terrain and `blockMap` implementations using TypeScript's
syntax tree. API transport, connected clients and teleport delivery are local
fixtures. It is module integration testing, not an end-to-end deployed game.

Before this server follow-up: 5 passed, 8 failed. After it: 13 passed, 0 failed.

The regressions establish that layered overrides share one tile-blocking
baseline; removing edits or changing `blocked` to null restores that baseline;
collision packets use actual terrain deltas rather than assuming missing edits
mean open ground; an unchanged occupying player is not relocated; and a late
older publication cannot overwrite a newer applied version. Positive controls
cover actual wall relocation, other-map isolation, fetch errors, graphic-layer
restoration and draft exclusion. Unrelated tile runtime fields are retained.

The original author retains authorship of the live-publication feature. This
follow-up corrects defects in that existing implementation; no full-bounty
approval, payment, or real multiplayer deployment is claimed.

Additional local verification: the full server TypeScript configuration passes with no emit; protocol compilation passes; all eight tests selected by the existing server test script pass. The ten previous client-loader regressions and strict client-loader typecheck also remain passing. Logs and exact commands are retained in the work evidence.

## Final browser/rendering follow-up

The live two-client run found and corrected a missing retained-scene redraw.
Nine new source-module regressions and a reusable full-stack browser harness
are included. See `live-stack/gameplay/README.md` and `CHECKS.json` for the
19 passing live assertions, screenshot evidence, source hashes and limits.
Full frontend and server typechecks and the earlier test suites still pass.
