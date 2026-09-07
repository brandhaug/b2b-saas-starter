import { describe, expect, it } from '@effect/vitest'

import {
  renderNotificationEvent,
  type SystemNotificationEvent
} from './notification-events.ts'

describe('system notification events', () => {
  it('renders the same historical event in the recipient locale', () => {
    const event = {
      type: 'account.impersonated',
      adminName: 'Martin Brandhaug',
      minutes: 60
    } satisfies SystemNotificationEvent

    const english = renderNotificationEvent(event, 'en')
    const bokmal = renderNotificationEvent(event, 'nb')

    expect(english.title).toBe('A System Admin accessed your account')
    expect(english.message).toContain('Martin Brandhaug')
    expect(bokmal.title).toBe('En systemadministrator åpnet kontoen din')
    expect(bokmal.message).toContain('60 minutter')
    expect(bokmal).not.toEqual(english)
  })
})
