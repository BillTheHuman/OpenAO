# Full local multiplayer and rendering validation

A real seeded PostgreSQL database, the actual HTTP API, the compiled game server,
and the actual Next.js frontend ran on loopback ports. Two separate Chromium
browser contexts logged in through the normal UI as newly created fixture users,
selected their characters and entered the same map. No publication response,
WebSocket event, map loader or rendering function was mocked in this run.

## The live run caught a missing renderer connection

The previous code updated `engine.mapData` and successfully relocated the affected
player, but it never replaced the retained Pixi scene sprites. Network activity
and a successful server response were insufficient evidence: a stationary
observer still saw the old floor pixels. `pre-render-fix-finding.json` preserves
that failure.

The patch reports changed tile coordinates after the atomic model refresh, awaits
an explicit scene-redraw callback, preloads textures, and replaces/removes graphic
layers including absent layers and roofs. It retains live tile references,
objects and player state. Nine focused regression tests exercise the real source
modules with deterministic boundary adapters: six fail before, all nine pass after.

## Successful independent browser replay

`result.json` records **19 passing end-to-end assertions** in a fresh two-client
run, separate from the manual diagnosis:

- Drafts remain absent from the ordinary public API and sampled screen pixels.
- Publication reaches the existing game process and both already-connected users.
- The affected character moves from (45,59) to (44,59); the other remains (50,59).
- The relocated character cannot enter the new wall, but can move away to (42,59).
- Both clients receive the version marker and re-fetch overrides.
- The stationary observer's pixels change after publication, return to the exact
  baseline after restoration, clear when a colored layer is removed, and restore.
- No additional game WebSocket opens during the measured publication sequence;
  the game process's Linux start-time value remains unchanged.
- No browser page exception was recorded.

Initial page/bootstrap activity occurs before that measured sequence; the raw
socket list includes it. This is not a claim that no connection ever opened while
logging in. The game was not restarted during either the diagnostic or final run.

All ten previous client regressions, thirteen server integration cases and eight
existing server tests still pass. Full frontend and server TypeScript checks pass.
`CHECKS.json` binds those checks to the tested source files. Screenshots and HTTP
request/response records are unedited, with only synthetic account names in view.
No passwords, session tokens, cookies, account registration response, or test DB
connection secret are included.

## Reproduction

Use a disposable copy of the seeded stack, never a real player's database. See
the parent live-stack setup notes. Create two ordinary warrior/human fixture
characters through `/auth/register` and `/auth/create-character`, plus a separate
builder account. Configure the API's documented `GAME_DATA_ADMIN_ACCOUNT_ID` and
`GAME_DATA_ADMIN_PROXY_TOKEN` for that builder. Keep the test API and frontend
bound to loopback and point the game/API callbacks at each other.

Create a private JSON configuration outside Git:

```json
{
  "fixtureOnly": true,
  "apiOrigin": "http://127.0.0.1:API_PORT",
  "frontendOrigin": "http://127.0.0.1:WEB_PORT",
  "gameOrigin": "ws://127.0.0.1:GAME_PORT",
  "gamePid": 12345,
  "admin": {"sessionToken": "LOCAL_TEST_SESSION", "proxyHeader": "LOCAL_TEST_PROXY_TOKEN"},
  "users": [
    {"name": "FirstFixture", "password": "LOCAL_TEST_PASSWORD"},
    {"name": "SecondFixture", "password": "LOCAL_TEST_PASSWORD"}
  ],
  "visualTile": {"x": 54, "y": 61}
}
```

The fixture assumes both characters start in seeded map 1 and that the probe tile
is a visible simple ground tile in the second client's viewport. Substitute the
actual local ports and Linux game PID. Install Playwright/Chromium (or point
`browser` at Brave) in your test environment, then run from the repository root:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
  node tools/map-live-cache-tests/live-browser-validation.mjs \
  /private/path/fixture-config.json /path/to/new-evidence-directory
node --experimental-vm-modules tools/map-live-cache-tests/render-regressions.mjs
```

The harness refuses non-loopback service URLs and will not print its credentials.
It publishes changes only into the disposable map fixture and restores the selected
terrain before a successful exit. On failure the fixture should be discarded or
reset before rerunning; it is not a migration for a production game database.

## Limits

This establishes the posted software acceptance behaviors in the recorded local
configuration. It is not a live production deployment, a performance benchmark,
a test of every graphic/card/browser, a combat/NPC-removal campaign, or maintainer
acceptance. SwiftShader emitted the application's software-rendering warning;
rendering was functional but low-frame-rate. The original implementation's
attribution is preserved. Reward assignment and payment remain maintainer decisions.
