import { useState } from 'react'
import { type OwnedConversation } from '@/lib/server/account-conversations'
import { type ConversationResult } from '@/lib/server/assistant-conversations'
import { callConversation } from '@/lib/assistant-conversation-call'
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
  initial,
  remove
}: {
  readonly initial: ConversationResult<ReadonlyArray<OwnedConversation>>
  readonly remove: (input: {
    readonly data: { readonly conversationId: string }
  }) => Promise<ConversationResult<void>>
}) {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set())
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(initial.ok ? null : initial.message)
  const rows = initial.ok ? initial.value.filter((row) => !removed.has(row.id)) : []
  async function deleteOwned(conversationId: string) {
    setPending(conversationId)
    const result = await callConversation(() => remove({ data: { conversationId } }))
    setPending(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    setRemoved((current) => new Set([...current, conversationId]))
  }
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
              <time dateTime={row.createdAt}>{row.createdAt.slice(0, 10)}</time>
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="outline" size="xs" disabled={pending !== null} />
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
                  <AlertDialogAction onClick={() => void deleteOwned(row.id)}>
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
