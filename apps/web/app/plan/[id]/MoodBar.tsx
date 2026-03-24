'use client'

import { useState, useRef, useEffect } from 'react'
import { useAIUpdate, type StreamChunk } from '@wayfarer/core/hooks/useAIUpdate'
import type { TripContext } from '@wayfarer/core/types'

type Message = {
  role: 'user' | 'assistant'
  text: string
}

type Props = {
  itineraryId: string
  tripContext: TripContext
  onRefresh: () => Promise<void>
}

export function MoodBar({ itineraryId, tripContext, onRefresh }: Props) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [toolStatus, setToolStatus] = useState('')
  const { streaming, update } = useAIUpdate()
  const bottomRef = useRef<HTMLDivElement>(null)
  // Ref tracks live streaming text to avoid stale closure in onDone
  const streamingTextRef = useRef('')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, toolStatus])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const msg = input.trim()
    if (!msg || streaming) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: msg }])
    setStreamingText('')
    setToolStatus('')
    streamingTextRef.current = ''

    // Pass last 6 turns of history — enough for context, avoids token bloat
    const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.text }))

    await update(itineraryId, msg, tripContext, {
      onChunk: (chunk: StreamChunk) => {
        if (chunk.type === 'text') {
          streamingTextRef.current += chunk.text
          setStreamingText(streamingTextRef.current)
          setToolStatus('')
        }
        if (chunk.type === 'tool_call') {
          setToolStatus(toolLabel(chunk.tool as string))
        }
      },
      onDone: () => {
        const finalText = streamingTextRef.current
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: finalText || 'Done.' },
        ])
        setStreamingText('')
        setToolStatus('')
        streamingTextRef.current = ''
        void onRefresh()
      },
      onError: (err: string) => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `Error: ${err}` },
        ])
        setStreamingText('')
        setToolStatus('')
        streamingTextRef.current = ''
      },
    }, history)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !streaming && (
          <p className="text-center text-xs text-neutral-600 py-2">
            Ask anything — add a place, set your hotel, remove a stop…
          </p>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-white text-black rounded-br-sm'
                  : 'bg-neutral-800 text-neutral-100 rounded-bl-sm'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {/* Live streaming assistant bubble */}
        {(streamingText || toolStatus) && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-neutral-800 px-3 py-2 text-sm leading-relaxed text-neutral-100 whitespace-pre-wrap">
              {toolStatus && !streamingText
                ? <span className="text-neutral-500 italic">{toolStatus}</span>
                : streamingText
              }
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-neutral-800 px-4 py-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add pizza tonight, set hotel to Radisson, remove Day 2 beach…"
            className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm placeholder-neutral-600 focus:border-neutral-500 focus:outline-none"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            {streaming ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}

function toolLabel(tool: string): string {
  switch (tool) {
    case 'search_reddit': return 'Searching Reddit…'
    case 'search_web': return 'Checking travel guides…'
    case 'lookup_place': return 'Looking up place…'
    case 'search_nearby': return 'Finding nearby options…'
    case 'update_itinerary': return 'Updating itinerary…'
    default: return 'Thinking…'
  }
}
