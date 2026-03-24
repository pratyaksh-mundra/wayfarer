import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockUpsert = vi.fn().mockResolvedValue({ error: null })
const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })

let mockSingleResult: { data: unknown; error: null } = { data: null, error: null }
const mockSingle = vi.fn(() => Promise.resolve(mockSingleResult))
const mockEq = vi.fn(() => ({ single: mockSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  update: mockUpdate,
  upsert: mockUpsert,
}))

vi.mock('@wayfarer/core/api/supabase', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}))

// ── Fetch mock ────────────────────────────────────────────────────────────────

const FAKE_TOKEN_RESPONSE = { access_token: 'fake-token' }

const FAKE_REDDIT_RESPONSE = {
  data: {
    children: [
      {
        data: {
          id: 'abc123',
          title: 'Best things to do in Pondicherry',
          selftext: 'We visited the French Quarter and loved it. Promenade Beach is a must.',
          url: 'https://reddit.com/r/travel/abc123',
          score: 450,
          subreddit: 'travel',
          created_utc: 1700000000,
          num_comments: 23,
        },
      },
      {
        data: {
          id: 'def456',
          title: '3 days in Pondicherry itinerary',
          selftext: 'Day 1: White Town, Day 2: Auroville, Day 3: beaches.',
          url: 'https://reddit.com/r/solotravel/def456',
          score: 280,
          subreddit: 'solotravel',
          created_utc: 1699000000,
          num_comments: 15,
        },
      },
    ],
  },
}

function makeFetchMock() {
  return vi.fn().mockImplementation((url: string) => {
    if ((url as string).includes('access_token')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_TOKEN_RESPONSE) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_REDDIT_RESPONSE) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('searchReddit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingleResult = { data: null, error: null }
    process.env['REDDIT_CLIENT_ID'] = 'test-client-id'
    process.env['REDDIT_CLIENT_SECRET'] = 'test-client-secret'
  })

  it('returns cached results without calling fetch when cache is fresh', async () => {
    const freshCachedAt = new Date(Date.now() - 1000 * 60 * 30).toISOString() // 30min ago
    const cachedOutput = {
      posts: [{ id: 'cached1', title: 'Cached post', selftext: 'text', url: '', score: 100, subreddit: 'travel', created_utc: 0, num_comments: 5 }],
      comments: [],
    }
    mockSingleResult = {
      data: { results: cachedOutput, cached_at: freshCachedAt, hit_count: 2 },
      error: null,
    }

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { searchReddit } = await import('../../app/api/tools/reddit')
    const result = await searchReddit({ destination: 'Pondicherry', queries: ['best things to do'] })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.posts[0]?.id).toBe('cached1')
    expect(mockUpdateEq).toHaveBeenCalled() // hit_count incremented
  })

  it('fetches live data on cache miss and writes to cache', async () => {
    mockSingleResult = { data: null, error: null }
    vi.stubGlobal('fetch', makeFetchMock())

    const { searchReddit } = await import('../../app/api/tools/reddit')
    const result = await searchReddit({ destination: 'Pondicherry', queries: ['best things to do'] })

    expect(result.posts.length).toBe(2)
    expect(result.posts[0]?.id).toBe('abc123')
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('fetches live data when cache is stale (>48 hours)', async () => {
    const staleCachedAt = new Date(Date.now() - 1000 * 60 * 60 * 60).toISOString() // 60hr ago
    mockSingleResult = {
      data: {
        results: { posts: [{ id: 'stale1', title: 'Old post' }], comments: [] },
        cached_at: staleCachedAt,
        hit_count: 0,
      },
      error: null,
    }
    vi.stubGlobal('fetch', makeFetchMock())

    const { searchReddit } = await import('../../app/api/tools/reddit')
    const result = await searchReddit({ destination: 'Pondicherry', queries: ['best things to do'] })

    // Should return fresh data, not stale
    expect(result.posts[0]?.id).toBe('abc123')
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('runs one fetch per query when all are cache misses', async () => {
    mockSingleResult = { data: null, error: null }
    const fetchSpy = makeFetchMock()
    vi.stubGlobal('fetch', fetchSpy)

    const { searchReddit } = await import('../../app/api/tools/reddit')
    await searchReddit({ destination: 'Pondicherry', queries: ['things to do', 'hidden gems'] })

    // 2 queries × 2 fetches each (token + search) = 4 calls
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('throws when Reddit credentials are missing', async () => {
    delete process.env['REDDIT_CLIENT_ID']
    mockSingleResult = { data: null, error: null }

    const { searchReddit } = await import('../../app/api/tools/reddit')
    await expect(
      searchReddit({ destination: 'Pondicherry', queries: ['things to do'] })
    ).rejects.toThrow(/REDDIT_CLIENT_ID/)
  })

  it('truncates and cleans selftext via cleanText', async () => {
    const longRedditResponse = {
      data: {
        children: [
          {
            data: {
              id: 'long1',
              title: 'Long post',
              selftext: '**Bold intro** ' + 'A'.repeat(500), // way over 400 chars
              url: 'https://reddit.com/r/travel/long1',
              score: 100,
              subreddit: 'travel',
              created_utc: 1700000000,
              num_comments: 5,
            },
          },
        ],
      },
    }

    mockSingleResult = { data: null, error: null }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes('access_token')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_TOKEN_RESPONSE) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(longRedditResponse) })
    }))

    const { searchReddit } = await import('../../app/api/tools/reddit')
    const result = await searchReddit({ destination: 'Test', queries: ['query'] })

    const selftext = result.posts[0]?.selftext ?? ''
    expect(selftext.length).toBeLessThanOrEqual(400)
    expect(selftext).not.toContain('**') // markdown stripped
  })
})
