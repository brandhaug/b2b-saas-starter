import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { SectionTabs } from './section-tabs'
import { CreateAction } from './panel'
import { renderWithRouter } from '@/test/router-harness'

const sections = [
  {
    value: 'general',
    label: 'General',
    content: (
      <Label>
        Name
        <Input aria-label="Name" />
      </Label>
    )
  },
  { value: 'sso', label: 'Single sign-on', content: <p>Identity providers</p> }
]

describe('shareable workspace views', () => {
  it('opens the linked tab, preserves form edits and restores the tab with Back', async () => {
    const { router } = await renderWithRouter(
      <SectionTabs defaultValue="general" sections={sections} />,
      {
        path: '/settings',
        initialEntry: '/settings?tab=sso'
      }
    )
    expect(
      screen.getByRole('tab', { name: 'Single sign-on' }).getAttribute('aria-selected')
    ).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'General' }))
    await waitFor(() => expect(router.state.location.search.tab).toBe('general'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Operations' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Single sign-on' }))
    await waitFor(() => expect(router.state.location.search.tab).toBe('sso'))
    router.history.back()
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')
      ).toBe('true')
    )
    expect(screen.getByDisplayValue('Operations')).toBeTruthy()
  })

  it('opens a linked creation form only when permitted', async () => {
    await renderWithRouter(
      <CreateAction
        action="invite"
        title="Invite member"
        allowed={false}
        deniedReason="Ask an owner"
      >
        <p>Invitation form</p>
      </CreateAction>,
      {
        path: '/members',
        initialEntry: '/members?action=invite'
      }
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Ask an owner')).toBeTruthy()
  })

  it('opens a creation form directly from its URL', async () => {
    await renderWithRouter(
      <CreateAction action="invite" title="Invite member">
        <p>Invitation form</p>
      </CreateAction>,
      {
        path: '/members',
        initialEntry: '/members?action=invite'
      }
    )
    expect(await screen.findByRole('dialog', { name: 'Invite member' })).toBeTruthy()
  })
})
