# Wayfarer — Full Product & Architecture Planning Document

> This document is the single source of truth for the Wayfarer travel app.
> Claude should read this before making any architectural decisions.
> Last updated: 2026-03-02 — Phase 1 code complete, awaiting first live test run.

---

## What We Are Building

A Reddit-powered travel companion app. Users type a destination, get an AI-generated itinerary sourced from real Reddit travel advice and grounded by Google Places data. The itinerary lives on a map, is fully drag-and-drop editable, and updates in real-time when users make natural language requests ("add pizza tonight near my last stop").

The core insight: Reddit travel advice (r/travel, r/solotravel, city subs) is often better than guidebooks — recent, opinionated, from real people. Nobody has built a product that properly surfaces this.

---

## Two Modes (Both Share the Same Data Model)

### Planning Mode
User hasn't left yet. They input destination, dates, optionally a hotel. AI generates a full itinerary. User can drag-drop to reorder, ask AI to swap/add/remove places, add their hotel to re-optimize routing. Shareable link. This is the primary web feature.

### Companion Mode
Trip is active. App knows what day it is based on trip start date. User sends natural language mood updates. AI edits the live itinerary with awareness of: current day, last stop, hotel location, and learned preferences. This is where mobile matters — design web for it, build native later.

---

## The Market Gap

| App | What it does | What's missing |
|-----|-------------|----------------|
| Wanderlog | Itinerary builder, map, drag-drop | No Reddit, no AI curation, no social |
| TripIt | Parses booking emails | No discovery |
| Google Travel | Hotels + trips | Generic, no community signal |
| Roadtrippers | Route planning | Road-trip only, US-focused |
| Roam Around / Layla | AI itineraries | No Reddit, no live companion mode |

**Our moat:** Reddit curation + hotel-aware routing + live companion with memory.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js 14 (App Router) | Server components, API routes, deploys to Vercel free |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent, mobile-ready |
| Map | Mapbox GL JS | Custom styling, React Native uses same SDK later |
| Backend / DB | Supabase | Postgres + Auth + Realtime + Storage, replaces 3 services |
| AI | Claude API (tool use) | Native tool use for 5-tool architecture, streaming |
| Drag-drop | dnd-kit | Lightweight, accessible, ports to RN later |
| Monorepo | pnpm workspaces | Shared core logic between web and future mobile |
| Hosting | Vercel + Supabase Cloud | Both free to start, zero DevOps |

---

## Project Structure

```
wayfarer/
├── packages/
│   └── core/                      # Shared logic — NO JSX. Used by web + mobile.
│       ├── hooks/
│       │   ├── useItinerary.ts    # CRUD, reordering, optimistic updates
│       │   ├── useTripContext.ts  # Live trip state, current day calculation
│       │   ├── useAIUpdate.ts     # Streaming AI calls, tool execution
│       │   └── useMemory.ts       # Read/write trip_context preferences
│       ├── api/
│       │   ├── supabase.ts        # Supabase client (shared, both platforms)
│       │   └── claude.ts          # AI wrapper with streaming + tool definitions
│       └── types/
│           └── index.ts           # All shared TypeScript types
│
└── apps/
    └── web/                       # Next.js app
        ├── app/
        │   ├── page.tsx           # Landing — destination search input
        │   ├── plan/[id]/
        │   │   ├── page.tsx       # Main view: Map (60%) + Panel (40%)
        │   │   ├── MapView.tsx    # Mapbox, pins colored by day, hotel pin, route lines
        │   │   ├── ItineraryPanel.tsx  # dnd-kit drag-drop, day groups, place cards
        │   │   ├── HotelInput.tsx      # Hotel search + confirm + trigger re-optimize
        │   │   └── MoodBar.tsx         # "What do you feel like?" live update input
        │   └── api/
        │       ├── generate/route.ts   # Streaming: full itinerary generation
        │       ├── update/route.ts     # Streaming: mood updates + edits
        │       └── tools/
        │           ├── reddit.ts       # Reddit API + 48hr Supabase cache
        │           ├── places.ts       # Google Places lookup
        │           └── nearby.ts       # Google Places nearby search
        └── components/            # Web-only UI primitives
```

**Rule:** Business logic lives ONLY in `packages/core/hooks`. Components are dumb UI. If logic touches Supabase or Claude, it belongs in core.

---

## The Four AI Tools

Claude is the orchestrator. It decides which tools to call and in what order. We define the tools; Claude sequences them.

