import { type JsonObject } from '@b2b-saas-starter/db/schema'
import { Option, Schema } from 'effect'

// A positive allowlist: new producer fields remain private until reviewed here.
// Never expose names, emails, IPs, URLs, scopes, credentials, or nested payloads.
const PermittedMetadata = Schema.Struct({
  role: Schema.optionalKey(Schema.Literals(['owner', 'admin', 'member'])),
  protocol: Schema.optionalKey(Schema.Literals(['saml', 'oidc'])),
  attempts: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
  responseStatus: Schema.optionalKey(
    Schema.NullOr(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isBetween({ minimum: 100, maximum: 599 })
      )
    )
  ),
  sizeBytes: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  )
})

const decodePermittedMetadata = Schema.decodeUnknownOption(PermittedMetadata)

export function permittedAuditMetadata(metadata: JsonObject): JsonObject {
  return Option.getOrElse(decodePermittedMetadata(metadata), () => ({}))
}
