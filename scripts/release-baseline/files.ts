import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name)
        return entry.isDirectory() ? listFiles(path) : Promise.resolve([path])
      })
    )
  ).flat()
}
