# Source-backed documentation examples

Architecture examples can opt into build-time validation by adding one metadata
field to a normal MDX code fence:

````md
```ts source="packages/capabilities/src/workspace-context.ts"
export class WorkspaceContext extends Context.Service<
  WorkspaceContext,
  WorkspaceContextInterface
>()('@b2b-saas-starter/capabilities/WorkspaceContext') {}
```
````

Copy a unique, contiguous set of complete lines from the current checkout. Keep
indentation and blank lines exactly as written in source. CRLF source files are
normalized to LF. The fence body is the selection, so there are no stale line
numbers or markers to maintain. Include enough surrounding code to disambiguate
repeated lines. Ellipses and edited explanatory versions belong in ordinary fences.

`source="repo/path"` must be the only metadata on a validated fence. Paths are
relative to the repository root, use forward slashes, and must resolve inside the
checkout. Missing files, malformed metadata, empty selections, multiple matches,
and changed excerpts stop the build with the MDX location, source path and selection
diagnostic. Update the example and its explanation together when source changes.

The build adds a source link with the current matched line range. Links use this
repository's `master` branch, so a branch preview can precede its linked source
until merged. These are current-checkout examples, not historical quotations.
External or historical quotations should use ordinary fences and explicit links
to immutable commits. The build never fetches source or consults Git.

## Verification and export

```sh
pnpm -C apps/web exec vp test run scripts/source-examples.test.ts
pnpm -C apps/web build
```

The first command exercises the real MDX build with valid and invalid references.
The second validates referenced fences in the public documentation collection as
part of the existing web build. Restart development Vite after editing referenced
source files, since they are not runtime imports and do not trigger MDX hot reload.

`apps/web/scripts/source-examples.ts` runs only in the build configuration, before
the existing syntax highlighter. Worker bundles receive compiled code text and
links. Source reading and highlighting stay outside the runtime graph.

The literal rendered snippet remains in the MDX fence and in the remark `code`
node's `value`. A future Markdown exporter can retain it without evaluating a React
component or reading source. It can run the same remark plugin to validate and add
the citation, or preserve the explicit code text when exporting raw MDX.

The [first business feature tutorial](../apps/web/content/docs/getting-started/first-business-feature.mdx)
teaches reader-added code from its companion patch, rather than installed checkout
code. Its ordinary fences and patch workflow remain the way to run that example.
See the [verification record](examples/source-examples/verification.md) for observed
checks and failure evidence.
