import { useEffect } from 'react'

/** Capture before control handlers run, including controls rendered in portals. */
export function InteractionModality() {
  useEffect(() => {
    const root = document.documentElement
    function recordInput(event: Event) {
      const modality = event.type === 'keydown' ? 'keyboard' : 'pointer'
      if (root.dataset.inputModality !== modality) {
        root.dataset.inputModality = modality
      }
    }
    document.addEventListener('keydown', recordInput, true)
    document.addEventListener('pointerdown', recordInput, true)
    return () => {
      document.removeEventListener('keydown', recordInput, true)
      document.removeEventListener('pointerdown', recordInput, true)
      delete root.dataset.inputModality
    }
  }, [])
  return null
}
