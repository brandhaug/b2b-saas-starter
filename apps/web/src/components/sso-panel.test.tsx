import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { SsoPanel, type SsoPanelPorts } from '@/components/sso-panel'
import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { type SsoTestResult } from '@/lib/server/workspace-sso'
import { type Viewer } from '@/lib/permissions'

// The panel takes its server calls as ports, so a test drives it with plain
// functions instead of replacing the module the production defaults import.

const OWNER: Viewer = { role: 'owner' }
const MEMBER: Viewer = { role: 'member' }

const disabledExample: SsoConnection = {
  id: 'sso_example_oidc',
  protocol: 'oidc',
  domain: 'acme-corp.example',
  issuer: 'https://login.acme-corp.example',
  enabled: false,
  requireSso: false,
  defaultWorkspaceRole: 'member',
  clientIdLastFour: '7f2a',
  createdAt: '2026-05-15T09:30:00.000Z'
}

/** A test's answer from the test port; the failed verdict is the common one. */
const failedTest: SsoTestResult = {
  outcome: 'failed',
  code: 'discovery_unreachable',
  message: 'no such issuer'
}

/** Records every call; each port answers a representative success. */
function recordingPorts({
  testResult = failedTest,
  createRejects = false
}: {
  readonly testResult?: SsoTestResult
  readonly createRejects?: boolean
} = {}) {
  const calls = {
    create: new Array<unknown>(),
    update: new Array<unknown>(),
    remove: new Array<unknown>(),
    test: new Array<unknown>()
  }
  const ports: SsoPanelPorts = {
    create: (input) => {
      calls.create.push(input)
      if (createRejects) {
        return Promise.reject(new Error('The identity provider refused'))
      }
      return Promise.resolve({
        ...disabledExample,
        id: 'sso_new',
        domain: input.domain
      })
    },
    update: (input) => {
      calls.update.push(input)
      // Only the fields the assertion reads come back; the panel never uses
      // this value, so a partial echo is enough for the double.
      return Promise.resolve(disabledExample)
    },
    remove: (input) => {
      calls.remove.push(input)
      return Promise.resolve(true)
    },
    test: (input) => {
      calls.test.push(input)
      return Promise.resolve(testResult)
    }
  }
  return { ports, calls }
}

