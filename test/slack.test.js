// Unit tests for the pure Slack reduction (lib/slack.js summarizeUnreads) —
// the bucket math the whole Slack half of the dashboard rests on. Network
// calls are deliberately untested; the sweep is exercised against the live
// API. Fixtures mirror real conversations.info `channel` objects.

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUnreads } from '../lib/slack.js';

test('DMs and group DMs sum into mentionsAndDms', () => {
  const out = summarizeUnreads([
    { is_im: true, unread_count_display: 2 },
    { is_mpim: true, unread_count_display: 3 },
    { is_im: true, unread_count_display: 0 },
  ]);
  assert.deepEqual(out, { mentionsAndDms: 5, otherUnreadChannels: 0 });
});

test('channels count once each regardless of unread volume', () => {
  const out = summarizeUnreads([
    { is_channel: true, unread_count_display: 41 },
    { is_channel: true, unread_count_display: 1 },
    { is_channel: true, unread_count_display: 0 },
  ]);
  assert.deepEqual(out, { mentionsAndDms: 0, otherUnreadChannels: 2 });
});

test('missing unread fields are treated as zero', () => {
  const out = summarizeUnreads([{ is_im: true }, { is_channel: true }]);
  assert.deepEqual(out, { mentionsAndDms: 0, otherUnreadChannels: 0 });
});

test('falls back to unread_count when unread_count_display absent', () => {
  const out = summarizeUnreads([{ is_im: true, unread_count: 4 }]);
  assert.equal(out.mentionsAndDms, 4);
});
