# Exclude browser vendors from worker bundles

Browser-only dynamic imports use a literal `createClientOnlyFn` in the component module. TanStack Start's transform removes the loader from the server graph; placing an import inside an effect alone still lets the bundler emit its vendor chunks into the worker upload. A shared wrapper would hide the compiler-recognized call.

This applies to the browser error-reporting loader. Verify the deployment-shaped bundle, because a standalone build can externalize packages that deployment bundles.
