import { type SocialProviderId } from '@/components/auth/auth-client-ports'

/**
 * The display labels for the social providers — sentence-case, no brand
 * shouting (DESIGN.md). Kept in a non-component module so the component file
 * exports only components (fast-refresh boundary), with the label map
 * inferring its keys from the literal and validated against the provider id
 * union by `satisfies`.
 */
export const SOCIAL_PROVIDER_LABELS = {
  github: 'GitHub',
  google: 'Google'
} satisfies Record<SocialProviderId, string>

/** Human label for a remembered login method id ('email', 'github', …). */
export function loginMethodLabel(method: string): string {
  if (method === 'email' || method === 'credential') {
    return 'email and password'
  }
  if (method === 'username') {
    return 'username'
  }
  if (method === 'github') {
    return SOCIAL_PROVIDER_LABELS.github
  }
  if (method === 'google') {
    return SOCIAL_PROVIDER_LABELS.google
  }
  return method
}
