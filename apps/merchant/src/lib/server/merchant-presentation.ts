import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { merchantPresentationFromHeaders } from '@/lib/merchant-presentation.ts'

export const getMerchantPresentation = createServerFn({ method: 'GET' }).handler(() =>
  merchantPresentationFromHeaders(getRequest().headers)
)
