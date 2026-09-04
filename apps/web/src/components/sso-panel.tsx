import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'

import { ConnectionList } from '@/components/sso-connection-list'
import { FormTextField } from '@/components/form-text-field'
import { ActionFeedback } from '@/components/page/action-feedback'
import { CreateSection } from '@/components/page/panel'
import { Button } from '@/components/ui/button'
import { FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useServerAction } from '@/hooks/use-server-action'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  createSsoConnectionServerFn,
  removeSsoConnectionServerFn,
  testSsoConnectionServerFn,
  updateSsoConnectionServerFn,
  type CreateSsoConnectionInput,
  type SsoTestResult,
  type UpdateSsoConnectionInput
} from '@/lib/server/workspace-sso'

/**
 * The "Single sign-on" section of workspace settings (ADR 0055). Owners and
 * admins only — the loader withholds the whole segment from anyone without
 * `sso:list`, and each control asks its own statement (`sso:create` adds,
 * `sso:update` tests and flips, `sso:remove` removes); the server re-checks
 * every statement regardless.
 *
 * Secrets are write-only by construction: the connection DTO carries the
 * client id's last four and nothing else, and the credential fields below are
 * only ever inputs. One form covers both protocols — a flat superset of the
 * OIDC and SAML fields, with the protocol deciding which middle third shows.
 */

const CREATE_FAILED = 'Failed to add the connection'
const UPDATE_FAILED = 'Failed to update the connection'
const REMOVE_FAILED = 'Failed to remove the connection'
const TEST_FAILED = 'The test could not run'

type SsoFormValues = {
  protocol: 'oidc' | 'saml'
  domain: string
  issuer: string
  clientId: string
  clientSecret: string
  metadataUrl: string
  metadataXml: string
  defaultWorkspaceRole: 'member' | 'admin'
}

const DEFAULT_VALUES: SsoFormValues = {
  protocol: 'oidc',
  domain: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
  metadataUrl: '',
  metadataXml: '',
  defaultWorkspaceRole: 'member'
}

function validateDomain(value: string): string | undefined {
  if (value.trim().length === 0) {
    return 'Domain is required'
  }
  if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value.trim())) {
    return 'Enter the domain after the @, like acme.com'
  }
  return
}

function validateIssuer(value: string): string | undefined {
  if (value.trim().length === 0) {
    return 'Issuer URL is required'
  }
  if (!value.startsWith('https://')) {
    return 'The issuer must be an https URL'
  }
  return
}

/** Optional (the XML can carry the metadata), but if filled, https. */
function validateMetadataUrl(value: string): string | undefined {
  if (value.trim().length === 0) {
    return
  }
  if (!value.startsWith('https://')) {
    return 'The metadata URL must be an https URL'
  }
  return
}

/**
 * The server schema demands exactly one SAML metadata source; say so in the
 * form instead of after the request's 400. Runs at the form level, where both
 * fields (and the protocol) are visible at once.
 */
function validateOneMetadataSource(value: SsoFormValues): string | undefined {
  if (value.protocol !== 'saml') {
    return
  }
  if (value.metadataUrl.trim().length === 0 && value.metadataXml.trim().length === 0) {
    return 'Add the metadata URL or paste the metadata XML'
  }
  return
}

/** The mutation surface as a port, so a test drives the panel with fakes. */
export type SsoPanelPorts = {
  readonly create: (input: CreateSsoConnectionInput) => Promise<SsoConnection>
  readonly update: (input: UpdateSsoConnectionInput) => Promise<SsoConnection | null>
  readonly remove: (input: {
    workspaceSlug: string
    providerId: string
  }) => Promise<boolean>
  readonly test: (input: {
    workspaceSlug: string
    providerId: string
  }) => Promise<SsoTestResult>
}

function defaultPorts(): SsoPanelPorts {
  return {
    create: (input) => createSsoConnectionServerFn({ data: input }),
    update: (input) => updateSsoConnectionServerFn({ data: input }),
    remove: (input) => removeSsoConnectionServerFn({ data: input }),
    test: (input) => testSsoConnectionServerFn({ data: input })
  }
}

