export const isSupportedCurrency = (currency: string): boolean => {
  if (!/^[A-Z]{3}$/.test(currency)) return false
  try {
    return Intl.supportedValuesOf('currency').includes(currency)
  } catch {
    return false
  }
}
