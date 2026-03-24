'use client'

import { useState } from 'react'

type Props = {
  status: 'planning' | 'active' | 'completed'
  currentDay: number
  durationDays: number
  onSetStartDate: (date: string) => Promise<void>
}

export function TripStartInput({ status, currentDay, durationDays, onSetStartDate }: Props) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]!)
  const [loading, setLoading] = useState(false)

  if (status === 'completed') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-neutral-600" />
        <p className="text-sm text-neutral-500">Trip completed</p>
      </div>
    )
  }

  if (status === 'active') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-900 bg-emerald-950/40 px-4 py-3">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <p className="text-sm text-emerald-400 font-medium">
          Day {currentDay} of {durationDays} — Trip active
        </p>
      </div>
    )
  }

  // planning
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await onSetStartDate(date)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wider text-neutral-500">
        Trip start date
      </label>
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:border-neutral-500 focus:outline-none [color-scheme:dark]"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !date}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors"
        >
          {loading ? '…' : 'Start trip'}
        </button>
      </div>
    </form>
  )
}
