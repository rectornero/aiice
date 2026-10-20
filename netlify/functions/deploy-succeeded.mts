// Netlify runs a function with this name after every successful deploy of the site.
// Production deploys are posted to the Artache Updates feed as a release; previews are skipped.
// Needs the ARTACHE_TOKEN environment variable on the Netlify site; without it this does nothing.
import { postUpdate, artacheConfig } from '../../scripts/artache.mjs'

type Deploy = {
  context?: string
  title?: string
  commit_ref?: string
  commit_url?: string
  ssl_url?: string
  url?: string
  name?: string
}

export function deployUpdate(deploy: Deploy) {
  if (deploy.context && deploy.context !== 'production') return null
  const site = deploy.ssl_url || deploy.url
  const commit = deploy.commit_ref ? deploy.commit_ref.slice(0, 7) : null
  const message = deploy.title?.split('\n')[0].trim()
  return {
    kind: 'release',
    title: message ? `Deployed: ${message}` : 'New version of the play app is live',
    body: [
      `A new production build of the AI-ICE play app is live${site ? ` at ${site}` : ''}.`,
      commit ? `Commit ${deploy.commit_url ? `[${commit}](${deploy.commit_url})` : commit}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    url: site,
    author: 'Netlify deploy',
  }
}

export default async (req: Request) => {
  const config = artacheConfig()
  if (!config.token) return new Response('ARTACHE_TOKEN not set, skipped')
  const { payload } = (await req.json()) as { payload: Deploy }
  const update = deployUpdate(payload ?? {})
  if (!update) return new Response('not a production deploy, skipped')
  try {
    await postUpdate(update, config)
  } catch (e) {
    // A failed post must never fail the deploy.
    console.error(e)
  }
  return new Response('ok')
}
