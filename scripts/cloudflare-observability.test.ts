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
    import { createRequire } from 'node:module';
    import { Schema } from 'effect';
    const alchemy = createRequire(import.meta.resolve('alchemy'));
    const { PutScriptMetadataObservability } = await import(alchemy.resolve('@distilled.cloud/cloudflare/workers'));
    const encoded = Schema.encodeSync(PutScriptMetadataObservability)({
      enabled: true,
      issues: { enabled: true },
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 1, persist: true }
    });
    process.stdout.write(JSON.stringify(encoded));
  `
    ],
    { encoding: 'utf8' }
  )
  expect(JSON.parse(encoded)).toEqual({
    enabled: true,
    issues: { enabled: true },
    redactQueryString: true,
    logs: { enabled: true, invocationLogs: true, headSamplingRate: 1 },
    traces: { enabled: true, headSamplingRate: 1, persist: true }
  })
})
