import { Option, Schema } from 'effect'

/** The datasets the dev-only `/demo?data=` toggle offers; `demo` is the default preview. */
export const demoDataKinds = ['demo', 'worst', 'empty', 'one', 'huge'] as const
export type DemoDataKind = (typeof demoDataKinds)[number]

const decodeDemoDataSearch = Schema.decodeUnknownOption(
  Schema.Struct({ data: Schema.Literals(demoDataKinds) })
)

/** The dataset a `/demo` URL selects; anything unrecognized shows the default preview. */
export function demoDataKindFromSearch(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the raw router search is the untrusted input this boundary decodes
  search: unknown
): DemoDataKind {
  return Option.match(decodeDemoDataSearch(search), {
    onNone: () => 'demo',
    onSome: ({ data }) => data
  })
}
