import { resolve } from 'node:path'
import { operationsReleaseEvidence } from '../packages/capabilities/src/governance/operations-security-evidence-matrix.ts'

export type OperationsReleasePlanEntry = {
  readonly workspace: string
  readonly testFiles: readonly string[]
}

export const buildOperationsReleasePlan = (): readonly OperationsReleasePlanEntry[] => {
  const workspaces = new Map<string, string[]>()
  for (const reference of operationsReleaseEvidence) {
    const testFiles = workspaces.get(reference.workspace) ?? []
    if (!testFiles.includes(reference.testFile)) testFiles.push(reference.testFile)
    workspaces.set(reference.workspace, testFiles)
  }
  return [...workspaces].map(([workspace, testFiles]) => ({
    workspace,
    testFiles
  }))
}

export const runOperationsReleaseMatrix = async (): Promise<void> => {
  const repositoryRoot = resolve(import.meta.dirname, '..')
  for (const entry of buildOperationsReleasePlan()) {
    console.log(`\nOperations release evidence: ${entry.workspace}`)
    const process = Bun.spawn(['bunx', 'vitest', 'run', ...entry.testFiles], {
      cwd: resolve(repositoryRoot, entry.workspace),
      stdout: 'inherit',
      stderr: 'inherit'
    })
    const exitCode = await process.exited
    if (exitCode !== 0) {
      throw new Error(
        `Operations release evidence failed in ${entry.workspace} (${exitCode})`
      )
    }
  }
}

if (import.meta.main) {
  await runOperationsReleaseMatrix()
}
