# droid-status — kiosk status display design

A spare Android phone (Redmi 10 2022, LCD) on the same Wi-Fi as the Mac shows a
full-screen dark dashboard with two things: Slack unreads and Claude usage.

## Architecture

One zero-dependency Node.js server on the Mac, fixed port **4321**, bound to all
interfaces. The phone runs Fully Kiosk Browser pointed at `http://<mac-lan-ip>:4321`.
`*.localhost` names don't resolve off-machine, so the phone uses the LAN IP; the
app is still registered with qwok (`--app-port 4321`) for dev convenience.

```
Slack Web API ──────┐
~/.claude (ccusage) ┤→ collectors (in-memory cache) → GET /api/status ← phone polls 30s
Keychain OAuth ─────┘        server.js                GET /           ← static page
```

## Data collectors

Each collector runs its own poll loop and caches `{data, updatedAt, error}`;
failures never crash the server and never blank the display — the page shows
last-good values plus staleness.

- **Slack** (~60s cycle): official Web API, user token (`xoxp`), scopes
  `channels:read groups:read im:read mpim:read`. `users.conversations` to
  enumerate, `conversations.info` per conversation for `unread_count_display`,
  throttled under the ~50/min Tier-3 limit with 429/Retry-After backoff.
  Bucket 1 (**Mentions & DMs**) = sum of unread counts over im/mpim.
  Bucket 2 (**Channels**) = count of channels with unreads. Channel @mentions
  are NOT promoted to bucket 1 (official-API limitation, accepted).
- **Claude local usage** (~5 min): shell out to `ccusage daily --json`;
  today's cost/tokens + 7-day cost.
- **Claude rate limits** (~2 min): read the Claude Code OAuth access token from
  macOS Keychain on demand (never stored, never refreshed by us — if expired we
  surface "run claude to refresh"), GET `api.anthropic.com/api/oauth/usage`
  → `five_hour.utilization` / `seven_day.utilization` + reset times.
  Endpoint verified working 2026-07-05.

## API

`GET /api/status` → `{ slack: {mentionsAndDms, otherUnreadChannels, updatedAt,
error}, claude: {today: {cost, totalTokens}, week: {cost}, limits: {fiveHourPct,
fiveHourResetAt, weeklyPct, weeklyResetAt}, updatedAt, error} }`.
`?mock=1` returns realistic fake data for UI work.

## UI

Deliberately minimal to start (will be shaped iteratively): single static HTML
file, true-black background, portrait layout. Clock header; two big Slack
numbers (red accent when mentions/DMs > 0); Claude cost today + two utilization
bars with reset countdowns; "updated Ns ago" footer that turns warning-colored
when stale. Polls every 30s. LCD panel → no burn-in mitigation needed.

## Config & secrets

`config.json` (gitignored; copy from `config.example.json`) holds `port` and
`slackUserToken`. Claude OAuth token is never written to disk.

## Testing

Unit tests (node:test) for the pure mapping functions: Slack conversation list
→ two buckets; usage/ccusage JSON → display model. Live collectors verified by
running the server.
