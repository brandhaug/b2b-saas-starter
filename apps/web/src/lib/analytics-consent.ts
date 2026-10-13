/* oxlint-disable effect/noTryCatch, anti-slop/no-runtime-typeof -- Browser storage is an untrusted, fallible boundary; Effect must stay out of the client bundle. */

const storageKey = 'starter.analytics-consent'
const noticeVersion = '2026-10-13'
const preferenceLifetimeMs = 180 * 24 * 60 * 60 * 1000
const refusalCookie = 'starter.analytics-refused'
const beaconSelector =
  'script[src="https://static.cloudflareinsights.com/beacon.min.js"]'

type ConsentChoice = 'accepted' | 'declined'
type ConsentRecord = { readonly choice: ConsentChoice; readonly decidedAt: number }

function readRecord(): ConsentRecord | undefined {
  try {
    const raw = localStorage.getItem(storageKey)
    const value: unknown = raw ? JSON.parse(raw) : undefined
    if (
      value !== null &&
      typeof value === 'object' &&
      'version' in value &&
      'choice' in value &&
      'decidedAt' in value &&
      value.version === noticeVersion &&
      (value.choice === 'accepted' || value.choice === 'declined') &&
      typeof value.decidedAt === 'number' &&
      Number.isFinite(value.decidedAt) &&
      value.decidedAt <= Date.now() &&
      Date.now() - value.decidedAt < preferenceLifetimeMs
    ) {
      return { choice: value.choice, decidedAt: value.decidedAt }
    }
  } catch {
    // Missing or blocked storage never implies permission.
  }
  return undefined
}

/** Stable scalar snapshot; no browser access during SSR or hydration. */
export function analyticsConsent(): ConsentChoice | 'pending' {
  if (document.querySelector('meta[data-analytics-stopped]') || hasRefusalCookie()) {
    return 'declined'
  }
  return readRecord()?.choice ?? 'pending'
}

function hasRefusalCookie(): boolean {
  return document.cookie
    .split(';')
    .some((cookie) => cookie.trim() === `${refusalCookie}=1`)
}

/** A necessary refusal cookie is the recovery path for read-only local storage. */
function rememberRefusal(): boolean {
  // oxlint-disable-next-line unicorn/no-document-cookie -- Synchronous refusal persistence must complete before the outgoing document reloads.
  document.cookie = `${refusalCookie}=1; Path=/; Max-Age=${preferenceLifetimeMs / 1000}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  return hasRefusalCookie()
}

export function serverAnalyticsConsent(): 'loading' {
  return 'loading'
}

/** The beacon has no teardown API. Block its exit reports before destroying this document. */
function blockOutgoingDocument(): void {
  if (document.querySelector('meta[data-analytics-stopped]')) {
    return
  }
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  // Manual embedding reports to cloudflareinsights.com. Keep same-origin app
  // requests usable if both preference stores refuse a withdrawal write.
  policy.content = "connect-src 'self'"
  policy.dataset.analyticsStopped = 'true'
  // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare's global Element.append overload conflicts with lib.dom; appendChild retains the browser type.
  document.head.appendChild(policy)
}

/** Removing permission still works when storage is full or refuses replacement. */
function forgetAnalyticsConsent(): boolean {
  try {
    localStorage.removeItem(storageKey)
    return localStorage.getItem(storageKey) === null
  } catch {
    return false
  }
}

export function saveAnalyticsConsent(choice: ConsentChoice, announce = true): boolean {
  if (choice === 'declined' && document.querySelector(beaconSelector)) {
    blockOutgoingDocument()
  }
  let saved = false
  try {
    const record = JSON.stringify({
      version: noticeVersion,
      choice,
      decidedAt: Date.now()
    })
    localStorage.setItem(storageKey, record)
    saved = localStorage.getItem(storageKey) === record
  } catch {
    // Try deletion below before leaving the current document disabled.
  }
  if (!saved && choice === 'declined') {
    saved = forgetAnalyticsConsent()
    if (!saved) {
      saved = rememberRefusal()
    }
  }
  if (choice === 'declined' && announce && 'BroadcastChannel' in window) {
    const channel = new BroadcastChannel(storageKey)
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel is origin-scoped and has no targetOrigin argument.
    channel.postMessage('declined')
    channel.close()
  }
  if (saved && choice === 'accepted' && hasRefusalCookie()) {
    // oxlint-disable-next-line unicorn/no-document-cookie -- Clear the synchronous fallback before reloading the accepted document.
    document.cookie = `${refusalCookie}=; Path=/; Max-Age=0; SameSite=Lax`
    saved = !hasRefusalCookie()
  }
  if (!saved) {
    if (document.querySelector(beaconSelector)) {
      blockOutgoingDocument()
    }
    return false
  }
  // A new document also avoids reporting buffered pre-consent performance data.
  blockOutgoingDocument()
  window.location.reload()
  return true
}

export function subscribeAnalyticsConsent(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const channel =
    'BroadcastChannel' in window ? new BroadcastChannel(storageKey) : undefined
  if (channel) {
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.data === 'declined') {
        saveAnalyticsConsent('declined', false)
        onChange()
      }
    })
  }
  const initialChoice = analyticsConsent()
  function check() {
    clearTimeout(timer)
    if (document.querySelector('meta[data-analytics-stopped]')) {
      onChange()
      return
    }
    const choice = analyticsConsent()
    if (
      (choice !== 'accepted' && document.querySelector(beaconSelector)) ||
      (choice === 'accepted' && initialChoice !== 'accepted')
    ) {
      blockOutgoingDocument()
      window.location.reload()
      return
    }
    onChange()
    const record = readRecord()
    if (record) {
      // Browsers clamp delays above a signed 32-bit integer; recheck long-lived choices.
      timer = setTimeout(
        check,
        Math.min(
          2_147_483_647,
          Math.max(1, record.decidedAt + preferenceLifetimeMs - Date.now())
        )
      )
    }
  }
  // Capture checks run before the vendor's hidden-page reporting listeners.
  window.addEventListener('storage', check)
  window.addEventListener('focus', check)
  window.addEventListener('pageshow', check, true)
  document.addEventListener('visibilitychange', check, true)
  check()
  return () => {
    clearTimeout(timer)
    channel?.close()
    window.removeEventListener('storage', check)
    window.removeEventListener('focus', check)
    window.removeEventListener('pageshow', check, true)
    document.removeEventListener('visibilitychange', check, true)
  }
}
