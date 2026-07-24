const currencyMinorUnitDigits = (currency: string) => {
  try {
    return (
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

const currencyMinorUnitDivisor = (currency: string) =>
  10 ** currencyMinorUnitDigits(currency)

export function formatMerchantPrice(amountMinor: number, currency: string) {
  const fractionDigits = currencyMinorUnitDigits(currency)
  const amountMajor = amountMinor / currencyMinorUnitDivisor(currency)

  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(amountMajor)} ${currency}`
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
