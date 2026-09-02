import { describe, expect, it } from 'vite-plus/test'
import { pickOptionalStrings, redirectSearch, safeRedirect } from './utils'

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

describe('pickOptionalStrings', () => {
  it('picks only the named keys when they are strings', () => {
    expect(
      pickOptionalStrings({ token: 'abc', error: undefined }, ['token', 'error'])
    ).toStrictEqual({ token: 'abc' })
  })

  it('ignores non-string values and non-object input', () => {
    expect(pickOptionalStrings({ redirect: 42 }, ['redirect'])).toStrictEqual({})
    expect(pickOptionalStrings(null, ['redirect'])).toStrictEqual({})
    expect(pickOptionalStrings('redirect=/x', ['redirect'])).toStrictEqual({})
  })
})

describe('redirectSearch', () => {
  it('passes through a string redirect', () => {
    expect(redirectSearch({ redirect: '/workspaces' })).toStrictEqual({
      redirect: '/workspaces'
    })
  })

  it('drops non-string and absent redirects', () => {
    expect(redirectSearch({ redirect: ['//evil.example.com'] })).toStrictEqual({})
    expect(redirectSearch({})).toStrictEqual({})
    expect(redirectSearch(undefined)).toStrictEqual({})
  })
})
