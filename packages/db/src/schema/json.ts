/**
 * What a `mode: 'json'` text column can hold: exactly what
 * `JSON.stringify`/`JSON.parse` round-trips. Audit metadata is heterogeneous
 * per event type (token name + scopes, webhook url + events, delivery
 * attempts), so "JSON" is the honest column contract — not `unknown`, which
 * would also admit functions, `undefined`, and class instances that D1 cannot
 * store.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

/** A JSON object payload — the shape of every `mode: 'json'` metadata column. */
export type JsonObject = Readonly<Record<string, JsonValue>>
