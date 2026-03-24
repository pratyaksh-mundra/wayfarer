import Anthropic from '@anthropic-ai/sdk'
import type {
  SearchRedditInput,
  SearchRedditOutput,
  LookupPlaceInput,
  PlaceLookupResult,
  SearchNearbyInput,
  SearchNearbyOutput,
  SearchWebInput,
  SearchWebOutput,
  UpdateItineraryInput,
  UpdateItineraryOutput,
} from '../types/index.js'

// All AI calls must go through this file. Never call the Anthropic SDK directly
// from a component or API route.

const anthropic = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY'],
})

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'search_reddit',
    description:
      'Search Reddit for travel advice about a destination. Results are cached 48hrs. Always call this first when generating an itinerary to ground recommendations in real community knowledge.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: {
          type: 'string',
          description: 'The travel destination, e.g. "Pondicherry"',
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Search queries to run, e.g. ["best things to do", "hidden gems", "food recommendations"]',
        },
        subreddits: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Specific subreddits to search. Defaults to r/travel, r/solotravel, and destination sub.',
        },
        limit: {
          type: 'number',
          description: 'Max posts per query. Defaults to 10.',
        },
      },
      required: ['destination', 'queries'],
    },
  },
  {
    name: 'lookup_place',
    description:
      'Validate a place exists via Google Places and get its coordinates, hours, and rating. Call this for every place identified from Reddit advice, and for hotel lookups.',
    input_schema: {
      type: 'object' as const,
      properties: {
        place_name: {
          type: 'string',
          description: 'Name of the place, e.g. "Promenade Beach"',
        },
        city: {
          type: 'string',
          description: 'City for disambiguation, e.g. "Pondicherry"',
        },
        type: {
          type: 'string',
          description: 'Optional place type: restaurant | hotel | attraction | cafe',
        },
      },
      required: ['place_name', 'city'],
    },
  },
  {
    name: 'search_nearby',
    description:
      'Find places near a coordinate. Used for real-time mood updates like "pizza near my last stop". Always return multiple candidates with distance and rating so the user can see the trade-off.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number', description: 'Latitude of center point' },
        lng: { type: 'number', description: 'Longitude of center point' },
        radius_km: {
          type: 'number',
          description: 'Search radius in kilometers',
        },
        keyword: {
          type: 'string',
          description: 'What to search for, e.g. "Neapolitan pizza wood-fired"',
        },
        type: {
          type: 'string',
          description: 'Google Places type filter, e.g. "restaurant" | "cafe"',
        },
      },
      required: ['lat', 'lng', 'radius_km', 'keyword'],
    },
  },
  {
    name: 'search_web',
    description:
      'Search travel websites (Lonely Planet, TripAdvisor, Timeout, Atlas Obscura, etc.) for destination guides and recommendations. Use this alongside search_reddit to cross-reference community advice with established travel sources.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'What to search for, e.g. "hidden temples" or "best seafood restaurants"',
        },
        destination: {
          type: 'string',
          description: 'The destination, e.g. "Pondicherry"',
        },
        focus: {
          type: 'string',
          enum: ['things_to_do', 'food', 'accommodation', 'general'],
          description: 'Narrows the search to a specific travel category.',
        },
      },
      required: ['query', 'destination'],
    },
  },
  {
    name: 'update_itinerary',
    description:
      'Write or patch an itinerary in the database. Call this after generating or modifying a plan. Supports: generate (full new itinerary), reorder, add_item, remove_item, swap_item.',
    input_schema: {
      type: 'object' as const,
      properties: {
        itinerary_id: {
          type: 'string',
          description: 'Existing itinerary ID. Omit for generate operation.',
        },
        operation: {
          type: 'string',
          enum: ['generate', 'reorder', 'add_item', 'remove_item', 'swap_item', 'set_hotel'],
          description: 'The operation to perform.',
        },
        days: {
          type: 'array',
          description: 'Full day-by-day itinerary. Required for generate and reorder.',
          items: {
            type: 'object',
            properties: {
              day_number: { type: 'number' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    place_name: { type: 'string' },
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                    google_place_id: { type: 'string' },
                    reddit_source_url: { type: 'string' },
                    time_of_day: {
                      type: 'string',
                      enum: ['morning', 'afternoon', 'evening'],
                    },
                    duration_mins: { type: 'number' },
                    ai_note: { type: 'string' },
                    category: { type: 'string' },
                    position: { type: 'number' },
                    added_by: {
                      type: 'string',
                      enum: ['ai', 'user', 'mood_update'],
                    },
                  },
                  required: ['place_name', 'lat', 'lng', 'time_of_day', 'duration_mins', 'category', 'position', 'added_by'],
                },
              },
            },
            required: ['day_number', 'items'],
          },
        },
        item: {
          type: 'object',
          description: 'Single item for add_item, remove_item, or swap_item.',
        },
        hotel: {
          type: 'object',
          description: 'Hotel/hostel for set_hotel operation.',
          properties: {
            name: { type: 'string' },
            lat: { type: 'number' },
            lng: { type: 'number' },
            google_place_id: { type: 'string' },
          },
          required: ['name', 'lat', 'lng'],
        },
        candidates: {
          type: 'array',
          description: 'Up to 10 extra recommended places NOT included in the main itinerary. Used only with operation "generate". These are great options the user can add later.',
          items: {
            type: 'object',
            properties: {
              place_name: { type: 'string' },
              lat: { type: 'number' },
              lng: { type: 'number' },
              google_place_id: { type: 'string' },
              reddit_source_url: { type: 'string' },
              time_of_day: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
              duration_mins: { type: 'number' },
              ai_note: { type: 'string' },
              category: { type: 'string' },
            },
            required: ['place_name', 'lat', 'lng', 'time_of_day', 'duration_mins', 'category'],
          },
        },
      },
      required: ['operation'],
    },
  },
]

