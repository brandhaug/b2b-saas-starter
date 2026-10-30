import { Schema } from 'effect'

export const getTurnstileSiteKeyResponse = Schema.Union([Schema.Null, Schema.String])
