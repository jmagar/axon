'use client'

import type React from 'react'
import { createContext, useContext } from 'react'
import { makeInitialRuntimeState, reduceRuntimeState } from './ws-messages/runtime'
import type {
  CancelResponseState,
  CrawlProgress,
  LogLine,
  PulseWorkspaceAgent,
  PulseWorkspaceModel,
  PulseWorkspacePermission,
  RecentRun,
  ScreenshotFile,
  WorkspaceContextState,
  WsMessagesActions,
  WsMessagesContextValue,
  WsMessagesExecutionState,
  WsMessagesWorkspaceState,
} from './ws-messages/types'

export { useWsMessagesProvider } from './ws-messages/provider'

const WsMessagesContext = createContext<WsMessagesContextValue | null>(null)
const WsMessagesExecutionContext = createContext<WsMessagesExecutionState | null>(null)
const WsMessagesWorkspaceContext = createContext<WsMessagesWorkspaceState | null>(null)
const WsMessagesActionsContext = createContext<WsMessagesActions | null>(null)

function useRequiredContext<T>(context: React.Context<T | null>, errorMessage: string): T {
  const value = useContext(context)
  if (!value) throw new Error(errorMessage)
  return value
}

export function useWsMessages() {
  return useRequiredContext(
    WsMessagesContext,
    'useWsMessages must be used within WsMessagesProvider',
  )
}

export function useWsExecutionState() {
  return useRequiredContext(
    WsMessagesExecutionContext,
    'useWsExecutionState must be used within WsMessagesProvider',
  )
}

export function useWsWorkspaceState() {
  return useRequiredContext(
    WsMessagesWorkspaceContext,
    'useWsWorkspaceState must be used within WsMessagesProvider',
  )
}

export function useWsMessageActions() {
  return useRequiredContext(
    WsMessagesActionsContext,
    'useWsMessageActions must be used within WsMessagesProvider',
  )
}

export {
  WsMessagesActionsContext,
  WsMessagesContext,
  WsMessagesExecutionContext,
  WsMessagesWorkspaceContext,
  makeInitialRuntimeState,
  reduceRuntimeState,
}
export type {
  CancelResponseState,
  CrawlProgress,
  LogLine,
  PulseWorkspaceAgent,
  PulseWorkspaceModel,
  PulseWorkspacePermission,
  RecentRun,
  ScreenshotFile,
  WorkspaceContextState,
}
