import { createContext, use } from 'react'

/** The workspace a `/demo` preview renders inside; `null` outside a preview. */
export type PreviewWorkspace = { readonly slug: string; readonly name: string }

export const PreviewContext = createContext<PreviewWorkspace | null>(null)

export function usePreview(): boolean {
  return use(PreviewContext) !== null
}

export function usePreviewWorkspace(): PreviewWorkspace | null {
  return use(PreviewContext)
}
