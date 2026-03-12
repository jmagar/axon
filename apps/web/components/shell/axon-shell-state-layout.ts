import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_NEURAL_CANVAS_PROFILE,
  type NeuralCanvasProfile,
} from '@/lib/pulse/neural-canvas-presets'
import { getStorageItem, setStorageItem } from '@/lib/storage'
import {
  AXON_MOBILE_PANE_STORAGE_KEY,
  type AxonMobilePane,
  CANVAS_PROFILE_STORAGE_KEY,
  CANVAS_PROFILES,
  CHAT_FLEX_STORAGE_KEY,
  CHAT_OPEN_STORAGE_KEY,
  PANE_WIDTH_MIN,
  RAIL_MODE_STORAGE_KEY,
  RIGHT_PANE_STORAGE_KEY,
  type RightPane,
  readStoredBool,
  readStoredFloat,
  readStoredRailMode,
  SIDEBAR_OPEN_STORAGE_KEY,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STORAGE_KEY,
  VALID_RIGHT_PANES,
} from './axon-shell-state-helpers'
import type { RailMode } from './axon-ui-config'

type LayoutControls = {
  chatFlex: number
  chatOpen: boolean
  editorOpen: boolean
  handleCanvasProfileChange: (profile: NeuralCanvasProfile) => void
  isDragging: boolean
  layoutRestored: boolean
  mobilePane: AxonMobilePane
  nudgeChatFlex: (delta: number) => void
  nudgeSidebar: (delta: number) => void
  persistChatOpen: (open: boolean) => void
  persistRightPane: (pane: RightPane) => void
  persistSidebarOpen: (open: boolean) => void
  railMode: RailMode
  resetChatFlex: () => void
  resetSidebarWidth: () => void
  rightPane: RightPane
  sectionRef: React.RefObject<HTMLElement | null>
  setMobilePaneTracked: (nextPane: AxonMobilePane) => void
  setRailModeTracked: (mode: RailMode) => void
  sidebarOpen: boolean
  sidebarWidth: number
  startChatResize: (startX: number) => void
  startSidebarResize: (startX: number) => void
  transitionClass: string
  canvasProfile: NeuralCanvasProfile
}

