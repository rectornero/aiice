# AI-ICE

Web app to play the AI-ICE trading card game. See README.md for the code layout.

## Artache
This studio tracks its work in Artache. The `artache` MCP tools post there. When they are not available
(for example a cloud session without the connector), use `node scripts/artache.mjs` with `ARTACHE_TOKEN` set;
if neither works, skip posting and mention it in your reply instead of failing the task.
- After meaningful progress (a feature or fix merged, a release or deploy, a milestone, a decision, or a
  question the team must answer), post one update with `artache_post_update`. Use `rectornero/aiice` as
  `project`.
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
