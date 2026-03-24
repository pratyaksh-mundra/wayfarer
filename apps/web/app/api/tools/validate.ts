// Itinerary quality validator.
// Pure functions — no external dependencies. Used in tests and can be called
// after update_itinerary to surface rule violations in server logs.

import type { Day } from '@wayfarer/core/types'

export type ValidationError = {
  rule: 'duplicate_time_slot' | 'duplicate_location' | 'zone_spread'
  message: string
  day: number
}

const ZONE_SPREAD_KM = 8 // places >8km apart on the same day are in different zones
const DUPLICATE_COORD_DEG = 0.003 // ~300m — same physical location

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function validateItinerary(days: Day[]): ValidationError[] {
  const errors: ValidationError[] = []

  for (const day of days) {
    const { day_number, items } = day

    // 1. Each time_of_day must appear at most once per day
    const slotsSeen = new Set<string>()
    for (const item of items) {
      if (slotsSeen.has(item.time_of_day)) {
        errors.push({
          rule: 'duplicate_time_slot',
          message: `Day ${day_number}: multiple '${item.time_of_day}' stops — "${item.place_name}" conflicts`,
          day: day_number,
        })
      }
      slotsSeen.add(item.time_of_day)
    }

    // 2. No two places at the same physical location (coordinate dedup)
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!
        const b = items[j]!
        const latDiff = Math.abs(a.lat - b.lat)
        const lngDiff = Math.abs(a.lng - b.lng)
        if (latDiff < DUPLICATE_COORD_DEG && lngDiff < DUPLICATE_COORD_DEG) {
          errors.push({
            rule: 'duplicate_location',
            message: `Day ${day_number}: "${a.place_name}" and "${b.place_name}" are at the same location (within 300m)`,
            day: day_number,
          })
        }
      }
    }

    // 3. All places on the same day should be in the same geographic zone
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!
        const b = items[j]!
        const dist = haversineKm(a.lat, a.lng, b.lat, b.lng)
        if (dist > ZONE_SPREAD_KM) {
          errors.push({
            rule: 'zone_spread',
            message: `Day ${day_number}: "${a.place_name}" and "${b.place_name}" are ${dist.toFixed(1)}km apart — different zones`,
            day: day_number,
          })
        }
      }
    }
  }

  return errors
}
