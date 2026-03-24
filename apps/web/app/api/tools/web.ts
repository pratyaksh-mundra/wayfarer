import { createHash } from 'crypto'
import { createServiceClient } from '@wayfarer/core/api/supabase'
import type { SearchWebInput, SearchWebOutput, WebResult } from '@wayfarer/core/types'

// Google Custom Search JSON API
// Docs: https://developers.google.com/custom-search/v1/overview
// Free tier: 100 queries/day. Shares the same Google Cloud project as Places.
// Setup: Enable "Custom Search API" in Google Cloud Console, create a CSE at cse.google.com.

const WEB_CACHE_TTL_HOURS = 48

// Curated travel domains the CSE is encouraged to surface
const TRAVEL_DOMAINS = [
  'lonelyplanet.com',
  'tripadvisor.com',
  'timeout.com',
  'theculturetrip.com',
  'travelandleisure.com',
  'roughguides.com',
  'nomadicmatt.com',
  'frommers.com',
  'atlasobscura.com',
  'eater.com',
]

function cseApiKey(): string {
  const key = process.env['GOOGLE_CSE_API_KEY']
  if (!key) throw new Error('Missing GOOGLE_CSE_API_KEY')
  return key
}

function cseId(): string {
  const id = process.env['GOOGLE_CSE_ID']
  if (!id) throw new Error('Missing GOOGLE_CSE_ID')
  return id
}

function webCacheKey(input: SearchWebInput): string {
  return createHash('md5')
    .update(`${input.destination}${input.query}${input.focus ?? 'general'}`)
    .digest('hex')
}

export async function searchWeb(input: SearchWebInput): Promise<SearchWebOutput> {
  const supabase = createServiceClient()
  const key = webCacheKey(input)

  // Check cache first
  const { data: cached } = await supabase
    .from('web_search_cache')
    .select('results, cached_at, hit_count')
    .eq('query_hash', key)
    .single()

  if (cached) {
    const ageHours = (Date.now() - new Date(cached.cached_at as string).getTime()) / (1000 * 60 * 60)
    if (ageHours < WEB_CACHE_TTL_HOURS) {
      await supabase
        .from('web_search_cache')
        .update({ hit_count: (cached.hit_count as number) + 1 })
        .eq('query_hash', key)
      return cached.results as SearchWebOutput
    }
  }

  // Cache miss — fetch live
  const result = await fetchLiveWebSearch(input)

  // Write to cache
  await supabase.from('web_search_cache').upsert({
    query_hash: key,
    destination: input.destination,
    query: input.query,
    focus: input.focus ?? 'general',
    results: result,
    cached_at: new Date().toISOString(),
    hit_count: 0,
  })

  return result
}

async function fetchLiveWebSearch(input: SearchWebInput): Promise<SearchWebOutput> {
  const focusPrefix: Record<NonNullable<SearchWebInput['focus']>, string> = {
    things_to_do: 'best things to do',
    food: 'best restaurants food',
    accommodation: 'best hotels where to stay',
    general: 'travel guide',
  }
  const prefix = focusPrefix[input.focus ?? 'general']
  const fullQuery = `${prefix} ${input.destination} ${input.query}`

  const siteFilter = TRAVEL_DOMAINS.map((d) => `site:${d}`).join(' OR ')
  const finalQuery = `${fullQuery} (${siteFilter})`

  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', cseApiKey())
  url.searchParams.set('cx', cseId())
  url.searchParams.set('q', finalQuery)
  url.searchParams.set('num', '5')

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Google Custom Search failed: ${res.statusText}`)
  }

  const data = (await res.json()) as {
    items?: Array<{
      title: string
      link: string
      snippet: string
      displayLink: string
    }>
  }

  const results: WebResult[] = (data.items ?? []).map((item) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet,
    source: item.displayLink,
  }))

  return { results }
}