async function renderPanel(
  connections: ReadonlyArray<SsoConnection> = [disabledExample],
  viewer: Viewer = OWNER,
  portsOptions: Parameters<typeof recordingPorts>[0] = {}
) {
  const { ports, calls } = recordingPorts(portsOptions)
  const rendered = await renderWithRouter(
    <SsoPanel
      workspaceSlug="starter-lab"
      connections={connections}
      ports={ports}
      viewer={viewer}
    />,
    { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
  )
  if (connections.length === 0) {
    await screen.findByText('No SSO connections yet')
  } else {
    await screen.findByText('acme-corp.example')
  }
  return { ...rendered, calls }
}

describe('SsoPanel', () => {
  it('shows the connection with its write-only credential echo', async () => {
    await renderPanel()
    // The provider id renders too — owners copy it into their IdP config.
    expect(screen.getByText('sso_example_oidc')).toBeTruthy()
    expect(screen.getByText('OIDC')).toBeTruthy()
    expect(screen.getByText(/client …7f2a/)).toBeTruthy()
    expect(screen.getByText(/joins as member/)).toBeTruthy()
    screen.getByRole('button', { name: 'Test' })
    screen.getByRole('button', { name: 'Enable' })
    screen.getByRole('button', { name: 'Remove acme-corp.example' })
    screen.getByRole('switch')
  })

  it('reports a failed test inline', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Connection test failed.')).toBeTruthy()
    expect(await screen.findByText('no such issuer')).toBeTruthy()
  })

  it('reports a passed test without a failure message', async () => {
    await renderPanel([disabledExample], OWNER, {
      testResult: { outcome: 'passed' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Connection test passed.')).toBeTruthy()
    expect(screen.queryByText('Connection test failed.')).toBeNull()
  })

  it('enable toggles call the update port with the flip', async () => {
    const { calls } = await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(calls.update).toHaveLength(1))
    expect(calls.update[0]).toMatchObject({
      workspaceSlug: 'starter-lab',
      providerId: 'sso_example_oidc',
      enabled: true
    })
  })

  it('flipping require-SSO updates the toggle flag', async () => {
    const { calls } = await renderPanel()
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(calls.update).toHaveLength(1))
    expect(calls.update[0]).toMatchObject({ requireSso: true })
  })

  it('replaces the controls with a reason when the viewer cannot manage', async () => {
    const { calls } = await renderPanel([disabledExample], MEMBER)
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add connection' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Remove acme-corp.example' })
    ).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    screen.getByText(/Your role cannot change single sign-on/)
    expect(calls.create).toHaveLength(0)
    expect(calls.update).toHaveLength(0)
  })

  it('submits an OIDC connection with the form’s fields', async () => {
    const { calls } = await renderPanel([])
    fireEvent.change(await screen.findByLabelText('Email domain'), {
      target: { value: 'northwind.test' }
    })
    fireEvent.change(screen.getByLabelText('Issuer'), {
      target: { value: 'https://login.northwind.test' }
    })
    fireEvent.change(screen.getByLabelText('Client ID'), {
      target: { value: 'client-wxyz' }
    })
    fireEvent.change(screen.getByLabelText('Client secret'), {
      target: { value: 'sekrit' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    await waitFor(() => expect(calls.create).toHaveLength(1))
    expect(calls.create[0]).toMatchObject({
      workspaceSlug: 'starter-lab',
      protocol: 'oidc',
      domain: 'northwind.test',
      issuer: 'https://login.northwind.test',
      clientId: 'client-wxyz',
      clientSecret: 'sekrit',
      defaultWorkspaceRole: 'member'
    })
  })

  it('submits a SAML connection with the metadata URL winning over pasted XML', async () => {
    const { calls } = await renderPanel([])
    fireEvent.click(screen.getByText('SAML'))
    fireEvent.change(await screen.findByLabelText('Email domain'), {
      target: { value: 'northwind.test' }
    })
    fireEvent.change(screen.getByLabelText('Metadata URL'), {
      target: { value: 'https://login.northwind.test/saml/metadata' }
    })
    fireEvent.change(screen.getByLabelText('Or paste the metadata XML'), {
      target: { value: '<EntityDescriptor>…</EntityDescriptor>' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    await waitFor(() => expect(calls.create).toHaveLength(1))
    // The URL wins whole: no metadataXml key rides along (the server schema
    // demands exactly one source).
    expect(calls.create[0]).toEqual({
      workspaceSlug: 'starter-lab',
      protocol: 'saml',
      domain: 'northwind.test',
      metadataUrl: 'https://login.northwind.test/saml/metadata',
      defaultWorkspaceRole: 'member'
    })
  })

  it('blocks SAML submission when neither metadata source is filled', async () => {
    const { calls } = await renderPanel([])
    fireEvent.click(screen.getByText('SAML'))
    fireEvent.change(await screen.findByLabelText('Email domain'), {
      target: { value: 'northwind.test' }
    })
    expect(
      await screen.findByText('Add the metadata URL or paste the metadata XML')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    // One macrotask so a wrongly-fired submit would have reached the port.
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(calls.create).toHaveLength(0)
  })

  it('keeps the values when the create fails', async () => {
    await renderPanel([], OWNER, { createRejects: true })
    fireEvent.change(screen.getByLabelText('Email domain'), {
      target: { value: 'northwind.test' }
    })
    fireEvent.change(screen.getByLabelText('Issuer'), {
      target: { value: 'https://login.northwind.test' }
    })
    fireEvent.change(screen.getByLabelText('Client ID'), {
      target: { value: 'client-wxyz' }
    })
    fireEvent.change(screen.getByLabelText('Client secret'), {
      target: { value: 'sekrit' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    expect(await screen.findByText('The identity provider refused')).toBeTruthy()
    expect(screen.getByLabelText('Email domain')).toHaveProperty(
      'value',
      'northwind.test'
    )
  })
})
