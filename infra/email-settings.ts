import * as Schema from 'effect/Schema'

const Sender = Schema.Struct({
  zoneId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
  from: Schema.String.check(
    Schema.isPattern(
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/
    )
  )
})
export type EmailSettings = typeof Sender.Type
const decodeSender = Schema.decodeUnknownSync(Sender)

export function emailSettings(value: EmailSettings | undefined) {
  const sender = decodeSender(value)
  return { ...sender, domain: sender.from.slice(sender.from.indexOf('@') + 1) }
}
