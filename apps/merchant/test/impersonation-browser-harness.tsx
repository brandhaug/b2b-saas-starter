import { createRoot } from 'react-dom/client'
import { ImpersonationBanner } from '../src/components/impersonation-banner.tsx'

const response = await fetch('/api/impersonation/presentation')
const lifecycle = await response.json()
if (lifecycle?.state === 'terminated') {
  window.location.assign(lifecycle.returnTo)
} else if (lifecycle?.state === 'active') {
  createRoot(document.getElementById('root')!).render(
    <ImpersonationBanner
      presentation={lifecycle}
      onExpired={async () => {
        const expired = await fetch('/api/impersonation/presentation').then((value) =>
          value.json()
        )
        if (expired?.state === 'terminated') window.location.assign(expired.returnTo)
      }}
      onStop={async () => {
        const stopped = await fetch('/api/impersonation/stop', {
          method: 'POST'
        }).then((value) => value.json())
        if (stopped?.state === 'terminated') window.location.assign(stopped.returnTo)
      }}
    />
  )
} else {
  document.getElementById('root')!.textContent = 'Normal Merchant Session'
}
