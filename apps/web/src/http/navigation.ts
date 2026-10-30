import { UiError } from '../lib/ui-error'

export function notFound(): UiError {
  return new UiError('not_found', {}, 'not_found')
}

export function redirect(options: {
  readonly to?: string
  readonly href?: string
  readonly search?: Readonly<Record<string, string>>
}): Response {
  const query = new URLSearchParams(options.search)
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${options.href ?? options.to ?? '/'}${query.size ? `?${query}` : ''}`
    }
  })
}
