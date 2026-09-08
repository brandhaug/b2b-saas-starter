import { test as teardown } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { removeBrowserTestPasskeys } from './authentication-cleanup'

teardown('removes disposable browser passkeys after the suite', () => {
  teardown.skip(!hasLocalD1State(), 'requires local D1')
  removeBrowserTestPasskeys()
})
