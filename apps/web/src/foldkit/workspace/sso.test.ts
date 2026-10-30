// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { demoFixtures } from '@/lib/demo-fixtures'
import * as Api from '@/lib/server/workspace-sso'
import * as Settings from '@/lib/server/workspace-settings'
import { input } from '@/components/native-test-harness'
import { renderWorkspace } from './test-harness'

const connection = {
  id: 'sso_example_oidc',
  protocol: 'oidc' as const,
  domain: 'acme-corp.example',
  issuer: 'https://login.acme-corp.example',
  enabled: false,
  requireSso: false,
  defaultWorkspaceRole: 'member' as const,
  clientIdLastFour: '7f2a',
  createdAt: '2026-05-15T09:30:00.000Z'
}
const data = { ...demoFixtures.settings, ssoConnections: [connection] }
beforeEach(() => {
  vi.spyOn(Settings, 'loadWorkspaceSettingsServerFn').mockResolvedValue(data)
  vi.spyOn(Api, 'createSsoConnectionServerFn').mockResolvedValue(connection)
  vi.spyOn(Api, 'updateSsoConnectionServerFn').mockResolvedValue(connection)
  vi.spyOn(Api, 'testSsoConnectionServerFn').mockResolvedValue({
    outcome: 'failed',
    code: 'discovery_unreachable',
    message: 'no such issuer'
  })
})
async function renderPanel(role: 'owner' | 'member' = 'owner') {
  return renderWorkspace(
    { _tag: 'settings', data: { ...data, viewer: { role } } },
    { url: '/workspaces/starter-lab/settings?tab=sso' }
  )
}
async function form() {
  await renderPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
  return within(await screen.findByRole('dialog'))
}
async function oidc() {
  const fields = await form()
  await input(fields.getByLabelText('Email domain'), 'northwind.test')
  await input(fields.getByLabelText('Issuer'), 'https://login.northwind.test')
  await input(fields.getByLabelText('Client ID'), 'client-wxyz')
  await input(fields.getByLabelText('Client secret'), 'sekrit')
  return fields
}
describe('SSO preserved behaviors', () => {
  it('shows the connection with its write-only credential echo', async () => {
    await renderPanel()
    expect(screen.getByText('sso_example_oidc')).not.toBeNull()
    expect(screen.getByText(/OIDC/)).not.toBeNull()
    expect(screen.getByText(/client …7f2a/)).not.toBeNull()
    expect(screen.getByText(/joins as member/)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Test' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Enable' })).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Remove acme-corp.example' })
    ).not.toBeNull()
    expect(screen.getByRole('switch')).not.toBeNull()
  })

  it('reports a failed test inline', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText(/Connection test failed\./)).not.toBeNull()
    expect(screen.getByText(/no such issuer/)).not.toBeNull()
  })

  it('reports a passed test without a failure message', async () => {
    vi.mocked(Api.testSsoConnectionServerFn).mockResolvedValue({ outcome: 'passed' })
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Connection test passed.')).not.toBeNull()
    expect(screen.queryByText(/Connection test failed/)).toBeNull()
  })

  it('enable toggles call the update port with the flip', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() =>
      expect(Api.updateSsoConnectionServerFn).toHaveBeenCalledWith({
        data: { workspaceSlug: 'starter-lab', providerId: connection.id, enabled: true }
      })
    )
  })

  it('flipping require-SSO updates the toggle flag', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(Api.updateSsoConnectionServerFn).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          providerId: connection.id,
          requireSso: true
        }
      })
    )
  })

  it('replaces the controls with a reason when the viewer cannot manage', async () => {
    await renderPanel('member')
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add connection' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(/Your role cannot change single sign-on/)).not.toBeNull()
    expect(Api.createSsoConnectionServerFn).not.toHaveBeenCalled()
    expect(Api.updateSsoConnectionServerFn).not.toHaveBeenCalled()
  })

  it('submits an OIDC connection with the form fields', async () => {
    const fields = await oidc()
    fireEvent.click(fields.getByRole('button', { name: 'Add connection' }))
    await waitFor(() =>
      expect(Api.createSsoConnectionServerFn).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          protocol: 'oidc',
          domain: 'northwind.test',
          issuer: 'https://login.northwind.test',
          clientId: 'client-wxyz',
          clientSecret: 'sekrit',
          defaultWorkspaceRole: 'member'
        }
      })
    )
  })

  it('submits SAML with the metadata URL winning over pasted XML', async () => {
    const fields = await form()
    fireEvent.change(fields.getByRole('combobox', { name: 'Protocol' }), {
      target: { value: 'saml' }
    })
    await input(
      await fields.findByLabelText('Metadata URL'),
      'https://login.northwind.test/saml/metadata'
    )
    await input(fields.getByLabelText('Email domain'), 'northwind.test')
    await input(
      fields.getByLabelText('Or paste the metadata XML'),
      '<EntityDescriptor>…</EntityDescriptor>'
    )
    fireEvent.click(fields.getByRole('button', { name: 'Add connection' }))
    await waitFor(() =>
      expect(Api.createSsoConnectionServerFn).toHaveBeenCalledWith({
        data: {
          workspaceSlug: 'starter-lab',
          protocol: 'saml',
          domain: 'northwind.test',
          metadataUrl: 'https://login.northwind.test/saml/metadata',
          defaultWorkspaceRole: 'member'
        }
      })
    )
  })

  it('blocks SAML submission when neither metadata source is filled', async () => {
    const fields = await form()
    fireEvent.change(fields.getByRole('combobox', { name: 'Protocol' }), {
      target: { value: 'saml' }
    })
    await input(fields.getByLabelText('Email domain'), 'northwind.test')
    expect(
      await fields.findByText('Add the metadata URL or paste the metadata XML')
    ).not.toBeNull()
    fireEvent.click(fields.getByRole('button', { name: 'Add connection' }))
    expect(Api.createSsoConnectionServerFn).not.toHaveBeenCalled()
  })

  it('keeps the values when the create fails', async () => {
    vi.mocked(Api.createSsoConnectionServerFn).mockRejectedValue(
      new Error('The identity provider refused')
    )
    const fields = await oidc()
    fireEvent.click(fields.getByRole('button', { name: 'Add connection' }))
    expect(await fields.findByText('Failed to add the connection')).not.toBeNull()
    expect(fields.getByLabelText('Email domain')).toHaveProperty(
      'value',
      'northwind.test'
    )
  })
})
