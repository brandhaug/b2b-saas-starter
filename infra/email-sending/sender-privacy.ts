import { Effect, Schema } from 'effect'
import {
  getSubdomain,
  editSubdomain,
  type GetSubdomainResponse
} from '@distilled.cloud/cloudflare/email-sending'
import {
  Domain,
  Identifier,
  authenticatedEmailClient,
  checkEnvironment,
  emailOperations,
  failure,
  missing,
  validateSenderZone
} from './api.ts'

export const SenderPrivacyProps = Schema.Struct({
  accountId: Identifier,
  zoneId: Identifier,
  subdomainId: Identifier,
  domain: Domain
})
export type SenderPrivacyProps = Schema.Schema.Type<typeof SenderPrivacyProps>
export type SenderPrivacyAttributes = SenderPrivacyProps & {
  readonly previewEnabled: boolean
}
const decodeProps = Schema.decodeEffect(SenderPrivacyProps)
const decodeSender = Schema.decodeUnknownEffect(
  Schema.Struct({
    tag: Identifier,
    name: Domain,
    enabled: Schema.Boolean,
    previewEnabled: Schema.Boolean
  })
)

const senderApi = Effect.fn('EmailSending.senderApi')(function* (
  input: SenderPrivacyProps
) {
  const environment = yield* authenticatedEmailClient
  yield* checkEnvironment(environment, input.accountId)
  const props = yield* decodeProps(input).pipe(
    Effect.mapError(() => failure('scope', 'Invalid sender privacy scope'))
  )
  const run = yield* emailOperations
  yield* validateSenderZone(run, props)
  const validate = Effect.fn('EmailSending.validateSender')(function* (
    response: GetSubdomainResponse
  ) {
    const value = yield* decodeSender(response).pipe(
      Effect.mapError(() => failure('sender', 'Malformed Cloudflare sender'))
    )
    if (value.tag !== props.subdomainId || value.name !== props.domain) {
      return yield* failure(
        'scope',
        'Sender response does not match the configured scope'
      )
    }
    if (!value.enabled) {
      return yield* failure('sender', 'Sending domain is not enabled')
    }
    return { ...props, previewEnabled: value.previewEnabled }
  })
  function get() {
    return run(
      'GET',
      getSubdomain({ zoneId: props.zoneId, subdomainId: props.subdomainId })
    )
  }
  function disable() {
    return run(
      'PATCH',
      editSubdomain({
        zoneId: props.zoneId,
        subdomainId: props.subdomainId,
        previewEnabled: false
      })
    )
  }
  return { get, disable, validate }
})

/** Observe the setting so Alchemy detects remote drift. A missing sender is not recreated here. */
export const readSenderPrivacy = Effect.fn('EmailSending.readSenderPrivacy')(function* (
  props: SenderPrivacyProps
) {
  const { get, validate } = yield* senderApi(props)
  const response = yield* missing(get())
  if (!response) {
    return
  }
  return yield* validate(response)
})

/** https://developers.cloudflare.com/api/resources/email_sending/subresources/subdomains/methods/edit/
 * Read first; PATCH only preview_enabled; validate the returned identity and setting.
 */
export const ensureSenderPrivacy = Effect.fn('EmailSending.ensureSenderPrivacy')(
  function* (props: SenderPrivacyProps) {
    const { get, disable, validate } = yield* senderApi(props)
    const observed = yield* validate(yield* get())
    if (!observed.previewEnabled) {
      return observed
    }
    const final = yield* validate(yield* disable())
    if (final.previewEnabled) {
      return yield* failure(
        'privacy',
        'Cloudflare did not disable sender message previews'
      )
    }
    return final
  }
)
