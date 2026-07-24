import { describe, expect, it } from 'vitest'
import {
  formatMerchantPrice,
  merchantPriceInputStep,
  merchantPriceInputValue,
  merchantPriceMinorFromMajor
} from './merchant-money.ts'

describe('Merchant price presentation', () => {
  it('presents RON minor units as a normal merchant-facing price', () => {
    expect(formatMerchantPrice(9000, 'RON')).toBe('90.00 RON')
    expect(merchantPriceInputValue(9000, 'RON')).toBe(90)
    expect(merchantPriceInputStep('RON')).toBe(0.01)
  })

  it('converts a merchant-entered major-unit price back to minor units', () => {
    expect(merchantPriceMinorFromMajor(45.5, 'RON')).toBe(4550)
  })

  it('uses the currency minor-unit precision instead of assuming two decimals', () => {
    expect(formatMerchantPrice(9000, 'JPY')).toBe('9,000 JPY')
    expect(merchantPriceInputValue(9000, 'JPY')).toBe(9000)
    expect(merchantPriceMinorFromMajor(9000, 'JPY')).toBe(9000)
  })

  it('keeps the price input usable while a currency code is being edited', () => {
    expect(merchantPriceInputStep('R')).toBe(0.01)
  })
})
