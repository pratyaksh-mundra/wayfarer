'use client'

import { useState } from 'react'
import type { Itinerary } from '@wayfarer/core/types'

type Props = {
  itinerary: Itinerary
  onHotelAdded: () => Promise<void>
}

// Hotel search input — Phase 2.
// Calls /api/update with the hotel name; Claude looks it up via lookup_place
// and re-optimises routing to minimise daily walking distance.
export function HotelInput({ itinerary, onHotelAdded }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasHotel = Boolean(itinerary.hotel_place_id)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const hotelName = input.trim()
    if (!hotelName || loading) return

    setLoading(true)
    setError(null)

    const res = await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itinerary_id: itinerary.id,
        message: `My hotel is "${hotelName}" in ${itinerary.destination}. Please look it up, save it, and re-optimize each day's routing so the first and last stop are within 1km of the hotel.`,
        trip_context: itinerary.trip_context,
      }),
    })

    if (!res.ok) {
      setError('Failed to add hotel. Try again.')
      setLoading(false)
      return
    }

    // Consume stream to completion
    const reader = res.body?.getReader()
    if (reader) {
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    }

    setInput('')
    setLoading(false)
    await onHotelAdded()
  }

  if (hasHotel) {
    return (
      <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3">
        <p className="text-sm text-neutral-400">
          Hotel saved. Routing is optimised around your accommodation.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wider text-neutral-500">
        Add your hotel
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Villa Shanti Pondicherry"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm placeholder-neutral-600 focus:border-neutral-500 focus:outline-none"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {loading ? '…' : 'Add'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}
