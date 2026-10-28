# AI-ICE

Web app to play the AI-ICE trading card game. See README.md for the code layout.

## Artache
This studio tracks its work in Artache. The `artache` MCP tools talk to it.
- No `artache` tools in this session (cloud sessions)? Use the same API over HTTPS with the `ARTACHE_TOKEN`
  environment variable: `curl -sS https://artache.netlify.app/api/v1/inbox?project=rectornero/aiice -H "Authorization: Bearer $ARTACHE_TOKEN"`
  for the inbox, and POST JSON (`project`, `kind`, `title`, `body`, `url`, `brief_id`) to `/api/v1/posts` for
  updates. Briefs: POST `/api/v1/briefs/<id>` with `status`; replies: POST `/api/v1/replies`.
  `node scripts/artache.mjs` wraps the posts and works endpoints. If neither works, skip posting and mention it
  in your reply instead of failing the task.
- At the start of a session, call `artache_inbox` with `rectornero/aiice` to see briefs and studio replies for
  this project. Briefs come first: accept one with `artache_update_brief` before starting, say what blocks you
  in a reply, and mark it done with a `result_url` when finished. Answer studio replies with `artache_reply`.
- After meaningful progress (a feature or fix merged, a release or deploy, a milestone, a decision, or a
  question the team must answer), post one update with `artache_post_update` (with `brief_id` when it delivers
  a brief). Use `rectornero/aiice` as `project`.
- Write the title for someone who didn't see the session (under 100 characters). In the body: what changed,
  why it matters, what's next. Add a `url` to the PR, deploy or doc when there is one.
- Use kind `release` for something shipped, `milestone` for a big step, `question` when you need a human
  decision, `note` for context, `update` otherwise.
- Production deploys already post a `release` on their own (`netlify/functions/deploy-succeeded.mts`), so don't
  post a second update just for a deploy; post about what the work changed.
- Don't post for trivial edits, failed attempts or work in progress with nothing to show. One update per
  meaningful result; check `artache_recent_updates` if unsure whether it was already posted.
- When you create or publish a platform, article or other work, record it with `artache_upsert_work` and a
  stable `key` like "rectornero/aiice:play-app" or "rectornero/aiice:rulebook", so later changes update the
  same item.
- Never put an Artache token (`art_…`) in this repo, a `.mcp.json` or a commit.

## Netlify credits
All of Nero's sites share one Netlify credit balance (team "overgame-director", 1,000 credits a month on the
Personal plan). When it hits zero, every site is paused. Prices: production deploy 15 credits; compute and
database compute 10 per GB-hour; bandwidth 20 per GB; web requests 2 per 10,000; AI Gateway 180 per USD.
Deploy Previews and branch deploys are free. The database suspends after about 5 idle minutes; anything that
keeps waking it costs credits around the clock.
- No scheduled job or polling loop touches the database on every run. Gate it on a cheap check, such as a
  Blobs note of when there is next work, or use delayed or event-driven scheduling instead of polling.
- Client polling is never faster than 60 seconds.
- No Netlify AI Gateway unless Nero approves it.
- Test on branches (free). Batch changes into as few production deploys as possible (every push or merge to
  `main` is a production deploy), and ask Nero before deploying while credits are low.
- Before adding any schedule, polling or production deploy, estimate its monthly credits and say the number.
- Known exception under review: the online relay (`src/net/transport.ts`) polls `/api/relay` every second
  during a match. Nero is deciding how it should live with the 60-second rule; don't make it faster or add
  new callers.