/** The create submit control. */
function AddConnectionButton({ disabled }: { readonly disabled: boolean }) {
  return (
    <Button type="submit" disabled={disabled} className="justify-self-start">
      {disabled ? <Spinner data-icon="inline-start" /> : null}
      Add connection
    </Button>
  )
}

/** The provisioning-role radio group, identical for both protocols. */
function RoleRadioGroup({
  value,
  onChange
}: {
  readonly value: 'member' | 'admin'
  readonly onChange: (role: 'member' | 'admin') => void
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Default role for new members</FieldLegend>
      <RadioGroup
        name="defaultWorkspaceRole"
        value={value}
        onValueChange={onChange}
        className="flex flex-wrap gap-3"
      >
        <FieldLabel>
          <RadioGroupItem value="member" />
          <span>member</span>
        </FieldLabel>
        <FieldLabel>
          <RadioGroupItem value="admin" />
          <span>admin</span>
        </FieldLabel>
      </RadioGroup>
    </FieldSet>
  )
}

/**
 * The wire input for a create, the one place that shapes it: OIDC reads the
 * credential trio; SAML sends exactly one metadata source — URL first when
 * both are filled — and never an empty string.
 */
function toCreatePayload(
  workspaceSlug: string,
  value: SsoFormValues
): CreateSsoConnectionInput {
  if (value.protocol === 'oidc') {
    return {
      workspaceSlug,
      protocol: 'oidc',
      domain: value.domain.trim(),
      issuer: value.issuer.trim(),
      clientId: value.clientId,
      clientSecret: value.clientSecret,
      defaultWorkspaceRole: value.defaultWorkspaceRole
    }
  }
  if (value.metadataUrl.trim().length > 0) {
    return {
      workspaceSlug,
      protocol: 'saml',
      domain: value.domain.trim(),
      metadataUrl: value.metadataUrl.trim(),
      defaultWorkspaceRole: value.defaultWorkspaceRole
    }
  }
  return {
    workspaceSlug,
    protocol: 'saml',
    domain: value.domain.trim(),
    metadataXml: value.metadataXml.trim(),
    defaultWorkspaceRole: value.defaultWorkspaceRole
  }
}

