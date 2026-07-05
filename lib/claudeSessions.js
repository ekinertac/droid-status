// Active Claude Code session counter + which projects they belong to.
// Every session appends to a JSONL transcript under
// ~/.claude/projects/<project-slug>/<session>.jsonl, so "sessions active
// right now" = transcript files whose mtime falls inside a short window
// (5 min — matches how long a session can think/tool-call without writing).
// Pure filesystem stats: no process sniffing, catches sessions in any
// terminal/app, costs nothing. The project slug is the cwd with "/" → "-"
// (e.g. -Users-alice-Code-my-app), so a readable name is a prefix
// strip, not a parse — see projectNameFromSlug. Feeds the pulsing badge +
// project list in the Claude pane. Pure functions are unit-tested in
// test/claude.test.js.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const HOME_SLUG = os.homedir().replaceAll('/', '-');

export function countActive(mtimes, now, windowMs = ACTIVE_WINDOW_MS) {
  return mtimes.filter((t) => now - t <= windowMs).length;
}

// Best-effort de-slugging: strip the home-dir prefix, then the common
// "Code-" parent. Dashes inside real dir names are indistinguishable from
// path separators, so this is a heuristic — good enough for a glance.
export function projectNameFromSlug(slug, homeSlug = HOME_SLUG) {
  let name = slug.startsWith(homeSlug) ? slug.slice(homeSlug.length) : slug;
  name = name.replace(/^-/, '').replace(/^Code-/, '');
  return name || '~';
}

export async function fetchActiveSessions() {
  let entries;
  try {
    entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return { activeSessions: 0, projects: [] }; // no ~/.claude/projects
  }
  const perDir = await Promise.all(
    entries.filter((e) => e.isDirectory()).map(async (e) => {
      const dir = path.join(PROJECTS_DIR, e.name);
      let files;
      try {
        files = await readdir(dir);
      } catch {
        return { slug: e.name, mtimes: [] };
      }
      const mtimes = await Promise.all(
        files
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => stat(path.join(dir, f)).then((s) => s.mtimeMs, () => 0)),
      );
      return { slug: e.name, mtimes };
    }),
  );
  const now = Date.now();
  let activeSessions = 0;
  const projects = new Set();
  for (const { slug, mtimes } of perDir) {
    const n = countActive(mtimes, now);
    if (n > 0) {
      activeSessions += n;
      projects.add(projectNameFromSlug(slug));
    }
  }
  return { activeSessions, projects: [...projects].sort() };
}