### 1. `search_reddit`
Searches Reddit for travel advice about a destination. Hits r/travel, r/solotravel, and destination-specific subs. Results are cached 48hrs in Supabase by query hash.

```typescript
input:  { destination: string, queries: string[], subreddits?: string[], limit?: number }
output: { posts: RedditPost[], comments: RedditComment[] }
```

### 2. `lookup_place`
Validates a place exists via Google Places and returns structured data. Used for every place Claude identifies from Reddit, AND for hotel lookup.

```typescript
input:  { place_name: string, city: string, type?: string }
output: { lat: number, lng: number, hours: string, rating: number, place_id: string, photo_url: string, price_level: number }
```

### 3. `search_nearby`
Finds places near a given coordinate. Used for real-time mood requests ("pizza near my last stop"). Returns candidates ranked by distance + rating so Claude can present a trade-off to the user.

```typescript
input:  { lat: number, lng: number, radius_km: number, keyword: string, type?: string }
output: { places: NearbyPlace[] }  // each has: name, distance_mins, rating, open_now, place_id
```

### 4. `update_itinerary`
Writes or patches an itinerary in the DB. Called at the end of generation, and for every user edit. Supports operations: `generate`, `reorder`, `add_item`, `remove_item`, `swap_item`.

```typescript
input:  { itinerary_id?: string, operation: string, days?: Day[], item?: ItineraryItem }
output: { itinerary_id: string, updated_days: Day[] }
```

---

## Database Schema

### `itineraries`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid REFERENCES auth.users  -- null = anonymous
destination     text NOT NULL               -- "Pondicherry"
trip_start_date date                        -- null until trip starts
duration_days   integer NOT NULL
hotel_place_id  text                        -- Google place_id of hotel
hotel_lat       float
hotel_lng       float
share_token     text UNIQUE                 -- short ID for /share/[token]
status          text DEFAULT 'planning'     -- planning | active | completed
trip_context    jsonb DEFAULT '{}'          -- memory object, updated live
created_at      timestamptz DEFAULT now()
```

### `itinerary_items`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
itinerary_id    uuid REFERENCES itineraries ON DELETE CASCADE
day_number      integer NOT NULL            -- 1, 2, 3...
position        float NOT NULL              -- FRACTIONAL: 1.0, 1.5, 2.0 (never integers for ordering)
place_name      text NOT NULL
lat             float NOT NULL
lng             float NOT NULL
google_place_id text
reddit_source_url text                      -- link to source Reddit post
time_of_day     text                        -- morning | afternoon | evening
duration_mins   integer                     -- estimated time at location
ai_note         text                        -- "locals say arrive before 6am"
category        text                        -- beach | food | heritage | cafe | outdoor
visited_at      timestamptz                 -- set when user marks visited in companion mode
added_by        text DEFAULT 'ai'           -- ai | user | mood_update
```

### `reddit_cache`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
query_hash      text UNIQUE                 -- MD5(destination + query string)
destination     text
results         jsonb                       -- raw Reddit API response
cached_at       timestamptz DEFAULT now()   -- expire after 48hrs in query logic
hit_count       integer DEFAULT 0           -- track popular destinations
```

### `mood_updates`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
itinerary_id    uuid REFERENCES itineraries ON DELETE CASCADE
day_number      integer
user_message    text                        -- "pizza tonight neapolitan"
action_taken    text                        -- added_item | swapped | removed | no_change
affected_item_id uuid REFERENCES itinerary_items
created_at      timestamptz DEFAULT now()
```

**Important:** Use `position float` with fractional ordering throughout. When inserting between position 2.0 and 3.0, use 2.5. Never re-index all rows on drag. This is how Notion and Linear do it.

---

## Key Data Types (TypeScript)

```typescript
// packages/core/types/index.ts

export type TripContext = {
  // Live state — changes daily
  current_day: number
  trip_start_date: string        // "2025-02-01"
  last_completed_stop: PlaceRef | null
  next_planned_stop: PlaceRef | null

  // Anchors — set once
  hotel: PlaceRef | null
  destination: string

  // Preferences — grow over trip from user actions
  food_preferences: {
    dietary: string[]            // ["vegetarian"]
    cuisines_liked: string[]     // ["neapolitan", "south_indian"]
    cuisines_skipped: string[]
    price_range: 'budget' | 'mid' | 'splurge'
  }
  activity_preferences: {
    pace: 'relaxed' | 'moderate' | 'packed'
    liked_categories: string[]   // ["beach", "heritage", "cafes"]
    skipped_place_ids: string[]  // Google place_ids user removed
  }

  // History
  completed_stops: PlaceRef[]
  mood_updates: MoodUpdate[]
}

export type PlaceRef = {
  name: string
  lat: number
  lng: number
  google_place_id?: string
}

export type ItineraryItem = {
  id: string
  itinerary_id: string
  day_number: number
  position: number               // float, fractional
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
```

