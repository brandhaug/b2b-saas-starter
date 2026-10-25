# Source example verification

## Failure cases planned before implementation

The build integration must reject a missing source file, changed excerpt, empty
excerpt, ambiguous repeated excerpt, malformed source metadata, absolute path,
parent traversal, and a symlink escaping the checkout. Diagnostics must identify
the MDX file, referenced source and failing selection. Ordinary fences must still
compile. Successful compilation must retain the literal snippet and add a source
link with the matched current line range. Moving an unchanged excerpt within its
file must update the link rather than break the example.

Exercise these through the real MDX Rollup plugin and a local fixture build,
without network access or application providers. Also compile the selected real
architecture article, and verify the built documentation in the browser during
repository validation. Record commands and observed results below after execution.

## Observed build evidence

On 2026-10-25, with Node 24.22.1 and repository-pinned Vite+ 1.1.0:

- `pnpm -C apps/web exec vp test run scripts/source-examples.test.ts` passed.
  This runs real MDX builds for matching and moved excerpts, ordinary fences,
  and the failure cases above. The emitted module retains the literal code and
  source citation, with no `node:fs` import.
- A separate Vite/MDX build using the invalid fence below exited 1. Its diagnostic
  included `source-example-invalid.mdx:1: source packages/capabilities/src/errors.ts:
  no exact match for 1 lines starting "export class WorkspaceNotFound extends
  AnObsoleteError {}"; copy a unique contiguous excerpt from the current source`.
- After `pnpm run db:migrate:local` and `pnpm run db:seed`,
  `CI=1 E2E_PORT=3194 pnpm -C apps/web exec playwright test
  e2e/source-examples.spec.ts --project=chromium --no-deps` passed one browser
  test against the compiled preview. Both architecture snippets and line-linked
  citations rendered. The first attempt stopped at preview readiness because
  this fresh checkout did not yet have local D1.
- Emitted server JavaScript in `apps/web/dist-e2e/server` had no matches for
  `remarkSourceExamples|no exact match|createHighlighter|loadWasm|shiki/dist|source-examples\.ts`.
  The existing `data-rehype-pretty-code-figure` HTML attributes and Shiki CSS
  variables remain as expected. This marker scan supplements the build-only
  import boundary; it is not a general bundle security proof.

Reproduce the invalid build without editing application source. Create
`.context/source-example-invalid.mdx` at the repository root with:

````md
```ts source="packages/capabilities/src/errors.ts"
export class WorkspaceNotFound extends AnObsoleteError {}
```
````

Then run from `apps/web`. Exit 1 is the expected result:

```sh
node --input-type=module -e '
import { build } from "vite";
import mdx from "@mdx-js/rollup";
import { remarkSourceExamples } from "./scripts/source-examples.ts";
await build({
  configFile: false,
  plugins: [mdx({ remarkPlugins: [[remarkSourceExamples, { root: "../.." }]] })],
  build: {
    write: false,
    lib: { entry: "../../.context/source-example-invalid.mdx", formats: ["es"] },
    rolldownOptions: { external: ["react/jsx-runtime"] }
  }
});'
```
