export const redirect = (
  location: string,
  cookies: readonly string[] = []
): Response => {
  const headers = new Headers({ location })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 303, headers })
}
