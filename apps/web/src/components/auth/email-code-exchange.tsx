import {
  EmailCodeExchangeCardContent,
  EmailCodeExchangePageContent,
  type EmailCodeExchangeProps
} from './email-code-exchange-content'

/** A new address or purpose starts a fresh exchange and cancels old callbacks. */
export function EmailCodeExchangePage(props: EmailCodeExchangeProps) {
  return (
    <EmailCodeExchangePageContent
      key={`${props.purpose}:${props.email ?? ''}`}
      {...props}
    />
  )
}

export function EmailCodeExchangeCard(props: EmailCodeExchangeProps) {
  return (
    <EmailCodeExchangeCardContent
      key={`${props.purpose}:${props.email ?? ''}`}
      {...props}
    />
  )
}
