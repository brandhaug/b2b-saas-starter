const currencyMetadataFormatters = new Map<string, Intl.NumberFormat>()
const decimalFormatters = new Map<number, Intl.NumberFormat>()

const currencyMinorUnitDigits = (currency: string) => {
  try {
    const existing = currencyMetadataFormatters.get(currency)
    const formatter =
      existing ??
      Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
      })
    if (!existing) currencyMetadataFormatters.set(currency, formatter)
    return formatter.resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

const currencyMinorUnitDivisor = (currency: string) =>
  10 ** currencyMinorUnitDigits(currency)

export function formatMerchantPrice(amountMinor: number, currency: string) {
  const fractionDigits = currencyMinorUnitDigits(currency)
  const amountMajor = amountMinor / currencyMinorUnitDivisor(currency)
  const existing = decimalFormatters.get(fractionDigits)
  const formatter =
    existing ??
    Intl.NumberFormat('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    })
  if (!existing) decimalFormatters.set(fractionDigits, formatter)

  return `${formatter.format(amountMajor)} ${currency}`
}

export function merchantPriceInputValue(amountMinor: number, currency: string) {
  return amountMinor / currencyMinorUnitDivisor(currency)
}

export function merchantPriceInputStep(currency: string) {
  return 1 / currencyMinorUnitDivisor(currency)
}

export function merchantPriceMinorFromMajor(amountMajor: number, currency: string) {
  return Math.round(amountMajor * currencyMinorUnitDivisor(currency))
}
