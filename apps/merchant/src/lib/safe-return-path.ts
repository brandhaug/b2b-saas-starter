/** Reject external, protocol-relative, and relative return locations. */
export const safeMerchantReturnPath = (raw: string | undefined): string =>
  raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/'
