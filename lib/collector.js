// Generic background poller shared by all three data sources (slack.js,
// claudeLocal.js, claudeLimits.js). Each collector owns its own loop and an
// in-memory cache of { data, updatedAt, error }; server.js reads the caches to
// assemble /api/status. Design constraint from the spec: a failing source must
// never crash the server or blank the display — errors are recorded alongside
// the last GOOD data, and the frontend decides how to show staleness.
// Ticks are skipped while a previous run is still in flight, so a slow sweep
// (the Slack one can take minutes on big workspaces) never overlaps itself.

export function startCollector(name, intervalMs, fn) {
  const state = { data: null, updatedAt: null, error: null };
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      state.data = await fn();
      state.updatedAt = new Date().toISOString();
      if (state.error) console.error(`[${new Date().toISOString()}] collector ${name} recovered`);
      state.error = null;
    } catch (err) {
      const msg = `${name}: ${err?.message ?? err}`;
      // Log on state CHANGE only — a broken source would otherwise repeat
      // the same line every tick. The kiosk deliberately doesn't render
      // errors (server log is the debugging surface); it only dims stale panes.
      if (state.error !== msg) {
        console.error(`[${new Date().toISOString()}] collector ${msg}`);
      }
      state.error = msg;
    } finally {
      running = false;
    }
  }

  tick();
  setInterval(tick, intervalMs).unref();

  return { get: () => ({ ...state }) };
}
