export type MerchantViewer = {
  readonly name: string
  readonly email?: string | null
  readonly emailVerified?: boolean
  readonly image: string | null
}

export function merchantViewerFromUser(user: {
  readonly name?: string | null | undefined
  readonly email?: string | null | undefined
  readonly emailVerified?: boolean | undefined
  readonly image?: string | null | undefined
}): MerchantViewer | null {
  const name = user.name?.trim()
  if (!name) return null
  return {
    name,
    email: user.email?.trim() || null,
    emailVerified: user.emailVerified ?? false,
    image: user.image?.trim() || null
  }
}
