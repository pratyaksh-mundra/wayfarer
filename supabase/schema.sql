-- Wayfarer — Supabase schema
-- Run this in the Supabase SQL editor to create all tables.
-- Order matters: itineraries before itinerary_items.

-- ─── Core tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS itineraries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users,        -- null = anonymous
  destination     text NOT NULL,
  trip_start_date date,                               -- null until trip starts
  duration_days   integer NOT NULL,
  hotel_place_id  text,                              -- Google place_id of hotel
  hotel_lat       float,
  hotel_lng       float,
  share_token     text UNIQUE,                       -- short ID for /share/[token]
  status          text DEFAULT 'planning',           -- planning | active | completed
  trip_context    jsonb DEFAULT '{}',                -- memory object, updated live
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS itinerary_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id      uuid REFERENCES itineraries ON DELETE CASCADE,
  day_number        integer NOT NULL,
  position          float NOT NULL,                  -- FRACTIONAL: 1.0, 1.5, 2.0
  place_name        text NOT NULL,
  lat               float NOT NULL,
  lng               float NOT NULL,
  google_place_id   text,
  reddit_source_url text,
  time_of_day       text,                            -- morning | afternoon | evening
  duration_mins     integer,
  ai_note           text,
  category          text,
  visited_at        timestamptz,                     -- set in companion mode
  added_by          text DEFAULT 'ai'                -- ai | user | mood_update
);

CREATE TABLE IF NOT EXISTS mood_updates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id      uuid REFERENCES itineraries ON DELETE CASCADE,
  day_number        integer,
  user_message      text,
  action_taken      text,                            -- added_item | swapped | removed | no_change
  affected_item_id  uuid REFERENCES itinerary_items,
  created_at        timestamptz DEFAULT now()
);

-- ─── Cache tables ─────────────────────────────────────────────────────────────
-- All cache tables follow the same pattern:
--   query_hash  → MD5 of the input, used as the unique key
--   cached_at   → checked against TTL in application code
--   hit_count   → analytics: which destinations/places are most queried

-- Reddit search cache — 48hr TTL
CREATE TABLE IF NOT EXISTS reddit_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash  text UNIQUE NOT NULL,                  -- MD5(destination + query)
  destination text,
  results     jsonb NOT NULL,                        -- SearchRedditOutput
  cached_at   timestamptz DEFAULT now(),
  hit_count   integer DEFAULT 0
);

-- Google Places lookup cache — 7-day TTL
-- Caches the full PlaceLookupResult including reviews.
CREATE TABLE IF NOT EXISTS places_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash  text UNIQUE NOT NULL,                  -- MD5(place_name + city + type)
  place_name  text,
  city        text,
  result      jsonb NOT NULL,                        -- PlaceLookupResult
  cached_at   timestamptz DEFAULT now(),
  hit_count   integer DEFAULT 0
);

-- Google Custom Search cache — 48hr TTL
CREATE TABLE IF NOT EXISTS web_search_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash  text UNIQUE NOT NULL,                  -- MD5(destination + query + focus)
  destination text,
  query       text,
  focus       text DEFAULT 'general',
  results     jsonb NOT NULL,                        -- SearchWebOutput
  cached_at   timestamptz DEFAULT now(),
  hit_count   integer DEFAULT 0
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_itinerary_items_itinerary_id ON itinerary_items (itinerary_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_items_position ON itinerary_items (itinerary_id, day_number, position);
CREATE INDEX IF NOT EXISTS idx_mood_updates_itinerary_id ON mood_updates (itinerary_id);
CREATE INDEX IF NOT EXISTS idx_reddit_cache_hash ON reddit_cache (query_hash);
CREATE INDEX IF NOT EXISTS idx_places_cache_hash ON places_cache (query_hash);
CREATE INDEX IF NOT EXISTS idx_web_search_cache_hash ON web_search_cache (query_hash);
