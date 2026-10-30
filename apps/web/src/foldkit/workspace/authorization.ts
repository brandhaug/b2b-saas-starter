import { viewerCan } from '@/lib/permissions'
import { type Action, type Model } from './model'

/** Presentation gates share the capability permission matrix; server calls recheck. */
export function allowed(model: Model, action: Action): boolean {
  const viewer = model.page.data.viewer
  switch (action._tag) {
    case 'Invite':
    case 'ResendInvitation': {
      return viewerCan(viewer, { invitation: ['create'] })
    }
    case 'CancelInvitation': {
      return viewerCan(viewer, { invitation: ['cancel'] })
    }
    case 'Role': {
      return viewerCan(viewer, { member: ['update'] })
    }
    case 'RemoveMember': {
      return viewerCan(viewer, { member: ['delete'] })
    }
    case 'Rename':
    case 'Checkout':
    case 'Reconcile':
    case 'SelectResources': {
      return viewerCan(viewer, { organization: ['update'] })
    }
    case 'Portal': {
      return model.page._tag === 'suspended'
        ? model.page.data.canManageBilling
        : viewerCan(viewer, { organization: ['update'] })
    }
    case 'DeleteWorkspace': {
      return viewerCan(viewer, { organization: ['delete'] })
    }
    case 'Export':
    case 'DownloadExport': {
      return model.page._tag === 'settings' && model.page.data.exports !== null
    }
    case 'CreateSso': {
      return viewerCan(viewer, { sso: ['create'] })
    }
    case 'TestSso':
    case 'UpdateSso': {
      return viewerCan(viewer, { sso: ['update'] })
    }
    case 'RemoveSso': {
      return viewerCan(viewer, { sso: ['remove'] })
    }
    case 'CreateToken': {
      return viewerCan(viewer, { apiToken: ['create'] })
    }
    case 'ReplaceToken': {
      return (
        viewerCan(viewer, { apiToken: ['create'] }) &&
        viewerCan(viewer, { apiToken: ['revoke'] })
      )
    }
    case 'RevokeToken': {
      return viewerCan(viewer, { apiToken: ['revoke'] })
    }
    case 'CreateWebhook': {
      return viewerCan(viewer, { webhook: ['create'] })
    }
    case 'SaveWebhook':
    case 'ToggleWebhook': {
      return viewerCan(viewer, { webhook: ['update'] })
    }
    case 'RotateWebhook': {
      return viewerCan(viewer, { webhook: ['rotateSecret'] })
    }
    case 'ReplayWebhook':
    case 'TestWebhook': {
      return viewerCan(viewer, { webhook: ['replay'] })
    }
    case 'Attempts': {
      return viewerCan(viewer, { webhook: ['list'] })
    }
    case 'DismissChecklist': {
      return viewerCan(viewer, { onboarding: ['dismiss'] })
    }
    case 'Investigate':
    case 'ReadTask': {
      return (
        viewerCan(viewer, { assistant: ['read'] }) &&
        viewerCan(viewer, { webhook: ['list'] })
      )
    }
    case 'ApproveTask':
    case 'CancelTask': {
      return (
        viewerCan(viewer, { assistant: ['read'] }) &&
        viewerCan(viewer, { webhook: ['replay'] })
      )
    }
    case 'ListConversations':
    case 'CreateConversation':
    case 'History':
    case 'Send':
    case 'RetryAnswer':
    case 'StopAnswer':
    case 'DeleteConversation': {
      return viewerCan(viewer, { assistant: ['read'] })
    }
    case 'Leave':
    case 'MarkRead':
    case 'Refresh': {
      return true
    }
  }
}
export function allowedDialog(model: Model, dialog: string): boolean {
  switch (dialog) {
    case 'invite': {
      return allowed(model, { _tag: 'Invite', retry: false })
    }
    case 'token': {
      return allowed(model, { _tag: 'CreateToken' })
    }
    case 'webhook': {
      return model.webhooks.editing
        ? allowed(model, { _tag: 'SaveWebhook', id: model.webhooks.editing })
        : allowed(model, { _tag: 'CreateWebhook' })
    }
    case 'sso': {
      return allowed(model, { _tag: 'CreateSso' })
    }
    default: {
      return true
    }
  }
}