export function useAxonShellLayoutControls(): LayoutControls {
  const [railMode, setRailMode] = useState<RailMode>('sessions')
  const [mobilePane, setMobilePane] = useState<AxonMobilePane>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [rightPane, setRightPane] = useState<RightPane>('editor')
  const editorOpen = rightPane !== null
  const [canvasProfile, setCanvasProfile] = useState<NeuralCanvasProfile>(
    DEFAULT_NEURAL_CANVAS_PROFILE,
  )
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT)
  const [chatFlex, setChatFlex] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [layoutRestored, setLayoutRestored] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(AXON_MOBILE_PANE_STORAGE_KEY)
      if (
        saved === 'sidebar' ||
        saved === 'chat' ||
        saved === 'editor' ||
        saved === 'terminal' ||
        saved === 'logs' ||
        saved === 'mcp' ||
        saved === 'settings' ||
        saved === 'cortex'
      ) {
        setMobilePane(saved as AxonMobilePane)
      }
    } catch {
      /* ignore */
    }
    setSidebarWidth(
      readStoredFloat(
        SIDEBAR_WIDTH_STORAGE_KEY,
        SIDEBAR_WIDTH_DEFAULT,
        SIDEBAR_WIDTH_MIN,
        SIDEBAR_WIDTH_MAX,
      ),
    )
    setChatFlex(readStoredFloat(CHAT_FLEX_STORAGE_KEY, 1))
    setSidebarOpen(readStoredBool(SIDEBAR_OPEN_STORAGE_KEY, true))
    setChatOpen(readStoredBool(CHAT_OPEN_STORAGE_KEY, true))
    const storedPane = getStorageItem(RIGHT_PANE_STORAGE_KEY)
    if (storedPane === '') {
      setRightPane(null)
    } else if (storedPane && VALID_RIGHT_PANES.has(storedPane)) {
      setRightPane(storedPane as RightPane)
    } else {
      setRightPane('editor')
    }
    setRailMode(readStoredRailMode(RAIL_MODE_STORAGE_KEY, 'sessions'))
    const rawProfile = getStorageItem(CANVAS_PROFILE_STORAGE_KEY)
    if (rawProfile && CANVAS_PROFILES.includes(rawProfile as NeuralCanvasProfile)) {
      setCanvasProfile(rawProfile as NeuralCanvasProfile)
    }
    setLayoutRestored(true)
  }, [])

  const setRailModeTracked = useCallback((mode: RailMode) => {
    setRailMode(mode)
    try {
      window.localStorage.setItem(RAIL_MODE_STORAGE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [])

  const setMobilePaneTracked = useCallback((nextPane: AxonMobilePane) => {
    setMobilePane(nextPane)
    try {
      window.localStorage.setItem(AXON_MOBILE_PANE_STORAGE_KEY, nextPane)
    } catch {
      /* ignore */
    }
  }, [])

  const handleCanvasProfileChange = useCallback((profile: NeuralCanvasProfile) => {
    setCanvasProfile(profile)
    setStorageItem(CANVAS_PROFILE_STORAGE_KEY, profile)
  }, [])

  const persistSidebarOpen = useCallback(
    (open: boolean) => {
      if (!open && !chatOpen && rightPane === null) return
      setSidebarOpen(open)
      try {
        window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open))
      } catch {
        /* ignore */
      }
    },
    [chatOpen, rightPane],
  )

  const persistChatOpen = useCallback(
    (open: boolean) => {
      if (!open && !sidebarOpen && rightPane === null) return
      setChatOpen(open)
      try {
        window.localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(open))
      } catch {
        /* ignore */
      }
    },
    [sidebarOpen, rightPane],
  )

  const persistRightPane = useCallback(
    (pane: RightPane) => {
      if (pane === null && !sidebarOpen && !chatOpen) return
      setRightPane(pane)
      try {
        window.localStorage.setItem(RIGHT_PANE_STORAGE_KEY, pane ?? '')
      } catch {
        /* ignore */
      }
    },
    [chatOpen, sidebarOpen],
  )

  const startSidebarResize = useCallback(
    (startX: number) => {
      const initWidth = sidebarWidth
      let lastWidth = initWidth
      setIsDragging(true)
      const onMove = (e: MouseEvent) => {
        lastWidth = Math.max(
          SIDEBAR_WIDTH_MIN,
          Math.min(SIDEBAR_WIDTH_MAX, initWidth + e.clientX - startX),
        )
        setSidebarWidth(lastWidth)
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
        setIsDragging(false)
        try {
          window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(lastWidth))
        } catch {
          /* ignore */
        }
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [sidebarWidth],
  )

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    try {
      window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const startChatResize = useCallback(
    (startX: number) => {
      const section = sectionRef.current
      if (!section) return
      const sidebarPx = sidebarOpen ? sidebarWidth : 40
      const available = section.offsetWidth - sidebarPx
      const totalFlex = chatFlex + 1
      const initChatPx = (available * chatFlex) / totalFlex
      let lastFlex = chatFlex
      setIsDragging(true)
      const onMove = (e: MouseEvent) => {
        const newChatPx = Math.max(
          PANE_WIDTH_MIN,
          Math.min(available - PANE_WIDTH_MIN, initChatPx + e.clientX - startX),
        )
        lastFlex = newChatPx / (available - newChatPx)
        setChatFlex(lastFlex)
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
        setIsDragging(false)
        try {
          window.localStorage.setItem(CHAT_FLEX_STORAGE_KEY, String(lastFlex))
        } catch {
          /* ignore */
        }
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [chatFlex, sidebarOpen, sidebarWidth],
  )

  const resetChatFlex = useCallback(() => {
    setChatFlex(1)
    try {
      window.localStorage.removeItem(CHAT_FLEX_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const nudgeSidebar = useCallback((delta: number) => {
    setSidebarWidth((w) => {
      const next = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, w + delta))
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const nudgeChatFlex = useCallback(
    (delta: number) => {
      const section = sectionRef.current
      if (!section) return
      const sidebarPx = sidebarOpen ? sidebarWidth : 40
      const available = section.offsetWidth - sidebarPx
      setChatFlex((f) => {
        const currentChatPx = (available * f) / (f + 1)
        const newChatPx = Math.max(
          PANE_WIDTH_MIN,
          Math.min(available - PANE_WIDTH_MIN, currentChatPx + delta),
        )
        const next = newChatPx / (available - newChatPx)
        try {
          window.localStorage.setItem(CHAT_FLEX_STORAGE_KEY, String(next))
        } catch {
          /* ignore */
        }
        return next
      })
    },
    [sidebarOpen, sidebarWidth],
  )

  const transitionClass = useMemo(
    () => (isDragging || !layoutRestored ? '' : 'transition-[width,flex] duration-300 ease-out'),
    [isDragging, layoutRestored],
  )

  return {
    canvasProfile,
    chatFlex,
    chatOpen,
    editorOpen,
    handleCanvasProfileChange,
    isDragging,
    layoutRestored,
    mobilePane,
    nudgeChatFlex,
    nudgeSidebar,
    persistChatOpen,
    persistRightPane,
    persistSidebarOpen,
    railMode,
    resetChatFlex,
    resetSidebarWidth,
    rightPane,
    sectionRef,
    setMobilePaneTracked,
    setRailModeTracked,
    sidebarOpen,
    sidebarWidth,
    startChatResize,
    startSidebarResize,
    transitionClass,
  }
}
