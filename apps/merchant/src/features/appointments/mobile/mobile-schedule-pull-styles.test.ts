import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('mobile schedule pull surface styling', () => {
  it('morphs continuously from flat content into a rounded sheet', async () => {
    const styles = await readFile(
      new URL('../../../index.css', import.meta.url),
      'utf8'
    )

    expect(styles).toContain(
      'calc(2.5rem * var(--merchant-schedule-pull-reveal-progress))'
    )
    expect(styles).toContain(
      'calc(var(--merchant-schedule-pull-reveal-progress) * 82%)'
    )
    expect(styles).toContain(
      'calc(100% + 2.5rem - 1rem * var(--merchant-schedule-pull-progress))'
    )
    expect(styles).toContain(
      'calc(-1.25rem + 0.5rem * var(--merchant-schedule-pull-progress))'
    )
    expect(styles).toContain('.merchant-mobile-schedule-pull-content')
    expect(styles).toContain(
      '--merchant-schedule-content-inline: calc(\n    1.25rem - 0.5rem * var(--merchant-schedule-pull-progress)\n  )'
    )
    expect(styles).toContain(
      'width: calc(100% + 2 * var(--merchant-schedule-content-inline))'
    )
    expect(styles).toContain(
      'margin-inline-start: calc(-1 * var(--merchant-schedule-content-inline))'
    )
    expect(styles).toContain('.merchant-mobile-home-action-group')
    expect(styles).toContain(
      'calc(100% - (100% - 14.5rem) * var(--merchant-schedule-pull-progress))'
    )
    expect(styles).not.toContain(
      ".merchant-mobile-schedule-pull-surface:not([data-mobile-schedule-pull-state='closed'])"
    )
  })
})
