import { randomHex } from './crypto.ts'

export const newCapabilityId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${randomHex(8)}`
