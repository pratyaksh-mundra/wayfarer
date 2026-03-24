import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Must be declared before importing the module under test

const mockUpsert = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
})

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

const FAKE_PLACE = {
  candidates: [
    {
      geometry: { location: { lat: 11.934, lng: 79.836 } },
      opening_hours: { weekday_text: ['Mon: 8am-6pm'] },
      rating: 4.5,
      user_ratings_total: 230,
      place_id: 'PLACE123',
      photos: [{ photo_reference: 'PHOTOREF' }],
      price_level: 1,
    },
  ],
}

const FAKE_REVIEWS = {
  result: {
    reviews: [
      { author_name: 'Alice', rating: 5, text: 'Amazing place!', time: 1700000000 },
      { author_name: 'Bob', rating: 4, text: 'Very nice.', time: 1699000000 },
    ],
  },
}

function makeFetchMock(findData: unknown, reviewData: unknown) {
  return vi.fn().mockImplementation((url: string) => {
    const isReviews = (url as string).includes('details')
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(isReviews ? reviewData : findData),
    })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('lookupPlace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingleResult = { data: null, error: null }
    process.env['GOOGLE_PLACES_API_KEY'] = 'test-key'
  })

  it('returns cached result without calling fetch when cache is fresh', async () => {
    const freshCachedAt = new Date(Date.now() - 1000 * 60 * 60).toISOString() // 1hr ago
    mockSingleResult = {
      data: {
        result: { lat: 11.934, lng: 79.836, rating: 4.5, place_id: 'CACHED', reviews: [], hours: '', user_ratings_total: 100, photo_url: '', price_level: 1 },
        cached_at: freshCachedAt,
        hit_count: 3,
      },
      error: null,
    }

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { lookupPlace } = await import('../../app/api/tools/places')
    const result = await lookupPlace({ place_name: 'Promenade Beach', city: 'Pondicherry' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.place_id).toBe('CACHED')
  })

  it('fetches live data on cache miss', async () => {
    mockSingleResult = { data: null, error: null } // no cache

    vi.stubGlobal('fetch', makeFetchMock(FAKE_PLACE, FAKE_REVIEWS))

    const { lookupPlace } = await import('../../app/api/tools/places')
    const result = await lookupPlace({ place_name: 'Promenade Beach', city: 'Pondicherry' })

    expect(result.place_id).toBe('PLACE123')
    expect(result.lat).toBe(11.934)
    expect(result.reviews.length).toBeGreaterThan(0)
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('fetches live data when cache is stale (>168 hours)', async () => {
    const staleCachedAt = new Date(Date.now() - 1000 * 60 * 60 * 200).toISOString() // 200hr ago
    mockSingleResult = {
      data: {
        result: { lat: 0, lng: 0, rating: 1, place_id: 'STALE', reviews: [], hours: '', user_ratings_total: 0, photo_url: '', price_level: 0 },
        cached_at: staleCachedAt,
        hit_count: 0,
      },
      error: null,
    }

    vi.stubGlobal('fetch', makeFetchMock(FAKE_PLACE, FAKE_REVIEWS))

    const { lookupPlace } = await import('../../app/api/tools/places')
    const result = await lookupPlace({ place_name: 'Promenade Beach', city: 'Pondicherry' })

    expect(result.place_id).toBe('PLACE123') // fresh result, not stale
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('throws when no candidates returned from Google', async () => {
    mockSingleResult = { data: null, error: null }
    vi.stubGlobal('fetch', makeFetchMock({ candidates: [] }, {}))

    const { lookupPlace } = await import('../../app/api/tools/places')
    await expect(lookupPlace({ place_name: 'Nonexistent Place XYZ', city: 'Nowhere' })).rejects.toThrow(
      /No results found/
    )
  })

  it('throws when GOOGLE_PLACES_API_KEY is missing', async () => {
    delete process.env['GOOGLE_PLACES_API_KEY']
    mockSingleResult = { data: null, error: null }

    const { lookupPlace } = await import('../../app/api/tools/places')
    await expect(lookupPlace({ place_name: 'Beach', city: 'City' })).rejects.toThrow(
      /GOOGLE_PLACES_API_KEY/
    )
  })
})
