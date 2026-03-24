import { createStreamingMessage, UPDATE_SYSTEM_PROMPT, type ConversationTurn } from '@wayfarer/core/api/claude'
import { createServiceClient } from '@wayfarer/core/api/supabase'
import { checkRateLimit, getClientIp, rateLimitResponse } from '../_lib/rateLimit'
import { searchReddit } from '../tools/reddit'
import { lookupPlace, searchNearby } from '../tools/places'
import { searchWeb } from '../tools/web'
import { updateItinerary } from '../tools/itinerary'
import type {
  TripContext,
  SearchRedditInput,
  SearchWebInput,
  LookupPlaceInput,
  SearchNearbyInput,
  UpdateItineraryInput,
} from '@wayfarer/core/types'

// POST /api/update
// Body: { itinerary_id: string, message: string, trip_context: TripContext }
// Streams SSE chunks back to the client.

export async function POST(req: Request) {
  // Rate limiting — 30 updates per IP per hour
  const ip = getClientIp(req)
  const rl = await checkRateLimit(ip, '/api/update')
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSecs)

  const body = (await req.json()) as {
    itinerary_id: string
    message: string
    trip_context: TripContext
    history?: ConversationTurn[]
  }

  const { itinerary_id, message, trip_context, history } = body

  if (!itinerary_id || !message) {
    return new Response(JSON.stringify({ error: 'itinerary_id and message are required' }), {
      status: 400,
    })
  }

  if (message.length > 1000) {
    return new Response(JSON.stringify({ error: 'Message too long (max 1000 chars)' }), { status: 400 })
  }

  // Validate itinerary_id is a UUID to prevent injection
  if (!/^[0-9a-f-]{36}$/.test(itinerary_id)) {
    return new Response(JSON.stringify({ error: 'Invalid itinerary_id' }), { status: 400 })
  }

  // Fetch current itinerary items + duration so Claude knows what's in the itinerary
  const supabase = createServiceClient()
  const [{ data: itin }, { data: currentItems }] = await Promise.all([
    supabase.from('itineraries').select('duration_days').eq('id', itinerary_id).single(),
    supabase
      .from('itinerary_items')
      .select('id, day_number, position, place_name, lat, lng, time_of_day, category, duration_mins, ai_note')
      .eq('itinerary_id', itinerary_id)
      .order('day_number')
      .order('position'),
  ])

  const durationDays = (itin as { duration_days: number } | null)?.duration_days ?? 3

  // Build a compact itinerary snapshot for Claude's context
  const itemsByDay = (currentItems ?? []).reduce<Record<number, typeof currentItems>>((acc, item) => {
    if (!item) return acc
    const day = item.day_number
    if (!acc[day]) acc[day] = []
    acc[day]!.push(item)
    return acc
  }, {})

  const itinerarySummary = Object.entries(itemsByDay)
    .map(([day, items]) => {
      const lines = (items ?? []).map(
        (it) =>
          `  - [id:${it!.id}] ${it!.time_of_day} | ${it!.place_name} | lat:${it!.lat}, lng:${it!.lng} | ${it!.category}`
      )
      return `Day ${day}:\n${lines.join('\n')}`
    })
    .join('\n\n')

  const fullContext = {
    ...trip_context,
    _current_itinerary: itinerarySummary || 'No items yet',
  }

  const encoder = new TextEncoder()

  function send(controller: ReadableStreamDefaultController, data: unknown) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = createStreamingMessage({
          userMessage: message,
          tripContext: JSON.stringify(fullContext, null, 2),
          systemPrompt: UPDATE_SYSTEM_PROMPT,
          history,
          tools: {
            search_reddit: async (input: SearchRedditInput) => {
              send(controller, { type: 'tool_call', tool: 'search_reddit', input })
              const result = await searchReddit(input)
              send(controller, { type: 'tool_result', tool: 'search_reddit', result })
              return result
            },
            search_web: async (input: SearchWebInput) => {
              send(controller, { type: 'tool_call', tool: 'search_web', input })
              const result = await searchWeb(input)
              send(controller, { type: 'tool_result', tool: 'search_web', result })
              return result
            },
            lookup_place: async (input: LookupPlaceInput) => {
              send(controller, { type: 'tool_call', tool: 'lookup_place', input })
              const result = await lookupPlace(input)
              send(controller, { type: 'tool_result', tool: 'lookup_place', result })
              return result
            },
            search_nearby: async (input: SearchNearbyInput) => {
              send(controller, { type: 'tool_call', tool: 'search_nearby', input })
              const result = await searchNearby(input)
              send(controller, { type: 'tool_result', tool: 'search_nearby', result })
              return result
            },
            update_itinerary: async (input: UpdateItineraryInput) => {
              send(controller, { type: 'tool_call', tool: 'update_itinerary', input })
              const result = await updateItinerary(
                { ...input, itinerary_id },
                trip_context.destination,
                durationDays
              )
              send(controller, { type: 'tool_result', tool: 'update_itinerary', result })
              return result
            },
          },
        })

        for await (const chunk of messageStream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            send(controller, { type: 'text', text: chunk.delta.text })
          }
        }

        send(controller, { type: 'done' })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[/api/update] error:', err)
        send(controller, { type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
