/**
 * Public surface of the package's single Web Crypto boundary
 * (`internal/crypto.ts`). Consumers outside this package — the background
 * worker's webhook signature — import from here rather than reaching into
 * `internal/`.
 */
export { bytesToHex } from './internal/crypto.ts'
