import { describe, expect, it } from 'vitest'
import { safeRedirect } from './utils'

describe('safeRedirect', () => {
  it('allows same-origin absolute paths', () => {
    expect(safeRedirect('/workspaces/starter-lab')).toBe('/workspaces/starter-lab')
    expect(safeRedirect('/admin?tab=users')).toBe('/admin?tab=users')
  })

  it('falls back for undefined or empty values', () => {
    expect(safeRedirect(undefined)).toBe('/workspaces')
    expect(safeRedirect('')).toBe('/workspaces')
  })

  it('rejects protocol-relative URLs (open redirect)', () => {
    expect(safeRedirect('//evil.example.com')).toBe('/workspaces')
    expect(safeRedirect('//evil.example.com/workspaces')).toBe('/workspaces')
  })

  it('rejects absolute URLs to other origins', () => {
    expect(safeRedirect('https://evil.example.com')).toBe('/workspaces')
    expect(safeRedirect('javascript:alert(1)')).toBe('/workspaces')
  })
})
