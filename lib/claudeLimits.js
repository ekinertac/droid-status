// Claude subscription rate-limit collector — the /usage-style "how close am I
// to the 5-hour and weekly caps" numbers. Reads the Claude Code OAuth access
// token from the macOS Keychain ON DEMAND (never written to disk, never
// logged) and calls the same endpoint the built-in /usage view uses
// (api.anthropic.com/api/oauth/usage — unofficial but verified working
// 2026-07-05; response shape pinned in test/claude.test.js fixtures).
// Deliberate constraint: we NEVER refresh the token ourselves — rotating the
// refresh token could invalidate Claude Code's own session. If the access
// token is expired we surface an actionable error instead.
// Complements claudeLocal.js (spend) — this file reports remaining headroom.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export function mapUsage(u) {
  return {
    fiveHourPct: u.five_hour?.utilization ?? null,
    fiveHourResetAt: u.five_hour?.resets_at ?? null,
    weeklyPct: u.seven_day?.utilization ?? null,
    weeklyResetAt: u.seven_day?.resets_at ?? null,
  };
}

// ── burn-rate forecast ──────────────────────────────────────────────
// We sample utilization every ~2 min; extrapolating the recent slope tells
// whether the current pace hits 100% BEFORE the window resets. Only the
// monotonically-rising suffix of samples is used, so a reset mid-history
// (utilization drops) naturally restarts the trend instead of poisoning it.
// Returns projected cap time (ms epoch) or null when flat/declining/too
// little data (< 2 samples or < 5 min of span).

const TREND_WINDOW_MS = 60 * 60 * 1000;
const MIN_SPAN_MS = 5 * 60 * 1000;

export function computeCapAt(samples, now, windowMs = TREND_WINDOW_MS) {
  let start = samples.length - 1;
  while (
    start > 0 &&
    samples[start - 1].pct <= samples[start].pct &&
    now - samples[start - 1].t <= windowMs
  ) start--;
  const trend = samples.slice(start);
  if (trend.length < 2) return null;
  const first = trend[0], last = trend[trend.length - 1];
  if (last.t - first.t < MIN_SPAN_MS) return null;
  const rate = (last.pct - first.pct) / (last.t - first.t);
  if (rate <= 0) return null;
  return now + (100 - last.pct) / rate;
}

const history = { five: [], week: [] };

function forecast(key, pct, resetAt, now) {
  if (pct == null) return null;
  const samples = history[key];
  samples.push({ t: now, pct });
  while (samples.length && now - samples[0].t > TREND_WINDOW_MS) samples.shift();
  const capAt = computeCapAt(samples, now);
  // Only meaningful if the cap lands before the window resets on its own.
  if (capAt && resetAt && capAt < new Date(resetAt).getTime()) {
    return new Date(capAt).toISOString();
  }
  return null;
}

async function readAccessToken() {
  const { stdout } = await run('security', [
    'find-generic-password', '-s', 'Claude Code-credentials', '-w',
  ]);
  const oauth = JSON.parse(stdout)?.claudeAiOauth;
  if (!oauth?.accessToken) throw new Error('no Claude OAuth token in Keychain');
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
    throw new Error('Claude OAuth token expired — open Claude Code once to refresh it');
  }
  return oauth.accessToken;
}

export async function fetchLimits() {
  const token = await readAccessToken();
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
  });
  if (!res.ok) throw new Error(`usage endpoint HTTP ${res.status}`);
  const mapped = mapUsage(await res.json());
  const now = Date.now();
  return {
    ...mapped,
    fiveHourCapAt: forecast('five', mapped.fiveHourPct, mapped.fiveHourResetAt, now),
    weeklyCapAt: forecast('week', mapped.weeklyPct, mapped.weeklyResetAt, now),
  };
}
