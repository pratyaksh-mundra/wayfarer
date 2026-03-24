'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const EXAMPLES = [
  { label: 'Pondicherry 3 days', emoji: '🌊' },
  { label: 'Kyoto 5 days cherry blossom', emoji: '🌸' },
  { label: 'Lisbon weekend solo', emoji: '🎸' },
  { label: 'Bali 7 days not touristy', emoji: '🌿' },
  { label: 'Rome 4 days food focused', emoji: '🍝' },
]

export default function HomePage() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)

    try {
      const durationMatch = trimmed.match(/(\d+)\s*days?/i)
      const durationDays = durationMatch ? parseInt(durationMatch[1]!, 10) : 3

      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: trimmed, duration_days: durationDays }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? `Failed: ${res.statusText}`)
      }

      const { itinerary_id } = (await res.json()) as { itinerary_id: string }
      router.push(`/plan/${itinerary_id}?prompt=${encodeURIComponent(trimmed)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-neutral-950 p-8">

      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-orange-500/10 blur-[100px]" />
        <div className="absolute left-1/4 bottom-0 h-[300px] w-[400px] translate-y-1/2 rounded-full bg-indigo-500/8 blur-[80px]" />
      </div>

      <div className="relative z-10 w-full max-w-xl space-y-8">

        {/* Badge */}
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-1.5 text-xs font-medium text-orange-400">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <circle cx="10" cy="10" r="10" />
              <path d="M16.67 10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23l.65-3.08 2.13.45a1 1 0 1 0 1.07-1 1 1 0 0 0-.96.68l-2.38-.5a.27.27 0 0 0-.32.2l-.73 3.44a7.14 7.14 0 0 0-3.89 1.23 1.46 1.46 0 1 0-1.61 2.39 2.87 2.87 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 0 0 0-.44 1.46 1.46 0 0 0 .6-1.08zM7.27 11a1 1 0 1 1 1 1 1 1 0 0 1-1-1zm5.58 2.65a3.56 3.56 0 0 1-2.85.58 3.56 3.56 0 0 1-2.85-.58.27.27 0 0 1 .38-.38 3.08 3.08 0 0 0 2.47.47 3.08 3.08 0 0 0 2.47-.47.27.27 0 1 1 .38.38zm-.16-1.65a1 1 0 1 1 1-1 1 1 0 0 1-1 1z" fill="white"/>
            </svg>
            Powered by real Reddit travel advice
          </div>
        </div>

        {/* Hero */}
        <div className="space-y-4 text-center">
          <h1 className="text-6xl font-black tracking-tight text-white">
            Wayfarer
          </h1>
          <p className="text-xl leading-relaxed text-neutral-400">
            Type a destination. Get a day-by-day itinerary<br />
            built from <span className="text-white font-medium">thousands of real traveller experiences</span>.
          </p>
        </div>

        {/* Input */}
        <form onSubmit={handleGenerate} className="space-y-3">
          <div className="relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Where to? e.g. Pondicherry 3 days"
              className="w-full rounded-2xl border border-neutral-700/60 bg-neutral-900/80 px-5 py-4 text-base text-white placeholder-neutral-600 shadow-xl backdrop-blur-sm transition-all focus:border-orange-500/50 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              disabled={loading}
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-full rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/20 transition-all hover:from-orange-400 hover:to-amber-400 hover:shadow-orange-500/30 disabled:opacity-40 disabled:shadow-none"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Creating your itinerary…
              </span>
            ) : 'Plan my trip →'}
          </button>
        </form>

        {error && <p className="text-center text-sm text-red-400">{error}</p>}

        {/* Example chips */}
        <div className="space-y-2">
          <p className="text-center text-xs text-neutral-600">Try one of these</p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map(({ label, emoji }) => (
              <button
                key={label}
                onClick={() => setInput(label)}
                className="flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-400 transition-all hover:border-neutral-600 hover:bg-neutral-800 hover:text-white"
              >
                <span>{emoji}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="grid grid-cols-3 gap-4 border-t border-neutral-800/60 pt-6">
          {[
            { icon: '📡', step: '01', label: 'Searches Reddit', desc: 'Scans r/travel, r/solotravel, and city subs for real tips' },
            { icon: '📍', step: '02', label: 'Verifies places', desc: 'Every stop validated with Google Places — hours, ratings, coords' },
            { icon: '🗺️', step: '03', label: 'Routes your day', desc: 'Groups stops geographically so you never backtrack' },
          ].map(({ icon, step, label, desc }) => (
            <div key={step} className="space-y-2 rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-4">
              <div className="text-2xl">{icon}</div>
              <p className="text-xs font-mono text-neutral-600">{step}</p>
              <p className="text-sm font-semibold text-neutral-200">{label}</p>
              <p className="text-xs leading-relaxed text-neutral-600">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
