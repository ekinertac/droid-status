// Claude Code LOCAL usage collector — "how much did I use today / this week".
// Shells out to the ccusage CLI (installed on this Mac) instead of parsing
// ~/.claude JSONL ourselves; ccusage owns the parsing/pricing logic and we own
// only the reduction to the two figures the dashboard shows. Complements
// claudeLimits.js, which reports subscription rate-limit utilization — the two
// answer different questions (spend vs. remaining headroom).
// summarizeDaily() is pure and unit-tested in test/claude.test.js.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Local-timezone calendar date, because ccusage buckets days locally too.
export function localISODate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function summarizeDaily(dailyEntries, todayStr) {
  const today = dailyEntries.find((d) => d.date === todayStr);
  const weekCost = dailyEntries.reduce((sum, d) => sum + (d.totalCost || 0), 0);
  // Sparkline needs all 7 calendar days; ccusage omits zero-usage days, so
  // fill the gaps. UTC arithmetic on the date STRING avoids tz edge cases.
  const byDate = new Map(dailyEntries.map((d) => [d.date, d.totalCost || 0]));
  const [y, m, dd] = todayStr.split('-').map(Number);
  const base = Date.UTC(y, m - 1, dd);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(base - i * 86400_000).toISOString().slice(0, 10);
    days.push({ date, cost: byDate.get(date) ?? 0 });
  }
  return {
    today: { cost: today?.totalCost ?? 0, totalTokens: today?.totalTokens ?? 0 },
    week: { cost: weekCost },
    days,
  };
}

export async function fetchLocalUsage() {
  const since = new Date(Date.now() - 6 * 24 * 3600 * 1000);
  const sinceArg = localISODate(since).replaceAll('-', '');
  const { stdout } = await run('ccusage', ['daily', '--json', '--since', sinceArg], {
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  return summarizeDaily(parsed.daily ?? [], localISODate());
}
