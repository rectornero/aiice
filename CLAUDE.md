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
