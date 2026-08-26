/**
 * The write-side view of a readonly type: same shape, mutable properties.
 * Built by assignment so absent optional fields stay absent rather than
 * carrying an explicit `undefined` under `exactOptionalPropertyTypes` —
 * populate only the keys you have.
 */
export type Writable<T> = { -readonly [K in keyof T]: T[K] }
