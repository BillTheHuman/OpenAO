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

This is a supplemental client fix, not a claim that the full #11 bounty,
live game-server reload, player relocation, or renderer validation is complete.
No campaign assignment or payment is claimed.

Strict TypeScript 6.0.3 module check: `tsc -p tools/map-live-cache-tests/tsconfig.json`. This checks the actual loader and local imports, not the entire Next.js application.
