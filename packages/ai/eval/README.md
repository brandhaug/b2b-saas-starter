# Assistant instruction evaluations

This runner calls the production `AssistantLive` service and `makeOpenAIModel`
adapter. It imports `assistantInstructions` for the recorded identity; inference
uses that same function through `AssistantLive`. Standard tests use explicit wire
stubs and verify the runner, not model quality.

## Run and compare

Use authorized OpenAI credentials in `OPENAI_API_KEY`. The CLI requires `--paid`
and refuses CI. Choose a dated model snapshot supported by the existing chat
adapter. It sends 4096 `max_tokens`, with no temperature or seed override, no
automatic retries and the production 60-second deadline per sample.

From the repository root, establish a baseline **before** changing instructions:

```sh
pnpm -C packages/ai eval:instructions --paid --establish-baseline \
  --model gpt-4o-mini-2024-07-18 --samples 3 --out ../../.context/assistant-baseline.json
```

After changing instructions, run the same model, cases and settings:

```sh
pnpm -C packages/ai eval:instructions --paid \
  --baseline ../../.context/assistant-baseline.json \
  --model gpt-4o-mini-2024-07-18 --samples 3 --out ../../.context/assistant-candidate.json
```

Paths are relative to `packages/ai`. Output parents must exist and output files
must be new. No root script or CI job invokes this command. Default sampling is
three repetitions of five cases, or 15 paid requests per run. The runner allows
2–100 repetitions; estimate provider charges before choosing a larger run.

The baseline check compares provider, endpoint, exact model ID, output limit,
sampling policy, repetition count, exact case inputs/rubrics and an adapter/lockfile
SHA-256 digest. Only instructions may differ. Malformed, missing, duplicated or
failed baseline samples are rejected before inference. Changing transport code or
the dependency lockfile requires a new baseline. A moving model alias can change
server-side behavior without changing its ID; prefer a pinned snapshot.

## Evidence and review

`cases.ts` links each synthetic regression and ordinary control to the pinned
production instruction contract. These are contract-derived failure scenarios,
not reproduced observations of an actual paid model. Add a source and rubric when
adding a real observed failure.

The JSON records exact instructions, cases, model/settings and every repeated
answer or safe failure marker. A comparison copies the validated baseline beside
the candidate. The adjacent `.review.md` supplies case rubrics for human pass/fail
decisions and comparison notes. Review every repetition, including controls; do
not infer success from one favorable answer. Record regressions, improvements and
actual billed cost in that review. The production stateless adapter does not expose
token usage or billing, so the runner records cost as unknown rather than estimates.

Provider errors remain evidence and cause a nonzero exit. An interrupted process
leaves a `started; incomplete` marker rather than a usable baseline; completed
samples are currently saved only when the run finishes. Quality remains pending
until human review. This runner neither scores with a second model nor blinds
review order. Model behavior cannot establish authorization or execution safety.

Without authorized credentials, record **paid evaluation unverified** and run:

```sh
pnpm -C packages/ai test
pnpm -C packages/ai typecheck
vp lint --type-aware packages/ai
```
