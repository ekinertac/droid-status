// Entry point: the tiny HTTP server the phone talks to. Wires the three
// collectors (lib/slack.js, lib/claudeLocal.js, lib/claudeLimits.js) through
// lib/collector.js and exposes:
//   GET /            → public/index.html (the kiosk page)
//   GET /api/status  → merged collector caches; ?mock=1 returns fixed sample
//                      data so the UI can be shaped without live tokens.
//   GET /<anything>  → static files under public/ (fonts, images) — served
//                      locally so the kiosk never depends on a CDN being up.
// Zero runtime dependencies (node:http only). Binds 0.0.0.0 on the FIXED port
// from config.json (default 4321) — the phone needs a stable LAN URL, so we
// intentionally ignore $PORT. Run ad hoc via npm start, or as a launchd
// service via deploy/install.sh.
// See docs/superpowers/specs/2026-07-05-droid-status-design.md for rationale.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startCollector } from './lib/collector.js';
import { fetchSlackSummary } from './lib/slack.js';
import { fetchLocalUsage } from './lib/claudeLocal.js';
import { fetchLimits } from './lib/claudeLimits.js';
import { fetchActiveSessions } from './lib/claudeSessions.js';

const root = path.dirname(fileURLToPath(import.meta.url));
// config.json is gitignored (may hold a Slack token); a fresh clone runs on
// defaults — the Slack collector reports "not configured" instead of crashing.
const config = await readFile(path.join(root, 'config.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => ({ port: 4321, slackUserToken: '' }));

const slack = startCollector('slack', 60_000, () => fetchSlackSummary(config.slackUserToken));
const local = startCollector('claude-local', 300_000, fetchLocalUsage);
const limits = startCollector('claude-limits', 120_000, fetchLimits);
const sessions = startCollector('claude-sessions', 30_000, fetchActiveSessions);

const MOCK = {
  slack: {
    mentionsAndDms: 3,
    otherUnreadChannels: 7,
    updatedAt: new Date().toISOString(),
    error: null,
  },
  claude: {
    today: { cost: 42.7, totalTokens: 115_000_000 },
    week: { cost: 231.4 },
    sessions: 3,
    projects: ['droid-status', 'qwok', 'metal-gig-tracker'],
    days: [61, 105.2, 88.4, 142.1, 0, 231.6, 42.7].map((cost, i) => ({
      date: new Date(Date.now() - (6 - i) * 86400_000).toISOString().slice(0, 10),
      cost,
    })),
    limits: {
      fiveHourPct: 62,
      fiveHourResetAt: new Date(Date.now() + 80 * 60000).toISOString(),
      fiveHourCapAt: new Date(Date.now() + 48 * 60000).toISOString(),
      weeklyPct: 34,
      weeklyResetAt: new Date(Date.now() + 3.2 * 86400_000).toISOString(),
      weeklyCapAt: null,
    },
    updatedAt: new Date().toISOString(),
    error: null,
  },
};

function status() {
  const s = slack.get();
  const l = local.get();
  const r = limits.get();
  const a = sessions.get();
  return {
    slack: { ...(s.data ?? {}), updatedAt: s.updatedAt, error: s.error },
    claude: {
      ...(l.data ?? {}),
      limits: r.data,
      sessions: a.data?.activeSessions ?? null,
      projects: a.data?.projects ?? [],
      updatedAt: l.updatedAt,
      // Any sub-source failing marks the whole section; frontend shows
      // last-good numbers regardless.
      error: l.error || r.error || a.error,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/status') {
      const body = url.searchParams.get('mock') ? MOCK : status();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    } else if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await readFile(path.join(root, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } else {
      // Static assets from public/ only; resolve + prefix check blocks ../
      const filePath = path.join(root, 'public', path.normalize(url.pathname));
      if (!filePath.startsWith(path.join(root, 'public'))) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const types = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json' };
      try {
        const body = await readFile(filePath);
        res.writeHead(200, {
          'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream',
          'Cache-Control': 'max-age=86400',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    }
  } catch (err) {
    res.writeHead(500).end(String(err?.message ?? err));
  }
});

server.listen(config.port ?? 4321, '0.0.0.0', () => {
  console.log(`droid-status listening on http://0.0.0.0:${config.port ?? 4321}`);
});
