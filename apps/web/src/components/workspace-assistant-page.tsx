import { SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { WorkspaceShell } from '@/components/workspace-shell'
import { viewerCan } from '@/lib/permissions'
import { Spinner } from '@/components/ui/spinner'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import {
  ASSISTANT_UNCONFIGURED_MESSAGE,
  type AskAssistantOutcome,
  type AssistantPagePayload
} from '@/lib/server/assistant'

/**
 * The one server call this page makes, as a port. Injected rather than
 * imported at the call site so a test drives the transcript with a real
 * function of this shape instead of replacing the module it lives in.
 */
export type AskAssistant = (input: {
  readonly data: { readonly workspaceSlug: string; readonly question: string }
}) => Promise<AskAssistantOutcome>

type AssistantPageProvider = 'workers-ai' | 'openai-compatible' | 'mock'

const PROVIDER_LABELS = {
  'workers-ai': 'Workers AI',
  'openai-compatible': 'OpenAI-compatible',
  mock: 'Mock provider'
} satisfies Record<AssistantPageProvider, string>

type TranscriptEntry = {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  /** Set on assistant entries that carry a real provider reply. */
  readonly provider: AssistantPageProvider | null
}

function entry(
  role: TranscriptEntry['role'],
  text: string,
  provider: AssistantPageProvider | null = null
): TranscriptEntry {
  return { id: crypto.randomUUID(), role, text, provider }
}

function outcomeToEntry(outcome: AskAssistantOutcome): TranscriptEntry {
  return outcome.ok
    ? entry('assistant', outcome.answer, outcome.provider)
    : entry('assistant', outcome.message)
}

function TranscriptBody({
  canUseAssistant,
  transcript
}: {
  readonly canUseAssistant: boolean
  readonly transcript: readonly TranscriptEntry[]
}) {
  if (transcript.length > 0) {
    return (
      <ol className="grid gap-3" aria-label="Conversation">
        {transcript.map((item) => (
          <TranscriptBubble key={item.id} item={item} />
        ))}
      </ol>
    )
  }
  if (canUseAssistant) {
    return (
      <p className="text-muted-foreground text-sm">
        Ask a question about this workspace. Answers come from the model configured on
        this deployment.
      </p>
    )
  }
  return null
}

function TranscriptBubble({ item }: { readonly item: TranscriptEntry }) {
  const isUser = item.role === 'user'
  return (
    <li className="grid gap-1">
      <div className="text-muted-foreground text-xs font-medium">
        {isUser ? 'You' : 'Assistant'}
      </div>
      <div
        className={
          isUser
            ? 'rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap'
            : 'rounded-md border border-border px-3 py-2 text-sm whitespace-pre-wrap'
        }
      >
        {item.text}
        {item.provider ? (
          <span className="text-muted-foreground mt-2 block text-xs">
            {PROVIDER_LABELS[item.provider]}
          </span>
        ) : null}
      </div>
    </li>
  )
}

/**
 * The per-workspace assistant chat. One question in flight at a time: the
 * submit button disables while the server function runs, and both sides of an
 * outcome land in the transcript as values — `ok: false` renders its honest
 * message inline instead of failing the page.
 */
export function WorkspaceAssistantPage({
  workspaceSlug,
  data,
  ask
}: {
  readonly workspaceSlug: string
  readonly data: AssistantPagePayload
  readonly ask: AskAssistant
}) {
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>([])

  // Presentation gate, mirroring the loader's hard gate: when no provider is
  // configured the form is absent and the honest copy stands in for it.
  const canUseAssistant =
    data.configured && viewerCan(data.viewer, { assistant: ['read'] })

  async function submit() {
    const trimmed = question.trim()
    if (trimmed.length === 0 || pending) return
    setPending(true)
    setQuestion('')
    setTranscript((entries) => [...entries, entry('user', trimmed)])
    // The ask port resolves with an outcome value (both sides are values, not
    // rejections), but a transport-level rejection still has to re-enable the
    // form — hence the catch that degrades into a transcript entry.
    const outcomeOrRejection = await ask({
      data: { workspaceSlug, question: trimmed }
    }).then(
      (outcome) => outcome,
      () => null
    )
    setPending(false)
    // `null` is the transport-level rejection branch: degrade into a
    // transcript entry instead of leaving the question hanging.
    setTranscript((entries) => [
      ...entries,
      outcomeOrRejection === null
        ? entry('assistant', 'The assistant could not be reached. Try again.')
        : outcomeToEntry(outcomeOrRejection)
    ])
  }

  return (
    <WorkspaceShell
      title="AI assistant"
      description="Ask about this workspace"
      workspaceSlug={workspaceSlug}
    >
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <SparklesIcon className="size-5" />
            Assistant
            {canUseAssistant ? (
              <Badge variant="secondary">Connected</Badge>
            ) : (
              <Badge variant="outline">Not enabled</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <TranscriptBody canUseAssistant={canUseAssistant} transcript={transcript} />
          {canUseAssistant ? (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <Textarea
                aria-label="Your question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="e.g. Summarize what changed recently"
                disabled={pending}
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={pending || question.trim().length === 0}
                >
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  Ask
                </Button>
              </div>
            </form>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>{ASSISTANT_UNCONFIGURED_MESSAGE}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </WorkspaceShell>
  )
}