---

## Hotel-Aware Routing Logic

1. User generates itinerary → city center used as default anchor
2. User adds hotel → `lookup_place` called → hotel lat/lng stored on itinerary
3. Claude re-optimization prompt: *"Re-order each day so morning starts closest to hotel and the day's final stop is within 1km of hotel. Minimize total walking distance. Only reorder — do not swap places unless you find a clearly better nearby alternative."*
4. UI shows: "We saved 2.4km of walking on Day 2" (computed from old vs new ordering)
5. Map re-renders: hotel pin visible at all times in distinct color, route lines updated

---

## Real-Time Mood Update Flow

Example: Day 2, 4:30pm, user types "I'm in the mood for pizza tonight. Add somewhere good."

1. Claude receives message + full `trip_context` (current day=2, last stop=Serenity Beach lat/lng, hotel=Villa Shanti lat/lng, time=4:30pm)
2. Claude calls `search_nearby` with: keyword="Neapolitan pizza wood-fired", location=last stop lat/lng, radius=2km
3. Claude evaluates results — finds Option A (5 min, rating 4.3) and Option B (20 min, rating 4.7, mentioned on Reddit)
4. UI shows the explicit trade-off: "Option A is 5 min away, Option B is 20 min but Redditors consistently recommend it"
5. User picks → Claude calls `update_itinerary` with add_item operation
6. Preference `cuisines_liked: ["neapolitan"]` written to `trip_context` in Supabase
7. Map pin appears on Day 2, route line updates

**Never hide the trade-off. Always show distance vs quality explicitly.**

---

## Geographic Ordering (No Routing API Needed for V1)

In the Claude system prompt for generation:

```
When ordering places within a day:
1. Group places that are within 500m of each other into time blocks
2. Order time blocks so the user doesn't backtrack across the city
3. Put outdoor/active places in morning, meals at natural meal times,
   relaxed/indoor places during afternoon heat, atmospheric spots at sunset/evening
4. Include ~15min travel buffer between places that are 1km+ apart
5. Never put more than 4-5 places in a single day
6. When hotel is known: first stop of day within 1km of hotel, last stop within 1km of hotel
```

---

## Companion Mode: How Day Tracking Works

```typescript
// In useTripContext.ts
export function getCurrentDay(tripStartDate: string): number {
  const start = new Date(tripStartDate)
  const today = new Date()
  const diff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(1, diff + 1)  // Day 1 = start date
}

// Status transitions
// planning → active: when user sets trip_start_date AND today >= start date
// active → completed: when current_day > duration_days
```

When `status = 'active'`, the UI switches to Companion Mode: shows today's stops highlighted, visited stops grayed out, MoodBar prominently displayed, hotel pin always visible.

---

## React Native Readiness Rules

These rules must be followed from day one so mobile doesn't require a rewrite:

1. **All business logic in `packages/core/hooks`** — hooks import from `@wayfarer/core`, not from `apps/web`
2. **No Next.js-specific imports in core** — no `next/navigation`, no `next/headers` in `packages/core`
3. **Supabase client initialized once in `packages/core/api/supabase.ts`** — imported everywhere
4. **Map components are the ONLY web-specific code** — Mapbox web vs Mapbox RN, swapped per platform
5. **dnd-kit is web-only** — RN will use `react-native-reanimated` for drag-drop, but `useItinerary.ts` reorder logic is shared

---

## Build Phases

### Phase 1 — Core Loop (Weeks 1–3)
Get Claude tools working end-to-end. No map UI yet. No auth yet.
- [x] pnpm monorepo scaffold with packages/core and apps/web
- [x] Supabase project, schema run (`supabase/schema.sql`) — 6 tables + indexes
- [x] TypeScript types in `packages/core/types/index.ts`
- [x] Claude API with **5 tools** + streaming in `packages/core/api/claude.ts`
  - Added: `search_web` (Google Custom Search — travel sites)
  - Enhanced: `lookup_place` now returns Google Reviews via Place Details API
