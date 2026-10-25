import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mdx from '@mdx-js/rollup'
import { build } from 'vite'
import { expect, test } from 'vite-plus/test'
import { remarkSourceExamples } from './source-examples'

test('documentation builds validate current source and preserve explicit snippet text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-examples-'))
  const source = 'export const answer = 42'
  const file = join(root, 'example.mdx')
  await mkdir(join(root, 'src'))
  const sourceFile = join(root, 'src/example.ts')
  async function compile(meta: string, text = source) {
    await writeFile(file, `# Example\n\n\`\`\`ts ${meta}\n${text}\n\`\`\`\n`)
    const result = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [mdx({ remarkPlugins: [[remarkSourceExamples, { root }]] })],
      build: {
        write: false,
        minify: false,
        lib: { entry: file, formats: ['es'] },
        rolldownOptions: { external: ['react/jsx-runtime'] }
      }
    })
    const outputs = Array.isArray(result) ? result : [result]
    return outputs
      .flatMap((output) => ('output' in output ? output.output : []))
      .map((output) => (output.type === 'chunk' ? output.code : ''))
      .join('\n')
  }
  try {
    await writeFile(sourceFile, `// heading\n${source}\n`)
    const compiled = await compile('source="src/example.ts"')
    expect(compiled).toContain(source)
    expect(compiled).toContain('/blob/master/src/example.ts#L2-L2')
    expect(compiled).not.toContain('node:fs')
    await writeFile(sourceFile, `// moved\n\n${source}\n`)
    expect(await compile('source="src/example.ts"')).toContain('#L3-L3')
    expect(await compile('', 'ordinary tutorial code')).toContain(
      'ordinary tutorial code'
    )

    for (const [meta, text, diagnostic] of [
      ['source="src/missing.ts"', source, 'cannot read'],
      ['source="src/example.ts"', 'export const answer = 43', 'no exact match'],
      ['source="src/example.ts"', '', 'empty excerpt'],
      ['source=src/example.ts', source, 'expected source="repo/path"'],
      ['source="/etc/passwd"', source, 'repository-relative'],
      ['source="../outside.ts"', source, 'repository-relative']
    ] satisfies Array<[string, string, string]>) {
      await expect(compile(meta, text)).rejects.toThrow(diagnostic)
    }
    await expect(compile('source="src/example.ts"', 'changed')).rejects.toThrow(
      'example.mdx'
    )
    await expect(compile('source="src/example.ts"', 'changed')).rejects.toThrow(
      'src/example.ts'
    )
    await writeFile(sourceFile, `${source}\n${source}\n`)
    await expect(compile('source="src/example.ts"')).rejects.toThrow(
      'ambiguous excerpt'
    )
    // A resolved outside file must fail even when its contents would match.
    const outside = await mkdtemp(join(tmpdir(), 'source-example-outside-'))
    try {
      await writeFile(join(outside, 'example.ts'), source)
      await symlink(join(outside, 'example.ts'), join(root, 'src/escape.ts'))
      await expect(compile('source="src/escape.ts"')).rejects.toThrow(
        'outside repository'
      )
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
