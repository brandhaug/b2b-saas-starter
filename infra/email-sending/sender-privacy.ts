import { Effect, Schema } from 'effect'
import { HttpClientRequest } from 'effect/http'
import {
  Domain,
  Identifier,
  apiUrl,
  authenticatedEmailClient,
  checkEnvironment,
  emailApi,
  envelope,
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
const Sender = Schema.Struct({
  tag: Identifier,
  name: Domain,
  enabled: Schema.Boolean,
  preview_enabled: Schema.Boolean
})
const SenderResponse = envelope(Sender)
const DisablePreview = Schema.Struct({ preview_enabled: Schema.Literal(false) })

const senderApi = Effect.fn('EmailSending.senderApi')(function* (
  input: SenderPrivacyProps
) {
  const environment = yield* authenticatedEmailClient
  yield* checkEnvironment(environment, input.accountId)
  const props = yield* decodeProps(input).pipe(
    Effect.mapError(() => failure('scope', 'Invalid sender privacy scope'))
  )
  const api = emailApi(environment.client)
  yield* validateSenderZone(api, props)
  const url = `${apiUrl}/zones/${props.zoneId}/email/sending/subdomains/${props.subdomainId}`
  const validate = Effect.fn('EmailSending.validateSender')(function* (
    value: Schema.Schema.Type<typeof Sender>
  ) {
    if (value.tag !== props.subdomainId || value.name !== props.domain) {
      return yield* failure(
        'scope',
        'Sender response does not match the configured scope'
      )
    }
    if (!value.enabled) {
      return yield* failure('sender', 'Sending domain is not enabled')
    }
    return { ...props, previewEnabled: value.preview_enabled }
  })
  return { api, url, validate }
})

/** Observe the setting so Alchemy detects remote drift. A missing sender is not recreated here. */
export const readSenderPrivacy = Effect.fn('EmailSending.readSenderPrivacy')(function* (
  props: SenderPrivacyProps
) {
  const { api, url, validate } = yield* senderApi(props)
  const response = yield* missing(
    api.decode(SenderResponse, HttpClientRequest.get(url))
  )
  if (!response) {
    return
  }
  return yield* validate(response.result)
})

/** https://developers.cloudflare.com/api/resources/email_sending/subresources/subdomains/methods/edit/
 * Read first; PATCH only preview_enabled; validate the returned identity and setting.
 */
export const ensureSenderPrivacy = Effect.fn('EmailSending.ensureSenderPrivacy')(
  function* (props: SenderPrivacyProps) {
    const { api, url, validate } = yield* senderApi(props)
    const response = yield* api.decode(SenderResponse, HttpClientRequest.get(url))
    const observed = yield* validate(response.result)
    if (!observed.previewEnabled) {
      return observed
    }
    const request = yield* HttpClientRequest.schemaBodyJson(DisablePreview)(
      HttpClientRequest.patch(url),
      { preview_enabled: false }
    ).pipe(Effect.mapError(() => failure('privacy', 'Invalid sender privacy request')))
    const updated = yield* api.decode(SenderResponse, request)
    const final = yield* validate(updated.result)
    if (final.previewEnabled) {
      return yield* failure(
        'privacy',
        'Cloudflare did not disable sender message previews'
      )
    }
    return final
  }
)
