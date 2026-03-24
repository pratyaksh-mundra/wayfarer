import { describe, it, expect } from 'vitest'
import { validateItinerary } from '../app/api/tools/validate'
import type { Day } from '@wayfarer/core/types'

// Helpers to build test items without boilerplate
function makeItem(
  place_name: string,
  lat: number,
  lng: number,
  time_of_day: 'morning' | 'afternoon' | 'evening',
  position: number
) {
  return {
    id: `id-${place_name}`,
    itinerary_id: 'itin-1',
    day_number: 1,
    place_name,
    lat,
    lng,
    time_of_day,
    duration_mins: 90,
    category: 'attraction',
    position,
    added_by: 'ai' as const,
  }
}

describe('validateItinerary', () => {
  describe('valid itineraries', () => {
    it('passes a correct single-day itinerary', () => {
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            makeItem('Beach', 11.934, 79.836, 'morning', 1.0),
            makeItem('Cafe', 11.937, 79.832, 'afternoon', 2.0),
            makeItem('Restaurant', 11.931, 79.828, 'evening', 3.0),
          ],
        },
      ]
      expect(validateItinerary(days)).toHaveLength(0)
    })

    it('passes a multi-day itinerary with one stop per day', () => {
      const days: Day[] = [
        { day_number: 1, items: [makeItem('Temple', 11.93, 79.83, 'morning', 1.0)] },
        { day_number: 2, items: [makeItem('Market', 11.94, 79.84, 'afternoon', 1.0)] },
      ]
      expect(validateItinerary(days)).toHaveLength(0)
    })

    it('passes an empty days array', () => {
      expect(validateItinerary([])).toHaveLength(0)
    })

    it('passes a day with no items', () => {
      const days: Day[] = [{ day_number: 1, items: [] }]
      expect(validateItinerary(days)).toHaveLength(0)
    })
  })

  describe('duplicate_time_slot', () => {
    it('detects two morning stops on the same day', () => {
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            makeItem('Rock Beach', 11.934, 79.836, 'morning', 1.0),
            makeItem('Cafe', 11.950, 79.850, 'morning', 2.0), // second morning
            makeItem('Restaurant', 11.931, 79.828, 'evening', 3.0),
          ],
        },
      ]
      const errors = validateItinerary(days)
      expect(errors.some((e) => e.rule === 'duplicate_time_slot')).toBe(true)
    })

    it('detects two evening stops on the same day', () => {
      const days: Day[] = [
        {
          day_number: 2,
          items: [
            makeItem('Museum', 11.934, 79.836, 'afternoon', 1.0),
            makeItem('Bar A', 11.950, 79.850, 'evening', 2.0),
            makeItem('Bar B', 11.960, 79.855, 'evening', 3.0),
          ],
        },
      ]
      const errors = validateItinerary(days)
      expect(errors.some((e) => e.rule === 'duplicate_time_slot' && e.day === 2)).toBe(true)
    })

    it('does not flag same time_of_day on different days', () => {
      const days: Day[] = [
        { day_number: 1, items: [makeItem('Beach', 11.934, 79.836, 'morning', 1.0)] },
        { day_number: 2, items: [makeItem('Park', 11.940, 79.840, 'morning', 1.0)] },
      ]
      expect(validateItinerary(days).filter((e) => e.rule === 'duplicate_time_slot')).toHaveLength(0)
    })
  })

  describe('duplicate_location', () => {
    it('detects two stops at the same coordinates (exact match)', () => {
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            makeItem('Rock Beach', 11.9340, 79.8298, 'morning', 1.0),
            makeItem('Promenade Beach', 11.9342, 79.8301, 'evening', 2.0), // ~30m apart
          ],
        },
      ]
      const errors = validateItinerary(days)
      expect(errors.some((e) => e.rule === 'duplicate_location')).toBe(true)
    })

    it('does not flag stops that are genuinely different (>300m)', () => {
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            makeItem('Beach North', 11.9340, 79.8298, 'morning', 1.0),
            makeItem('Temple South', 11.9500, 79.8500, 'afternoon', 2.0), // ~2km away
          ],
        },
      ]
      expect(validateItinerary(days).filter((e) => e.rule === 'duplicate_location')).toHaveLength(0)
    })

    it('detects duplicate even with different place names', () => {
      // Real case: "Seafront Promenade" and "Beach Road Walk" same location
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            makeItem('Seafront Promenade', 11.9340, 79.8298, 'morning', 1.0),
            makeItem('Beach Road Walk', 11.9341, 79.8299, 'afternoon', 2.0),
          ],
        },
      ]
      const errors = validateItinerary(days)
      expect(errors.some((e) => e.rule === 'duplicate_location')).toBe(true)
    })
  })

  describe('zone_spread', () => {
    it('detects stops more than 8km apart on the same day', () => {
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            // City center: ~11.93, 79.83
            makeItem('City Temple', 11.9340, 79.8298, 'morning', 1.0),
            // Auroville area: ~12.007, 79.811 — about 8.5km away
            makeItem('Zone Retreat', 12.0068, 79.8109, 'afternoon', 2.0),
          ],
        },
      ]
      const errors = validateItinerary(days)
      expect(errors.some((e) => e.rule === 'zone_spread')).toBe(true)
    })

    it('does not flag stops within the same zone (<8km)', () => {
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            makeItem('North Market', 11.9500, 79.8400, 'morning', 1.0),
            makeItem('South Beach', 11.9100, 79.8200, 'afternoon', 2.0), // ~5km away
          ],
        },
      ]
      expect(validateItinerary(days).filter((e) => e.rule === 'zone_spread')).toHaveLength(0)
    })

    it('correctly isolates zone violations to the offending day', () => {
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            makeItem('Place A', 11.934, 79.830, 'morning', 1.0),
            makeItem('Place B', 11.940, 79.835, 'afternoon', 2.0), // same zone
          ],
        },
        {
          day_number: 2,
          items: [
            makeItem('City Center', 11.934, 79.830, 'morning', 1.0),
            makeItem('Far Away Spot', 12.010, 79.811, 'afternoon', 2.0), // different zone
          ],
        },
      ]
      const errors = validateItinerary(days)
      const zoneErrors = errors.filter((e) => e.rule === 'zone_spread')
      expect(zoneErrors).toHaveLength(1)
      expect(zoneErrors[0]!.day).toBe(2)
    })
  })

  describe('multiple violations', () => {
    it('reports all violations in a single pass', () => {
      const days: Day[] = [
        {
          day_number: 1,
          items: [
            // duplicate time_of_day (both morning)
            makeItem('Rock Beach', 11.9340, 79.8298, 'morning', 1.0),
            // duplicate location (within 300m of Rock Beach) + second morning
            makeItem('Promenade Beach', 11.9341, 79.8300, 'morning', 2.0),
          ],
        },
      ]
      const errors = validateItinerary(days)
      const rules = errors.map((e) => e.rule)
      expect(rules).toContain('duplicate_time_slot')
      expect(rules).toContain('duplicate_location')
    })
  })
})
