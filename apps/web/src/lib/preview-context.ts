import { createContext, use } from 'react'

export const PreviewContext = createContext(false)

export function usePreview(): boolean {
  return use(PreviewContext)
}
