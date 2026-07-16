import { useEffect } from 'react'

export function MerchantPwaRegistration({ scope }: { readonly scope: string }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    void navigator.serviceWorker
      .register('/merchant-pwa-sw.js', { scope })
      .catch(() => undefined)
  }, [scope])

  return null
}
