# Isolated live-stack validation, September 17, 2026

Tested gameplay source: `9310624f75d8e85b7fc31560ebd543a7a269ee69`.
This directory adds deployment evidence, not a claim of finished multiplayer validation.

## Executed successfully

A separate PostgreSQL 18 container, the actual Express API, the compiled game server,
and the actual Next.js frontend were started together on loopback-only ports. No
production endpoint, existing database, or user account was modified.

- API dependency installation from its frozen lockfile and full TypeScript check passed.
- Server protocol compilation, TypeScript build and asset-copy script passed.
- The supplied `database/aoweb.sql` restored into a fresh database; the current API
  migration script then reconciled its schema successfully.
- The actual API `/health` returned HTTP 200 with `ok: true`.
- The actual game `/health` returned HTTP 200 with `serverReady: true`.
- Public `/maps/1/overrides` returned HTTP 200, `includeDrafts: false`, and empty
  override/entity arrays for the new database.
- A headless Brave browser rendered the real `/register` page, waited for visible
  form fields, and recorded no JavaScript or failed-request errors. The actual
  screenshot and structured browser result are included. This is not a screenshot
  of an in-game map and is not presented as gameplay evidence.

The frontend was run with Next's development server and webpack. This check is not
an optimized production-frontend build, WebGL validation or load/concurrency test.

## Important seed-data finding

Applying only the schema followed by `import-game-data all` was insufficient for
this checkout: `api/src/jsons/npcs.json` contains 339 NPC definitions and is missing
NPC ID 50, referenced by the map placements. The game crashed at `datNpc.name`.

The README-prescribed full public database dump contains 340 NPC definitions and
covers all 172 distinct NPC IDs referenced across 2,660 placements. Restoring it
resolved the startup failure without changing game source. The dump SHA-256 and
set differences are recorded in `seed-and-health.json`. Use the matching dump for
end-to-end tests; do not suppress the exception and call the world initialized.

## Remaining final acceptance scenarios

These are NOT yet executed through authenticated browsers:

1. Two ordinary players stay connected on the same map while an authorized local
   administrator creates a draft. Public API responses and both renderers must
   continue showing the published terrain.
2. Publish the change through the actual API. Verify its hot-reload result, a
   MAP_LIVE_RELOAD notification in each open WebSocket, refreshed terrain without
   reconnecting, and unchanged game-process identity.
3. Publish a blocked tile under one player. Verify relocation to the nearest valid
   tile, not an unrelated position, and that a player on a valid tile stays put.
4. Remove/revert a terrain override. Verify original graphics and collision on
   both clients, including an original wall, without reconnecting.
5. Exercise rapid publishes with response ordering controlled at the transport
   boundary, and verify neither client nor server rolls back to an older version.
6. Exercise unavailable reload data and an entirely blocked relocation area. A
   healthy process alone does not establish those failure-mode guarantees.

The existing 10 client regression scenarios, 13 server integration scenarios and
8 original server tests remain separate evidence for their specific behaviors.

## Why the authenticated stage stopped

The execution environment blocked the call that would create the synthetic local
accounts before it ran. No test account or logged-in player was created by that
call, and no alternate signup route was attempted. The remaining gate is access
to local test identities, not a need for production credentials or real personal
information. Once an operator creates test accounts, use the existing isolated
stack to complete the scenario list. Maintainer acceptance and deployment approval
remain independent of local test results.

## Reproduction settings

Follow the project README with the complete SQL dump. Use distinct local ports,
set `API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WS_URL` and
`GAME_SERVER_INTERNAL_URL` consistently, and configure synthetic local admin
identity/token settings in the API. Do not point tests at the production host.

Our stack used Node 24.21.0, pnpm 12.4.2, Next.js 16.2.6 and the repository's frozen
lockfiles. The database image was `postgres:18-alpine` at digest
`sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2`.
A runtime-only listener wrapper bound unspecified Node listener hosts to loopback;
it did not replace the game reload, rendering, authentication or database code.
