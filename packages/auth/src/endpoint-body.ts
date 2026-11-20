import { Schema } from 'effect'

// Better Auth types every endpoint body as `any`. Hooks read a body field only
// after one of these guards confirms its shape, so a malformed body reads as
// absent instead of flowing on untyped. Copy `ctx.body` into an `unknown`
// local first: a type guard cannot narrow `any`.

export const hasUserIdBody = Schema.is(Schema.Struct({ userId: Schema.String }))
export const hasCodeBody = Schema.is(Schema.Struct({ code: Schema.String }))
export const hasIdBody = Schema.is(Schema.Struct({ id: Schema.String }))
