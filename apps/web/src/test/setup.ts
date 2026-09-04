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
authClient.$store.atoms.session.subscribe(() => {})
