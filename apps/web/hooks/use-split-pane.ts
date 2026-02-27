'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopPaneOrder, DesktopViewMode } from '@/lib/pulse/workspace-persistence'

const DESKTOP_SPLIT_STORAGE_KEY = 'axon.web.pulse.editor-split.desktop'
const MOBILE_SPLIT_STORAGE_KEY = 'axon.web.pulse.editor-split.mobile'
export const MOBILE_PANE_STORAGE_KEY = 'axon.web.pulse.mobile-pane'

export function useSplitPane() {
  const [desktopSplitPercent, setDesktopSplitPercent] = useState(62)
  const [mobileSplitPercent, setMobileSplitPercent] = useState(56)
  const [isDesktop, setIsDesktop] = useState(false)
  const [mobilePane, setMobilePane] = useState<'chat' | 'editor'>('chat')
  const [desktopViewMode, setDesktopViewMode] = useState<DesktopViewMode>('both')
  const [desktopPaneOrder, setDesktopPaneOrder] = useState<DesktopPaneOrder>('editor-first')

  const desktopSplitPercentRef = useRef(62)
  const mobileSplitPercentRef = useRef(56)
  const dragStartRef = useRef<{ pointerX: number; startPercent: number } | null>(null)
  const verticalDragStartRef = useRef<{ pointerY: number; startPercent: number } | null>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const splitHandleRef = useRef<HTMLDivElement>(null)

  // Keep refs in sync with state
  useEffect(() => {
    desktopSplitPercentRef.current = desktopSplitPercent
  }, [desktopSplitPercent])

  useEffect(() => {
    mobileSplitPercentRef.current = mobileSplitPercent
  }, [mobileSplitPercent])

  // Storage restore effect — load split percentages from localStorage on mount
  useEffect(() => {
    try {
      const desktop = window.localStorage.getItem(DESKTOP_SPLIT_STORAGE_KEY)
      const mobile = window.localStorage.getItem(MOBILE_SPLIT_STORAGE_KEY)
      const parsedDesktop = Number(desktop)
      const parsedMobile = Number(mobile)
      if (Number.isFinite(parsedDesktop) && parsedDesktop >= 42 && parsedDesktop <= 74) {
        setDesktopSplitPercent(parsedDesktop)
      }
      if (Number.isFinite(parsedMobile) && parsedMobile >= 35 && parsedMobile <= 70) {
        setMobileSplitPercent(parsedMobile)
      }
      const pane = window.localStorage.getItem(MOBILE_PANE_STORAGE_KEY)
      if (pane === 'chat' || pane === 'editor') setMobilePane(pane)
    } catch {
      // Ignore storage errors.
    }
  }, [])

  // Media query effect — listen for (min-width: 1024px)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  // Horizontal drag effect — pointermove + pointerup on window
  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const start = dragStartRef.current
      const container = splitContainerRef.current
      if (!start || !container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const deltaPx = event.clientX - start.pointerX
      const deltaPercent = (deltaPx / rect.width) * 100
      const next = Math.max(42, Math.min(74, start.startPercent + deltaPercent))
      setDesktopSplitPercent(next)
    }

    function stopDrag() {
      if (!dragStartRef.current) return
      dragStartRef.current = null
      splitHandleRef.current?.classList.remove('bg-[rgba(175,215,255,0.3)]')
      try {
        window.localStorage.setItem(
          DESKTOP_SPLIT_STORAGE_KEY,
          String(desktopSplitPercentRef.current),
        )
      } catch {
        // Ignore storage errors.
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDrag)
    }
  }, [])

  // Vertical drag effect — pointermove + pointerup on window
  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const start = verticalDragStartRef.current
      const container = splitContainerRef.current
      if (!start || !container) return
      const rect = container.getBoundingClientRect()
      if (rect.height <= 0) return
      const deltaPx = event.clientY - start.pointerY
      const deltaPercent = (deltaPx / rect.height) * 100
      const next = Math.max(35, Math.min(70, start.startPercent + deltaPercent))
      setMobileSplitPercent(next)
    }

    function stopVerticalDrag() {
      if (!verticalDragStartRef.current) return
      verticalDragStartRef.current = null
      try {
        window.localStorage.setItem(MOBILE_SPLIT_STORAGE_KEY, String(mobileSplitPercentRef.current))
      } catch {
        // Ignore storage errors.
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopVerticalDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopVerticalDrag)
    }
  }, [])

  const persistMobilePane = useCallback((pane: 'chat' | 'editor') => {
    setMobilePane(pane)
    try {
      window.localStorage.setItem(MOBILE_PANE_STORAGE_KEY, pane)
    } catch {
      // Ignore storage errors.
    }
  }, [])

  return {
    desktopSplitPercent,
    setDesktopSplitPercent,
    mobileSplitPercent,
    setMobileSplitPercent,
    isDesktop,
    mobilePane,
    setMobilePane: persistMobilePane,
    desktopViewMode,
    setDesktopViewMode,
    desktopPaneOrder,
    setDesktopPaneOrder,
    splitContainerRef,
    splitHandleRef,
    dragStartRef,
    verticalDragStartRef,
    desktopSplitPercentRef,
    mobileSplitPercentRef,
  }
}
