import { createServiceClient } from '@wayfarer/core/api/supabase'
import type { SearchRedditInput, SearchRedditOutput, RedditPost, RedditComment } from '@wayfarer/core/types'
import { createHash } from 'crypto'
import { cleanText } from './text'

const CACHE_TTL_HOURS = 48

function cacheKey(destination: string, query: string): string {
  return createHash('md5').update(`${destination}${query}`).digest('hex')
}

async function fetchRedditPosts(
  query: string,
  subreddits: string[],
  limit: number
): Promise<{ posts: RedditPost[]; comments: RedditComment[] }> {
  const clientId = process.env['REDDIT_CLIENT_ID']
  const clientSecret = process.env['REDDIT_CLIENT_SECRET']

  if (!clientId || !clientSecret) {
    throw new Error('Missing REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET')
  }

  // Get OAuth token (app-only flow)
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'User-Agent': 'Wayfarer/1.0 (travel itinerary app)',
    },
    body: 'grant_type=client_credentials',
  })

  if (!tokenRes.ok) {
    throw new Error(`Reddit auth failed: ${tokenRes.statusText}`)
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string }

  const subredditStr = subreddits.join('+')
  const searchUrl = `https://oauth.reddit.com/r/${subredditStr}/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=${limit}&restrict_sr=true`

  const searchRes = await fetch(searchUrl, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'User-Agent': 'Wayfarer/1.0 (travel itinerary app)',
    },
  })

  if (!searchRes.ok) {
    throw new Error(`Reddit search failed: ${searchRes.statusText}`)
  }

  const data = (await searchRes.json()) as {
    data: {
      children: Array<{
        data: {
          id: string
          title: string
          selftext: string
          url: string
          score: number
          subreddit: string
          created_utc: number
          num_comments: number
        }
      }>
    }
  }

  const posts: RedditPost[] = data.data.children.map((child) => ({
    id: child.data.id,
    title: child.data.title,
    selftext: cleanText(child.data.selftext, 400),
    url: child.data.url,
    score: child.data.score,
    subreddit: child.data.subreddit,
    created_utc: child.data.created_utc,
    num_comments: child.data.num_comments,
  }))

  // TODO: fetch top comments for high-value posts (Phase 2)
  const comments: RedditComment[] = []

  return { posts, comments }
}

export async function searchReddit(input: SearchRedditInput): Promise<SearchRedditOutput> {
  const supabase = createServiceClient()
  const subreddits = input.subreddits ?? ['travel', 'solotravel', input.destination.toLowerCase().replace(/\s+/g, '')]
  const limit = input.limit ?? 5

  const allPosts: RedditPost[] = []
  const allComments: RedditComment[] = []

  for (const query of input.queries) {
    const key = cacheKey(input.destination, query)

    // Check cache first — mandatory per architecture rules
    const { data: cached } = await supabase
      .from('reddit_cache')
      .select('results, cached_at')
      .eq('query_hash', key)
      .single()

    if (cached) {
      const cachedAt = new Date(cached.cached_at as string)
      const ageHours = (Date.now() - cachedAt.getTime()) / (1000 * 60 * 60)

      if (ageHours < CACHE_TTL_HOURS) {
        // Cache hit — increment hit count and use cached results
        await supabase
          .from('reddit_cache')
          .update({ hit_count: (cached as unknown as { hit_count: number }).hit_count + 1 })
          .eq('query_hash', key)

        const cachedResult = cached.results as SearchRedditOutput
        allPosts.push(...cachedResult.posts)
        allComments.push(...cachedResult.comments)
        continue
      }
    }

    // Cache miss or expired — fetch live
    const result = await fetchRedditPosts(query, subreddits, limit)

    // Write to cache
    await supabase.from('reddit_cache').upsert({
      query_hash: key,
      destination: input.destination,
      results: result,
      cached_at: new Date().toISOString(),
      hit_count: 0,
    })

    allPosts.push(...result.posts)
    allComments.push(...result.comments)
  }

  return { posts: allPosts, comments: allComments }
}
