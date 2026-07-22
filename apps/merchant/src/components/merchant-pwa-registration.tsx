import { useEffect } from 'react'

type MerchantServiceWorkerRegistrar = {
  readonly register: (
    scriptURL: string | URL,
    options?: RegistrationOptions
  ) => Promise<ServiceWorkerRegistration>
}

export async function registerMerchantServiceWorker(
  serviceWorker: MerchantServiceWorkerRegistrar,
  enabled: boolean
): Promise<ServiceWorkerRegistration | null> {
  if (!enabled) return null

  try {
    return await serviceWorker.register('/merchant-sw.js', { scope: '/' })
  } catch {
    console.warn('Merchant service worker registration failed.')
    return null
  }
}

export function MerchantPwaRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    void registerMerchantServiceWorker(
      navigator.serviceWorker,
      import.meta.env.PROD && window.isSecureContext
    )
  }, [])

  return null
}
