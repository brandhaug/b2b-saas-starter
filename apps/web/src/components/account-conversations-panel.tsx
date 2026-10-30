import { useServerAction } from '@/hooks/use-server-action'
import { useQuery } from '@tanstack/react-query'
import { pageQueryOptions } from '@/lib/page-query'
import { type OwnedConversation } from '@/lib/server/account-conversations'
import { type ConversationResult } from '@/lib/server/assistant-conversations'
import { callConversation } from '@/lib/assistant-conversation-call'
import { formatTimestamp } from '@/lib/format-date'
import { Panel } from '@/components/page/panel'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel
} from '@/components/ui/alert-dialog'
import { m } from '@b2b-saas-starter/i18n/messages'

export function AccountConversationsPanel({
  userId,
  initial,
  load,
  remove
}: {
  readonly userId: string
  readonly load: () => Promise<ConversationResult<ReadonlyArray<OwnedConversation>>>
  readonly initial: ConversationResult<ReadonlyArray<OwnedConversation>>
  readonly remove: (input: {
    readonly data: { readonly conversationId: string }
  }) => Promise<ConversationResult<void>>
}) {
  const query = useQuery({
    ...pageQueryOptions(['account-conversations', userId], () =>
      callConversation(load)
    ),
    initialData: initial,
    gcTime: 0
  })
  const action = useServerAction(
    (conversationId: string) =>
      callConversation(() => remove({ data: { conversationId } })),
    {
      failureMessage: m.assistant_unreachable(),
      identityKey: userId,
      invalidate: false,
      onSuccess: async (result) => {
        if (result.ok) {
          await query.refetch()
        }
      }
    }
  )
  const error =
    action.error ??
    (action.result?.ok === false ? action.result.message : null) ??
    (query.data.ok ? null : query.data.message)
  const rows = query.data.ok ? query.data.value : []
  return (
    <Panel
      title={m.assistant_conversations_title()}
      description={m.assistant_conversations_account_description()}
    >
      <ActionFeedback error={error} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {m.assistant_conversations_empty()}
        </p>
      ) : null}
      <ul className="grid gap-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <div className="min-w-0 text-sm">
              <p className="break-all font-mono text-xs">{row.id}</p>
              <time dateTime={row.createdAt}>
                {formatTimestamp(row.createdAt, { dateStyle: 'short' })}
              </time>
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="outline" size="xs" disabled={action.pending} />
                }
              >
                {m.assistant_conversations_delete()}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  {m.assistant_conversations_delete_title()}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {m.assistant_conversations_delete_description()}
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={action.pending}
                    onClick={() => action.run(row.id)}
                  >
                    {m.assistant_conversations_delete()}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
