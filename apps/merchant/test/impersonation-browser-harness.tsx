import { createRoot } from 'react-dom/client'
import type {
  ImpersonationLifecyclePresentation,
  ImpersonationLifecycleTermination
} from '@b2b-saas-starter/capabilities/operations'
import { ImpersonationBanner } from '../src/components/impersonation-banner.tsx'

export type ImpersonationBrowserHarnessEntry = true

type HarnessLifecycle =
  | ImpersonationLifecyclePresentation
  | (ImpersonationLifecycleTermination & { readonly returnTo: string })
  | null

const readLifecycle = (response: Response) =>
  response.json() as Promise<HarnessLifecycle>

const response = await fetch('/api/impersonation/presentation')
const lifecycle = await readLifecycle(response)
if (lifecycle?.state === 'terminated') {
  window.location.assign(lifecycle.returnTo)
} else if (lifecycle?.state === 'active') {
  createRoot(document.getElementById('root')!).render(
    <ImpersonationBanner
      presentation={lifecycle}
      onExpired={async () => {
        const expired = await fetch('/api/impersonation/presentation').then(
          readLifecycle
        )
        if (expired?.state === 'terminated') window.location.assign(expired.returnTo)
      }}
      onStop={async () => {
        const stopped = await fetch('/api/impersonation/stop', {
          method: 'POST'
        }).then(readLifecycle)
        if (stopped?.state === 'terminated') window.location.assign(stopped.returnTo)
      }}
    />
  )
} else {
  document.getElementById('root')!.textContent = 'Normal Merchant Session'
}
