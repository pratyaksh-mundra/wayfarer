import { useState, useCallback } from 'react'
import { supabase } from '../api/supabase.js'
import type { Itinerary, ItineraryItem, PlaceCandidate } from '../types/index.js'

// CRUD and drag-drop reordering for itinerary items.
// Fractional position ordering — never re-index all rows.

export function useItinerary(itineraryId: string | null) {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!itineraryId) return
    setLoading(true)
    setError(null)

    const { data: itin, error: itinErr } = await supabase
      .from('itineraries')
      .select('*')
      .eq('id', itineraryId)
      .single()

    if (itinErr) {
      setError(itinErr.message)
      setLoading(false)
      return
    }

    const { data: items, error: itemsErr } = await supabase
      .from('itinerary_items')
      .select('*')
      .eq('itinerary_id', itineraryId)
      .order('day_number', { ascending: true })
      .order('position', { ascending: true })

    if (itemsErr) {
      setError(itemsErr.message)
      setLoading(false)
      return
    }

    setItinerary({ ...itin, items: items ?? [] })
    setLoading(false)
  }, [itineraryId])

  // Reorder: compute fractional position between two neighbours.
  // Never re-index all rows — only update the moved item's position.
  const reorder = useCallback(
    async (itemId: string, afterPosition: number | null, beforePosition: number | null) => {
      let newPosition: number

      if (afterPosition === null && beforePosition === null) {
        newPosition = 1.0
      } else if (afterPosition === null) {
        newPosition = (beforePosition ?? 1.0) / 2
      } else if (beforePosition === null) {
        newPosition = (afterPosition ?? 1.0) + 1.0
      } else {
        newPosition = (afterPosition + beforePosition) / 2
      }

      // Optimistic update
      setItinerary((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.id === itemId ? { ...item, position: newPosition } : item
          ),
        }
      })

      const { error: updateErr } = await supabase
        .from('itinerary_items')
        .update({ position: newPosition })
        .eq('id', itemId)

      if (updateErr) {
        setError(updateErr.message)
        // Roll back by re-fetching
        await fetch()
      }
    },
    [fetch]
  )

  const removeItem = useCallback(
    async (itemId: string) => {
      // Optimistic update
      setItinerary((prev) => {
        if (!prev) return prev
        return { ...prev, items: prev.items.filter((i) => i.id !== itemId) }
      })

      const { error: deleteErr } = await supabase
        .from('itinerary_items')
        .delete()
        .eq('id', itemId)

      if (deleteErr) {
        setError(deleteErr.message)
        await fetch()
      }
    },
    [fetch]
  )

  // Reorder an entire day: batch-update position + time_of_day for all items.
  // Called after drag-drop so time slots redistribute to match new visual order.
  const reorderDay = useCallback(
    async (updates: Array<{ id: string; position: number; time_of_day: ItineraryItem['time_of_day'] }>) => {
      // Optimistic update
      setItinerary((prev) => {
        if (!prev) return prev
        const byId = new Map(updates.map((u) => [u.id, u]))
        return {
          ...prev,
          items: prev.items.map((item) => {
            const u = byId.get(item.id)
            return u ? { ...item, position: u.position, time_of_day: u.time_of_day } : item
          }),
        }
      })

      const results = await Promise.all(
        updates.map(({ id, position, time_of_day }) =>
          supabase.from('itinerary_items').update({ position, time_of_day }).eq('id', id)
        )
      )

      const firstErr = results.find((r) => r.error)?.error
      if (firstErr) {
        setError(firstErr.message)
        await fetch()
      }
    },
    [fetch]
  )

  const markVisited = useCallback(
    async (itemId: string) => {
      const visitedAt = new Date().toISOString()

      setItinerary((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.id === itemId ? { ...item, visited_at: visitedAt } : item
          ),
        }
      })

      const { error: updateErr } = await supabase
        .from('itinerary_items')
        .update({ visited_at: visitedAt })
        .eq('id', itemId)

      if (updateErr) {
        setError(updateErr.message)
        await fetch()
      }
    },
    [fetch]
  )

  const addCandidateToDay = useCallback(
    async (candidate: PlaceCandidate, dayNum: number) => {
      if (!itineraryId || !itinerary) return
      const dayItems = itinerary.items.filter((i) => i.day_number === dayNum)
      const maxPos = dayItems.length > 0 ? Math.max(...dayItems.map((i) => i.position)) : 0
      const newPosition = maxPos + 1.0

      const { error: insertErr } = await supabase.from('itinerary_items').insert({
        ...candidate,
        itinerary_id: itineraryId,
        day_number: dayNum,
        position: newPosition,
        added_by: 'user',
      })
      if (insertErr) { setError(insertErr.message); return }

      // Remove from candidate_pool
      const pool = itinerary.trip_context.candidate_pool ?? []
      const updatedPool = pool.filter((c: PlaceCandidate) => c.place_name !== candidate.place_name)
      const { error: ctxErr } = await supabase
        .from('itineraries')
        .update({ trip_context: { ...itinerary.trip_context, candidate_pool: updatedPool } })
        .eq('id', itineraryId)
      if (ctxErr) setError(ctxErr.message)

      await fetch()
    },
    [itinerary, itineraryId, fetch]
  )

  return { itinerary, loading, error, fetch, reorder, reorderDay, removeItem, markVisited, addCandidateToDay }
}
