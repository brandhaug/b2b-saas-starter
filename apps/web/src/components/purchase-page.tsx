import { Link, useNavigate } from '@tanstack/react-router'
import { type PurchasePayload } from '@/lib/server/purchase'
import { type PurchaseIntent } from '@/lib/purchase-intent'
import { PublicLayout } from './public-layout'
import { CreateWorkspaceForm } from './create-workspace-form'
import { EmailVerificationBanner } from './email-verification-banner'
import { Panel } from './page/panel'
import { Button } from './ui/button'
import { m } from '@b2b-saas-starter/i18n/messages'

export function PurchasePage({
  purchase,
  intent,
  email,
  turnstileSiteKey
}: {
  readonly purchase: PurchasePayload | null
  readonly intent: PurchaseIntent | null
  readonly email: string
  readonly turnstileSiteKey: string | null
}) {
  const navigate = useNavigate()
  return (
    <PublicLayout>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-12 outline-none"
      >
        <h1 className="text-3xl font-semibold">
          {intent
            ? m.purchase_plan({ name: purchase?.plan?.name ?? 'Team' })
            : m.purchase_title()}
        </h1>
        {purchase && intent ? (
          <>
            <p className="text-muted-foreground">{m.purchase_choose_workspace()}</p>
            {purchase.plan === null ? (
              <p className="text-sm text-muted-foreground">
                {m.billing_pricing_unavailable()}
              </p>
            ) : null}
            {purchase.stripeConfigured ? null : (
              <p className="text-sm text-muted-foreground">
                {m.billing_not_configured()}
              </p>
            )}
            {purchase.emailVerificationRequired ? (
              <EmailVerificationBanner
                email={email}
                turnstileSiteKey={turnstileSiteKey}
                callbackPath={`/purchase?plan=${intent.planId}`}
              />
            ) : (
              <>
                <Panel title={m.page_workspaces()}>
                  <div className="grid gap-3">
                    {purchase.workspaces.map((workspace) => (
                      <Button
                        key={workspace.slug}
                        variant="outline"
                        nativeButton={false}
                        render={
                          <Link
                            to="/workspaces/$workspaceSlug/billing"
                            params={{ workspaceSlug: workspace.slug }}
                            search={{ purchase: intent.planId }}
                          />
                        }
                      >
                        {workspace.name}
                      </Button>
                    ))}
                    {purchase.workspaces.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {m.purchase_no_workspace()}
                      </p>
                    ) : null}
                  </div>
                </Panel>
                <Panel title={m.workspaces_new_action()}>
                  <CreateWorkspaceForm
                    onCreated={(workspace) =>
                      void navigate({
                        to: '/workspaces/$workspaceSlug/billing',
                        params: { workspaceSlug: workspace.slug },
                        search: { purchase: intent.planId }
                      })
                    }
                  />
                </Panel>
              </>
            )}
          </>
        ) : (
          <p>{m.purchase_invalid()}</p>
        )}
        <Link to="/pricing" className="text-sm underline underline-offset-4">
          {m.purchase_cancel()}
        </Link>
      </main>
    </PublicLayout>
  )
}
