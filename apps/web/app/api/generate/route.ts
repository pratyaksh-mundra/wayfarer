import { createStreamingMessage } from '@wayfarer/core/api/claude'
import { checkRateLimit, getClientIp, rateLimitResponse } from '../_lib/rateLimit'
import { searchReddit } from '../tools/reddit'
import { lookupPlace, searchNearby } from '../tools/places'
import { searchWeb } from '../tools/web'
import { updateItinerary } from '../tools/itinerary'
import type {
  SearchRedditInput,
  SearchWebInput,
  LookupPlaceInput,
  SearchNearbyInput,
  UpdateItineraryInput,
} from '@wayfarer/core/types'

// POST /api/generate
// Body: { prompt: string }  e.g. "Pondicherry 3 days"
// Streams SSE chunks back to the client.

export async function POST(req: Request) {
  // Rate limiting — 5 generations per IP per hour
  const ip = getClientIp(req)
  const rl = await checkRateLimit(ip, '/api/generate')
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSecs)

  const body = (await req.json()) as {
    prompt?: string
    destination?: string
    duration_days?: number
    itinerary_id?: string  // pre-created row ID from /api/create
  }

  // Input validation
  const rawPrompt = body.prompt ?? ''
  if (rawPrompt.length > 500) {
    return new Response(JSON.stringify({ error: 'Prompt too long (max 500 chars)' }), { status: 400 })
  }

  // Accept either raw prompt or structured input
  const userMessage = body.prompt ?? `${body.destination} ${body.duration_days} days`
  const destination = body.destination ?? body.prompt ?? 'Unknown'
  const durationDays = body.duration_days ?? parseDuration(body.prompt ?? '')
  const preCreatedId = body.itinerary_id

  const encoder = new TextEncoder()

  function send(controller: ReadableStreamDefaultController, data: unknown) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  const stream = new ReadableStream({
    async start(controller) {
      let itineraryId: string | null = null

      try {
        const messageStream = createStreamingMessage({
          userMessage,
          model: 'claude-haiku-4-5-20251001',  // TODO: switch to claude-sonnet-4-6 for production
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
              // Pass pre-created ID so generate uses the existing row instead of creating a new one
              const inputWithId = preCreatedId && input.operation === 'generate'
                ? { ...input, itinerary_id: preCreatedId }
                : input
              const result = await updateItinerary(inputWithId, destination, durationDays)
              itineraryId = result.itinerary_id
              send(controller, { type: 'tool_result', tool: 'update_itinerary', result })
              return result
            },
          },
        })

        // Stream text chunks as they arrive
        for await (const chunk of messageStream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            send(controller, { type: 'text', text: chunk.delta.text })
          }
        }

        // If Claude never called update_itinerary, the itinerary is empty — report error
        if (!itineraryId) {
          console.error('[/api/generate] update_itinerary was never called by Claude')
          send(controller, { type: 'error', message: 'Claude did not save the itinerary. Please retry.' })
        } else {
          send(controller, { type: 'done', itinerary_id: itineraryId })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[/api/generate] error:', err)
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

function parseDuration(prompt: string): number {
  const match = prompt.match(/(\d+)\s*days?/i)
  return match ? parseInt(match[1]!, 10) : 3
}
