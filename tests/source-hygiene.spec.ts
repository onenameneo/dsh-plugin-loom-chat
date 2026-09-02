import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const sourceRoot = join(projectRoot, 'src')

function sourceFilesIn(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesIn(path)
    return /^(?!.*\.d\.ts$).*\.(?:ts|tsx)$/u.test(path) ? [resolve(path)] : []
  })
}

function resolveRelativeImport(from: string, specifier: string, sourceFiles: ReadonlySet<string>): string | undefined {
  const base = resolve(dirname(from), specifier.replace(/\.js$/u, ''))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (sourceFiles.has(candidate)) return candidate
  }
  return undefined
}

function reachableSourceFiles(roots: readonly string[], sourceFiles: readonly string[]): Set<string> {
  const sourceSet = new Set(sourceFiles)
  const imports = new Map<string, readonly string[]>()
  for (const file of sourceFiles) {
    const source = readFileSync(file, 'utf8')
    const specifiers = [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?['"]((?:\.\.?\/)[^'"]+)['"]/gu)]
    imports.set(file, specifiers
      .map(match => resolveRelativeImport(file, match[1]!, sourceSet))
      .filter((value): value is string => value !== undefined))
  }
  const reachable = new Set<string>()
  const pending = [...roots]
  while (pending.length > 0) {
    const file = pending.pop()!
    if (reachable.has(file)) continue
    reachable.add(file)
    pending.push(...(imports.get(file) ?? []))
  }
  return reachable
}

describe('source hygiene', () => {
  it('keeps every vendored source module reachable from a production entrypoint', () => {
    const sourceFiles = sourceFilesIn(sourceRoot)
    const roots = ['src/index.ts', 'src/invariant.ts', 'src/client/index.ts']
      .map(path => join(projectRoot, path))
    const reachable = reachableSourceFiles(roots, sourceFiles)
    const orphaned = sourceFiles
      .filter(file => file.includes(join('src', 'vendor')) && !reachable.has(file))
      .map(file => file.slice(projectRoot.length + 1))
      .sort()

    expect(orphaned).toEqual([])
  })
})
