import { type ConversationAdmissionLedger } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-admission'
import { Effect, Schema } from 'effect'
import {
  ConversationAttempt,
  ConversationQuestion,
  ConversationUnavailable,
  type ConversationAcceptance
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'

import { type TranscriptQuestionPage } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-transcript'

const decodeJsonRow = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.String }))

/** Application acceptance and terminal state share the conversation's SQLite transaction. */
export class ConversationLedger implements ConversationAdmissionLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS assistant_questions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_attempts (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, question_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, input TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assistant_attempt_question ON assistant_attempts(question_id,sequence);
      CREATE INDEX IF NOT EXISTS assistant_attempt_status ON assistant_attempts(status,sequence);
      CREATE TABLE IF NOT EXISTS assistant_acceptance_keys (key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, attempt_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_pending_output (id INTEGER PRIMARY KEY CHECK(id=1), attempt_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_identity (id INTEGER PRIMARY KEY CHECK(id=1), conversation_id TEXT NOT NULL);`)
  }

  private read<A>(
    schema: Schema.Codec<A>,
    query: string,
    ...bindings: Array<SqlStorageValue>
  ) {
    return Effect.try({
      try: () =>
        this.storage.sql
          .exec(query, ...bindings)
          .toArray()
          .map((row) =>
            Schema.decodeUnknownSync(Schema.fromJsonString(schema))(
              decodeJsonRow(row).data
            )
          ),
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    })
  }

  identity() {
    return Effect.try({
      try: () =>
        this.storage.sql
          .exec<{ conversation_id: string }>(
            'SELECT conversation_id FROM assistant_identity WHERE id=1'
          )
          .toArray()[0]?.conversation_id ?? null,
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    })
  }

  bind(conversationId: string) {
    return Effect.try({
      try: () =>
        this.storage.sql.exec(
          'INSERT OR IGNORE INTO assistant_identity VALUES(1,?)',
          conversationId
        ),
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    }).pipe(Effect.asVoid)
  }

  attempt(id: string) {
    return this.read(
      ConversationAttempt,
      'SELECT data FROM assistant_attempts WHERE id=?',
      id
    ).pipe(Effect.map((rows) => rows[0] ?? null))
  }

  active() {
    return this.read(
      ConversationAttempt,
      "SELECT data FROM assistant_attempts WHERE status IN ('Accepted','Running') ORDER BY sequence DESC LIMIT 1"
    ).pipe(Effect.map((rows) => rows[0] ?? null))
  }

  pendingOutput() {
    return this.read(
      ConversationAttempt,
      'SELECT data FROM assistant_attempts WHERE id=(SELECT attempt_id FROM assistant_pending_output WHERE id=1)'
    ).pipe(Effect.map((rows) => rows[0] ?? null))
  }

  latestAttempt() {
    return this.read(
      ConversationAttempt,
      'SELECT data FROM assistant_attempts ORDER BY sequence DESC LIMIT 1'
    ).pipe(Effect.map((rows) => rows[0] ?? null))
  }

  finishOutput(attemptId: string) {
    return Effect.try({
      try: () =>
        this.storage.sql.exec(
          'DELETE FROM assistant_pending_output WHERE attempt_id=?',
          attemptId
        ),
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    }).pipe(Effect.asVoid)
  }

  question(id: string) {
    return this.read(
      ConversationQuestion,
      'SELECT data FROM assistant_questions WHERE id=?',
      id
    ).pipe(Effect.map((rows) => rows[0] ?? null))
  }

  questions(page?: TranscriptQuestionPage) {
    if (page === undefined) {
      return this.read(
        ConversationQuestion,
        'SELECT data FROM assistant_questions ORDER BY sequence'
      )
    }
    const query =
      page.before === null
        ? this.read(
            ConversationQuestion,
            'SELECT data FROM assistant_questions ORDER BY sequence DESC LIMIT ?',
            page.limit
          )
        : this.read(
            ConversationQuestion,
            'SELECT data FROM assistant_questions WHERE sequence < (SELECT sequence FROM assistant_questions WHERE id=?) ORDER BY sequence DESC LIMIT ?',
            page.before,
            page.limit
          )
    return query.pipe(Effect.map((rows) => rows.toReversed()))
  }

  firstQuestion() {
    return this.read(
      ConversationQuestion,
      'SELECT data FROM assistant_questions ORDER BY sequence LIMIT 1'
    ).pipe(Effect.map((rows) => rows[0] ?? null))
  }

  attempts(questionIds?: ReadonlyArray<string>) {
    if (questionIds === undefined) {
      return this.read(
        ConversationAttempt,
        'SELECT data FROM assistant_attempts ORDER BY sequence'
      )
    }
    return this.read(
      ConversationAttempt,
      'SELECT data FROM assistant_attempts WHERE question_id IN (SELECT value FROM json_each(?)) ORDER BY sequence',
      JSON.stringify(questionIds)
    )
  }

  recentFailures() {
    return this.read(
      ConversationAttempt,
      "SELECT data FROM assistant_attempts WHERE status IN ('Interrupted','Stopped') ORDER BY sequence DESC LIMIT 3"
    ).pipe(Effect.map((rows) => rows.toReversed()))
  }

  completedCount() {
    return Effect.try({
      try: () =>
        this.storage.sql
          .exec<{ count: number }>(
            "SELECT count(DISTINCT question_id) AS count FROM assistant_attempts WHERE status='Completed'"
          )
          .toArray()[0]?.count ?? 0,
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    })
  }

  completed(page: TranscriptQuestionPage) {
    let before = ''
    const bindings: Array<string | number> = []
    if (page.before !== null) {
      before =
        'WHERE q.sequence < (SELECT sequence FROM assistant_questions WHERE id=?)'
      bindings.push(page.before)
    }
    bindings.push(page.limit)
    return this.read(
      Schema.Struct({ question: ConversationQuestion, attempt: ConversationAttempt }),
      `SELECT json_object('question',json(q.data),'attempt',json(a.data)) AS data
       FROM assistant_questions q JOIN assistant_attempts a ON a.sequence =
         (SELECT min(sequence) FROM assistant_attempts WHERE question_id=q.id AND status='Completed')
       ${before}
       ORDER BY q.sequence DESC LIMIT ?`,
      ...bindings
    ).pipe(Effect.map((rows) => rows.toReversed()))
  }

  previous(key: string) {
    return Effect.gen({ self: this }, function* () {
      const rows = yield* Effect.try({
        try: () =>
          this.storage.sql
            .exec<{ payload_hash: string; attempt_id: string }>(
              'SELECT payload_hash,attempt_id FROM assistant_acceptance_keys WHERE key=?',
              key
            )
            .toArray(),
        catch: () => new ConversationUnavailable({ reason: 'storage' })
      })
      const row = rows[0]
      if (!row) {
        return null
      }
      const attempt = yield* this.attempt(row.attempt_id)
      if (!attempt) {
        return yield* new ConversationUnavailable({ reason: 'storage' })
      }
      const question = yield* this.question(attempt.questionId)
      if (!question) {
        return yield* new ConversationUnavailable({ reason: 'storage' })
      }
      return {
        payloadHash: row.payload_hash,
        acceptance: { question, attempt, joined: true }
      }
    })
  }

  input<A>(id: string, schema: Schema.Codec<A>) {
    return this.read(
      schema,
      'SELECT input AS data FROM assistant_attempts WHERE id=?',
      id
    ).pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.fail(new ConversationUnavailable({ reason: 'storage' }))
          : Effect.succeed(rows[0])
      )
    )
  }

  accept(input: {
    readonly key: string
    readonly hash: string
    readonly acceptance: ConversationAcceptance
    readonly execution: unknown
  }) {
    return Effect.try({
      try: () =>
        this.storage.transactionSync(() => {
          const { question, attempt } = input.acceptance
          this.storage.sql.exec(
            'INSERT OR IGNORE INTO assistant_questions(id,data) VALUES(?,?)',
            question.id,
            JSON.stringify(question)
          )
          this.storage.sql.exec(
            'INSERT INTO assistant_attempts(id,question_id,status,data,input) VALUES(?,?,?,?,?)',
            attempt.id,
            question.id,
            attempt.status,
            JSON.stringify(attempt),
            JSON.stringify(input.execution)
          )
          this.storage.sql.exec(
            'INSERT INTO assistant_acceptance_keys VALUES(?,?,?)',
            input.key,
            input.hash,
            attempt.id
          )
        }),
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    })
  }

  update(attempt: ConversationAttempt) {
    return Effect.try({
      try: () =>
        this.storage.transactionSync(() => {
          const changed =
            this.storage.sql
              .exec(
                "UPDATE assistant_attempts SET status=?,data=? WHERE id=? AND status IN ('Accepted','Running') RETURNING data",
                attempt.status,
                JSON.stringify(attempt),
                attempt.id
              )
              .toArray().length > 0
          if (changed && attempt.status === 'Running') {
            this.storage.sql.exec(
              'INSERT OR IGNORE INTO assistant_pending_output VALUES(1,?)',
              attempt.id
            )
          }
          return changed
        }),
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    })
  }
}
