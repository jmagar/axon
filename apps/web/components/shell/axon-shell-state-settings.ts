'use client'

import { useState } from 'react'

export function useAxonShellSettings() {
  const [enableFs, setEnableFs] = useState(true)
  const [enableTerminal, setEnableTerminal] = useState(true)
  const [permissionTimeoutSecs, setPermissionTimeoutSecs] = useState<number | null>(null)
  const [adapterTimeoutSecs, setAdapterTimeoutSecs] = useState<number | null>(null)

  return {
    enableFs,
    setEnableFs,
    enableTerminal,
    setEnableTerminal,
    permissionTimeoutSecs,
    setPermissionTimeoutSecs,
    adapterTimeoutSecs,
    setAdapterTimeoutSecs,
  }
}
