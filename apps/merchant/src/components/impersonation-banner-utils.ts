export const remainingImpersonationSeconds = (expiresAt: string, now: Date): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now.getTime()) / 1_000))
