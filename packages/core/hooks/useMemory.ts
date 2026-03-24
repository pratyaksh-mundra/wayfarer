import { useCallback } from 'react'
import { supabase } from '../api/supabase.js'
import type { TripContext, PlaceRef } from '../types/index.js'

// Read/write trip_context preferences.
// Called when user removes/reorders places (preference learning) or
// when companion mode updates current day / completed stops.

export function useMemory(itineraryId: string | null) {
  const recordSkippedPlace = useCallback(
    async (placeId: string, context: TripContext) => {
      if (!itineraryId) return

      const updated: TripContext = {
        ...context,
        activity_preferences: {
          ...context.activity_preferences,
          skipped_place_ids: [
            ...context.activity_preferences.skipped_place_ids,
            placeId,
          ],
        },
      }

      const { error } = await supabase
        .from('itineraries')
        .update({ trip_context: updated })
        .eq('id', itineraryId)

      if (error) {
        console.error('Failed to record skipped place:', error.message)
      }
    },
    [itineraryId]
  )

  const recordCompletedStop = useCallback(
    async (place: PlaceRef, context: TripContext) => {
      if (!itineraryId) return

      const updated: TripContext = {
        ...context,
        last_completed_stop: place,
        completed_stops: [...context.completed_stops, place],
      }

      const { error } = await supabase
        .from('itineraries')
        .update({ trip_context: updated })
        .eq('id', itineraryId)

      if (error) {
        console.error('Failed to record completed stop:', error.message)
      }
    },
    [itineraryId]
  )

  const addLikedCuisine = useCallback(
    async (cuisine: string, context: TripContext) => {
      if (!itineraryId) return
      if (context.food_preferences.cuisines_liked.includes(cuisine)) return

      const updated: TripContext = {
        ...context,
        food_preferences: {
          ...context.food_preferences,
          cuisines_liked: [...context.food_preferences.cuisines_liked, cuisine],
        },
      }

      const { error } = await supabase
        .from('itineraries')
        .update({ trip_context: updated })
        .eq('id', itineraryId)

      if (error) {
        console.error('Failed to record cuisine preference:', error.message)
      }
    },
    [itineraryId]
  )

  const addLikedCategory = useCallback(
    async (category: string, context: TripContext) => {
      if (!itineraryId) return
      if (context.activity_preferences.liked_categories.includes(category)) return

      const updated: TripContext = {
        ...context,
        activity_preferences: {
          ...context.activity_preferences,
          liked_categories: [...context.activity_preferences.liked_categories, category],
        },
      }

      const { error } = await supabase
        .from('itineraries')
        .update({ trip_context: updated })
        .eq('id', itineraryId)

      if (error) {
        console.error('Failed to record category preference:', error.message)
      }
    },
    [itineraryId]
  )

  return {
    recordSkippedPlace,
    recordCompletedStop,
    addLikedCuisine,
    addLikedCategory,
  }
}
