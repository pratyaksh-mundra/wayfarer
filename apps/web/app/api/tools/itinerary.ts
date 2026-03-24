import { createServiceClient } from '@wayfarer/core/api/supabase'
import type { UpdateItineraryInput, UpdateItineraryOutput, ItineraryItem } from '@wayfarer/core/types'
import { randomUUID } from 'crypto'

function generateShareToken(): string {
  return randomUUID().split('-')[0]! // short 8-char token
}

export async function updateItinerary(
  input: UpdateItineraryInput,
  destination: string,
  durationDays: number
): Promise<UpdateItineraryOutput> {
  const supabase = createServiceClient()

  if (input.operation === 'generate') {
    let itineraryId: string

    if (input.itinerary_id) {
      // Existing row — update destination/duration and clear any prior items
      itineraryId = input.itinerary_id
      await supabase
        .from('itineraries')
        .update({ destination, duration_days: durationDays })
        .eq('id', itineraryId)
      // Delete all existing items so we start fresh (handles full regeneration from MoodBar)
      await supabase.from('itinerary_items').delete().eq('itinerary_id', itineraryId)
    } else {
      // Create new itinerary row (legacy path — used when no pre-created ID)
      const { data: itin, error: itinErr } = await supabase
        .from('itineraries')
        .insert({
          destination,
          duration_days: durationDays,
          share_token: generateShareToken(),
          status: 'planning',
          trip_context: {
            current_day: 1,
            trip_start_date: '',
            last_completed_stop: null,
            next_planned_stop: null,
            hotel: null,
            destination,
            food_preferences: {
              dietary: [],
              cuisines_liked: [],
              cuisines_skipped: [],
              price_range: 'mid',
            },
            activity_preferences: {
              pace: 'moderate',
              liked_categories: [],
              skipped_place_ids: [],
            },
            completed_stops: [],
            mood_updates: [],
          },
        })
        .select('id')
        .single()

      if (itinErr || !itin) {
        throw new Error(`Failed to create itinerary: ${itinErr?.message}`)
      }
      itineraryId = itin.id
    }

    // Insert all items
    const allItems: Omit<ItineraryItem, 'id'>[] = (input.days ?? []).flatMap((day) =>
      day.items.map((item) => ({
        ...item,
        itinerary_id: itineraryId,
        day_number: day.day_number,
      }))
    )

    if (allItems.length > 0) {
      const { error: itemsErr } = await supabase.from('itinerary_items').insert(allItems)
      if (itemsErr) {
        throw new Error(`Failed to insert items: ${itemsErr.message}`)
      }
    }

    // Save candidate pool to trip_context if provided
    if (input.candidates && input.candidates.length > 0) {
      const { data: current } = await supabase
        .from('itineraries')
        .select('trip_context')
        .eq('id', itineraryId)
        .single()
      const ctx = (current?.trip_context as Record<string, unknown>) ?? {}
      await supabase
        .from('itineraries')
        .update({ trip_context: { ...ctx, candidate_pool: input.candidates } })
        .eq('id', itineraryId)
    }

    return { itinerary_id: itineraryId, updated_days: input.days ?? [] }
  }

  if (input.operation === 'reorder') {
    if (!input.itinerary_id) throw new Error('itinerary_id required for reorder')
    if (!input.days) throw new Error('days required for reorder')

    // Update each item's position
    for (const day of input.days) {
      for (const item of day.items) {
        const { error } = await supabase
          .from('itinerary_items')
          .update({ position: item.position, day_number: day.day_number })
          .eq('id', item.id)

        if (error) throw new Error(`Reorder failed: ${error.message}`)
      }
    }

    return { itinerary_id: input.itinerary_id, updated_days: input.days }
  }

  if (input.operation === 'add_item') {
    if (!input.itinerary_id) throw new Error('itinerary_id required for add_item')
    if (!input.item) throw new Error('item required for add_item')

    const { error } = await supabase.from('itinerary_items').insert({
      ...input.item,
      itinerary_id: input.itinerary_id,
    })

    if (error) throw new Error(`add_item failed: ${error.message}`)

    // If the new item is on a day beyond current duration_days, extend the trip
    const newDayNumber = input.item.day_number ?? 1
    if (newDayNumber > durationDays) {
      await supabase
        .from('itineraries')
        .update({ duration_days: newDayNumber })
        .eq('id', input.itinerary_id)
    }

    return { itinerary_id: input.itinerary_id, updated_days: [] }
  }

  if (input.operation === 'remove_item') {
    if (!input.itinerary_id) throw new Error('itinerary_id required for remove_item')
    if (!input.item?.id) throw new Error('item.id required for remove_item')

    const { error } = await supabase
      .from('itinerary_items')
      .delete()
      .eq('id', input.item.id)

    if (error) throw new Error(`remove_item failed: ${error.message}`)

    return { itinerary_id: input.itinerary_id, updated_days: [] }
  }

  if (input.operation === 'swap_item') {
    if (!input.itinerary_id) throw new Error('itinerary_id required for swap_item')
    if (!input.item) throw new Error('item required for swap_item')

    const { error } = await supabase
      .from('itinerary_items')
      .update({
        place_name: input.item.place_name,
        lat: input.item.lat,
        lng: input.item.lng,
        google_place_id: input.item.google_place_id,
        ai_note: input.item.ai_note,
        category: input.item.category,
        duration_mins: input.item.duration_mins,
        reddit_source_url: input.item.reddit_source_url,
      })
      .eq('id', input.item.id)

    if (error) throw new Error(`swap_item failed: ${error.message}`)

    return { itinerary_id: input.itinerary_id, updated_days: [] }
  }

  if (input.operation === 'set_hotel') {
    if (!input.itinerary_id) throw new Error('itinerary_id required for set_hotel')
    if (!input.hotel) throw new Error('hotel required for set_hotel')

    const { hotel } = input

    // Fetch current trip_context to merge hotel into it
    const { data: itin, error: fetchErr } = await supabase
      .from('itineraries')
      .select('trip_context')
      .eq('id', input.itinerary_id)
      .single()

    if (fetchErr || !itin) throw new Error(`Failed to fetch itinerary: ${fetchErr?.message}`)

    const tripContext = (itin as { trip_context: Record<string, unknown> }).trip_context ?? {}
    const updatedContext = { ...tripContext, hotel: { name: hotel.name, lat: hotel.lat, lng: hotel.lng, google_place_id: hotel.google_place_id } }

    const { error } = await supabase
      .from('itineraries')
      .update({
        hotel_lat: hotel.lat,
        hotel_lng: hotel.lng,
        hotel_place_id: hotel.google_place_id ?? null,
        trip_context: updatedContext,
      })
      .eq('id', input.itinerary_id)

    if (error) throw new Error(`set_hotel failed: ${error.message}`)

    return { itinerary_id: input.itinerary_id, updated_days: [] }
  }

  throw new Error(`Unknown operation: ${String(input.operation)}`)
}
