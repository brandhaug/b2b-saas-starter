import { authClient } from '@/lib/auth-client'

// Rendering any workspace page mounts Better Auth's nanostores session atom
// (WorkspaceShell reads it through `authClient.useSession()`). When the last
// listener unsubscribes at test end, nanostores schedules the store's unmount
// cleanup 1s later — and if that timer fires after Vitest has torn the jsdom
// environment down, the cleanup's `window.removeEventListener` throws
// `ReferenceError: window is not defined` as an unhandled error that fails the
// whole run even though every test passed. Holding one listener for the file's
// lifetime keeps the store mounted, so the cleanup only ever runs inside a
// live environment (never) and the timer is never scheduled.
// `noUncheckedIndexedAccess` makes the atom lookup possibly undefined; a
// missing key means a Better Auth upgrade changed its client internals, so
// fail loudly here rather than silently re-exposing the flake.
const session = authClient.$store.atoms.session
if (!session) {
  throw new Error(
    'better-auth no longer exposes $store.atoms.session; update src/test/setup.ts'
  )
}
session.subscribe(() => {})
