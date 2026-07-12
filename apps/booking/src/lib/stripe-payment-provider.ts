type StripeAdapterOptions = {
  readonly secretKey: string
  readonly webhookSecret?: string
  readonly fetch?: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response>
  readonly now?: () => number
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const verifySignature = async (
  rawBody: string,
  signature: string | null,
  secret: string,
  now: number
) => {
  const values = Object.fromEntries(
    (signature ?? '').split(',').map((part) => part.split('=', 2) as [string, string])
  )
  const timestamp = Number(values.t)
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp * 1000) > 5 * 60_000)
    return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const expected = hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`)
    )
  )
  return expected.length === values.v1?.length && expected === values.v1
}

const normalizeEvent = (event: {
  readonly id: string
  readonly type: string
  readonly created: number
  readonly data: { readonly object: Record<string, unknown> }
}) => {
  const object = event.data.object
  const paymentId =
    typeof object.metadata === 'object' &&
    object.metadata !== null &&
    typeof (object.metadata as Record<string, unknown>).payment_id === 'string'
      ? String((object.metadata as Record<string, unknown>).payment_id)
      : null
  const reference = typeof object.id === 'string' ? object.id : event.id
  const currency =
    typeof object.currency === 'string' ? object.currency.toUpperCase() : null
  const amount =
    event.type === 'payment_intent.succeeded'
      ? object.amount_received
      : event.type === 'payment_intent.amount_capturable_updated'
        ? object.amount_capturable
        : event.type === 'charge.refunded'
          ? object.amount_refunded
          : event.type === 'payment_intent.canceled'
            ? object.amount
            : null
  const kind =
    event.type === 'payment_intent.succeeded'
      ? 'capture'
      : event.type === 'payment_intent.amount_capturable_updated'
        ? 'authorization'
        : event.type === 'charge.refunded'
          ? 'refund'
          : event.type === 'payment_intent.canceled'
            ? 'void'
            : null
  if (!paymentId || !currency || !kind || typeof amount !== 'number' || amount <= 0)
    throw new Error('unsupported_stripe_event')
  return {
    paymentId,
    providerEventId: event.id,
    facts: [
      {
        kind,
        amountMinor: amount,
        currency,
        providerReference: `${reference}:${kind}:${amount}`,
        occurredAt: new Date(event.created * 1000).toISOString()
      }
    ]
  }
}

export const makeStripePaymentProvider = (
  options: StripeAdapterOptions
): { readonly fetch: (request: Request) => Promise<Response> } => ({
  fetch: async (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/verify-callback') {
      if (!options.webhookSecret)
        return new Response('Webhook is not configured', { status: 503 })
      const rawBody = await request.text()
      if (
        !(await verifySignature(
          rawBody,
          request.headers.get('stripe-signature'),
          options.webhookSecret,
          (options.now ?? Date.now)()
        ))
      )
        return new Response('Invalid signature', { status: 400 })
      try {
        return Response.json(normalizeEvent(JSON.parse(rawBody)))
      } catch {
        return new Response('Unsupported event', { status: 422 })
      }
    }
    if (url.pathname !== '/settle') return new Response('Not found', { status: 404 })
    const input = (await request.json()) as Record<string, unknown>
    if (input.paymentMethodReference !== 'hosted_checkout')
      return new Response('Invalid payment method reference', { status: 422 })
    const method =
      input.method === 'cash_app_pay'
        ? 'cashapp'
        : input.method === 'klarna'
          ? 'klarna'
          : 'card'
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: String(input.returnUrl),
      cancel_url: `${String(input.returnUrl)}&payment_cancel=1`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': String(input.currency).toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(input.amountMinor),
      'line_items[0][price_data][product_data][name]': 'Booking',
      'payment_method_types[0]': method,
      'payment_intent_data[metadata][payment_id]': String(input.paymentId),
      'payment_intent_data[metadata][attempt_id]': String(input.attemptId)
    })
    const stripe = await (options.fetch ?? globalThis.fetch)(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': String(input.idempotencyKey)
        },
        body: form
      }
    )
    const result = (await stripe.json()) as Record<string, unknown>
    if (!stripe.ok)
      return Response.json(
        {
          outcome: 'failed',
          providerReference: String(result.id ?? input.attemptId),
          failureCode:
            typeof result.error === 'object' &&
            result.error !== null &&
            typeof (result.error as Record<string, unknown>).code === 'string'
              ? ((result.error as Record<string, unknown>).code as string)
              : 'provider_error',
          facts: []
        },
        { status: 200 }
      )
    const providerReference = String(result.id)
    if (typeof result.url !== 'string')
      return new Response('Stripe Checkout URL unavailable', { status: 502 })
    return Response.json({
      outcome: 'processing',
      providerReference,
      facts: [],
      nextActionUrl: result.url
    })
  }
})
