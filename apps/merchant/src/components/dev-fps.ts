export function calculateFramesPerSecond(frameCount: number, elapsedMs: number) {
  if (elapsedMs <= 0) return 0
  return Math.round((frameCount * 1_000) / elapsedMs)
}
