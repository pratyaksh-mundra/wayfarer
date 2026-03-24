'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import type { Itinerary, ItineraryItem, PlaceCandidate } from '@wayfarer/core/types'
import { useItinerary } from '@wayfarer/core/hooks/useItinerary'
import { useMemory } from '@wayfarer/core/hooks/useMemory'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDraggable, useDroppable } from '@dnd-kit/core'

const DAY_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#06b6d4']

type Props = {
  itinerary: Itinerary
  currentDay: number
  status: 'planning' | 'active' | 'completed'
  onRefresh: () => Promise<void>
  activeDay: number | null
  onDaySelect: (day: number | null) => void
  selectedItemId: string | null
  onSelectItem: (id: string | null) => void
}

export function ItineraryPanel({
  itinerary, currentDay, status, onRefresh,
  activeDay, onDaySelect, selectedItemId, onSelectItem,
}: Props) {
  const { reorderDay, removeItem, markVisited, addCandidateToDay } = useItinerary(itinerary.id)
  const { recordSkippedPlace } = useMemory(itinerary.id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const [localItems, setLocalItems] = useState<ItineraryItem[]>(() =>
    [...itinerary.items].sort((a, b) => a.day_number - b.day_number || a.position - b.position)
  )
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  // Ref for synchronous access inside collisionDetection (state update is async)
  const activeDragIdRef = useRef<string | null>(null)

  useEffect(() => {
    setLocalItems(
      [...itinerary.items].sort((a, b) => a.day_number - b.day_number || a.position - b.position)
    )
  }, [itinerary.items])

  function itemsForDay(dayNum: number): ItineraryItem[] {
    return localItems.filter((i) => i.day_number === dayNum)
  }

  function handleDragStart(event: DragStartEvent) {
    activeDragIdRef.current = String(event.active.id)
    setActiveDragId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    activeDragIdRef.current = null
    setActiveDragId(null)
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)

    // Candidate dropped onto a day or an item within a day
    if (activeId.startsWith('candidate-')) {
      const idx = parseInt(activeId.replace('candidate-', ''), 10)
      const candidates = itinerary.trip_context.candidate_pool ?? []
      const candidate = candidates[idx]
      if (!candidate) return

      let targetDay: number | null = null
      if (overId.startsWith('day-')) {
        targetDay = parseInt(overId.replace('day-', ''), 10)
      } else {
        const targetItem = localItems.find((i) => i.id === overId)
        targetDay = targetItem?.day_number ?? null
      }
      if (targetDay) void addCandidateToDay(candidate, targetDay)
      return
    }

    // Regular item reorder within a day
    if (active.id === over.id) return
    const item = localItems.find((i) => i.id === activeId)
    if (!item) return
    const dayNum = item.day_number
    const dayItems = itemsForDay(dayNum)
    const oldIndex = dayItems.findIndex((i) => i.id === activeId)
    const newIndex = dayItems.findIndex((i) => i.id === overId)
    if (oldIndex === -1 || newIndex === -1) return

    const timeSlots = dayItems.map((i) => i.time_of_day)
    const reordered = arrayMove(dayItems, oldIndex, newIndex)
    const updated: ItineraryItem[] = reordered.map((it, idx) => ({
      ...it,
      time_of_day: timeSlots[idx]!,
      position: (idx + 1) * 1.0,
    }))

    setLocalItems((prev) => {
      const others = prev.filter((i) => i.day_number !== dayNum)
      return [...others, ...updated].sort((a, b) => a.day_number - b.day_number || a.position - b.position)
    })

    void reorderDay(updated.map((u) => ({ id: u.id, position: u.position, time_of_day: u.time_of_day })))
  }

  async function handleRemove(itemId: string, googlePlaceId?: string) {
    if (selectedItemId === itemId) onSelectItem(null)
    await removeItem(itemId)
    if (googlePlaceId && itinerary.trip_context) {
      await recordSkippedPlace(googlePlaceId, itinerary.trip_context)
    }
    await onRefresh()
  }

  async function handleMarkVisited(itemId: string) {
    await markVisited(itemId)
    await onRefresh()
  }

  const daysToShow = activeDay !== null
    ? [activeDay]
    : Array.from({ length: itinerary.duration_days }, (_, i) => i + 1)

  // Use pointer-based collision for candidates (cross-list drop),
  // closestCenter for regular item reordering within a day.
  const collisionDetection: CollisionDetection = (args) => {
    if (activeDragIdRef.current?.startsWith('candidate-')) {
      const hits = pointerWithin(args)
      return hits.length > 0 ? hits : rectIntersection(args)
    }
    return closestCenter(args)
  }

  const candidates = itinerary.trip_context.candidate_pool ?? []
  const activeCandidateIdx = activeDragId?.startsWith('candidate-')
    ? parseInt(activeDragId.replace('candidate-', ''), 10)
    : null
  const activeCandidate = activeCandidateIdx !== null ? candidates[activeCandidateIdx] : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col">
        {/* Day filter bar */}
        <div className="shrink-0 overflow-x-auto border-b border-neutral-800/60 bg-neutral-950 px-3 py-2.5">
          <div className="flex gap-1.5">
            <button
              onClick={() => onDaySelect(null)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                activeDay === null
                  ? 'bg-neutral-700 text-white shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              All
            </button>
            {Array.from({ length: itinerary.duration_days }, (_, i) => i + 1).map((d) => {
              const color = DAY_COLORS[(d - 1) % DAY_COLORS.length]!
              const isActive = activeDay === d
              return (
                <button
                  key={d}
                  onClick={() => onDaySelect(isActive ? null : d)}
                  style={isActive ? { backgroundColor: color + '22', border: `1px solid ${color}55`, color } : {}}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                    isActive ? '' : 'text-neutral-500 hover:text-neutral-300 border border-transparent'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                  Day {d}
                </button>
              )
            })}
          </div>
        </div>

        {/* Scrollable items */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-950/50">
          <div className="space-y-6 p-4">
            {daysToShow.map((dayNum) => {
              const items = itemsForDay(dayNum)
              const isToday = status === 'active' && dayNum === currentDay
              const dayColor = DAY_COLORS[(dayNum - 1) % DAY_COLORS.length]!

              return (
                <section key={dayNum}>
                  <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: dayColor }}>
                    Day {dayNum}
                    {isToday && (
                      <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-black normal-case tracking-normal">
                        Today
                      </span>
                    )}
                  </h2>

                  <DroppableDay dayNum={dayNum}>
                    {items.length === 0 ? (
                      <div className="flex min-h-[56px] items-center justify-center rounded-xl border border-dashed border-neutral-800 px-4">
                        <p className="text-xs text-neutral-700">Drop a suggestion here</p>
                      </div>
                    ) : (
                      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                        <ul className="space-y-2">
                          {items.map((item, idx) => (
                            <SortableItem
                              key={item.id}
                              item={item}
                              dayColor={dayColor}
                              stopIndex={idx + 1}
                              status={status}
                              isSelected={selectedItemId === item.id}
                              onRemove={handleRemove}
                              onMarkVisited={handleMarkVisited}
                              onSelect={onSelectItem}
                            />
                          ))}
                        </ul>
                      </SortableContext>
                    )}
                  </DroppableDay>
                </section>
              )
            })}

            {/* Candidate pool */}
            {candidates.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-px flex-1 bg-neutral-800" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-600">
                    ✦ Also consider
                  </h2>
                  <div className="h-px flex-1 bg-neutral-800" />
                </div>
                <p className="mb-3 text-xs text-neutral-700 text-center">Drag to a day or pick one below</p>
                <ul className="space-y-2">
                  {candidates.map((c, idx) => (
                    <DraggableCandidate
                      key={idx}
                      candidate={c}
                      idx={idx}
                      durationDays={itinerary.duration_days}
                      onAdd={(dayNum) => void addCandidateToDay(c, dayNum)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Drag overlay for candidates */}
      <DragOverlay>
        {activeCandidate ? (
          <div className="rounded-lg border border-neutral-500 bg-neutral-800 p-3 shadow-xl opacity-90">
            <p className="text-sm font-medium">{activeCandidate.place_name}</p>
            <p className="text-xs text-neutral-400">{activeCandidate.category}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ── Droppable day zone ────────────────────────────────────────────────────────

function DroppableDay({ dayNum, children }: { dayNum: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayNum}` })
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg transition-colors ${isOver ? 'ring-1 ring-neutral-500 bg-neutral-800/30' : ''}`}
    >
      {children}
    </div>
  )
}

// ── Draggable candidate card ──────────────────────────────────────────────────

type DraggableCandidateProps = {
  candidate: PlaceCandidate
  idx: number
  durationDays: number
  onAdd: (dayNum: number) => void
}

function DraggableCandidate({ candidate, idx, durationDays, onAdd }: DraggableCandidateProps) {
  const [selectedDay, setSelectedDay] = useState(1)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `candidate-${idx}` })

  return (
    <li
      ref={setNodeRef}
      className={`rounded-xl border border-dashed border-neutral-700/60 bg-neutral-900/30 p-3 transition-all ${isDragging ? 'opacity-30' : 'hover:border-neutral-600 hover:bg-neutral-900/60'}`}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab touch-none text-neutral-700 hover:text-neutral-500 active:cursor-grabbing"
          aria-label="Drag to a day"
        >
          <GripIcon />
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-sm">{getCategoryIcon(candidate.category)}</span>
            <span className="rounded-md bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-500 capitalize">{candidate.time_of_day}</span>
          </div>
          <p className="text-sm font-semibold text-neutral-300 leading-snug">{candidate.place_name}</p>
          {candidate.ai_note && (
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">{candidate.ai_note}</p>
          )}
        </div>

        {/* Day picker + add */}
        <div className="flex shrink-0 items-center gap-1.5">
          <select
            value={selectedDay}
            onChange={(e) => setSelectedDay(Number(e.target.value))}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-300 focus:outline-none"
          >
            {Array.from({ length: durationDays }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>Day {d}</option>
            ))}
          </select>
          <button
            onClick={() => onAdd(selectedDay)}
            className="rounded-lg bg-neutral-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-neutral-600 transition-colors"
          >
            + Add
          </button>
        </div>
      </div>
    </li>
  )
}

// ── Sortable itinerary item ───────────────────────────────────────────────────

type ItemProps = {
  item: ItineraryItem
  dayColor: string
  stopIndex: number
  status: 'planning' | 'active' | 'completed'
  isSelected: boolean
  onRemove: (id: string, googlePlaceId?: string) => Promise<void>
  onMarkVisited: (id: string) => Promise<void>
  onSelect: (id: string | null) => void
}

const CATEGORY_ICONS: Record<string, string> = {
  beach: '🏖️', food: '🍽️', restaurant: '🍽️', cafe: '☕', heritage: '🏛️',
  temple: '🛕', outdoor: '🌿', market: '🛍️', nightlife: '🌙', museum: '🖼️',
  nature: '🌲', hotel: '🏨', bar: '🍸', shopping: '🛍️', viewpoint: '🔭',
  default: '📍',
}

function getCategoryIcon(category: string): string {
  const key = category.toLowerCase()
  for (const [k, v] of Object.entries(CATEGORY_ICONS)) {
    if (key.includes(k)) return v
  }
  return CATEGORY_ICONS.default!
}

function SortableItem({ item, dayColor, stopIndex, status, isSelected, onRemove, onMarkVisited, onSelect }: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        borderLeftColor: item.visited_at ? '#404040' : dayColor,
      }}
      onClick={() => onSelect(isSelected ? null : item.id)}
      className={`group relative flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-800/60 border-l-2 bg-neutral-900 p-3 transition-all ${
        isDragging ? 'opacity-40 shadow-2xl scale-[0.98]' : ''
      } ${
        item.visited_at
          ? 'opacity-40'
          : isSelected
          ? 'border-neutral-600/60 bg-neutral-800/60 shadow-lg shadow-black/20'
          : 'hover:border-neutral-700 hover:bg-neutral-800/40'
      }`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 cursor-grab touch-none text-neutral-700 hover:text-neutral-500 active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripIcon />
      </button>

      {/* Stop number badge */}
      <div
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-white shadow-sm"
        style={{ background: item.visited_at ? '#404040' : dayColor }}
      >
        {item.visited_at ? '✓' : stopIndex}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-base">{getCategoryIcon(item.category)}</span>
          <span className="rounded-md bg-neutral-800 px-1.5 py-0.5 text-xs font-medium text-neutral-400 capitalize">{item.time_of_day}</span>
        </div>
        <p className={`text-sm font-semibold leading-snug ${item.visited_at ? 'line-through text-neutral-500' : 'text-white'}`}>
          {item.place_name}
        </p>
        {item.ai_note && !item.visited_at && (
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">{item.ai_note}</p>
        )}
        {item.reddit_source_url && !item.visited_at && (
          <a
            href={item.reddit_source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-orange-500 hover:text-orange-400"
          >
            <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="10"/><path d="M16.67 10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23l.65-3.08 2.13.45a1 1 0 1 0 1.07-1 1 1 0 0 0-.96.68l-2.38-.5a.27.27 0 0 0-.32.2l-.73 3.44a7.14 7.14 0 0 0-3.89 1.23 1.46 1.46 0 1 0-1.61 2.39 2.87 2.87 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 0 0 0-.44 1.46 1.46 0 0 0 .6-1.08zM7.27 11a1 1 0 1 1 1 1 1 1 0 0 1-1-1zm5.58 2.65a3.56 3.56 0 0 1-2.85.58 3.56 3.56 0 0 1-2.85-.58.27.27 0 0 1 .38-.38 3.08 3.08 0 0 0 2.47.47 3.08 3.08 0 0 0 2.47-.47.27.27 0 1 1 .38.38zm-.16-1.65a1 1 0 1 1 1-1 1 1 0 0 1-1 1z" fill="white"/></svg>
            Reddit source
          </a>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {status === 'active' && !item.visited_at && (
          <button
            onClick={(e) => { e.stopPropagation(); void onMarkVisited(item.id) }}
            className="rounded-lg p-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10"
            title="Mark visited"
          >
            ✓
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); void onRemove(item.id, item.google_place_id) }}
          className="rounded-lg p-1.5 text-xs text-neutral-600 hover:bg-red-500/10 hover:text-red-400"
          title="Remove"
        >
          ✕
        </button>
      </div>
    </li>
  )
}

function GripIcon() {
  return (
    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="8" cy="4" r="1.5" />
      <circle cx="4" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
    </svg>
  )
}
