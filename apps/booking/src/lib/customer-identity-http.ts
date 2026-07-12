import { customerIdentityProviderStates } from '@b2b-saas-starter/capabilities/customer-identity'

export type CustomerIdentityProviderConfig = Parameters<
  typeof customerIdentityProviderStates
>[0]

export const handleCustomerIdentityProviderRequest = (
  request: Request,
  config: CustomerIdentityProviderConfig
): Response => {
  const error = new URL(request.url).searchParams.get('error')
  return Response.json(
    {
      anonymousBooking: 'available',
      providers: customerIdentityProviderStates(config),
      ...(error === 'google' || error === 'apple' ? { providerError: error } : {})
    },
    { headers: { 'cache-control': 'private, no-store' } }
  )
}
