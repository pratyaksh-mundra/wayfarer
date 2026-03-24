import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolExecutors, ConversationTurn } from '@wayfarer/core/api/claude'

// ── Anthropic SDK mock ────────────────────────────────────────────────────────

const { mockStreamFn } = vi.hoisted(() => ({ mockStreamFn: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { stream: mockStreamFn },
  })),
}))

// ── Stream builder ────────────────────────────────────────────────────────────

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }

function fakeStream(content: ContentBlock[], stop_reason: 'end_turn' | 'tool_use') {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const block of content) {
        if (block.type === 'text') {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: block.text } }
        }
      }
    },
    finalMessage: () => Promise.resolve({ content, stop_reason }),
  }
}

// ── Message snapshot helper ───────────────────────────────────────────────────
// `mock.calls` holds array references, not copies. Because `createStreamingMessage`
// mutates `messages` after each Claude turn (push assistant reply, push tool result),
// reading `mock.calls[n][0].messages` post-run shows the final mutated state.
// We capture a deep-clone at call time by wrapping the mock implementation.

let messagesSnapshots: unknown[][] = []

function setupStream(...streams: ReturnType<typeof fakeStream>[]) {
  messagesSnapshots = []
  let i = 0
  mockStreamFn.mockImplementation(({ messages }: { messages: unknown[] }) => {
    messagesSnapshots.push(JSON.parse(JSON.stringify(messages))) // snapshot at call time
    return streams[i++] ?? fakeStream([], 'end_turn')
  })
}

// ── Tool executor factory ─────────────────────────────────────────────────────

function makeTools(overrides: Partial<ToolExecutors> = {}): ToolExecutors {
  return {
    search_reddit: vi.fn().mockResolvedValue({ posts: [], comments: [] }),
    search_web: vi.fn().mockResolvedValue({ results: [] }),
    lookup_place: vi.fn().mockResolvedValue({ lat: 11.9, lng: 79.8, hours: '', rating: 4, user_ratings_total: 100, place_id: 'P1', photo_url: '', price_level: 1, reviews: [] }),
    search_nearby: vi.fn().mockResolvedValue({ places: [] }),
    update_itinerary: vi.fn().mockResolvedValue({ itinerary_id: 'itin-1', updated_days: [] }),
    ...overrides,
  }
}

