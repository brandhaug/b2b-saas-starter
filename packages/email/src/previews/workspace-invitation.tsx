import { WorkspaceInvitationEmail } from '../templates.tsx'

export default function Preview(props: Parameters<typeof WorkspaceInvitationEmail>[0]) {
  return <WorkspaceInvitationEmail {...Preview.PreviewProps} {...props} />
}

Preview.PreviewProps = {
  ...WorkspaceInvitationEmail.PreviewProps,
  workspaceName: 'Økonomi og internasjonalt samarbeid i Starter Lab',
  locale: 'nb'
} satisfies Parameters<typeof WorkspaceInvitationEmail>[0]
