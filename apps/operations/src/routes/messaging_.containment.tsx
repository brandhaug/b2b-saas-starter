import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  Feedback,
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui'
import { requireOperationsSession } from '@/lib/require-operations-session'
import {
  approveMessagingRecovery,
  completeMessagingRecovery,
  containMessagingIncident,
  getMessagingContainment,
  getMessagingIncidents,
  openMessagingIncident,
  recordMessagingCredentialRotation,
  recordMessagingRecoveryCheck
} from '@/lib/server/operations-server-functions'

export const Route = createFileRoute('/messaging_/containment')({
  beforeLoad: requireOperationsSession,
  loader: async () => ({
    containment: await getMessagingContainment(),
    incidents: await getMessagingIncidents()
  }),
  component: MessagingContainmentRoute
})

function MessagingContainmentRoute() {
  const { containment, incidents } = Route.useLoaderData()
  const router = useRouter()
  const [mutation, setMutation] = useState<
    | Awaited<ReturnType<typeof containMessagingIncident>>
    | Awaited<ReturnType<typeof openMessagingIncident>>
    | undefined
  >()
  const finish = async (
    response: Awaited<ReturnType<typeof containMessagingIncident>>
  ) => {
    setMutation(response)
    if (response.state === 'ready') await router.invalidate()
  }
  return (
    <OperationsShell eyebrow="Privileged messaging" title="Containment">
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Current provider/channel posture is separate from routine investigation.
        Accepted actions require an authoritative permission recheck, a narrow scope, a
        safe before/after preview, a substantive reason, and confirmation.
      </p>
      <Link
        className="mt-5 inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium"
        search={{ q: '' }}
        to="/messaging"
      >
        Back to case queue
      </Link>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Channel posture</h2>
        {containment.state === 'ready' ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {containment.data.controls.map((control) => (
              <li className="border border-border bg-card p-4" key={control.controlId}>
                <p className="font-medium capitalize">
                  {control.channel} · {control.provider}
                </p>
                <p className="mt-1 text-sm">
                  {control.environment} · {control.enabled ? 'Enabled' : 'Paused'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {control.reason ?? 'No active containment reason'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <ScreenState result={containment} />
          </div>
        )}
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Messaging incidents</h2>
        <details className="mt-4 border border-border bg-card p-5">
          <summary className="cursor-pointer font-medium">
            Open a scoped incident
          </summary>
          <form
            className="mt-5 grid gap-4 sm:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              await finish(
                await openMessagingIncident({
                  data: {
                    kind: String(form.get('kind')) as 'duplicate_delivery',
                    severity: String(form.get('severity')) as 'high',
                    safeSummary: String(form.get('safeSummary') ?? ''),
                    containmentScope: String(
                      form.get('containmentScope')
                    ) as 'merchant',
                    environment: String(form.get('environment') ?? ''),
                    shopId: String(form.get('shopId') ?? ''),
                    provider: String(form.get('provider')) as '' | 'meta' | 'smso',
                    channel: String(form.get('channel')) as '' | 'whatsapp' | 'sms',
                    reason: String(form.get('reason') ?? '')
                  }
                })
              )
            }}
          >
            <SelectField label="Incident kind" name="kind">
              <option value="duplicate_delivery">Duplicate delivery</option>
              <option value="financial_uncertainty">Financial uncertainty</option>
              <option value="credential_compromise">Credential compromise</option>
              <option value="encryption_key_compromise">
                Encryption key compromise
              </option>
              <option value="privacy_exposure">Privacy exposure</option>
              <option value="forged_callback">Forged callback</option>
            </SelectField>
            <SelectField label="Severity" name="severity">
              <option value="high">High</option>
              <option value="critical">Critical</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </SelectField>
            <SelectField label="Required containment scope" name="containmentScope">
              <option value="merchant">Merchant freeze</option>
              <option value="provider_channel">Provider/channel pause</option>
              <option value="callback_rule">Callback rule pause</option>
              <option value="global">Global stop</option>
            </SelectField>
            <TextField label="Environment" name="environment" value="production" />
            <TextField label="Shop ID (Merchant scope)" name="shopId" />
            <SelectField label="Provider" name="provider">
              <option value="">Not applicable</option>
              <option value="meta">Meta</option>
              <option value="smso">SMSO</option>
            </SelectField>
            <SelectField label="Channel" name="channel">
              <option value="">Not applicable</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </SelectField>
            <TextField label="Safe summary" name="safeSummary" required />
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Substantive reason
              <textarea
                className="min-h-24 rounded-md border border-input bg-card p-3"
                minLength={12}
                name="reason"
                required
              />
            </label>
            <div className="sm:col-span-2">
              <SubmitButton>Open incident</SubmitButton>
            </div>
          </form>
        </details>
        {incidents.state !== 'ready' ? (
          <div className="mt-4">
            <ScreenState result={incidents} />
          </div>
        ) : incidents.data.incidents.length ? (
          <ul className="mt-4 grid gap-3">
            {incidents.data.incidents.map((incident) => (
              <li
                className="border border-border bg-card p-4"
                key={incident.incidentId}
              >
                <p className="font-medium">{incident.safeSummary}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {incident.status} · {incident.containmentScope}
                </p>
                {incident.status === 'open' ? (
                  <form
                    className="mt-5 grid gap-4 border-t border-border pt-5"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const form = new FormData(event.currentTarget)
                      const response = await containMessagingIncident({
                        data: {
                          incidentId: incident.incidentId,
                          reason: String(form.get('reason') ?? ''),
                          confirmed: form.get('confirmed') === 'yes'
                        }
                      })
                      await finish(response)
                    }}
                  >
                    <div
                      aria-label="Containment preview"
                      className="grid gap-2 rounded-md bg-muted p-4 text-sm sm:grid-cols-2"
                    >
                      <p>Before: {incident.controlBefore}</p>
                      <p>After: {incident.controlAfter}</p>
                      <p className="sm:col-span-2">
                        Exact control: {incident.controlLabel}
                      </p>
                    </div>
                    <label className="grid gap-1.5 text-sm font-medium">
                      Containment reason
                      <textarea
                        className="min-h-24 rounded-md border border-input bg-card p-3"
                        maxLength={1000}
                        minLength={12}
                        name="reason"
                        required
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                      <input name="confirmed" required type="checkbox" value="yes" />
                      Confirm narrow containment
                    </label>
                    <div>
                      <SubmitButton>Contain incident</SubmitButton>
                    </div>
                  </form>
                ) : null}
                {incident.status === 'contained' || incident.status === 'recovering' ? (
                  <details className="mt-4 border-t border-border pt-4">
                    <summary className="cursor-pointer text-sm font-medium">
                      Recovery evidence and approval
                    </summary>
                    <form
                      className="mt-4 grid gap-3 sm:grid-cols-2"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        const form = new FormData(event.currentTarget)
                        await finish(
                          await recordMessagingRecoveryCheck({
                            data: {
                              incidentId: incident.incidentId,
                              kind: String(form.get('kind')) as
                                | 'health_probe'
                                | 'reconciliation',
                              reference: String(form.get('reference') ?? ''),
                              status: String(form.get('status')) as 'passed' | 'failed',
                              observedAt: new Date().toISOString(),
                              reason: String(form.get('reason') ?? ''),
                              confirmed: form.get('confirmed') === 'yes'
                            }
                          })
                        )
                      }}
                    >
                      <SelectField label="Check" name="kind">
                        <option value="health_probe">Health probe</option>
                        <option value="reconciliation">Reconciliation</option>
                      </SelectField>
                      <SelectField label="Result" name="status">
                        <option value="passed">Passed</option>
                        <option value="failed">Failed</option>
                      </SelectField>
                      <TextField label="Evidence reference" name="reference" required />
                      <TextField label="Reason" name="reason" required />
                      <div
                        aria-label="Recovery check preview"
                        className="rounded-md bg-muted p-4 text-sm sm:col-span-2"
                      >
                        Append evidence only; incident and control state remain
                        unchanged.
                      </div>
                      <Confirm label="Confirm recovery evidence" />
                      <div className="sm:col-span-2">
                        <SubmitButton>Record recovery check</SubmitButton>
                      </div>
                    </form>
                    {incident.kind === 'credential_compromise' ? (
                      <form
                        className="mt-5 grid gap-3 sm:grid-cols-2"
                        onSubmit={async (event) => {
                          event.preventDefault()
                          const form = new FormData(event.currentTarget)
                          await finish(
                            await recordMessagingCredentialRotation({
                              data: {
                                incidentId: incident.incidentId,
                                previousVersion: String(
                                  form.get('previousVersion') ?? ''
                                ),
                                nextVersion: String(form.get('nextVersion') ?? ''),
                                invalidatedAt: String(form.get('invalidatedAt') ?? ''),
                                validatedAt: String(form.get('validatedAt') ?? ''),
                                evidenceReference: String(
                                  form.get('evidenceReference') ?? ''
                                ),
                                reason: String(form.get('reason') ?? ''),
                                confirmed: form.get('confirmed') === 'yes'
                              }
                            })
                          )
                        }}
                      >
                        <TextField
                          label="Previous credential version"
                          name="previousVersion"
                          required
                        />
                        <TextField
                          label="Replacement credential version"
                          name="nextVersion"
                          required
                        />
                        <TextField
                          label="Old credential invalidated at"
                          name="invalidatedAt"
                          required
                        />
                        <TextField
                          label="Replacement validated at"
                          name="validatedAt"
                          required
                        />
                        <TextField
                          label="Rotation evidence reference"
                          name="evidenceReference"
                          required
                        />
                        <TextField label="Rotation reason" name="reason" required />
                        <div
                          aria-label="Credential rotation preview"
                          className="rounded-md bg-muted p-4 text-sm sm:col-span-2"
                        >
                          Before: compromised provider credential. After: old version
                          invalidated and replacement evidence recorded; scope stays
                          contained.
                        </div>
                        <Confirm label="Confirm credential rotation evidence" />
                        <div className="sm:col-span-2">
                          <SubmitButton>Record credential rotation</SubmitButton>
                        </div>
                      </form>
                    ) : null}
                    <form
                      className="mt-5 grid gap-3 sm:grid-cols-2"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        const form = new FormData(event.currentTarget)
                        await finish(
                          await approveMessagingRecovery({
                            data: {
                              incidentId: incident.incidentId,
                              healthProbeReference: String(
                                form.get('healthProbeReference') ?? ''
                              ),
                              reconciliationReference: String(
                                form.get('reconciliationReference') ?? ''
                              ),
                              residualRisk: String(form.get('residualRisk') ?? ''),
                              reason: String(form.get('reason') ?? ''),
                              confirmed: form.get('confirmed') === 'yes'
                            }
                          })
                        )
                      }}
                    >
                      <TextField
                        label="Passing health reference"
                        name="healthProbeReference"
                        required
                      />
                      <TextField
                        label="Passing reconciliation reference"
                        name="reconciliationReference"
                        required
                      />
                      <TextField label="Residual risk" name="residualRisk" required />
                      <TextField label="Approval reason" name="reason" required />
                      <div
                        aria-label="Recovery approval preview"
                        className="rounded-md bg-muted p-4 text-sm sm:col-span-2"
                      >
                        Before: {incident.status} with {incident.recoveryApprovalCount}{' '}
                        of {incident.requiredRecoveryApprovals} required approvals.
                        After: one approval from the current Operator is appended;
                        control state remains {incident.controlAfter.toLowerCase()}.
                      </div>
                      <Confirm label="Confirm recovery approval" />
                      <div className="sm:col-span-2">
                        <SubmitButton>Approve recovery</SubmitButton>
                      </div>
                    </form>
                    {incident.status === 'recovering' ? (
                      <form
                        className="mt-5 grid gap-3"
                        onSubmit={async (event) => {
                          event.preventDefault()
                          const form = new FormData(event.currentTarget)
                          await finish(
                            await completeMessagingRecovery({
                              data: {
                                incidentId: incident.incidentId,
                                reason: String(form.get('reason') ?? ''),
                                confirmed: form.get('confirmed') === 'yes'
                              }
                            })
                          )
                        }}
                      >
                        <div
                          aria-label="Recovery preview"
                          className="grid gap-2 rounded-md bg-muted p-4 text-sm sm:grid-cols-2"
                        >
                          <p>Before: recovering</p>
                          <p>After: resolved and scope re-enabled</p>
                        </div>
                        <TextField label="Completion reason" name="reason" required />
                        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                          <input
                            name="confirmed"
                            required
                            type="checkbox"
                            value="yes"
                          />
                          Confirm recovery and re-enable the exact scope
                        </label>
                        <div>
                          <SubmitButton>Complete recovery</SubmitButton>
                        </div>
                      </form>
                    ) : null}
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 border border-border bg-card p-5 text-sm text-muted-foreground">
            No messaging incidents.
          </p>
        )}
      </section>
      {mutation ? (
        <Feedback status={mutation.state === 'ready'}>
          {mutation.state === 'ready'
            ? 'Messaging control updated.'
            : 'message' in mutation
              ? mutation.message
              : 'Containment state changed.'}
        </Feedback>
      ) : null}
    </OperationsShell>
  )
}

function TextField({
  label,
  name,
  required = false,
  value
}: {
  label: string
  name: string
  required?: boolean
  value?: string
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <input
        className="min-h-11 rounded-md border border-input bg-card px-3"
        defaultValue={value}
        minLength={required ? 1 : undefined}
        name={name}
        required={required}
      />
    </label>
  )
}

function SelectField({
  label,
  name,
  children
}: {
  label: string
  name: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <select
        className="min-h-11 rounded-md border border-input bg-card px-3"
        name={name}
      >
        {children}
      </select>
    </label>
  )
}

function Confirm({ label }: { readonly label: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm font-medium sm:col-span-2">
      <input name="confirmed" required type="checkbox" value="yes" />
      {label}
    </label>
  )
}