async function drainStream(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = []
  for await (const event of gen) events.push(event)
  return events
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createStreamingMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    messagesSnapshots = []
    process.env['ANTHROPIC_API_KEY'] = 'test-key'
  })

  describe('basic text response', () => {
    it('yields text_delta events from Claude', async () => {
      setupStream(fakeStream([{ type: 'text', text: 'Hello traveller!' }], 'end_turn'))

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      const events = await drainStream(
        createStreamingMessage({ userMessage: 'Plan a trip', tools: makeTools() })
      )

      const textDeltas = (events as Array<{ type: string; delta?: { text: string } }>)
        .filter((e) => e.type === 'content_block_delta')
        .map((e) => e.delta?.text)

      expect(textDeltas).toContain('Hello traveller!')
    })

    it('calls anthropic.messages.stream exactly once for a simple response', async () => {
      setupStream(fakeStream([], 'end_turn'))

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(createStreamingMessage({ userMessage: 'hi', tools: makeTools() }))

      expect(mockStreamFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('conversation history', () => {
    it('prepends history turns before the current user message', async () => {
      setupStream(fakeStream([], 'end_turn'))

      const history: ConversationTurn[] = [
        { role: 'user', content: 'Plan Pondicherry 3 days' },
        { role: 'assistant', content: 'Here is your Pondicherry itinerary.' },
      ]

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(
        createStreamingMessage({ userMessage: 'replace it entirely', tools: makeTools(), history })
      )

      const messages = messagesSnapshots[0] as Array<{ role: string; content: string }>

      expect(messages[0]).toMatchObject({ role: 'user', content: 'Plan Pondicherry 3 days' })
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Here is your Pondicherry itinerary.' })
      // Current user message is last
      const last = messages[messages.length - 1]!
      expect(last.role).toBe('user')
      expect(last.content).toContain('replace it entirely')
    })

    it('works correctly with no history (undefined)', async () => {
      setupStream(fakeStream([], 'end_turn'))

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(createStreamingMessage({ userMessage: 'Plan a trip', tools: makeTools() }))

      const messages = messagesSnapshots[0] as Array<{ role: string }>
      expect(messages).toHaveLength(1)
      expect(messages[0]?.role).toBe('user')
    })

    it('works correctly with empty history array', async () => {
      setupStream(fakeStream([], 'end_turn'))

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(
        createStreamingMessage({ userMessage: 'Plan a trip', tools: makeTools(), history: [] })
      )

      const messages = messagesSnapshots[0] as Array<{ role: string }>
      expect(messages).toHaveLength(1)
    })

    it('preserves multi-turn history order', async () => {
      setupStream(fakeStream([], 'end_turn'))

      const history: ConversationTurn[] = [
        { role: 'user', content: 'Turn 1 user' },
        { role: 'assistant', content: 'Turn 1 assistant' },
        { role: 'user', content: 'Turn 2 user' },
        { role: 'assistant', content: 'Turn 2 assistant' },
      ]

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(
        createStreamingMessage({ userMessage: 'Turn 3 user', tools: makeTools(), history })
      )

      const messages = messagesSnapshots[0] as Array<{ role: string }>
      const roles = messages.map((m) => m.role)
      expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    })

    it('includes tripContext in the user message body', async () => {
      setupStream(fakeStream([], 'end_turn'))

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(
        createStreamingMessage({
          userMessage: 'add pizza',
          tripContext: '{"destination":"Mulki"}',
          tools: makeTools(),
        })
      )

      const messages = messagesSnapshots[0] as Array<{ role: string; content: string }>
      const userMsg = messages[messages.length - 1]!
      expect(userMsg.content).toContain('Mulki')
      expect(userMsg.content).toContain('add pizza')
    })

    it('simulates a follow-up clarification: "replace it" uses prior context', async () => {
      // Turn 1 is history — assistant gave a Pondicherry plan.
      // User now says "replace it entirely with Mulki".
      // The history ensures Claude knows what "it" refers to.
      setupStream(
        fakeStream(
          [{ type: 'tool_use', id: 't1', name: 'update_itinerary', input: { operation: 'generate', days: [] } }],
          'tool_use'
        ),
        fakeStream([{ type: 'text', text: 'Done.' }], 'end_turn')
      )

      const history: ConversationTurn[] = [
        { role: 'user', content: 'Plan Pondicherry 3 days' },
        { role: 'assistant', content: 'Here is a Pondicherry itinerary.' },
      ]

      const updateItinerary = vi.fn().mockResolvedValue({ itinerary_id: 'itin-1', updated_days: [] })

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(
        createStreamingMessage({
          userMessage: 'replace it entirely with Mulki',
          history,
          tools: makeTools({ update_itinerary: updateItinerary }),
        })
      )

      // First Claude call had history
      const firstCallMessages = messagesSnapshots[0] as Array<{ role: string; content: string }>
      expect(firstCallMessages[0]?.content).toContain('Plan Pondicherry 3 days')

      // Tool was called (Claude acted, didn't ask)
      expect(updateItinerary).toHaveBeenCalledOnce()
    })
  })

  describe('tool dispatch', () => {
    it('calls the correct executor when Claude requests a tool', async () => {
      setupStream(
        fakeStream(
          [{ type: 'tool_use', id: 'tool-1', name: 'lookup_place', input: { place_name: 'Beach', city: 'Goa' } }],
          'tool_use'
        ),
        fakeStream([{ type: 'text', text: 'Done.' }], 'end_turn')
      )

      const lookupPlace = vi.fn().mockResolvedValue({ lat: 15.5, lng: 73.8, hours: '', rating: 4, user_ratings_total: 50, place_id: 'GOA1', photo_url: '', price_level: 1, reviews: [] })

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(createStreamingMessage({ userMessage: 'Plan Goa', tools: makeTools({ lookup_place: lookupPlace }) }))

      expect(lookupPlace).toHaveBeenCalledOnce()
      expect(lookupPlace).toHaveBeenCalledWith({ place_name: 'Beach', city: 'Goa' })
      expect(mockStreamFn).toHaveBeenCalledTimes(2)
    })

    it('feeds tool result back to Claude in the next turn', async () => {
      setupStream(
        fakeStream(
          [{ type: 'tool_use', id: 'tool-1', name: 'search_reddit', input: { destination: 'Goa', queries: ['best beaches'] } }],
          'tool_use'
        ),
        fakeStream([], 'end_turn')
      )

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(createStreamingMessage({ userMessage: 'Plan Goa', tools: makeTools() }))

      // Second call snapshot should contain the tool_result message
      const secondCallMessages = messagesSnapshots[1] as Array<{ role: string; content: unknown }>
      const toolResultMsg = secondCallMessages.find(
        (m) => m.role === 'user' && Array.isArray(m.content)
      )
      expect(toolResultMsg).toBeDefined()
      const resultContent = toolResultMsg!.content as Array<{ type: string; tool_use_id: string }>
      expect(resultContent[0]?.type).toBe('tool_result')
      expect(resultContent[0]?.tool_use_id).toBe('tool-1')
    })

    it('dispatches multiple tool calls from a single Claude turn', async () => {
      setupStream(
        fakeStream(
          [
            { type: 'tool_use', id: 't1', name: 'search_reddit', input: { destination: 'Goa', queries: ['tips'] } },
            { type: 'tool_use', id: 't2', name: 'lookup_place', input: { place_name: 'Anjuna Beach', city: 'Goa' } },
          ],
          'tool_use'
        ),
        fakeStream([], 'end_turn')
      )

      const searchReddit = vi.fn().mockResolvedValue({ posts: [], comments: [] })
      const lookupPlace = vi.fn().mockResolvedValue({ lat: 0, lng: 0, hours: '', rating: 0, user_ratings_total: 0, place_id: 'X', photo_url: '', price_level: 0, reviews: [] })

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(
        createStreamingMessage({ userMessage: 'Plan Goa', tools: makeTools({ search_reddit: searchReddit, lookup_place: lookupPlace }) })
      )

      expect(searchReddit).toHaveBeenCalledOnce()
      expect(lookupPlace).toHaveBeenCalledOnce()
    })

    it('handles an unknown tool name by returning an error result (no throw)', async () => {
      setupStream(
        fakeStream([{ type: 'tool_use', id: 't1', name: 'nonexistent_tool' as never, input: {} }], 'tool_use'),
        fakeStream([], 'end_turn')
      )

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await expect(drainStream(createStreamingMessage({ userMessage: 'hi', tools: makeTools() }))).resolves.toBeDefined()

      const secondCallMessages = messagesSnapshots[1] as Array<{ role: string; content: unknown }>
      const toolResultMsg = secondCallMessages.find((m) => m.role === 'user' && Array.isArray(m.content))
      const resultContent = toolResultMsg!.content as Array<{ content: string }>
      expect(resultContent[0]?.content).toContain('Unknown tool')
    })

    it('sends is_error:true when a tool executor throws', async () => {
      setupStream(
        fakeStream([{ type: 'tool_use', id: 't1', name: 'lookup_place', input: { place_name: 'X', city: 'Y' } }], 'tool_use'),
        fakeStream([], 'end_turn')
      )

      const failingLookup = vi.fn().mockRejectedValue(new Error('No results found for "X"'))

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(
        createStreamingMessage({ userMessage: 'Plan trip', tools: makeTools({ lookup_place: failingLookup }) })
      )

      const secondCallMessages = messagesSnapshots[1] as Array<{ role: string; content: unknown }>
      const toolResultMsg = secondCallMessages.find((m) => m.role === 'user' && Array.isArray(m.content))
      const resultContent = toolResultMsg!.content as Array<{ is_error?: boolean; content: string }>
      expect(resultContent[0]?.is_error).toBe(true)
      expect(resultContent[0]?.content).toContain('No results found')
    })
  })

  describe('safety limit', () => {
    it('stops after 20 turns even if Claude keeps requesting tools', async () => {
      // Every turn returns tool_use — should stop at 20
      messagesSnapshots = []
      mockStreamFn.mockImplementation(({ messages }: { messages: unknown[] }) => {
        messagesSnapshots.push(JSON.parse(JSON.stringify(messages)))
        return fakeStream(
          [{ type: 'tool_use', id: 'tx', name: 'search_reddit', input: { destination: 'X', queries: ['q'] } }],
          'tool_use'
        )
      })

      const { createStreamingMessage } = await import('@wayfarer/core/api/claude')
      await drainStream(createStreamingMessage({ userMessage: 'hi', tools: makeTools() }))

      expect(mockStreamFn).toHaveBeenCalledTimes(20)
    })
  })
})

// ── SSE buffer parsing ────────────────────────────────────────────────────────
// Tests the \n\n buffer-split logic used in consumeStream (useAIUpdate.ts).

describe('SSE buffer parsing', () => {
  function parseBuffer(buffer: string) {
    const parts = buffer.split('\n\n')
    const remaining = parts.pop() ?? ''
    const chunks: unknown[] = []
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') continue
      try { chunks.push(JSON.parse(raw)) } catch { /* skip malformed */ }
    }
    return { chunks, remaining }
  }

  it('parses a single complete SSE event', () => {
    const { chunks } = parseBuffer('data: {"type":"text","text":"hello"}\n\n')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ type: 'text', text: 'hello' })
  })

  it('parses multiple events in one buffer', () => {
    const { chunks } = parseBuffer(
      'data: {"type":"text","text":"a"}\n\ndata: {"type":"text","text":"b"}\n\n'
    )
    expect(chunks).toHaveLength(2)
  })

  it('leaves incomplete event in remaining buffer — no data loss', () => {
    const { chunks, remaining } = parseBuffer(
      'data: {"type":"text","text":"a"}\n\ndata: {"type":"text"'
    )
    expect(chunks).toHaveLength(1)
    expect(remaining).toContain('"type":"text"')
  })

  it('skips [DONE] sentinel', () => {
    const { chunks } = parseBuffer('data: [DONE]\n\n')
    expect(chunks).toHaveLength(0)
  })

  it('skips malformed JSON without throwing', () => {
    const { chunks } = parseBuffer(
      'data: {"type":"text","text":"ok"}\n\ndata: {broken json}\n\n'
    )
    expect(chunks).toHaveLength(1)
  })

  it('handles a read split exactly at the event boundary (the bug we fixed)', () => {
    // Simulates two network reads joined: first ends with \n, second starts with \n
    const read1 = 'data: {"type":"text","text":"hello"}\n'
    const read2 = '\ndata: {"type":"text","text":"world"}\n\n'
    const { chunks } = parseBuffer(read1 + read2)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ text: 'hello' })
    expect(chunks[1]).toMatchObject({ text: 'world' })
  })

  it('ignores lines without the data: prefix', () => {
    const { chunks } = parseBuffer('event: ping\n\ndata: {"type":"done"}\n\n')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ type: 'done' })
  })
})
