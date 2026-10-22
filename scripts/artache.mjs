#!/usr/bin/env node
// Posts AI-ICE progress to the Artache Updates feed and Studio (https://artache.netlify.app).
// No dependencies, so it runs from a terminal, CI or a Netlify function.
//
//   node scripts/artache.mjs post "Deck builder is live" --body "..." --kind release --url https://...
//   node scripts/artache.mjs work rectornero/aiice:play-app --kind platform --status published --url https://...
//   node scripts/artache.mjs recent [--limit 10]
//
// Reads ARTACHE_TOKEN (and optional ARTACHE_URL) from the environment, or ~/.artache.json
// ({ "url": "...", "token": "art_..." }). --dry-run prints the request instead of sending it.
// Never commit a token: it can post and edit works as its owner.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ARTACHE_PROJECT = 'rectornero/aiice'
const DEFAULT_URL = 'https://artache.netlify.app'
export const POST_KINDS = ['release', 'milestone', 'update', 'question', 'note']
export const WORK_KINDS = ['platform', 'article', 'work']
export const WORK_STATUSES = ['idea', 'drafting', 'in_progress', 'review', 'published', 'archived']

export function artacheConfig(env = process.env) {
  let file = {}
  try {
    file = JSON.parse(readFileSync(join(homedir(), '.artache.json'), 'utf8'))
  } catch {
    // no config file: environment only
  }
  return {
    url: (env.ARTACHE_URL || file.url || DEFAULT_URL).replace(/\/+$/, ''),
    token: env.ARTACHE_TOKEN || file.token || '',
  }
}

/** Builds the HTTP request for an Artache API call; kept separate so --dry-run and tests can inspect it. */
export function buildRequest(config, method, path, body) {
  const headers = { Authorization: `Bearer ${config.token}` }
  if (body) headers['Content-Type'] = 'application/json'
  return { url: config.url + path, init: { method, headers, body: body ? JSON.stringify(body) : undefined } }
}

async function send(config, method, path, body, fetchImpl = fetch) {
  if (!config.token) throw new Error('ARTACHE_TOKEN is not set (env or ~/.artache.json)')
  const { url, init } = buildRequest(config, method, path, body)
  const res = await fetchImpl(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`Artache ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

export function updatePayload({ title, body, kind = 'update', url, author, session_id, project = ARTACHE_PROJECT }) {
  if (!title) throw new Error('title is required')
  if (!POST_KINDS.includes(kind)) throw new Error(`kind must be one of ${POST_KINDS.join(', ')}`)
  const payload = { project, title: title.slice(0, 100), kind }
  for (const [k, v] of Object.entries({ body, url, author, session_id })) if (v) payload[k] = v
  return payload
}

export function workPayload({ key, ...fields }) {
  if (!key) throw new Error('key is required, e.g. "rectornero/aiice:play-app"')
  if (fields.kind && !WORK_KINDS.includes(fields.kind)) throw new Error(`kind must be one of ${WORK_KINDS.join(', ')}`)
  if (fields.status && !WORK_STATUSES.includes(fields.status)) {
    throw new Error(`status must be one of ${WORK_STATUSES.join(', ')}`)
  }
  // Fields left out keep their current value in Artache, so only send what was given.
  const payload = { key }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') payload[k] = v
  return payload
}

export const postUpdate = (fields, config = artacheConfig(), fetchImpl) =>
  send(config, 'POST', '/api/v1/posts', updatePayload(fields), fetchImpl)

export const upsertWork = (fields, config = artacheConfig(), fetchImpl) =>
  send(config, 'POST', '/api/v1/works', workPayload({ project: ARTACHE_PROJECT, ...fields }), fetchImpl)

export const recentUpdates = (limit = 10, config = artacheConfig(), fetchImpl) =>
  send(config, 'GET', `/api/v1/posts?project=${encodeURIComponent(ARTACHE_PROJECT)}&limit=${limit}`, undefined, fetchImpl)

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) positional.push(a)
    else if (a === '--dry-run') flags.dryRun = true
    else flags[a.slice(2).replace(/-/g, '_')] = argv[++i]
  }
  return { positional, flags }
}

async function main(argv) {
  const [command, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  const { dryRun, limit, tags, ...fields } = flags
  const config = artacheConfig()
  let call
  if (command === 'post') {
    call = ['POST', '/api/v1/posts', updatePayload({ title: positional[0], ...fields })]
  } else if (command === 'work') {
    const tagList = tags ? tags.split(',').map((t) => t.trim()) : undefined
    call = ['POST', '/api/v1/works', workPayload({ key: positional[0], project: ARTACHE_PROJECT, tags: tagList, ...fields })]
  } else if (command === 'recent') {
    call = ['GET', `/api/v1/posts?project=${encodeURIComponent(fields.project || ARTACHE_PROJECT)}&limit=${limit || 10}`]
  } else {
    console.error('usage: artache.mjs post <title> [--body --kind --url --author --session-id --project]')
    console.error('       artache.mjs work <key> [--kind --status --title --url --summary --body --tags a,b]')
    console.error('       artache.mjs recent [--limit N]          (add --dry-run to any command)')
    process.exit(2)
  }
  if (dryRun) {
    const { url, init } = buildRequest({ ...config, token: config.token ? 'art_…' : '(missing)' }, ...call)
    console.log(init.method, url)
    if (init.body) console.log(JSON.stringify(JSON.parse(init.body), null, 2))
    return
  }
  console.log(JSON.stringify(await send(config, ...call), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
