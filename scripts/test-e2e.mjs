/**
 * Wayfarer end-to-end smoke test — zero dependencies, plain fetch only
 * Usage:
 *   node scripts/test-e2e.mjs                    # test localhost:3000
 *   node scripts/test-e2e.mjs https://your.app   # test production
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.argv[2] ?? 'http://localhost:3000'

// ── Load env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '../apps/web/.env.local')
  const env = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    env[key.trim()] = rest.join('=').trim()
  }
  return env
}

const env = loadEnv()
const SUPA_URL = env['NEXT_PUBLIC_SUPABASE_URL']
const SUPA_KEY = env['SUPABASE_SERVICE_ROLE_KEY']

// ── Supabase REST helpers ─────────────────────────────────────────────────────
async function dbSelect(table, filters = '') {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${filters}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
  })
  return res.json()
}

async function dbDelete(table, filter) {
  await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  })
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0

function ok(label, value) {
  if (value) { console.log(`  ✓  ${label}`); passed++ }
  else        { console.error(`  ✗  ${label}`); failed++ }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
}

async function consumeStream(res) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const events = []
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data: ')) continue
      try { events.push(JSON.parse(line.slice(6))) } catch { /* skip */ }
    }
  }
  return events
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\nWayfarer E2E smoke test`)
console.log(`Target: ${BASE_URL}`)

// ── 1. Landing page ───────────────────────────────────────────────────────────
section('1. Landing page')
try {
  const res = await fetch(`${BASE_URL}/`)
  ok('GET / returns 200', res.ok)
  const html = await res.text()
  ok('Contains "Plan my trip"', html.includes('Plan my trip'))
  ok('Contains "Wayfarer"', html.includes('Wayfarer'))
} catch (err) { console.error(`  ✗  ${err.message}`); failed++ }

// ── 2. Create itinerary ───────────────────────────────────────────────────────
section('2. POST /api/create')
let itineraryId = null
try {
  const res = await fetch(`${BASE_URL}/api/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination: 'Pondicherry 3 days test', duration_days: 3 }),
  })
  ok('Returns 200', res.ok)
  const body = await res.json()
  itineraryId = body.itinerary_id
  ok('Has itinerary_id', typeof itineraryId === 'string' && itineraryId.length > 0)
  console.log(`     id: ${itineraryId}`)
} catch (err) { console.error(`  ✗  ${err.message}`); failed++ }

// ── 3. Generate itinerary (streaming) ────────────────────────────────────────
section('3. POST /api/generate (streaming — ~60s)')
let generateOk = false
if (itineraryId) {
  try {
    console.log('     Calling Claude + Reddit + Google Places...')
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Pondicherry 3 days', itinerary_id: itineraryId }),
    })
    ok('Returns 200', res.ok)

    const events = await consumeStream(res)
    const tools = events.filter(e => e.type === 'tool_call').map(e => e.tool)
    const done  = events.find(e => e.type === 'done')
    const err   = events.find(e => e.type === 'error')

    if (err) console.error(`     AI error: ${err.message}`)

    ok('No error event', !err)
    ok('Called search_reddit', tools.includes('search_reddit'))
    ok('Called lookup_place',  tools.includes('lookup_place'))
    ok('Called update_itinerary', tools.includes('update_itinerary'))
    ok('Stream ends with done', !!done)
    console.log(`     Tools: ${[...new Set(tools)].join(', ')}`)
    generateOk = !!done && !err
  } catch (err) { console.error(`  ✗  ${err.message}`); failed++ }
}

// ── 4. Verify DB — itinerary row ──────────────────────────────────────────────
section('4. Supabase — itinerary row shape')
if (itineraryId && generateOk) {
  const rows = await dbSelect('itineraries', `id=eq.${itineraryId}&select=*`)
  const itin = rows[0]
  ok('Row exists', !!itin)
  ok('destination set', !!itin?.destination)
  ok('duration_days = 3', itin?.duration_days === 3)
  ok('share_token set', !!itin?.share_token)
  ok('trip_context is object', typeof itin?.trip_context === 'object')
}

// ── 5. Verify DB — itinerary items ────────────────────────────────────────────
section('5. Supabase — itinerary items')
if (itineraryId && generateOk) {
  const items = await dbSelect(
    'itinerary_items',
    `itinerary_id=eq.${itineraryId}&order=day_number.asc,position.asc`
  )
  ok('Items exist', Array.isArray(items) && items.length > 0)
  ok('At least 6 items', items.length >= 6)
  ok('All have lat/lng', items.every(i => i.lat && i.lng))
  ok('All have time_of_day', items.every(i => ['morning','afternoon','evening'].includes(i.time_of_day)))
  ok('Spans 3 days', new Set(items.map(i => i.day_number)).size === 3)
  ok('Fractional positions', items.every(i => typeof i.position === 'number'))
  console.log(`     ${items.length} items across ${new Set(items.map(i => i.day_number)).size} days`)
  const sample = items.slice(0, 3).map(i => `${i.place_name} (Day ${i.day_number})`).join(', ')
  console.log(`     Sample: ${sample}`)
}

// ── 6. Candidate pool ─────────────────────────────────────────────────────────
section('6. Candidate pool in trip_context')
if (itineraryId && generateOk) {
  const rows = await dbSelect('itineraries', `id=eq.${itineraryId}&select=trip_context`)
  const pool = rows[0]?.trip_context?.candidate_pool ?? []
  ok('candidate_pool exists', Array.isArray(pool))
  ok('At least 5 candidates', pool.length >= 5)
  ok('Candidates have name + coords', pool.every(c => c.place_name && c.lat && c.lng))
  console.log(`     ${pool.length} candidates: ${pool.slice(0, 3).map(c => c.place_name).join(', ')}`)
}

// ── 7. AI mood update ─────────────────────────────────────────────────────────
section('7. POST /api/update — mood update (~20s)')
if (itineraryId && generateOk) {
  try {
    const rows = await dbSelect('itineraries', `id=eq.${itineraryId}&select=trip_context`)
    const tripContext = rows[0]?.trip_context ?? {}

    console.log('     Asking Claude to add a cafe...')
    const res = await fetch(`${BASE_URL}/api/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itinerary_id: itineraryId,
        message: 'Add a good cafe for Day 1 morning',
        trip_context: tripContext,
      }),
    })
    ok('Returns 200', res.ok)
    const events = await consumeStream(res)
    ok('Update stream completes', !!events.find(e => e.type === 'done'))
  } catch (err) { console.error(`  ✗  ${err.message}`); failed++ }
}

// ── 8. Plan page renders ──────────────────────────────────────────────────────
section('8. Plan page HTTP')
if (itineraryId) {
  try {
    const res = await fetch(`${BASE_URL}/plan/${itineraryId}`)
    ok(`GET /plan/${itineraryId} returns 200`, res.ok)
    const html = await res.text()
    ok('Page includes Wayfarer', html.includes('Wayfarer'))
  } catch (err) { console.error(`  ✗  ${err.message}`); failed++ }
}

// ── Results ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(55)}`)
console.log(`  ${passed} passed  ·  ${failed} failed`)
if (failed === 0) {
  console.log('  All checks passed — ready to deploy!')
} else {
  console.log('  Fix failing checks before deploying.')
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
if (itineraryId) {
  await dbDelete('itinerary_items', `itinerary_id=eq.${itineraryId}`)
  await dbDelete('itineraries', `id=eq.${itineraryId}`)
  console.log(`\n  Cleaned up test itinerary ${itineraryId}`)
}

if (failed > 0) process.exit(1)
