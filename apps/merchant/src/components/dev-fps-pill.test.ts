import { describe, expect, it } from 'vitest'
import { calculateFramesPerSecond } from './dev-fps-pill.tsx'

describe('development FPS pill', () => {
  it('turns a sampled frame count into a rounded FPS value', () => {
    expect(calculateFramesPerSecond(30, 500)).toBe(60)
    expect(calculateFramesPerSecond(29, 500)).toBe(58)
  })

  it('guards against an empty sample window', () => {
    expect(calculateFramesPerSecond(30, 0)).toBe(0)
  })
})
