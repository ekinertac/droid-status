// Slack unread-count collector. Uses the OFFICIAL Web API with a user token
// (xoxp; scopes: channels:read groups:read im:read mpim:read) because unread
// state is per-user. Produces the two numbers the dashboard shows:
//   mentionsAndDms      — sum of unread messages across DMs and group DMs
//   otherUnreadChannels — count of channels that have any unreads
// Known accepted limitation (see spec): an @mention inside a channel is NOT
// promoted to the first bucket — the official API doesn't expose mention
// counts, and the undocumented client API was ruled out during design.
// Rate limits shape this file: conversations.info is Tier 3 (~50/min), so the
// sweep is throttled to ~45/min and honors 429 Retry-After. A full sweep of a
// big workspace takes minutes; collector.js prevents overlapping sweeps.
// summarizeUnreads() is pure and unit-tested in test/slack.test.js.

const SLACK_API = 'https://slack.com/api';
const INFO_DELAY_MS = 1300; // ~46 req/min, safely under Tier 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function summarizeUnreads(conversations) {
  let mentionsAndDms = 0;
  let otherUnreadChannels = 0;
  for (const c of conversations) {
    const unread = c.unread_count_display ?? c.unread_count ?? 0;
    if (c.is_im || c.is_mpim) mentionsAndDms += unread;
    else if (unread > 0) otherUnreadChannels += 1;
  }
  return { mentionsAndDms, otherUnreadChannels };
}

async function slackCall(token, method, params, attempt = 0) {
  const url = new URL(`${SLACK_API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429 && attempt < 3) {
    const wait = (Number(res.headers.get('retry-after')) || 30) * 1000;
    await sleep(wait);
    return slackCall(token, method, params, attempt + 1);
  }
  const body = await res.json();
  if (!body.ok) throw new Error(`${method}: ${body.error}`);
  return body;
}

export async function fetchSlackSummary(token) {
  if (!token) throw new Error('token not configured (config.json → slackUserToken)');

  // users.conversations only returns conversations the token's user is in,
  // which is exactly the set that can have unreads for them.
  const conversations = [];
  let cursor = '';
  do {
    const page = await slackCall(token, 'users.conversations', {
      types: 'public_channel,private_channel,mpim,im',
      exclude_archived: 'true',
      limit: '200',
      ...(cursor ? { cursor } : {}),
    });
    conversations.push(...page.channels);
    cursor = page.response_metadata?.next_cursor ?? '';
  } while (cursor);

  const infos = [];
  for (const c of conversations) {
    const info = await slackCall(token, 'conversations.info', { channel: c.id });
    infos.push(info.channel);
    await sleep(INFO_DELAY_MS);
  }
  return summarizeUnreads(infos);
}
