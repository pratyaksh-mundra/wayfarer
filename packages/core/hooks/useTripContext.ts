import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../api/supabase.js'
import type { TripContext, Itinerary } from '../types/index.js'

// Calculates current day from trip start date.
// Used to determine if a trip is active and which day to highlight.
export function getCurrentDay(tripStartDate: string): number {
  const start = new Date(tripStartDate)
  const today = new Date()
  const diffMs = today.getTime() - start.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return Math.max(1, diffDays + 1) // Day 1 = start date
}

// Derives status from trip dates and duration.
export function deriveStatus(
  itinerary: Pick<Itinerary, 'trip_start_date' | 'duration_days' | 'status'>
): 'planning' | 'active' | 'completed' {
  if (!itinerary.trip_start_date) return 'planning'
  const currentDay = getCurrentDay(itinerary.trip_start_date)
  if (currentDay > itinerary.duration_days) return 'completed'
  if (currentDay >= 1) return 'active'
  return 'planning'
}

export function useTripContext(itineraryId: string | null) {
  const [tripContext, setTripContext] = useState<TripContext | null>(null)
  const [currentDay, setCurrentDay] = useState(1)
  const [status, setStatus] = useState<'planning' | 'active' | 'completed'>('planning')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!itineraryId) return
    setLoading(true)
    setError(null)

    const { data, error: fetchErr } = await supabase
      .from('itineraries')
      .select('trip_context, trip_start_date, duration_days, status')
      .eq('id', itineraryId)
      .single()

    if (fetchErr) {
      setError(fetchErr.message)
      setLoading(false)
      return
    }

    setTripContext(data.trip_context as TripContext)
    setStatus(deriveStatus(data))

    if (data.trip_start_date) {
      setCurrentDay(getCurrentDay(data.trip_start_date))
    }

    setLoading(false)
  }, [itineraryId])

  // Patch specific keys in trip_context jsonb
  const updateTripContext = useCallback(
    async (patch: Partial<TripContext>) => {
      if (!itineraryId || !tripContext) return

      const updated = { ...tripContext, ...patch }
      setTripContext(updated)

      const { error: updateErr } = await supabase
        .from('itineraries')
        .update({ trip_context: updated })
        .eq('id', itineraryId)

      if (updateErr) {
        setError(updateErr.message)
        await fetch()
      }
    },
    [itineraryId, tripContext, fetch]
  )

  useEffect(() => {
    void fetch()
  }, [fetch])

  const setTripStartDate = useCallback(
    async (date: string) => {
      if (!itineraryId) return
      const { error: updateErr } = await supabase
        .from('itineraries')
        .update({ trip_start_date: date, status: 'active' })
        .eq('id', itineraryId)
      if (!updateErr) await fetch()
      else setError(updateErr.message)
    },
    [itineraryId, fetch]
  )

  return { tripContext, currentDay, status, loading, error, updateTripContext, setTripStartDate, refetch: fetch }
}