export function SsoPanel({
  workspaceSlug,
  connections,
  ports = defaultPorts(),
  viewer
}: {
  readonly workspaceSlug: string
  readonly connections: ReadonlyArray<SsoConnection>
  /** A test supplies fakes; production reaches the server functions. */
  readonly ports?: SsoPanelPorts
  /** Per-action gating, decided by role: create, update (test/flip), remove. */
  readonly viewer: Viewer
}) {
  const [testResult, setTestResult] = useState<
    ({ readonly providerId: string } & SsoTestResult) | null
  >(null)

  const canCreate = viewerCan(viewer, { sso: ['create'] })
  const canUpdate = viewerCan(viewer, { sso: ['update'] })
  const canRemove = viewerCan(viewer, { sso: ['remove'] })

  const create = useServerAction(
    (value: SsoFormValues) => ports.create(toCreatePayload(workspaceSlug, value)),
    { failureMessage: CREATE_FAILED }
  )

  const update = useServerAction(
    (input: UpdateSsoConnectionInput) => ports.update(input),
    { failureMessage: UPDATE_FAILED }
  )

  const remove = useServerAction(
    (providerId: string) => ports.remove({ workspaceSlug, providerId }),
    { failureMessage: REMOVE_FAILED }
  )

  const test = useServerAction(
    (providerId: string) => ports.test({ workspaceSlug, providerId }),
    {
      failureMessage: TEST_FAILED,
      onSuccess: (result, providerId) => setTestResult({ providerId, ...result })
    }
  )

  const form = useForm({
    defaultValues: DEFAULT_VALUES,
    validators: {
      onChange: ({ value }) => validateOneMetadataSource(value)
    },
    onSubmit: async ({ value }) => {
      const outcome = await create.runAsync(value)
      if (outcome.ok) {
        form.reset()
      }
    }
  })

  return (
    <div className="grid gap-5">
      <CreateSection
        allowed={canCreate}
        title="Add a connection"
        deniedReason="Your role cannot change single sign-on for this workspace."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
          className="grid gap-4"
        >
          <form.Field name="protocol">
            {(field) => (
              <FieldSet>
                <FieldLegend variant="label">Protocol</FieldLegend>
                <RadioGroup
                  name={field.name}
                  value={field.state.value}
                  onValueChange={(next) =>
                    field.handleChange(next === 'saml' ? 'saml' : 'oidc')
                  }
                  className="flex flex-wrap gap-3"
                >
                  <FieldLabel>
                    <RadioGroupItem value="oidc" />
                    <span>OIDC</span>
                  </FieldLabel>
                  <FieldLabel>
                    <RadioGroupItem value="saml" />
                    <span>SAML</span>
                  </FieldLabel>
                </RadioGroup>
              </FieldSet>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.protocol}>
            {(protocol) =>
              protocol === 'oidc' ? (
                <>
                  <form.Field
                    name="issuer"
                    validators={{
                      onChange: ({ value }: { value: string }) => validateIssuer(value)
                    }}
                  >
                    {(field) => (
                      <FormTextField
                        name={field.name}
                        label="Issuer"
                        value={field.state.value}
                        errors={field.state.meta.errors}
                        onBlur={field.handleBlur}
                        onChange={field.handleChange}
                        placeholder="https://login.acme.com"
                      />
                    )}
                  </form.Field>
                  <form.Field name="clientId">
                    {(field) => (
                      <FormTextField
                        name={field.name}
                        label="Client ID"
                        value={field.state.value}
                        errors={field.state.meta.errors}
                        onBlur={field.handleBlur}
                        onChange={field.handleChange}
                      />
                    )}
                  </form.Field>
                  <form.Field name="clientSecret">
                    {(field) => (
                      <FormTextField
                        name={field.name}
                        label="Client secret"
                        type="password"
                        autoComplete="off"
                        value={field.state.value}
                        errors={field.state.meta.errors}
                        onBlur={field.handleBlur}
                        onChange={field.handleChange}
                      />
                    )}
                  </form.Field>
                </>
              ) : (
                <>
                  <form.Field
                    name="metadataUrl"
                    validators={{
                      onChange: ({ value }: { value: string }) =>
                        validateMetadataUrl(value)
                    }}
                  >
                    {(field) => (
                      <FormTextField
                        name={field.name}
                        label="Metadata URL"
                        value={field.state.value}
                        errors={field.state.meta.errors}
                        onBlur={field.handleBlur}
                        onChange={field.handleChange}
                        placeholder="https://login.acme.com/saml/metadata"
                      />
                    )}
                  </form.Field>
                  <form.Field name="metadataXml">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name}>Or paste the metadata XML</Label>
                        <Textarea
                          id={field.name}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          rows={4}
                          placeholder="<EntityDescriptor …>"
                          className="font-mono text-xs"
                        />
                      </div>
                    )}
                  </form.Field>
                  <form.Subscribe selector={(state) => state.errors}>
                    {(errors) =>
                      errors.length === 0 ? null : (
                        <FieldError>{errors.join(', ')}</FieldError>
                      )
                    }
                  </form.Subscribe>
                </>
              )
            }
          </form.Subscribe>

          <form.Field
            name="domain"
            validators={{
              onChange: ({ value }: { value: string }) => validateDomain(value)
            }}
          >
            {(field) => (
              <FormTextField
                name={field.name}
                label="Email domain"
                value={field.state.value}
                errors={field.state.meta.errors}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
                placeholder="acme.com"
              />
            )}
          </form.Field>

          <form.Field name="defaultWorkspaceRole">
            {(field) => (
              <RoleRadioGroup
                value={field.state.value}
                onChange={(role) => field.handleChange(role)}
              />
            )}
          </form.Field>

          <ActionFeedback error={create.error} />

          <form.Subscribe
            selector={(state): readonly [boolean, boolean] => [
              state.canSubmit,
              state.isSubmitting
            ]}
          >
            {([canSubmit, isSubmitting]) => (
              <AddConnectionButton
                disabled={!canSubmit || isSubmitting || create.pending}
              />
            )}
          </form.Subscribe>
        </form>
      </CreateSection>

      <ConnectionList
        workspaceSlug={workspaceSlug}
        connections={connections}
        canUpdate={canUpdate}
        canRemove={canRemove}
        testResult={testResult}
        update={update}
        remove={remove}
        test={test}
      />
    </div>
  )
}
