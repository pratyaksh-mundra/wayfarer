import { createHash } from 'crypto'
import { createServiceClient } from '@wayfarer/core/api/supabase'
import type { LookupPlaceInput, PlaceLookupResult, SearchNearbyInput, SearchNearbyOutput, NearbyPlace, GoogleReview } from '@wayfarer/core/types'
import { cleanText } from './text'

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place'
const PLACES_CACHE_TTL_HOURS = 168 // 7 days — place details change rarely

function apiKey(): string {
  const key = process.env['GOOGLE_PLACES_API_KEY']
  if (!key) throw new Error('Missing GOOGLE_PLACES_API_KEY')
  return key
}

function placesCacheKey(input: LookupPlaceInput): string {
  return createHash('md5')
    .update(`${input.place_name}${input.city}${input.type ?? ''}`)
    .digest('hex')
}

export async function lookupPlace(input: LookupPlaceInput): Promise<PlaceLookupResult> {
  const supabase = createServiceClient()
  const key = placesCacheKey(input)

  // Check cache first
  const { data: cached } = await supabase
    .from('places_cache')
    .select('result, cached_at')
    .eq('query_hash', key)
    .single()

  if (cached) {
    const ageHours = (Date.now() - new Date(cached.cached_at as string).getTime()) / (1000 * 60 * 60)
    if (ageHours < PLACES_CACHE_TTL_HOURS) {
      await supabase
        .from('places_cache')
        .update({ hit_count: (cached as unknown as { hit_count: number }).hit_count + 1 })
        .eq('query_hash', key)
      return cached.result as PlaceLookupResult
    }
  }

  // Cache miss — fetch live
  const result = await fetchLivePlace(input)

  // Write to cache
  await supabase.from('places_cache').upsert({
    query_hash: key,
    place_name: input.place_name,
    city: input.city,
    result,
    cached_at: new Date().toISOString(),
    hit_count: 0,
  })

  return result
}

async function fetchLivePlace(input: LookupPlaceInput): Promise<PlaceLookupResult> {
  const query = `${input.place_name} ${input.city}${input.type ? ` ${input.type}` : ''}`
  const findUrl = `${PLACES_BASE}/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=geometry,opening_hours,rating,user_ratings_total,place_id,photos,price_level&key=${apiKey()}`

  const findRes = await fetch(findUrl)
  if (!findRes.ok) throw new Error(`Places lookup failed: ${findRes.statusText}`)

  const findData = (await findRes.json()) as {
    candidates: Array<{
      geometry: { location: { lat: number; lng: number } }
      opening_hours?: { weekday_text?: string[] }
      rating?: number
      user_ratings_total?: number
      place_id: string
      photos?: Array<{ photo_reference: string }>
      price_level?: number
    }>
  }

  const candidate = findData.candidates[0]
  if (!candidate) {
    throw new Error(`No results found for "${input.place_name}" in ${input.city}`)
  }

  const photoRef = candidate.photos?.[0]?.photo_reference
  const photoUrl = photoRef
    ? `${PLACES_BASE}/photo?maxwidth=800&photoreference=${photoRef}&key=${apiKey()}`
    : ''

  const reviews = await fetchPlaceReviews(candidate.place_id)

  return {
    lat: candidate.geometry.location.lat,
    lng: candidate.geometry.location.lng,
    hours: candidate.opening_hours?.weekday_text?.join('; ') ?? '',
    rating: candidate.rating ?? 0,
    user_ratings_total: candidate.user_ratings_total ?? 0,
    place_id: candidate.place_id,
    photo_url: photoUrl,
    price_level: candidate.price_level ?? 0,
    reviews,
  }
}

async function fetchPlaceReviews(placeId: string): Promise<GoogleReview[]> {
  const url = `${PLACES_BASE}/details/json?place_id=${placeId}&fields=reviews&reviews_sort=most_relevant&key=${apiKey()}`

  try {
    const res = await fetch(url)
    if (!res.ok) return []

    const data = (await res.json()) as {
      result?: {
        reviews?: Array<{
          author_name: string
          rating: number
          text: string
          time: number
        }>
      }
    }

    // Keep top 3 reviews, clean and truncate text — reviews can be very verbose
    return (data.result?.reviews ?? []).slice(0, 3).map((r) => ({
      author: r.author_name,
      rating: r.rating,
      text: cleanText(r.text, 150),
      time: r.time,
    }))
  } catch {
    // Reviews are best-effort — never block the main lookup
    return []
  }
}

export async function searchNearby(input: SearchNearbyInput): Promise<SearchNearbyOutput> {
  const radiusMeters = Math.round(input.radius_km * 1000)
  const typeParam = input.type ? `&type=${input.type}` : ''
  const url = `${PLACES_BASE}/nearbysearch/json?location=${input.lat},${input.lng}&radius=${radiusMeters}&keyword=${encodeURIComponent(input.keyword)}${typeParam}&key=${apiKey()}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Nearby search failed: ${res.statusText}`)

  const data = (await res.json()) as {
    results: Array<{
      name: string
      geometry: { location: { lat: number; lng: number } }
      place_id: string
      rating?: number
      opening_hours?: { open_now?: boolean }
      price_level?: number
    }>
  }

  const places: NearbyPlace[] = data.results.slice(0, 5).map((r) => {
    // Estimate travel time: assume ~5 min/km walking
    const distKm = haversineKm(input.lat, input.lng, r.geometry.location.lat, r.geometry.location.lng)
    const distanceMins = Math.round(distKm * 12) // ~5 km/h walking pace

    return {
      name: r.name,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      place_id: r.place_id,
      distance_mins: distanceMins,
      rating: r.rating ?? 0,
      open_now: r.opening_hours?.open_now ?? false,
      price_level: r.price_level,
    }
  })

  return { places }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
