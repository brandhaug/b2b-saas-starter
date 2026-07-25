import { describe, expect, it } from 'vitest'
import {
  isMerchantOverlayPath,
  shouldRenderMerchantHome
} from './merchant-home-route.ts'

describe('shouldRenderMerchantHome', () => {
  it('renders home for appointments and overlay routes', () => {
    expect(shouldRenderMerchantHome('/appointments')).toBe(true)
    expect(shouldRenderMerchantHome('/customers')).toBe(true)
    expect(shouldRenderMerchantHome('/appointments/appointment-1')).toBe(true)
    expect(isMerchantOverlayPath('/customers')).toBe(true)
    expect(isMerchantOverlayPath('/appointments')).toBe(false)
  })

  it('does not render home for auth routes', () => {
    expect(shouldRenderMerchantHome('/sign-in')).toBe(false)
    expect(shouldRenderMerchantHome('/forgot-password')).toBe(false)
  })
})
