import { useState, useCallback } from 'react'

// Streaming AI calls for mood updates and itinerary edits.
// Connects to /api/update (or /api/generate for new itineraries).
// Never calls Claude SDK directly — goes through the API route.

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type AIUpdateOptions = {
  onChunk?: (chunk: StreamChunk) => void
  onDone?: () => void
  onError?: (err: string) => void
}

export function useAIUpdate() {
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastText, setLastText] = useState('')

  const generate = useCallback(
    async (destination: string, durationDays: number, options?: AIUpdateOptions) => {
      setStreaming(true)
      setError(null)
      setLastText('')

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destination, duration_days: durationDays }),
        })

        if (!res.ok) {
          throw new Error(`Generate failed: ${res.statusText}`)
        }

        await consumeStream(res, options)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        options?.onError?.(msg)
      } finally {
        setStreaming(false)
      }
    },
    []
  )

  const update = useCallback(
    async (
      itineraryId: string,
      userMessage: string,
      tripContext: unknown,
      options?: AIUpdateOptions,
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
    ) => {
      setStreaming(true)
      setError(null)
      setLastText('')

      try {
        const res = await fetch('/api/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itinerary_id: itineraryId, message: userMessage, trip_context: tripContext, history }),
        })

        if (!res.ok) {
          throw new Error(`Update failed: ${res.statusText}`)
        }

        await consumeStream(res, options)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        options?.onError?.(msg)
      } finally {
        setStreaming(false)
      }
    },
    []
  )

  async function consumeStream(res: Response, options?: AIUpdateOptions) {
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue

        try {
          const chunk = JSON.parse(raw) as StreamChunk
          if (chunk.type === 'text') {
            setLastText((prev) => prev + chunk.text)
          }
          options?.onChunk?.(chunk)
          if (chunk.type === 'done') {
            options?.onDone?.()
          }
          if (chunk.type === 'error') {
            options?.onError?.(chunk.message)
          }
        } catch {
          // malformed chunk — skip
        }
      }
    }
  }

  return { streaming, error, lastText, generate, update }
}
