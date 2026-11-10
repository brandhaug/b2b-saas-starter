import { describe, expect, it } from 'vite-plus/test'
import { copyStatusTransition, type CopyStatus } from './copy-status'

const settled: ReadonlyArray<CopyStatus> = ['idle', 'copied', 'failed']

describe('copyStatusTransition', () => {
  it('moves any settled state to pending on a request', () => {
    for (const status of settled) {
      expect(copyStatusTransition(status, { type: 'requested' })).toBe('pending')
    }
  })

  it('keeps pending on a repeated request rather than restarting it', () => {
    expect(copyStatusTransition('pending', { type: 'requested' })).toBe('pending')
  })

  it('settles a pending copy as copied or failed', () => {
    expect(copyStatusTransition('pending', { type: 'succeeded' })).toBe('copied')
    expect(copyStatusTransition('pending', { type: 'failed' })).toBe('failed')
  })

  it('ignores a settle that arrives while no copy is pending', () => {
    for (const status of settled) {
      expect(copyStatusTransition(status, { type: 'succeeded' })).toBe(status)
      expect(copyStatusTransition(status, { type: 'failed' })).toBe(status)
    }
  })

  it('expires settled feedback back to idle and ignores expiry elsewhere', () => {
    expect(copyStatusTransition('copied', { type: 'expired' })).toBe('idle')
    expect(copyStatusTransition('failed', { type: 'expired' })).toBe('idle')
    expect(copyStatusTransition('pending', { type: 'expired' })).toBe('pending')
    expect(copyStatusTransition('idle', { type: 'expired' })).toBe('idle')
  })

  it('resets any state to idle when the displayed value is replaced', () => {
    for (const status of ['idle', 'pending', 'copied', 'failed'] as const) {
      expect(copyStatusTransition(status, { type: 'replaced' })).toBe('idle')
    }
  })
})