- [x] Reddit API wrapper + 48hr cache — `apps/web/app/api/tools/reddit.ts`
- [x] Google Places wrapper (lookup + reviews + nearby) + 7-day cache — `apps/web/app/api/tools/places.ts`
- [x] Google Custom Search wrapper + 48hr cache — `apps/web/app/api/tools/web.ts`
- [x] All 4 core hooks: `useItinerary`, `useTripContext`, `useAIUpdate`, `useMemory`
- [x] Streaming generate endpoint — `apps/web/app/api/generate/route.ts`
- [x] Streaming update endpoint — `apps/web/app/api/update/route.ts`
- [x] Basic UI: landing page, plan view, ItineraryPanel, MoodBar, HotelInput, MapView placeholder
- [ ] **NEXT:** Fix `@types/node` in `packages/core` (devDeps + tsconfig), run `pnpm install`, fill `.env.local`
- [ ] Test: type "Pondicherry 3 days" → streaming response → valid itinerary JSON → saved to Supabase

#### Added beyond original Phase 1 spec
- Supabase-backed caching for ALL external APIs (not just Reddit) — mandatory, prevents rate limits
- `search_web` tool (Google CSE) for cross-referencing Reddit with Lonely Planet / TripAdvisor / etc.
- Google Reviews embedded in `lookup_place` response — Claude uses these to populate `ai_note`
- Supabase URL now supports proxy/custom domain (e.g. `https://wayfarer.jiobase.com`)
- Supabase anon key supports both old (`ANON_KEY`) and new (`PUBLISHABLE_DEFAULT_KEY`) naming

### Phase 2 — Planning Mode UI (Weeks 4–6)
- [ ] Mapbox map with day-colored pins + hotel pin
- [ ] Itinerary panel with dnd-kit drag-drop
- [ ] Fractional position reordering working
- [ ] Hotel input + re-optimize flow
- [ ] MoodBar for AI updates (planning mode: swap/add/remove)
- [ ] Shareable link via share_token
- [ ] Supabase Auth (magic link email)
- [ ] Save itinerary to account
- [ ] Mobile responsive layout

### Phase 3 — Companion Mode (Weeks 7–9)
- [ ] Trip start date → status transitions to 'active'
- [ ] Day counter + today's stops highlighted
- [ ] trip_context memory object live and updating
- [ ] Preference learning from user drag/remove actions
- [ ] "Mark as visited" on stops
- [ ] Real-time mood updates with trade-off UI
- [ ] near-me search using user's current location

### Phase 4 — Ship (Week 10)
- [ ] Analytics with Posthog (itinerary_created, hotel_added, mood_update events)
- [ ] Post to r/solotravel, r/travel, IndieHackers
- [ ] Success metric: 50 itineraries created by strangers in first month
- [ ] Decide: social layer or mobile next based on what users actually do

---

## Future Features (Do Not Build Yet)

These are planned but explicitly out of scope until Phase 4 validation:

- **Social / bulletin board**: Users create public events on map, solo travelers can join. Hostels can post activities. Map IS the board.
- **Hostel partnerships**: Hostels pay to list activities. Best early B2B revenue.
- **Outbound affiliate links**: GetYourGuide / Viator links (~5-8% affiliate margin)
- **Budget-aware itineraries**: price_level filter, daily budget input
- **React Native app**: After web validation. Shared core hooks make this faster.

---

## Running Costs (V1, ~1000 users/month)

| Service | Free Tier | Est. Cost |
|---------|-----------|-----------|
| Vercel | Unlimited hobby | $0 |
| Supabase | 500MB DB, 50k MAU | $0 |
| Mapbox | 50k map loads/mo | $0 |
| Google Places | $200 credit/mo | ~$0 with caching |
| Claude API (Haiku) | — | ~$2–5 |
| Reddit API | 100 req/min free | $0 with 48hr cache |
| **Total** | | **~$5/mo** |

---

## Critical Implementation Notes

- **Reddit cache is mandatory from day one.** MD5 hash of `destination + query` as cache key. Check Supabase before every Reddit API call. 48hr TTL. Without this, you'll hit rate limits within days of launch.
- **Fractional positions everywhere.** Never use integers for `itinerary_items.position`. When inserting between 2.0 and 3.0, use 2.5. When inserting between 2.0 and 2.5, use 2.25. No re-indexing on drag.
- **trip_context as JSONB.** Do not normalize preferences into separate tables yet. You don't know which preferences matter. Iterate on the JSONB shape, normalize later.
- **Stream everything.** Both `/api/generate` and `/api/update` must use streaming (Server-Sent Events). A 10-second blank wait will kill perceived quality.
- **Always show trade-offs on nearby search.** Distance vs rating, never hide it, never auto-pick.
