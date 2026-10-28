import { execFileSync } from 'node:child_process'
import { expect, it } from 'vite-plus/test'

// Failure modes: the deployment SDK drops unknown Issues settings, or fails to
// translate query redaction, or strips trace settings from Worker uploads.
it('preserves native error tracking, query redaction, and tracing in the Worker upload metadata', () => {
  const encoded = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { Effect, Redacted } from 'effect';
    import { HttpClient } from 'effect/http';
    import { Credentials } from '@distilled.cloud/cloudflare/Credentials';
    import { putScript } from '@distilled.cloud/cloudflare/workers';
    const observability = {
      enabled: true,
      issues: { enabled: true },
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 1, persist: true }
    };
    const client = HttpClient.make((request) => Effect.sync(() => {
      const metadata = JSON.parse(request.body.formData.get('metadata'));
      process.stdout.write(JSON.stringify(metadata.observability));
      throw new Error('Upload captured; no network request');
    }));
    await Effect.runPromise(putScript({
      accountId: 'test-account', scriptName: 'test-worker', metadata: { observability }
    }).pipe(
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.provideService(Credentials, Effect.succeed({
        type: 'apiToken', apiToken: Redacted.make('test-token'),
        apiBaseUrl: 'https://api.cloudflare.com/client/v4'
      })),
      Effect.exit
    ));
  `
    ],
    { encoding: 'utf8' }
  )
  expect(JSON.parse(encoded)).toEqual({
    enabled: true,
    issues: { enabled: true },
    redact_query_string: true,
    logs: { enabled: true, invocation_logs: true, head_sampling_rate: 1 },
    traces: { enabled: true, head_sampling_rate: 1, persist: true }
  })
})
