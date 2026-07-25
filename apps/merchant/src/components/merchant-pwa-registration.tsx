import { useEffect } from 'react'
import { registerMerchantServiceWorker } from './merchant-service-worker.ts'

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
