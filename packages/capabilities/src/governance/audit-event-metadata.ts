import { Option, Schema } from 'effect'

// A positive allowlist: new producer fields remain private until reviewed here.
// Never expose names, emails, IPs, URLs, scopes, credentials, or nested payloads.
export const AuditEventMetadata = Schema.Struct({
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

const decodePermittedMetadata = Schema.decodeUnknownOption(AuditEventMetadata)

export function decodeAuditEventMetadata(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- this decoder is the boundary for untrusted persisted JSON, including malformed non-object values
  metadata: unknown
): typeof AuditEventMetadata.Type {
  return Option.getOrElse(decodePermittedMetadata(metadata), () => ({}))
}
