# Exclude browser vendors from worker bundles

Keep the browser boot entry separate from the server-renderable Foldkit program. Browser APIs run through commands and scoped resources after hydration. Merely moving a dynamic import into a command does not guarantee that its vendor graph disappears from the Worker upload; check the emitted server chunks.

The former literal `createClientOnlyFn` rule depended on TanStack's compiler and no longer applies. Verify the deployment-shaped bundle, because a standalone build can externalize packages that deployment bundles. The browser module-graph guard separately rejects server implementation imports in client output.
