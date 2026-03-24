# Wayfarer

Reddit-powered travel companion app. See @PLANNING.md for full product context, architecture decisions, and rationale. Read it before making any architectural decisions.

---

## Commands

```bash
pnpm dev          # start web app (apps/web)
pnpm build        # build all packages
pnpm typecheck    # tsc --noEmit across all packages
pnpm lint         # eslint across all packages
pnpm test         # vitest
```

To run a single app: `pnpm --filter web dev`
To add a dep to core: `pnpm --filter @wayfarer/core add <pkg>`

---

## Stack

- **Next.js 14** (App Router) — `apps/web`
- **Supabase** — Postgres + Auth + Realtime. Client in `packages/core/api/supabase.ts`
- **Claude API** — tool use with streaming. Wrapper in `packages/core/api/claude.ts`
- **Mapbox GL JS** — map, pins, route lines
- **dnd-kit** — drag-drop itinerary reordering
- **pnpm workspaces** — monorepo

---

## Architecture Rules

IMPORTANT: These rules exist so the app can move to React Native without a rewrite.

1. **Business logic belongs in `packages/core/hooks` only.** Components are dumb UI — they call hooks, render data. Never put Supabase queries or Claude calls in components.
2. **No Next.js imports in `packages/core`.** No `next/navigation`, `next/headers`, or anything Next-specific in core. Core must be platform-agnostic.
3. **All AI calls go through `packages/core/api/claude.ts`.** Never call the Claude SDK directly from a component or API route.
4. **Use fractional float positions for `itinerary_items.position`.** When inserting between 2.0 and 3.0, use 2.5. Never re-index all rows. Never use integers for ordering.
5. **All external API calls must check cache first.** Every tool that hits a third-party API has a Supabase cache table. Check it before every call. Write to it after every live fetch. Never skip.
   - `reddit_cache` — MD5(destination+query), 48hr TTL
   - `places_cache` — MD5(place_name+city+type), 7-day TTL (places don't change often)
   - `web_search_cache` — MD5(destination+query+focus), 48hr TTL

   Full schema in `supabase/schema.sql`.

---

## The Five AI Tools

Claude orchestrates these — it decides call order. We define schemas, Claude sequences.

| Tool | Purpose |
|------|---------|
| `search_reddit` | Fetch travel advice from Reddit. Always cache results 48hrs. |
| `search_web` | Google Custom Search across travel sites (Lonely Planet, TripAdvisor, Timeout, etc.). Cross-references Reddit with established travel sources. |
| `lookup_place` | Google Places lookup — validate a named place, get lat/lng/hours/rating + up to 5 Google review texts. Also used for hotel lookup. |
| `search_nearby` | Google Places nearby search by lat/lng. Used for mood updates ("pizza near my last stop"). Returns candidates with distance + rating so Claude can present trade-offs. |
| `update_itinerary` | Write or patch itinerary in Supabase. Operations: `generate`, `reorder`, `add_item`, `remove_item`, `swap_item`. |

Full schemas in `packages/core/api/claude.ts` and `@PLANNING.md`.

Source priority: Reddit (recent, opinionated) → Google Reviews (verified visitor feedback) → travel web (editorial context). Claude synthesises all three and notes conflicts in `ai_note`.

---

## Database

Full schema in `supabase/schema.sql` — run this in the Supabase SQL editor. **Already run.**

Core tables:
- `itineraries` — one row per trip. `trip_context jsonb` holds the entire memory/preference object.
- `itinerary_items` — one row per stop. `position float` (fractional).
- `mood_updates` — log of natural language updates from companion mode.

Cache tables (all follow same pattern: MD5 hash key, `cached_at`, `hit_count`):
- `reddit_cache` — TTL 48hr
- `places_cache` — TTL 7 days (includes Google Reviews in `result` jsonb)
- `web_search_cache` — TTL 48hr

---

## Key Types

All shared types live in `packages/core/types/index.ts`. The most important:

- `Itinerary` — full trip including items and trip_context
- `ItineraryItem` — single stop with fractional position
- `TripContext` — memory object: current day, hotel, food/activity preferences, history
- `PlaceRef` — `{ name, lat, lng, google_place_id? }`

---

## Env Variables

```
# apps/web/.env.local  (copy from .env.local.example)

# Supabase — use proxy URL if available (e.g. https://wayfarer.jiobase.com)
# Supports both old (ANON_KEY) and new (PUBLISHABLE_DEFAULT_KEY) Supabase naming
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # server-side only, never expose to client

ANTHROPIC_API_KEY=
MAPBOX_TOKEN=

# Google — one Cloud project, two APIs
GOOGLE_PLACES_API_KEY=         # Places API (lookup + nearby + reviews)
GOOGLE_CSE_API_KEY=            # Custom Search API (same project, enable separately)
GOOGLE_CSE_ID=                 # Create at cse.google.com

REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
```

---

## Code Style

- TypeScript strict mode. No `any`. If you're tempted, use `unknown` and narrow it.
- ES modules only. No `require()`.
- Async/await over raw promises.
- Named exports only. No default exports except Next.js page/layout files.
- Tailwind for all styling. No inline styles. No CSS modules.
- Functional components + hooks only. No class components.
- Error handling: always handle Supabase errors explicitly. Never assume `.data` is non-null.

---

## Streaming Pattern

Both `/api/generate` and `/api/update` MUST stream. Use Server-Sent Events via Next.js Route Handlers. Users must see progress — never a blank 10-second wait.

```typescript
// Correct pattern for streaming Claude responses
return new Response(
  new ReadableStream({
    async start(controller) {
      const stream = await anthropic.messages.stream({ ... })
      for await (const chunk of stream) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`))
      }
      controller.close()
    }
  }),
  { headers: { 'Content-Type': 'text/event-stream' } }
)
```

---

## What We Are NOT Building Yet

Do not implement these until explicitly asked:

- Social / bulletin board / event features
- Hostel partnerships
- Affiliate links (GetYourGuide, Viator)
- Budget-aware itinerary filtering
- React Native app
- Multi-user / real-time collaboration

---

## Current Phase

**Phase 1 — Core Loop.** All code written. Needs `pnpm install` + env vars to run.

### Done
- pnpm monorepo scaffold (`packages/core`, `apps/web`)
- All TypeScript types — `packages/core/types/index.ts`
- Supabase client with proxy/custom domain support — `packages/core/api/supabase.ts`
- Claude API wrapper with **5 tools** + streaming — `packages/core/api/claude.ts`
- All 4 core hooks (`useItinerary`, `useTripContext`, `useAIUpdate`, `useMemory`)
- Reddit API wrapper + 48hr cache — `apps/web/app/api/tools/reddit.ts`
- Google Places lookup (with Reviews via Place Details) + 7-day cache — `apps/web/app/api/tools/places.ts`
- Google Custom Search across travel sites + 48hr cache — `apps/web/app/api/tools/web.ts`
- Streaming generate endpoint — `apps/web/app/api/generate/route.ts`
- Streaming update endpoint — `apps/web/app/api/update/route.ts`
- Supabase DB schema (all 6 tables + indexes) — `supabase/schema.sql` ✅ ran
- Landing page + plan view + ItineraryPanel + MoodBar + MapView (placeholder) + HotelInput

### Immediate next steps (to get Phase 1 running)
1. Fix `@types/node` missing in `packages/core` — add to `packages/core/package.json` devDeps and `tsconfig.json`
2. Copy `apps/web/.env.local.example` → `apps/web/.env.local`, fill all keys
3. Run `pnpm install` from workspace root (installs to F drive per `.npmrc`)
4. Run `pnpm dev` and test: type "Pondicherry 3 days" → verify streaming → verify Supabase row created

### Remaining Phase 1 gap
- End-to-end test not yet verified (no `pnpm install` run yet)

Full checklist in `@PLANNING.md` under "Build Phases".

---

## Drive Constraint — CRITICAL

**Never write to or install anything on the C drive.** All project files, package stores, caches, and tooling must stay on the F drive.

pnpm is configured via `.npmrc` to store packages and cache on F drive. Do not override these settings. Do not run any command that would write to `C:\Users\...` or any C drive path.

---

## When Something Feels Wrong

Before changing architecture, read `@PLANNING.md`. If it contradicts what you're about to do, stop and ask. The architecture decisions in that doc were deliberate — especially the monorepo structure, fractional positions, and JSONB trip_context.
