// Unit tests for the pure Slack reduction (lib/slack.js summarizeUnreads) —
// the bucket math the whole Slack half of the dashboard rests on. Both
// buckets count CONVERSATIONS with unreads (message sums saturate on
// never-opened bot DMs); bot detection happens in the fetch layer and
// arrives here as an isBot flag. Network calls are deliberately untested;
// the sweep is exercised against the live API. Fixtures mirror real
// conversations.info `channel` objects.

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUnreads } from '../lib/slack.js';

test('DMs and group DMs count once per conversation, not per message', () => {
  const out = summarizeUnreads([
    { is_im: true, unread_count_display: 400 },
    { is_mpim: true, unread_count_display: 3 },
    { is_im: true, unread_count_display: 0 },
  ]);
  assert.deepEqual(out, { mentionsAndDms: 2, otherUnreadChannels: 0 });
});

test('bot DMs are excluded from the count', () => {
  const out = summarizeUnreads([
    { is_im: true, unread_count_display: 1000, isBot: true },
    { is_im: true, unread_count_display: 1 },
  ]);
  assert.deepEqual(out, { mentionsAndDms: 1, otherUnreadChannels: 0 });
});

test('a DM whose only unread is a joined-Slack prompt does not count', () => {
  const out = summarizeUnreads([
    { is_im: true, unread_count_display: 1, latest: { subtype: 'joiner_notification' } },
    { is_im: true, unread_count_display: 2, latest: { subtype: 'joiner_notification' } }, // real msg on top
    { is_im: true, unread_count_display: 1, latest: {} },
  ]);
  assert.equal(out.mentionsAndDms, 2);
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
  assert.equal(out.mentionsAndDms, 1);
});