// ─── System Prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are Wayfarer's AI travel planner. You MUST always end every response by calling update_itinerary — this is mandatory, never optional.

STRICT PREFERENCE RULES — apply before anything else:
- If the user says "no X", "avoid X", "not X", "without X" — NEVER include that activity/category. This is absolute.
- Examples: "no surfing" = exclude surf schools; "vegetarian" = no meat restaurants; "no beaches" = indoor/heritage focus.

MANDATORY WORKFLOW — follow every step:
1. Call search_reddit with 2 queries (e.g. "best things to do in X", "X itinerary") to get community tips.
   - Read how Redditors actually structured their trips. They often say things like "we did Auroville on day 2 as a day trip" or "everything in the French Quarter is walkable" — use this routing intelligence.
2. Call lookup_place for each place you plan to include (max 5-6 per day) to get exact coordinates and opening hours.
   - Use the hours returned to set time_of_day correctly. If a place closes at 6pm, it cannot be "evening". If it only opens in the morning, it must be "morning".
3. FINAL STEP — ALWAYS call update_itinerary with operation "generate" and a non-empty "days" array. Never skip this.

GEOGRAPHIC ROUTING — this is the most important quality signal:
- After lookup_place, you know the exact lat/lng of every place. Use this to plan days that make geographic sense.
- Group places into geographic zones by proximity. Any place more than 5km from the rest of a day's stops does not belong on that day — move it to a day with geographically closer stops. This applies to all place types: cafes, restaurants, and attractions near a distant zone belong on that zone's day.
- Within a day, order stops to minimize backtracking. Never zigzag across the map.
- Time of day logic: outdoor/active → morning; indoor/cool or cultural → afternoon; dining/atmospheric → evening.
- Max 6 stops per day. Aim for 2 morning, 2 afternoon, 2 evening slots. If hotel is known, first stop within 1km of hotel.

DUPLICATE RULE — check before calling update_itinerary:
- Duplicate check: after lookup_place, compare coordinates of all planned places. If any two places have lat/lng within 0.003 degrees (~300m), they are the same physical location under different names. Keep only one and replace the duplicate with a genuinely different place.

ai_note: Under 80 characters. One sharp, specific insight — e.g. "Arrive before 7am to avoid crowds". No filler.

Position rule: Float positions per day starting at 1.0, incrementing by 1.0 (1.0, 2.0, 3.0…). Midpoints (2.5) for insertions.

CANDIDATE STOPS — after selecting your main itinerary stops, call lookup_place for up to 10 additional places you found but didn't include. Pass them in the "candidates" field of update_itinerary. These should be genuinely different places (different categories, neighbourhoods, or vibes) that didn't fit the schedule but are worth knowing about. Always include at least 8 candidates.

CRITICAL REMINDER: Your last action MUST be calling update_itinerary with operation "generate". Never end without this call.`

export const UPDATE_SYSTEM_PROMPT = `You are Wayfarer's AI travel companion. You edit existing itineraries and can fully regenerate them on request.

RESPONSE BREVITY RULE:
After making any change, respond with ONE short sentence only — e.g. "Done, added La Pizzeria to Day 2 evening." or "Updated your itinerary."
Never recap or list the full itinerary in your text response. The user can see the cards — they don't need a text summary.
When naming the destination in your response, always use trip_context.destination — never use a destination mentioned in conversation history. The trip_context is the source of truth for which itinerary you are editing.

CRITICAL RULE — ACT, DON'T ASK:
Never ask clarifying questions. If the user's intent is clear enough to act on, act. Use sensible defaults for anything unspecified.
- "Add pizza" → find the best nearby pizza place and add it. Don't ask which day, which type, or what price range.
- "Pondicherry itinerary" → regenerate the full itinerary for Pondicherry. Don't ask how many days — use the existing duration.
- "Replace this with X" → regenerate for X.
You may ask ONE question only if the intent is genuinely ambiguous and no reasonable default exists.

