import { createServiceClient } from '@wayfarer/core/api/supabase'
import { randomUUID } from 'crypto'
import { checkRateLimit, getClientIp, rateLimitResponse } from '../_lib/rateLimit'

function generateShareToken(): string {
  return randomUUID().split('-')[0]!
}

// POST /api/create
// Body: { destination: string, duration_days: number }
// Creates a pending itinerary row synchronously and returns the ID.
// The client redirects to /plan/[id]?prompt=... immediately.
// Generation happens on the plan page via /api/generate.

export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await checkRateLimit(ip, '/api/create')
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSecs)

  const body = (await req.json()) as { destination?: string; duration_days?: number }
  const { destination, duration_days } = body

  if (!destination || !duration_days) {
    return new Response(JSON.stringify({ error: 'destination and duration_days required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (destination.length > 200) {
    return new Response(JSON.stringify({ error: 'Destination too long (max 200 chars)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (duration_days < 1 || duration_days > 14) {
    return new Response(JSON.stringify({ error: 'duration_days must be between 1 and 14' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('itineraries')
    .insert({
      destination,
      duration_days,
      share_token: generateShareToken(),
      status: 'planning',
      trip_context: {
        current_day: 1,
        trip_start_date: '',
        last_completed_stop: null,
        next_planned_stop: null,
        hotel: null,
        destination,
        food_preferences: {
          dietary: [],
          cuisines_liked: [],
          cuisines_skipped: [],
          price_range: 'mid',
        },
        activity_preferences: {
          pace: 'moderate',
          liked_categories: [],
          skipped_place_ids: [],
        },
        completed_stops: [],
        mood_updates: [],
      },
    })
    .select('id')
    .single()

  if (error || !data) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Failed to create itinerary' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ itinerary_id: data.id }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
