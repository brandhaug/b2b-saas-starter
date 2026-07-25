// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useMobileSurfaceChrome } from './use-mobile-surface-chrome.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

function SurfaceChrome({ dimmed }: { readonly dimmed: boolean }) {
  useMobileSurfaceChrome(dimmed)
  return null
}

const themeColors = () =>
  Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  ).map((meta) => meta.content)

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-merchant-time-theme')
  document.body.innerHTML = ''
})

describe('useMobileSurfaceChrome', () => {
  it('keeps installed chrome synchronized with the dynamic home surface', async () => {
    document.head.innerHTML = `
      <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
      <meta name="theme-color" content="#171717" media="(prefers-color-scheme: dark)">
    `
    document.documentElement.style.setProperty(
      '--merchant-home-surface',
      'rgb(255 247 237)'
    )
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root?.render(<SurfaceChrome dimmed={false} />))
    expect(themeColors()).toEqual(['rgb(255 247 237)', 'rgb(255 247 237)'])

    document.documentElement.style.setProperty(
      '--merchant-home-surface',
      'rgb(17 23 32)'
    )
    await act(async () => {
      document.documentElement.dataset.merchantTimeTheme = 'night'
      await Promise.resolve()
    })
    expect(themeColors()).toEqual(['rgb(17 23 32)', 'rgb(17 23 32)'])

    await act(async () => root?.render(<SurfaceChrome dimmed />))
    expect(themeColors()).toEqual(['#000000', '#000000'])
  })
})
