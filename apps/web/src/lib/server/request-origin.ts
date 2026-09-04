import { currentRequest } from '../request-context'

/**
 * Absolute origin of the in-flight request: where an emailed invitation link
 * becomes clickable (`invitations.effects.ts`) and the SP entity id a SAML
 * connection registers under (`workspace-sso.effects.ts`). Empty when there is
 * no request — the URL stays relative, or the caller falls back to its own
 * stable identity, rather than pointing at a fabricated host.
 */
export function requestOrigin(): string {
  const request = currentRequest()
  if (!request) {
    return ''
  }
  return new URL(request.url).origin
}
