import { Schema } from 'effect'

export const CustomerDetailsSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String)
})

export type NormalizedCustomerDetails = typeof CustomerDetailsSchema.Type

export const normalizeCustomerEmail = (value: string | null): string | null =>
  value === null || value.trim() === '' ? null : value.trim().toLowerCase()

export const normalizeCustomerPhone = (value: string | null): string | null => {
  const digits = value?.replace(/\D/g, '') ?? ''
  return digits ? `+${digits}` : null
}

export const normalizeCustomerDetails = (
  details: NormalizedCustomerDetails
): NormalizedCustomerDetails => ({
  name: details.name.trim(),
  email: normalizeCustomerEmail(details.email),
  phone: normalizeCustomerPhone(details.phone)
})
