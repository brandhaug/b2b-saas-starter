import { StarterApi } from '@b2b-saas-starter/api'
import { OpenApi } from 'effect/unstable/httpapi'

export const openApiDocument = OpenApi.fromApi(StarterApi)
