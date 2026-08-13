// Every `/* expect: ... */` marker below must produce exactly one report on
// that line. The test compares markers against oxlint's JSON output.

export const direct = () => fetch('https://example.com') /* expect: no-direct-fetch */

export const viaGlobalThis = () =>
  globalThis.fetch('https://example.com') /* expect: no-direct-fetch */

export const viaWindow = () =>
  window.fetch('https://example.com') /* expect: no-direct-fetch */
