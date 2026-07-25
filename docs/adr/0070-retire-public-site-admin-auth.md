# Retire Public Site admin authentication

Once the Operations App is introduced, the unused global `createAuth` path and Better Auth admin remnants are removed from `apps/web`, along with stale environment expectations and dashboard documentation. The Public Site remains unauthenticated, and the supported auth factories become Merchant Auth, Customer Auth, and Operations Auth. This prevents the superseded embedded dashboard from competing with the Operations App as a platform-administration boundary.
