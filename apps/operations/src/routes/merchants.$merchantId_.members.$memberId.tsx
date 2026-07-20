import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  DefinitionList,
  Fact,
  Field,
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { requireOperationsSession } from '@/lib/require-operations-session.ts'
import { getMerchantMember } from '@/lib/server/operations.ts'
import { startImpersonation } from '@/lib/server/operations.ts'
import { formValue } from '@/lib/form-value.ts'

export const Route = createFileRoute('/merchants/$merchantId_/members/$memberId')({
  beforeLoad: requireOperationsSession,
  loader: ({ params }) => getMerchantMember({ data: params }),
  component: MerchantMemberDetailPage
})

function MerchantMemberDetailPage() {
  const result = Route.useLoaderData()
  const { merchantId, memberId } = Route.useParams()
  const [handoff, setHandoff] = useState<{
    readonly handoffTicket: string
    readonly expiresAt: string
    readonly merchantAppOrigin: string
  } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  if (result.state !== 'ready')
    return (
      <OperationsShell eyebrow="Member detail" title="Member unavailable">
        <ScreenState result={result} />
      </OperationsShell>
    )
  const member = result.data
  return (
    <OperationsShell eyebrow="Merchant Member detail" title={member.name}>
      <Link
        className="text-sm text-primary"
        params={{ merchantId }}
        to="/merchants/$merchantId"
      >
        ← Back to Merchant
      </Link>
      <div className="mt-6">
        <DefinitionList>
          <Fact term="Member ID">
            <code>{member.id}</code>
          </Fact>
          <Fact term="Email">{member.email}</Fact>
          <Fact term="Email verification">
            {member.emailVerified ? 'Verified' : 'Unverified'}
          </Fact>
          <Fact term="Enabled state">{member.enabled ? 'Enabled' : 'Disabled'}</Fact>
          <Fact term="Membership">
            {member.membership.role} of {member.membership.merchantName}
          </Fact>
          <Fact term="Active sessions">{member.activeSessionCount}</Fact>
          <Fact term="Last sign-in">{member.lastSignInAt ?? 'Never'}</Fact>
          <Fact term="Impersonation">
            {member.impersonationEligibility.eligible
              ? 'Eligible'
              : `Ineligible: ${member.impersonationEligibility.reason ?? 'unknown'}`}
          </Fact>
        </DefinitionList>
      </div>
      {member.impersonationEligibility.eligible ? (
        <section className="mt-8 max-w-2xl border border-border bg-accent p-6 text-accent-foreground">
          <h2 className="text-xl font-semibold">Create accountable Pending Handoff</h2>
          <p className="mt-2 text-sm leading-6">
            A fresh authentication code and an internal reason are required. The
            single-use handoff expires after 60 seconds.
          </p>
          {!handoff ? (
            <form
              className="mt-6 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                setMessage(null)
                void startImpersonation({
                  data: {
                    merchantId,
                    memberId,
                    reason: formValue(form, 'reason'),
                    supportReference: formValue(form, 'supportReference'),
                    code: formValue(form, 'code')
                  }
                }).then((result) => {
                  if (result.state === 'ready') setHandoff(result.data)
                  else if (result.state === 'redirect')
                    window.location.assign(result.location)
                  else setMessage(result.message)
                })
              }}
            >
              <Field label="Internal Impersonation Reason" name="reason" required>
                <textarea
                  className="min-h-28 rounded-md border border-input bg-card p-4 text-foreground"
                  maxLength={1000}
                  name="reason"
                  required
                />
              </Field>
              <Field
                label="External support reference (optional)"
                name="supportReference"
              />
              <Field label="Current authentication code" name="code" required />
              <SubmitButton>Create Pending Handoff</SubmitButton>
            </form>
          ) : (
            <div className="mt-6">
              <p className="text-sm">
                Pending Handoff created. It expires at{' '}
                <time dateTime={handoff.expiresAt}>{handoff.expiresAt}</time>.
              </p>
              <form
                action={`${handoff.merchantAppOrigin}/impersonation/handoffs/exchange`}
                className="mt-4"
                method="post"
              >
                <input name="ticket" type="hidden" value={handoff.handoffTicket} />
                <SubmitButton>Continue to Merchant App</SubmitButton>
              </form>
            </div>
          )}
          {message ? (
            <p
              className="mt-4 rounded-md border border-border bg-muted p-4 text-sm text-foreground"
              role="alert"
            >
              {message}
            </p>
          ) : null}
        </section>
      ) : null}
    </OperationsShell>
  )
}
