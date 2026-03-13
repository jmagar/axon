export function computeCanvasIntensity(
  cpuPercent: number,
  containerCount: number,
  isProcessing: boolean,
): number {
  if (isProcessing) return 1
  const maxCpu = containerCount * 100
  const norm = maxCpu > 0 ? Math.min(cpuPercent / maxCpu, 1.0) : 0
  return 0.02 + norm * 0.83
}
