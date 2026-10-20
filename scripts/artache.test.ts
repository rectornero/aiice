import { describe, expect, it, vi } from 'vitest'
import { buildRequest, postUpdate, updatePayload, upsertWork, workPayload } from './artache.mjs'
import handler, { deployUpdate } from '../netlify/functions/deploy-succeeded.mts'

const config = { url: 'https://artache.test', token: 'art_test' }
const okFetch = () => vi.fn(async () => new Response('{"ok":true}', { status: 200 }))

describe('artache client', () => {
  it('posts updates to the AI-ICE project with only the given fields', async () => {
    const fetchImpl = okFetch()
    await postUpdate({ title: 'Deck builder merged', kind: 'update', url: 'https://x/pr/1' }, config, fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://artache.test/api/v1/posts')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer art_test')
    expect(JSON.parse(init.body as string)).toEqual({
      project: 'rectornero/aiice',
      title: 'Deck builder merged',
      kind: 'update',
      url: 'https://x/pr/1',
    })
  })

  it('rejects unknown kinds, missing titles and over-long titles', () => {
    expect(() => updatePayload({ title: 'x', kind: 'shipped' })).toThrow(/kind/)
    expect(() => updatePayload({ title: '' })).toThrow(/title/)
    expect(updatePayload({ title: 'a'.repeat(150) }).title).toHaveLength(100)
  })

  it('upserts works by key and leaves out fields that were not given', async () => {
    const fetchImpl = okFetch()
    await upsertWork({ key: 'rectornero/aiice:play-app', status: 'published' }, config, fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://artache.test/api/v1/works')
    expect(JSON.parse(init.body as string)).toEqual({
      key: 'rectornero/aiice:play-app',
      project: 'rectornero/aiice',
      status: 'published',
    })
    expect(() => workPayload({ key: 'k', status: 'done' })).toThrow(/status/)
    expect(() => workPayload({ status: 'idea' })).toThrow(/key/)
  })

  it('fails loudly without a token or on an HTTP error', async () => {
    await expect(postUpdate({ title: 't' }, { ...config, token: '' }, okFetch())).rejects.toThrow(/ARTACHE_TOKEN/)
    const bad = vi.fn(async () => new Response('nope', { status: 401 }))
    await expect(postUpdate({ title: 't' }, config, bad)).rejects.toThrow(/401/)
  })

  it('builds GET requests without a body', () => {
    const { init } = buildRequest(config, 'GET', '/api/v1/posts')
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })
})

describe('deploy-succeeded function', () => {
  it('turns a production deploy into a release update', () => {
    const update = deployUpdate({
      context: 'production',
      title: 'Card effects for SOFA-003\n\nlonger body',
      commit_ref: 'abcdef1234567',
      commit_url: 'https://github.com/rectornero/aiice/commit/abcdef1',
      ssl_url: 'https://ai-ice.netlify.app',
    })
    expect(update).toMatchObject({
      kind: 'release',
      title: 'Deployed: Card effects for SOFA-003',
      url: 'https://ai-ice.netlify.app',
    })
    expect(update!.body).toContain('[abcdef1](https://github.com/rectornero/aiice/commit/abcdef1)')
  })

  it('skips preview deploys', () => {
    expect(deployUpdate({ context: 'deploy-preview' })).toBeNull()
  })

  it('does nothing without ARTACHE_TOKEN', async () => {
    vi.stubEnv('ARTACHE_TOKEN', '')
    const res = await handler(new Request('https://x', { method: 'POST', body: '{"payload":{}}' }))
    expect(await res.text()).toMatch(/skipped/)
    vi.unstubAllEnvs()
  })
})
