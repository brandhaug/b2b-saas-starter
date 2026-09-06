import { AsyncLocalStorage } from 'node:async_hooks'

type Presentation = {
  readonly timeZone: string
  readonly authenticated: boolean
  readonly needsTimeZone: boolean
}

const presentation = new AsyncLocalStorage<Presentation>()

export function withPresentation<A>(value: Presentation, run: () => A): A {
  return presentation.run(value, run)
}

export function requestPresentation(): Presentation {
  return (
    presentation.getStore() ?? {
      timeZone: 'UTC',
      authenticated: false,
      needsTimeZone: false
    }
  )
}
