'use client'

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Itinerary } from '@wayfarer/core/types'

const DAY_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#06b6d4']

type Props = {
  itinerary: Itinerary
  currentDay: number
  selectedItemId: string | null
  activeDay: number | null
  onSelectItem: (id: string | null) => void
}

export function MapView({ itinerary, currentDay, selectedItemId, activeDay, onSelectItem }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const openPopupsRef = useRef<mapboxgl.Popup[]>([])
  const layerIds = useRef<string[]>([])
  const sourceIds = useRef<string[]>([])
  const onSelectItemRef = useRef(onSelectItem)
  useEffect(() => { onSelectItemRef.current = onSelectItem }, [onSelectItem])

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ?? ''
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [78, 20],
      zoom: 4,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Re-render pins + routes when itinerary / selection / day filter changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    openPopupsRef.current.forEach((p) => p.remove())
    openPopupsRef.current = []

    function render() {
      if (!map) return

      for (const id of layerIds.current) { if (map.getLayer(id)) map.removeLayer(id) }
      for (const id of sourceIds.current) { if (map.getSource(id)) map.removeSource(id) }
      layerIds.current = []
      sourceIds.current = []

      const items = itinerary.items.filter((i) => i.lat && i.lng)
      if (!items.length) return

      // Group by day
      const byDay: Record<number, typeof items> = {}
      for (const item of items) {
        if (!byDay[item.day_number]) byDay[item.day_number] = []
        byDay[item.day_number]!.push(item)
      }

      // Only show markers for the active day (or all days if no filter)
      const visibleItems = activeDay !== null ? items.filter((i) => i.day_number === activeDay) : items

      // Stop numbers within each day: 1, 2, 3...
      const stopNumbers = new Map<string, number>()
      for (const dayItems of Object.values(byDay)) {
        const sorted = [...dayItems].sort((a, b) => a.position - b.position)
        sorted.forEach((item, idx) => stopNumbers.set(item.id, idx + 1))
      }

      // Markers
      for (const item of visibleItems) {
        const dayIdx = (item.day_number - 1) % DAY_COLORS.length
        const color = DAY_COLORS[dayIdx]!
        const isToday = item.day_number === currentDay
        const isSelected = item.id === selectedItemId
        const isDimmed = activeDay !== null && item.day_number !== activeDay
        const stopNum = stopNumbers.get(item.id) ?? 1

        const el = document.createElement('div')
        const size = isToday || isSelected ? '34px' : '28px'
        const shadow = isSelected
          ? color + '88, 0 3px 14px rgba(0,0,0,0.85)'
          : '0 2px 10px rgba(0,0,0,0.6)'
        const boxShadow = isSelected ? '0 0 0 3px ' + shadow : shadow
        const border = isSelected
          ? '3px solid white'
          : isToday
          ? '3px solid rgba(255,255,255,0.9)'
          : '2px solid rgba(255,255,255,0.55)'

        el.style.width = size
        el.style.height = size
        el.style.background = color
        el.style.border = border
        el.style.borderRadius = '50%'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.fontSize = '11px'
        el.style.fontWeight = '700'
        el.style.color = 'white'
        el.style.cursor = 'pointer'
        el.style.boxShadow = boxShadow
        el.style.opacity = isDimmed ? '0.2' : '1'
        el.style.fontFamily = 'sans-serif'
        el.style.transition = 'opacity 0.25s'
        el.textContent = String(stopNum)

        el.addEventListener('click', () => {
          onSelectItemRef.current(item.id === selectedItemId ? null : item.id)
        })

        const popupContent = '<div style="padding:4px 2px;font-family:sans-serif;">'
          + '<p style="font-weight:700;margin:0 0 3px;font-size:13px;color:#111;">' + item.place_name + '</p>'
          + '<p style="margin:0;font-size:11px;color:#888;text-transform:capitalize;">' + item.time_of_day + ' · Day ' + item.day_number + ' · #' + stopNum + '</p>'
          + (item.ai_note ? '<p style="margin:5px 0 0;font-size:11px;color:#444;line-height:1.4;">' + item.ai_note + '</p>' : '')
          + '</div>'

        const popup = new mapboxgl.Popup({ offset: 16, closeButton: true, maxWidth: '240px' }).setHTML(popupContent)
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([item.lng, item.lat]).addTo(map!)
        if (isSelected) {
          popup.setLngLat([item.lng, item.lat]).addTo(map!)
          openPopupsRef.current.push(popup)
        }
        markersRef.current.push(marker)
      }

      // Hotel marker
      if (itinerary.hotel_lat && itinerary.hotel_lng) {
        const el = document.createElement('div')
        el.style.width = '36px'
        el.style.height = '36px'
        el.style.background = 'white'
        el.style.border = '2.5px solid #6366f1'
        el.style.borderRadius = '8px'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.fontSize = '18px'
        el.style.cursor = 'pointer'
        el.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)'
        el.style.opacity = activeDay !== null ? '0.35' : '1'
        el.textContent = '\u{1F3E8}'
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([itinerary.hotel_lng, itinerary.hotel_lat]).addTo(map!)
        markersRef.current.push(marker)
      }

      // Route lines per day
      for (const [dayNum, dayItems] of Object.entries(byDay)) {
        if (dayItems.length < 2) continue
        const dayIdx = (Number(dayNum) - 1) % DAY_COLORS.length
        const color = DAY_COLORS[dayIdx]!
        const isActiveRoute = activeDay === null || activeDay === Number(dayNum)
        const sorted = [...dayItems].sort((a, b) => a.position - b.position)
        const coordinates = sorted.map((i) => [i.lng, i.lat] as [number, number])
        const srcId = 'route-src-' + dayNum
        const lyrId = 'route-lyr-' + dayNum
        map!.addSource(srcId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } })
        map!.addLayer({ id: lyrId, type: 'line', source: srcId, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': color, 'line-width': isActiveRoute ? 2 : 1, 'line-dasharray': [3, 2], 'line-opacity': isActiveRoute ? 0.65 : 0.1 } })
        sourceIds.current.push(srcId)
        layerIds.current.push(lyrId)
      }

      // Fit bounds / fly to
      if (selectedItemId) {
        const sel = items.find((i) => i.id === selectedItemId)
        if (sel) map!.flyTo({ center: [sel.lng, sel.lat], zoom: Math.max(mapRef.current?.getZoom() ?? 14, 14), duration: 800 })
      } else {
        const fitItems = activeDay !== null ? items.filter((i) => i.day_number === activeDay) : items
        const pool = fitItems.length > 0 ? fitItems : items
        if (pool.length === 1) {
          map!.flyTo({ center: [pool[0]!.lng, pool[0]!.lat], zoom: 14, duration: 1200 })
        } else if (pool.length > 1) {
          const bounds = new mapboxgl.LngLatBounds()
          pool.forEach((i) => bounds.extend([i.lng, i.lat]))
          if (!activeDay && itinerary.hotel_lat && itinerary.hotel_lng) bounds.extend([itinerary.hotel_lng, itinerary.hotel_lat])
          map!.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 1200 })
        }
      }
    }

    if (map.isStyleLoaded()) { render() } else { map.once('load', render) }
  }, [itinerary, currentDay, selectedItemId, activeDay])

  return <div ref={containerRef} className="h-full w-full" />
}