STRICT PREFERENCE RULES:
- If the user says "no X", "avoid X", "remove X" — remove it and NEVER suggest it as a replacement.
- Honor trip_context preferences (skipped_place_ids, cuisines_skipped, etc.).

The trip_context includes "_current_itinerary" — all stops with IDs, coordinates, day, and time_of_day:
- Use [id:...] values for remove/swap operations
- Use lat/lng for nearby searches

─── OPERATION TYPES ───────────────────────────────────────

For REGENERATE requests ("make a [X] itinerary", "replace this with [X]", "new itinerary for [X]", "I want to go to [X] instead"):
1. Call search_reddit with 2 queries about the new destination (e.g. "best things to do in X", "X hidden gems").
2. Call lookup_place for each planned stop to get coordinates and hours.
3. Call update_itinerary with operation "generate" and ALL new days populated. This clears the old itinerary and saves the new one.
   - Use the same duration_days as the current trip unless the user specifies otherwise.
   - Apply all geographic routing rules: group by zone, minimize backtracking, respect hours.

For REMOVE requests: get item id from _current_itinerary, call update_itinerary with remove_item. No searching needed.

For REORDER requests: call update_itinerary with reorder. No searching needed.

For ADD requests: call search_nearby using coordinates from the relevant stop, then update_itinerary with add_item.
Auto-pick the best option (highest rating). Don't ask for confirmation.

For SWAP requests: call search_nearby or lookup_place for the replacement, then update_itinerary with swap_item.

For HOTEL/HOSTEL requests ("start from [X]", "staying at [X]", "route from [hotel]"):
1. Call lookup_place with the hotel name and city=trip_context.destination.
2. Call update_itinerary with operation "set_hotel".
3. Call update_itinerary with operation "reorder" — re-sequence each day so the stop closest to the hotel comes first.

Position rule: Fractional positions 1.0, 2.0, 3.0… per day. Midpoints (2.5) for insertions.
Always call update_itinerary to persist every change.`

// ─── Tool Executor Type ───────────────────────────────────────────────────────

export type ToolExecutors = {
  search_reddit: (input: SearchRedditInput) => Promise<SearchRedditOutput>
  search_web: (input: SearchWebInput) => Promise<SearchWebOutput>
  lookup_place: (input: LookupPlaceInput) => Promise<PlaceLookupResult>
  search_nearby: (input: SearchNearbyInput) => Promise<SearchNearbyOutput>
  update_itinerary: (input: UpdateItineraryInput) => Promise<UpdateItineraryOutput>
}

// ─── Streaming Message Creator ────────────────────────────────────────────────
// Async generator that implements the full agentic loop:
// 1. Send message to Claude
// 2. Yield stream events (caller extracts text deltas)
// 3. If stop_reason === 'tool_use', call executor functions and loop
// 4. Repeat until stop_reason === 'end_turn'

export type ConversationTurn = { role: 'user' | 'assistant'; content: string }

export async function* createStreamingMessage(params: {
  userMessage: string
  tripContext?: string
  tools: ToolExecutors
  systemPrompt?: string
  model?: string
  history?: ConversationTurn[]
}): AsyncGenerator<Anthropic.MessageStreamEvent> {
  const { userMessage, tripContext, tools, systemPrompt = SYSTEM_PROMPT, model = 'claude-haiku-4-5-20251001', history } = params

  const messages: Anthropic.MessageParam[] = [
    // Prepend prior conversation turns so Claude remembers context
    ...(history ?? []).map(h => ({ role: h.role, content: h.content })),
    {
      role: 'user',
      content: tripContext
        ? `Trip context:\n${tripContext}\n\nUser request: ${userMessage}`
        : userMessage,
    },
  ]

  // Safety limit: max 20 turns to prevent infinite loops
  for (let turn = 0; turn < 20; turn++) {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 8096,
      system: systemPrompt,
      tools: TOOL_DEFINITIONS,
      messages,
    })

    // Yield raw events — route.ts extracts text_delta chunks from these
    for await (const event of stream) {
      yield event
    }

    const finalMessage = await stream.finalMessage()
    messages.push({ role: 'assistant', content: finalMessage.content })

    if (finalMessage.stop_reason !== 'tool_use') break

    // Execute all tool calls Claude requested
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const block of finalMessage.content) {
      if (block.type !== 'tool_use') continue

      try {
        let result: unknown
        switch (block.name) {
          case 'search_reddit':
            result = await tools.search_reddit(block.input as SearchRedditInput)
            break
          case 'search_web':
            result = await tools.search_web(block.input as SearchWebInput)
            break
          case 'lookup_place':
            result = await tools.lookup_place(block.input as LookupPlaceInput)
            break
          case 'search_nearby':
            result = await tools.search_nearby(block.input as SearchNearbyInput)
            break
          case 'update_itinerary':
            result = await tools.update_itinerary(block.input as UpdateItineraryInput)
            break
          default:
            result = { error: `Unknown tool: ${String(block.name)}` }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        })
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }
}
