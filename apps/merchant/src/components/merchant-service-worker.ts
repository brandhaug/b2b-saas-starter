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
    return null
  }
}
