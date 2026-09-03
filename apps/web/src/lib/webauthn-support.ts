/**
 * Whether the browser offers conditional UI (passkey autofill). The DOM types
 * declare `PublicKeyCredential` and its feature probe unconditionally, but
 * engines without WebAuthn — and jsdom — simply lack them at runtime, so this
 * reads the host through a deliberately narrower structural type instead of
 * the global's declared shape. Absent means "no conditional UI": the sign-in
 * page's button is the fallback.
 */
type ConditionalMediationHost = {
  readonly PublicKeyCredential?: {
    readonly isConditionalMediationAvailable?: () => Promise<boolean>
  }
}

export async function conditionalMediationAvailable(): Promise<boolean> {
  const host: ConditionalMediationHost = globalThis
  const probe = host.PublicKeyCredential?.isConditionalMediationAvailable
  if (probe === undefined) {
    return false
  }
  return probe()
}
