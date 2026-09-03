import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'

import { FormTextField } from '@/components/form-text-field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/confirm-button'
import { useServerAction } from '@/hooks/use-server-action'
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
 * `sso:list`, and every mutation here re-checks the matching statement on the
 * server.
 *
 * Secrets are write-only by construction: the connection DTO carries the
 * client id's last four and nothing else, and the credential fields below are
 * only ever inputs. The component is split so no one piece grows past the
 * house size: the connection list, the OIDC form, and the SAML form each
 * live below.
 */

const CREATE_FAILED = 'Failed to add the connection'
const UPDATE_FAILED = 'Failed to update the connection'
const REMOVE_FAILED = 'Failed to remove the connection'
const TEST_FAILED = 'The test could not run'

type OidcValues = {
  protocol: 'oidc'
  domain: string
  issuer: string
  clientId: string
  clientSecret: string
  defaultWorkspaceRole: 'member' | 'admin'
}

type SamlValues = {
  protocol: 'saml'
  domain: string
  metadataUrl: string
  metadataXml: string
  defaultWorkspaceRole: 'member' | 'admin'
}

const DEFAULT_OIDC: OidcValues = {
  protocol: 'oidc',
  domain: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
  defaultWorkspaceRole: 'member'
}

const DEFAULT_SAML: SamlValues = {
  protocol: 'saml',
  domain: '',
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

function validateHttps(value: string): string | undefined {
  if (value.trim().length === 0) {
    return 'Issuer URL is required'
  }
  if (!value.startsWith('https://')) {
    return 'The issuer must be an https URL'
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

/** The create submit control, shared by both protocol forms. */
function AddConnectionButton({ disabled }: { readonly disabled: boolean }) {
  return (
    <Button type="submit" disabled={disabled} className="justify-self-start">
      {disabled ? <Spinner data-icon="inline-start" /> : null}
      Add connection
    </Button>
  )
}

/** The provisioning-role radio group, identical for both protocol forms. */
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

function useOidcForm() {
  return useForm({ defaultValues: DEFAULT_OIDC })
}

function useSamlForm() {
  return useForm({ defaultValues: DEFAULT_SAML })
}

type OidcForm = ReturnType<typeof useOidcForm>
type SamlForm = ReturnType<typeof useSamlForm>

function toCreatePayload(
  workspaceSlug: string,
  value: OidcValues | SamlValues
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
  // The schema demands exactly one metadata source; the form's non-empty
  // field wins, URL first.
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
  canManage = true
}: {
  readonly workspaceSlug: string
  readonly connections: ReadonlyArray<SsoConnection>
  /** A test supplies fakes; production reaches the server functions. */
  readonly ports?: SsoPanelPorts
  /** False replaces the controls with a reason (the viewer can list but not manage). */
  readonly canManage?: boolean
}) {
  const [protocol, setProtocol] = useState<'oidc' | 'saml'>('oidc')
  const [testResult, setTestResult] = useState<
    ({ readonly providerId: string } & SsoTestResult) | null
  >(null)

  const create = useServerAction(
    (value: OidcValues | SamlValues) =>
      ports.create(toCreatePayload(workspaceSlug, value)),
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

  const oidcForm = useForm({
    defaultValues: DEFAULT_OIDC,
    onSubmit: async ({ value }) => {
      const outcome = await create.runAsync(value)
      if (outcome.ok) {
        oidcForm.reset()
      }
    }
  })

  const samlForm = useForm({
    defaultValues: DEFAULT_SAML,
    onSubmit: async ({ value }) => {
      const outcome = await create.runAsync(value)
      if (outcome.ok) {
        samlForm.reset()
      }
    }
  })

  return (
    <div className="grid gap-5">
      <ConnectionList
        workspaceSlug={workspaceSlug}
        connections={connections}
        canManage={canManage}
        testResult={testResult}
        update={update}
        remove={remove}
        test={test}
      />

      {canManage ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void (protocol === 'oidc'
              ? oidcForm.handleSubmit()
              : samlForm.handleSubmit())
          }}
          className="grid gap-4"
        >
          <FieldSet>
            <FieldLegend variant="label">Protocol</FieldLegend>
            <RadioGroup
              name="sso-protocol"
              value={protocol}
              onValueChange={setProtocol}
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

          {protocol === 'oidc' ? (
            <OidcFormFields form={oidcForm} pending={create.pending} />
          ) : (
            <SamlFormFields form={samlForm} pending={create.pending} />
          )}

          {create.error === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{create.error}</AlertDescription>
            </Alert>
          )}
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Your role cannot change single sign-on for this workspace.
        </p>
      )}
    </div>
  )
}

