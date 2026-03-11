'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RightPanelId } from '@/lib/pulse/types'

const DESKTOP_SPLIT_STORAGE_KEY = 'axon.web.pulse.editor-split.desktop'
const MOBILE_SPLIT_STORAGE_KEY = 'axon.web.pulse.editor-split.mobile'
const SHOW_CHAT_STORAGE_KEY = 'axon.web.pulse.show-chat'
const RIGHT_PANEL_STORAGE_KEY = 'axon.web.pulse.right-panel'
export const MOBILE_PANE_STORAGE_KEY = 'axon.web.pulse.mobile-pane'

const VALID_PANELS: string[] = ['editor', 'terminal', 'logs', 'mcp', 'settings', 'cortex']
export type MobilePane = 'chat' | RightPanelId

export function useSplitPane() {
  const [desktopSplitPercent, setDesktopSplitPercent] = useState(50)
  const [mobileSplitPercent, setMobileSplitPercent] = useState(56)
  const [isDesktop, setIsDesktop] = useState(false)
  const [mobilePane, setMobilePane] = useState<MobilePane>('chat')
  const [showChat, setShowChat] = useState(true)
  const [rightPanel, setRightPanelState] = useState<RightPanelId | null>(null)

  const desktopSplitPercentRef = useRef(50)
  const mobileSplitPercentRef = useRef(56)
  const dragStartRef = useRef<{ pointerX: number; startPercent: number } | null>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const splitHandleRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<RightPanelId | null>(null)
  const showChatRef = useRef(true)

  const setDesktopSplitPercentTracked = useCallback((val: number) => {
    desktopSplitPercentRef.current = val
    setDesktopSplitPercent(val)
  }, [])

  const setMobileSplitPercentTracked = useCallback((val: number) => {
    mobileSplitPercentRef.current = val
    setMobileSplitPercent(val)
  }, [])

  const setShowChatTracked = useCallback((val: boolean) => {
    showChatRef.current = val
    setShowChat(val)
  }, [])

  const setRightPanel = useCallback((next: RightPanelId | null) => {
    rightPanelRef.current = next
    setRightPanelState(next)
    try {
      if (next) {
        window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, next)
      } else {
        window.localStorage.removeItem(RIGHT_PANEL_STORAGE_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const toggleRightPanel = useCallback((id: RightPanelId) => {
    const next = rightPanelRef.current === id ? null : id
    if (!next && !showChatRef.current) return
    rightPanelRef.current = next
    setRightPanelState(next)
    try {
      if (next) {
        window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, next)
      } else {
        window.localStorage.removeItem(RIGHT_PANEL_STORAGE_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [])

  // Storage restore effect
  useEffect(() => {
    try {
      const desktop = window.localStorage.getItem(DESKTOP_SPLIT_STORAGE_KEY)
      const mobile = window.localStorage.getItem(MOBILE_SPLIT_STORAGE_KEY)
      const parsedDesktop = Number(desktop)
      const parsedMobile = Number(mobile)
      if (Number.isFinite(parsedDesktop) && parsedDesktop >= 20 && parsedDesktop <= 80) {
        setDesktopSplitPercent(parsedDesktop)
      }
      if (Number.isFinite(parsedMobile) && parsedMobile >= 35 && parsedMobile <= 70) {
        setMobileSplitPercent(parsedMobile)
      }
      const pane = window.localStorage.getItem(MOBILE_PANE_STORAGE_KEY)
      if (pane === 'chat' || VALID_PANELS.includes(pane ?? '')) {
        setMobilePane((pane as MobilePane) ?? 'chat')
      }
      const panel = window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY)
      if (panel && VALID_PANELS.includes(panel)) {
        rightPanelRef.current = panel as RightPanelId
        setRightPanelState(panel as RightPanelId)
      }
    } catch {
      // Ignore storage errors.
    }
  }, [])

  // Media query effect
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  // Horizontal drag effect — click (< 4px) toggles editor; drag (>= 4px) resizes
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once — refs used for all state reads; setters are stable
  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const start = dragStartRef.current
      const container = splitContainerRef.current
      if (!start || !container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const deltaPx = event.clientX - start.pointerX
      const deltaPercent = (deltaPx / rect.width) * 100
      const next = Math.max(20, Math.min(80, start.startPercent + deltaPercent))
      setDesktopSplitPercentTracked(next)
    }

    function stopDrag(event: PointerEvent) {
      const start = dragStartRef.current
      if (!start) return
      const totalMovement = Math.abs(event.clientX - start.pointerX)
      dragStartRef.current = null
      splitHandleRef.current?.classList.remove('bg-[rgba(175,215,255,0.15)]')
      if (totalMovement < 4) {
        // Click — toggle editor panel
        const next = rightPanelRef.current === 'editor' ? null : 'editor'
        if (!next && !showChatRef.current) return
        rightPanelRef.current = next
        setRightPanelState(next)
        try {
          if (next) {
            window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, next)
          } else {
            window.localStorage.removeItem(RIGHT_PANEL_STORAGE_KEY)
          }
        } catch {
          /* ignore */
        }
        return
      }
      // Drag — persist the new split position
      try {
        window.localStorage.setItem(
          DESKTOP_SPLIT_STORAGE_KEY,
          String(desktopSplitPercentRef.current),
        )
      } catch {
        /* ignore */
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDrag)
    }
  }, [])

  const persistMobilePane = useCallback((pane: MobilePane) => {
    setMobilePane(pane)
    try {
      window.localStorage.setItem(MOBILE_PANE_STORAGE_KEY, pane)
    } catch {
      /* ignore */
    }
  }, [])

  const toggleChat = useCallback((next?: boolean) => {
    setShowChat((prev) => {
      const value = next ?? !prev
      if (!value && !rightPanelRef.current) return prev
      showChatRef.current = value
      try {
        window.localStorage.setItem(SHOW_CHAT_STORAGE_KEY, String(value))
      } catch {
        /* ignore */
      }
      return value
    })
  }, [])

  return {
    desktopSplitPercent,
    setDesktopSplitPercent: setDesktopSplitPercentTracked,
    mobileSplitPercent,
    setMobileSplitPercent: setMobileSplitPercentTracked,
    isDesktop,
    mobilePane,
    setMobilePane: persistMobilePane,
    showChat,
    setShowChat: setShowChatTracked,
    toggleChat,
    rightPanel,
    setRightPanel,
    toggleRightPanel,
    splitContainerRef,
    splitHandleRef,
    dragStartRef,
    desktopSplitPercentRef,
    mobileSplitPercentRef,
  }
}
