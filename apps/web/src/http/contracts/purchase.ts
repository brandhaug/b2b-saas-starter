import { Schema } from 'effect'
import { LoadPurchaseSchema } from './purchase-records'

export const loadPurchaseServerFnResponse = LoadPurchaseSchema
export const continuePurchaseServerFnResponse = Schema.Struct({ url: Schema.String })
