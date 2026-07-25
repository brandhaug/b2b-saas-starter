import { useEffect, useState } from 'react'

const SAMPLE_WINDOW_MS = 500

export function calculateFramesPerSecond(frameCount: number, elapsedMs: number) {
  if (elapsedMs <= 0) return 0
  return Math.round((frameCount * 1_000) / elapsedMs)
}

export function DevFpsPill() {
  const [fps, setFps] = useState<number | null>(null)

  useEffect(() => {
    let animationFrame = 0
    let frameCount = 0
    let sampleStartedAt: number | undefined

    const measure = (now: number) => {
      if (sampleStartedAt === undefined) {
        sampleStartedAt = now
        animationFrame = requestAnimationFrame(measure)
        return
      }

      frameCount += 1

      const elapsed = now - sampleStartedAt
      if (elapsed >= SAMPLE_WINDOW_MS) {
        setFps(calculateFramesPerSecond(frameCount, elapsed))
        frameCount = 0
        sampleStartedAt = now
      }

      animationFrame = requestAnimationFrame(measure)
    }

    animationFrame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(animationFrame)
  }, [])

  return (
    <output
      aria-label="Current rendering frame rate"
      className="pointer-events-none fixed top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-[2147483647] inline-flex h-7 items-center gap-1.5 rounded-full border border-white/15 bg-neutral-950/85 px-2.5 font-mono text-[11px] leading-none font-semibold text-white tabular-nums shadow-lg backdrop-blur"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
      {fps === null ? '—' : fps} FPS
    </output>
  )
}
