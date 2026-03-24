'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { useItinerary } from '@wayfarer/core/hooks/useItinerary'
import { useTripContext } from '@wayfarer/core/hooks/useTripContext'
import { ItineraryPanel } from './ItineraryPanel'
import { MapView } from './MapView'
import { MoodBar } from './MoodBar'
import { HotelInput } from './HotelInput'
import { TripStartInput } from './TripStartInput'

function toolLabel(tool: string): string {
  switch (tool) {
    case 'search_reddit': return 'Searching Reddit for tips…'
    case 'search_web': return 'Checking travel guides…'
    case 'lookup_place': return 'Verifying places on Google Maps…'
    case 'search_nearby': return 'Finding nearby options…'
    case 'update_itinerary': return 'Building your itinerary…'
    default: return 'Thinking…'
  }
}

export default function PlanPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = typeof params['id'] === 'string' ? params['id'] : null
  const promptParam = searchParams.get('prompt')

  const { itinerary, loading, error, fetch: loadItinerary } = useItinerary(id)
  const { tripContext, currentDay, status, setTripStartDate } = useTripContext(id)

  const [generating, setGenerating] = useState(!!promptParam)
  const [progressText, setProgressText] = useState(promptParam ? 'Starting…' : '')
  const [genError, setGenError] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [activeDay, setActiveDay] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [panelWidth, setPanelWidth] = useState(380)
  const isDraggingPanel = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(380)

  const [chatHeight, setChatHeight] = useState(260)
  const isDraggingChat = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(260)
  const started = useRef(false)
  const savedPrompt = useRef<string | null>(promptParam)

  const handleSelectItem = useCallback((id: string | null) => {
    setSelectedItemId(id)
  }, [])

  const handleDaySelect = useCallback((day: number | null) => {
    setActiveDay(day)
    setSelectedItemId(null)
  }, [])

  useEffect(() => { void loadItinerary() }, [loadItinerary])

  // Auto-switch to today's day when trip is active
  useEffect(() => {
    if (status === 'active') setActiveDay(currentDay)
  }, [status, currentDay])

  useEffect(() => {
    function onMouseMove(e: globalThis.MouseEvent) {
      if (isDraggingPanel.current) {
        const delta = dragStartX.current - e.clientX
        setPanelWidth(Math.min(640, Math.max(280, dragStartWidth.current + delta)))
      }
      if (isDraggingChat.current) {
        const delta = dragStartY.current - e.clientY
        setChatHeight(Math.min(600, Math.max(120, dragStartHeight.current + delta)))
      }
    }
    function onMouseUp() {
      isDraggingPanel.current = false
      isDraggingChat.current = false
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  useEffect(() => {
    if (!promptParam || !id || started.current) return
    started.current = true
    savedPrompt.current = promptParam

    async function runGeneration() {
      try {
        const res = await globalThis.fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptParam, itinerary_id: id }),
        })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (!raw) continue
            try {
              const chunk = JSON.parse(raw) as { type: string; tool?: string; message?: string }
              if (chunk.type === 'tool_call') setProgressText(toolLabel(chunk.tool ?? ''))
              else if (chunk.type === 'done') {
                await loadItinerary()
                setGenerating(false)
                setProgressText('')
                router.replace(`/plan/${id}`)
              } else if (chunk.type === 'error') {
                setGenError(chunk.message ?? 'Generation failed')
                setGenerating(false)
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch (err) {
        setGenError(err instanceof Error ? err.message : String(err))
        setGenerating(false)
      }
    }

    void runGeneration()
  }, [promptParam, id, loadItinerary, router])

  function handleRetry() {
    setGenError(null)
    started.current = false
    setGenerating(true)
    setProgressText('Retrying…')
    if (savedPrompt.current) {
      router.replace(`/plan/${id}?prompt=${encodeURIComponent(savedPrompt.current)}`)
    }
  }

  if (loading && !generating && !itinerary) {
    return (
      <main className="flex h-screen items-center justify-center bg-neutral-950">
        <p className="text-neutral-400">Loading…</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex h-screen items-center justify-center bg-neutral-950">
        <p className="text-red-400">Error: {error}</p>
      </main>
    )
  }

  function parseDestination(raw: string): string {
    return raw
      .replace(/\d+\s*days?/gi, '')
      .replace(/\b(solo|trip|travel|weekend|week)\b/gi, '')
      .replace(/[,·|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const destination = itinerary?.destination
    ? parseDestination(itinerary.destination)
    : parseDestination(promptParam ?? 'Your trip')

  return (
    <main className="flex h-screen flex-col bg-neutral-950 text-white">

      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-800/60 bg-gradient-to-b from-neutral-900 to-neutral-950 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <a href="/" className="text-xs font-bold tracking-widest text-orange-500 uppercase opacity-80 hover:opacity-100 transition-opacity">
            Wayfarer
          </a>
          <span className="text-neutral-700">/</span>
          <div>
            <h1 className="text-sm font-semibold text-white">{destination}</h1>
            <p className="text-xs text-neutral-500">
              {itinerary
                ? status === 'active'
                  ? <span className="text-emerald-400 font-medium">● Day {currentDay} of {itinerary.duration_days}</span>
                  : status === 'completed'
                  ? <span className="text-neutral-600">{itinerary.duration_days} days · completed</span>
                  : `${itinerary.duration_days} days · planning`
                : 'Generating…'}
            </p>
          </div>
        </div>
        {itinerary && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/plan/${itinerary.id}`)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition-all hover:border-neutral-500 hover:text-white"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>
            </svg>
            {copied ? 'Copied!' : 'Share'}
          </button>
        )}
      </header>

      {/* ── Error banner ── */}
      {genError && !generating && (
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-red-900 bg-red-950 px-5 py-2">
          <p className="text-sm text-red-300">Generation failed: {genError}</p>
          <button
            onClick={handleRetry}
            className="shrink-0 rounded-lg border border-red-700 px-3 py-1 text-xs text-red-300 hover:bg-red-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Body: map (flex-1) + side panel (fixed width) ── */}
      <div className="flex min-h-0 flex-1">

        {/* Map area */}
        <div className="relative flex-1 overflow-hidden">
          {generating ? (
            <div className="flex h-full flex-col items-center justify-center gap-5">
              <div className="space-y-2 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-white" />
                <p className="text-sm text-neutral-400">{progressText}</p>
              </div>
              <div className="w-full max-w-xs space-y-3 px-8">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-neutral-800" />
                ))}
              </div>
            </div>
          ) : itinerary ? (
            <MapView
              itinerary={itinerary}
              currentDay={currentDay}
              selectedItemId={selectedItemId}
              activeDay={activeDay}
              onSelectItem={handleSelectItem}
            />
          ) : null}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={(e: MouseEvent) => {
            isDraggingPanel.current = true
            dragStartX.current = e.clientX
            dragStartWidth.current = panelWidth
            e.preventDefault()
          }}
          className="w-1 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-neutral-600 transition-colors"
        />

        {/* Side panel — ItineraryPanel manages its own scroll internally */}
        <div className="flex shrink-0 flex-col border-l border-neutral-800" style={{ width: panelWidth }}>
          <div className="min-h-0 flex-1 overflow-hidden">
            {itinerary ? (
              <ItineraryPanel
                itinerary={itinerary}
                currentDay={currentDay}
                status={status}
                onRefresh={loadItinerary}
                activeDay={activeDay}
                onDaySelect={handleDaySelect}
                selectedItemId={selectedItemId}
                onSelectItem={handleSelectItem}
              />
            ) : generating ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-neutral-800" />
                ))}
              </div>
            ) : null}
          </div>

          {/* Horizontal resize handle between itinerary and chat */}
          {itinerary && (
            <div
              onMouseDown={(e) => {
                isDraggingChat.current = true
                dragStartY.current = e.clientY
                dragStartHeight.current = chatHeight
                e.preventDefault()
              }}
              className="h-1 shrink-0 cursor-row-resize bg-neutral-800 hover:bg-neutral-600 transition-colors"
            />
          )}

          {/* Hotel + Trip start + MoodBar — resizable height */}
          {itinerary && (
            <div className="shrink-0 flex flex-col border-t border-neutral-800" style={{ height: chatHeight }}>
              {/* Static inputs — always visible at top */}
              <div className="shrink-0 space-y-3 p-4 pb-2">
                <TripStartInput
                  status={status}
                  currentDay={currentDay}
                  durationDays={itinerary.duration_days}
                  onSetStartDate={setTripStartDate}
                />
                <HotelInput itinerary={itinerary} onHotelAdded={loadItinerary} />
              </div>
              {/* MoodBar fills remaining space */}
              {(status === 'active' || status === 'planning') && tripContext && (
                <div className="min-h-0 flex-1">
                  <MoodBar
                    itineraryId={itinerary.id}
                    tripContext={tripContext}
                    onRefresh={loadItinerary}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
