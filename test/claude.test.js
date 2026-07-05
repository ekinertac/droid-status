// Unit tests for the pure Claude mappings: ccusage daily JSON → today/week
// figures (lib/claudeLocal.js) and the oauth/usage response → limit bars
// (lib/claudeLimits.js). The usage-endpoint fixture pins the response shape
// observed live on 2026-07-05 — if Anthropic changes it, this is the test
// that should break first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDaily, localISODate } from '../lib/claudeLocal.js';
import { mapUsage, computeCapAt } from '../lib/claudeLimits.js';
import { countActive, projectNameFromSlug } from '../lib/claudeSessions.js';

test('summarizeDaily picks today and sums the week', () => {
  const out = summarizeDaily(
    [
      { date: '2026-07-04', totalCost: 10, totalTokens: 1000 },
      { date: '2026-07-05', totalCost: 105.47, totalTokens: 115192336 },
    ],
    '2026-07-05',
  );
  assert.equal(out.today.cost, 105.47);
  assert.equal(out.today.totalTokens, 115192336);
  assert.equal(out.week.cost, 115.47);
});

test('summarizeDaily handles a day with no usage yet', () => {
  const out = summarizeDaily([{ date: '2026-07-04', totalCost: 10 }], '2026-07-05');
  assert.deepEqual(out.today, { cost: 0, totalTokens: 0 });
  assert.equal(out.week.cost, 10);
});

test('localISODate formats in local time', () => {
  assert.match(localISODate(), /^\d{4}-\d{2}-\d{2}$/);
});

test('mapUsage extracts both windows from the live response shape', () => {
  const out = mapUsage({
    five_hour: { utilization: 5.0, resets_at: '2026-07-05T03:29:59.512085+00:00' },
    seven_day: { utilization: 45.0, resets_at: '2026-07-09T06:59:59.512106+00:00' },
    seven_day_opus: null,
  });
  assert.deepEqual(out, {
    fiveHourPct: 5.0,
    fiveHourResetAt: '2026-07-05T03:29:59.512085+00:00',
    weeklyPct: 45.0,
    weeklyResetAt: '2026-07-09T06:59:59.512106+00:00',
  });
});

test('countActive counts only transcripts touched inside the window', () => {
  const now = 1_000_000_000;
  const min = 60_000;
  assert.equal(countActive([now - 1 * min, now - 4 * min, now - 6 * min, 0], now, 5 * min), 2);
  assert.equal(countActive([], now, 5 * min), 0);
});

test('summarizeDaily fills zero-usage gaps so the sparkline always has 7 days', () => {
  const out = summarizeDaily(
    [{ date: '2026-07-01', totalCost: 5 }, { date: '2026-07-05', totalCost: 9 }],
    '2026-07-05',
  );
  assert.equal(out.days.length, 7);
  assert.deepEqual(out.days[0], { date: '2026-06-29', cost: 0 });
  assert.deepEqual(out.days[2], { date: '2026-07-01', cost: 5 });
  assert.deepEqual(out.days[6], { date: '2026-07-05', cost: 9 });
});

test('projectNameFromSlug strips home and Code parents', () => {
  const home = '-Users-alice';
  assert.equal(projectNameFromSlug('-Users-alice-Code-droid-status', home), 'droid-status');
  assert.equal(projectNameFromSlug('-Users-alice-Desktop-scratch', home), 'Desktop-scratch');
  assert.equal(projectNameFromSlug('-Users-alice', home), '~');
  assert.equal(projectNameFromSlug('-somewhere-else', home), 'somewhere-else');
});

test('computeCapAt projects a rising trend to 100%', () => {
  const min = 60_000;
  const now = 100 * min;
  // 50% -> 60% over 10 minutes = 1%/min -> 40 more minutes to cap
  const capAt = computeCapAt([{ t: now - 10 * min, pct: 50 }, { t: now, pct: 60 }], now);
  assert.equal(capAt, now + 40 * min);
});

test('computeCapAt returns null when flat, declining, or data-poor', () => {
  const min = 60_000;
  const now = 100 * min;
  assert.equal(computeCapAt([{ t: now - 10 * min, pct: 50 }, { t: now, pct: 50 }], now), null);
  assert.equal(computeCapAt([{ t: now - 10 * min, pct: 60 }, { t: now, pct: 50 }], now), null);
  assert.equal(computeCapAt([{ t: now, pct: 50 }], now), null);
  // spans under 5 minutes are noise, not a trend
  assert.equal(computeCapAt([{ t: now - 2 * min, pct: 50 }, { t: now, pct: 55 }], now), null);
});

test('computeCapAt ignores samples from before a window reset', () => {
  const min = 60_000;
  const now = 100 * min;
  // 90% pre-reset, drops to 5%, then climbs 5→15 over 10 min = 1%/min
  const capAt = computeCapAt([
    { t: now - 30 * min, pct: 90 },
    { t: now - 10 * min, pct: 5 },
    { t: now, pct: 15 },
  ], now);
  assert.equal(capAt, now + 85 * min);
});

test('mapUsage tolerates missing windows', () => {
  assert.deepEqual(mapUsage({}), {
    fiveHourPct: null,
    fiveHourResetAt: null,
    weeklyPct: null,
    weeklyResetAt: null,
  });
});