function ConnectionList({
  workspaceSlug,
  connections,
  canManage,
  testResult,
  update,
  remove,
  test
}: {
  readonly workspaceSlug: string
  readonly connections: ReadonlyArray<SsoConnection>
  readonly canManage: boolean
  readonly testResult: ({ readonly providerId: string } & SsoTestResult) | null
  readonly update: ReturnType<
    typeof useServerAction<UpdateSsoConnectionInput, SsoConnection | null>
  >
  readonly remove: ReturnType<typeof useServerAction<string, boolean>>
  readonly test: ReturnType<typeof useServerAction<string, SsoTestResult>>
}) {
  return (
    <div className="grid gap-2">
      <Label>Connections</Label>
      {connections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No SSO connections yet</EmptyTitle>
            <EmptyDescription>
              Add one below; sign-ins for its domain route to the IdP once an owner
              enables it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              workspaceSlug={workspaceSlug}
              connection={connection}
              canManage={canManage}
              testResult={testResult?.providerId === connection.id ? testResult : null}
              update={update}
              remove={remove}
              test={test}
            />
          ))}
        </ItemGroup>
      )}
      {update.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{update.error}</AlertDescription>
        </Alert>
      )}
      {remove.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{remove.error}</AlertDescription>
        </Alert>
      )}
      {test.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{test.error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function ConnectionRow({
  workspaceSlug,
  connection,
  canManage,
  testResult,
  update,
  remove,
  test
}: {
  readonly workspaceSlug: string
  readonly connection: SsoConnection
  readonly canManage: boolean
  readonly testResult: ({ readonly providerId: string } & SsoTestResult) | null
  readonly update: ReturnType<
    typeof useServerAction<UpdateSsoConnectionInput, SsoConnection | null>
  >
  readonly remove: ReturnType<typeof useServerAction<string, boolean>>
  readonly test: ReturnType<typeof useServerAction<string, SsoTestResult>>
}) {
  const updating = update.pendingInput?.providerId === connection.id
  return (
    <Item variant="outline" size="sm">
      <ItemContent>
        <ItemTitle className="font-mono">{connection.domain}</ItemTitle>
        <ItemDescription>
          {connection.protocol.toUpperCase()} · {connection.issuer}
          {connection.clientIdLastFour === null
            ? null
            : ` · client …${connection.clientIdLastFour}`}
          {' · joins as '}
          {connection.defaultWorkspaceRole}
        </ItemDescription>
        {testResult === null ? null : (
          <Alert variant={testResult.outcome === 'passed' ? 'default' : 'destructive'}>
            <AlertTitle>
              {testResult.outcome === 'passed'
                ? 'Connection test passed.'
                : 'Connection test failed.'}
            </AlertTitle>
            {testResult.outcome === 'failed' ? (
              <AlertDescription>{testResult.message}</AlertDescription>
            ) : null}
          </Alert>
        )}
      </ItemContent>
      <ItemActions className="flex-wrap">
        <Badge variant={connection.enabled ? 'ok' : 'neutral'}>
          {connection.enabled ? 'routing' : 'disabled'}
        </Badge>
        {canManage ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={test.pendingInput === connection.id}
              onClick={() => test.run(connection.id)}
            >
              {test.pendingInput === connection.id ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Test
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={updating}
              onClick={() =>
                update.run({
                  workspaceSlug,
                  providerId: connection.id,
                  enabled: !connection.enabled
                })
              }
            >
              {connection.enabled ? 'Disable' : 'Enable'}
            </Button>
            <ConfirmButton
              label="Remove"
              confirmLabel="Remove connection"
              busy={remove.pendingInput === connection.id}
              onConfirm={() => remove.run(connection.id)}
              target={connection.domain}
            />
          </>
        ) : null}
      </ItemActions>
      {canManage ? (
        <ItemActions className="flex items-center gap-2">
          <Switch
            id={`require-sso-${connection.id}`}
            checked={connection.requireSso}
            disabled={updating}
            onCheckedChange={(checked) =>
              update.run({
                workspaceSlug,
                providerId: connection.id,
                requireSso: checked
              })
            }
          />
          <Label
            htmlFor={`require-sso-${connection.id}`}
            className="text-xs font-normal text-muted-foreground"
          >
            Require SSO for this domain
          </Label>
        </ItemActions>
      ) : null}
    </Item>
  )
}

function OidcFormFields({
  form,
  pending
}: {
  readonly form: OidcForm
  readonly pending: boolean
}) {
  return (
    <>
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
      <form.Field
        name="issuer"
        validators={{
          onChange: ({ value }: { value: string }) => validateHttps(value)
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
      <form.Field name="defaultWorkspaceRole">
        {(field) => (
          <RoleRadioGroup
            value={field.state.value}
            onChange={(role) => field.handleChange(role)}
          />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state): readonly [boolean, boolean] => [
          state.canSubmit,
          state.isSubmitting
        ]}
      >
        {([canSubmit, isSubmitting]) => (
          <AddConnectionButton disabled={!canSubmit || isSubmitting || pending} />
        )}
      </form.Subscribe>
    </>
  )
}

function SamlFormFields({
  form,
  pending
}: {
  readonly form: SamlForm
  readonly pending: boolean
}) {
  return (
    <>
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
      <form.Field name="metadataUrl">
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
      <form.Field name="defaultWorkspaceRole">
        {(field) => (
          <RoleRadioGroup
            value={field.state.value}
            onChange={(role) => field.handleChange(role)}
          />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state): readonly [boolean, boolean] => [
          state.canSubmit,
          state.isSubmitting
        ]}
      >
        {([canSubmit, isSubmitting]) => (
          <AddConnectionButton disabled={!canSubmit || isSubmitting || pending} />
        )}
      </form.Subscribe>
    </>
  )
}
