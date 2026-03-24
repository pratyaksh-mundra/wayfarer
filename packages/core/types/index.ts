// All shared TypeScript types for Wayfarer
// Used by apps/web and future React Native app

export type PlaceRef = {
  name: string
  lat: number
  lng: number
  google_place_id?: string
}

export type MoodUpdate = {
  id: string
  itinerary_id: string
  day_number: number
  user_message: string
  action_taken: 'added_item' | 'swapped' | 'removed' | 'no_change'
  affected_item_id?: string
  created_at: string
}

export type PlaceCandidate = {
  place_name: string
  lat: number
  lng: number
  google_place_id?: string
  reddit_source_url?: string
  time_of_day: 'morning' | 'afternoon' | 'evening'
  duration_mins: number
  ai_note?: string
  category: string
}

export type TripContext = {
  // Live state — changes daily
  current_day: number
  trip_start_date: string // "2025-02-01"
  last_completed_stop: PlaceRef | null
  next_planned_stop: PlaceRef | null

  // Anchors — set once
  hotel: PlaceRef | null
  destination: string

  // Preferences — grow over trip from user actions
  food_preferences: {
    dietary: string[]
    cuisines_liked: string[]
    cuisines_skipped: string[]
    price_range: 'budget' | 'mid' | 'splurge'
  }
  activity_preferences: {
    pace: 'relaxed' | 'moderate' | 'packed'
    liked_categories: string[]
    skipped_place_ids: string[] // Google place_ids user removed
  }

  // History
  completed_stops: PlaceRef[]
  mood_updates: MoodUpdate[]

  // Extra recommendations Claude found but didn't include in main itinerary
  candidate_pool?: PlaceCandidate[]
}

export type ItineraryItem = {
  id: string
  itinerary_id: string
  day_number: number
  position: number // float, fractional — NEVER use integers
  place_name: string
  lat: number
  lng: number
  google_place_id?: string
  reddit_source_url?: string
  time_of_day: 'morning' | 'afternoon' | 'evening'
  duration_mins: number
  ai_note?: string
  category: string
  visited_at?: string
  added_by: 'ai' | 'user' | 'mood_update'
}

export type Itinerary = {
  id: string
  user_id?: string
  destination: string
  trip_start_date?: string
  duration_days: number
  hotel_place_id?: string
  hotel_lat?: number
  hotel_lng?: number
  share_token: string
  status: 'planning' | 'active' | 'completed'
  trip_context: TripContext
  items: ItineraryItem[]
}

// Reddit API types
export type RedditPost = {
  id: string
  title: string
  selftext: string
  url: string
  score: number
  subreddit: string
  created_utc: number
  num_comments: number
}

export type RedditComment = {
  id: string
  body: string
  score: number
  author: string
  post_id: string
}

// Google Places types
export type GoogleReview = {
  author: string
  rating: number
  text: string
  time: number // Unix timestamp
}

export type PlaceLookupResult = {
  lat: number
  lng: number
  hours: string
  rating: number
  user_ratings_total: number
  place_id: string
  photo_url: string
  price_level: number
  reviews: GoogleReview[] // up to 5 most relevant Google reviews
}

// Web search types
export type WebResult = {
  title: string
  url: string
  snippet: string
  source: string // domain, e.g. "lonelyplanet.com"
}

export type SearchWebInput = {
  query: string
  destination: string
  focus?: 'things_to_do' | 'food' | 'accommodation' | 'general'
}

export type SearchWebOutput = {
  results: WebResult[]
}

export type NearbyPlace = {
  name: string
  lat: number
  lng: number
  place_id: string
  distance_mins: number
  rating: number
  open_now: boolean
  price_level?: number
}

// Tool input/output types for Claude
export type SearchRedditInput = {
  destination: string
  queries: string[]
  subreddits?: string[]
  limit?: number
}

export type SearchRedditOutput = {
  posts: RedditPost[]
  comments: RedditComment[]
}

export type LookupPlaceInput = {
  place_name: string
  city: string
  type?: string
}

export type SearchNearbyInput = {
  lat: number
  lng: number
  radius_km: number
  keyword: string
  type?: string
}

export type SearchNearbyOutput = {
  places: NearbyPlace[]
}

export type UpdateItineraryOperation =
  | 'generate'
  | 'reorder'
  | 'add_item'
  | 'remove_item'
  | 'swap_item'
  | 'set_hotel'

export type UpdateItineraryInput = {
  itinerary_id?: string
  operation: UpdateItineraryOperation
  days?: Day[]
  item?: ItineraryItem
  hotel?: { name: string; lat: number; lng: number; google_place_id?: string }
  candidates?: PlaceCandidate[]
}

export type UpdateItineraryOutput = {
  itinerary_id: string
  updated_days: Day[]
}

export type Day = {
  day_number: number
  items: ItineraryItem[]
}
