type Presentation = {
  readonly timeZone: string
  readonly authenticated: boolean
  readonly needsTimeZone: boolean
}

function defaultPresentation(): Presentation {
  return { timeZone: 'UTC', authenticated: false, needsTimeZone: false }
}
let serverPresentation = defaultPresentation

/** Bind the request-scoped reader once in the server entry, never a request's value. */
export function bindPresentationReader(reader: () => Presentation): void {
  serverPresentation = reader
}

/** Browser imports stay independent of the server's AsyncLocalStorage implementation. */
export function presentationSettings(): Presentation {
  if (typeof document === 'undefined') {
    return serverPresentation()
  }
  return {
    timeZone: document.documentElement.dataset.timeZone ?? 'UTC',
    authenticated: document.documentElement.dataset.authenticated === 'true',
    needsTimeZone: document.documentElement.dataset.needsTimeZone === 'true'
  }
}
