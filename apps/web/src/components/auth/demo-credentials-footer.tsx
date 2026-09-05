import { Link } from '@tanstack/react-router'
import {
  DEMO_CREDENTIALS,
  DEMO_MEMBER_CREDENTIALS,
  DEMO_WORKSPACE_SLUG
} from '@/lib/demo-workspace'

/**
 * The seeded-credential hints, rendered in both sign-in modes: the seed
 * workspace is the public reference app — the hero CTA lands behind sign-in,
 * so the credentials stay on the page in production too (they exist only
 * after seeding a local D1). The demo address works for a magic link too,
 * which lands in the dev console log (log-mode email) with no provider
 * configured. Extracted from the sign-in page so the card footer composes
 * instead of growing.
 */
export function DemoCredentialsFooter() {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Seeded the local database? Sign in with{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5">
          {DEMO_CREDENTIALS.email}
        </code>{' '}
        /{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5">
          {DEMO_CREDENTIALS.password}
        </code>
        .
      </p>
      <p className="text-xs text-muted-foreground">
        Or as a plain member, to see the role-gated view:{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5">
          {DEMO_MEMBER_CREDENTIALS.email}
        </code>{' '}
        /{' '}
        <code className="rounded-sm bg-muted px-1 py-0.5">
          {DEMO_MEMBER_CREDENTIALS.password}
        </code>
        .
      </p>
      <Link
        to="/workspaces/$workspaceSlug"
        params={{ workspaceSlug: DEMO_WORKSPACE_SLUG }}
        className="text-center text-sm text-primary underline underline-offset-4"
      >
        Open seeded workspace instead
      </Link>
    </>
  )
}
