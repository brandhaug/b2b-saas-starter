/** Give each browser test its own edge rate-limit bucket. */
export function isolatedClientIp(testId: string): string {
  let hash = 0
  for (const character of testId) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  }
  return `10.${(hash % 254) + 1}.${(Math.floor(hash / 254) % 254) + 1}.${
    (Math.floor(hash / 64_516) % 254) + 1
  }`
}
