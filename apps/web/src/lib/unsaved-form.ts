/** Track edits without reading or retaining field values, which may be secrets. */
const editedForms = new Set<HTMLFormElement>()

function recordEdit(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLElement) || target.closest('[data-locale-control]')) {
    return
  }
  const form = target.closest('form')
  if (form) {
    editedForms.add(form)
  }
}

function recordReset(event: Event) {
  if (event.target instanceof HTMLFormElement) {
    editedForms.delete(event.target)
  }
}

export function trackFormEdits(): () => void {
  // Each registration needs its own listener identities for independent cleanup.
  const onEdit = recordEdit.bind(undefined)
  const onReset = recordReset.bind(undefined)
  document.addEventListener('input', onEdit, true)
  document.addEventListener('change', onEdit, true)
  document.addEventListener('reset', onReset, true)
  return () => {
    document.removeEventListener('input', onEdit, true)
    document.removeEventListener('change', onEdit, true)
    document.removeEventListener('reset', onReset, true)
    editedForms.clear()
  }
}

export function hasEditedForms(except?: HTMLFormElement): boolean {
  for (const form of editedForms) {
    if (form === except) {
      continue
    }
    if (form.isConnected) {
      return true
    }
    editedForms.delete(form)
  }
  return false
}
