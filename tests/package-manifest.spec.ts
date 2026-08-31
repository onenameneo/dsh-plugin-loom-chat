import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  files?: string[]
  types?: string
  exports?: {
    '.': {
      types?: string
    }
    './invariant': {
      types?: string
    }
    './client': {
      types?: string
    }
  }
  scripts?: {
    'pack:verify'?: string
    prepare?: string
  }
}

interface BuildConfig {
  compilerOptions?: {
    outDir?: string
    declarationDir?: string
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(resolve(import.meta.dirname, '..', file), 'utf8')) as T
}

describe('published package manifest', () => {
  it('uses the DSH declaration layout for the root entry', async () => {
    const manifest = await readJson<PackageManifest>('package.json')
    const buildConfig = await readJson<BuildConfig>('tsconfig.build.json')

    expect(manifest.types).toBe('lib/types/index.d.ts')
    expect(manifest.exports?.['.']?.types).toBe('./lib/types/index.d.ts')
    expect(manifest.exports?.['./invariant']?.types).toBe('./lib/types/invariant.d.ts')
    expect(manifest.exports?.['./client']?.types).toBe('./lib/types/client/index.d.ts')
    expect(buildConfig.compilerOptions?.outDir).toBe('lib')
    expect(buildConfig.compilerOptions?.declarationDir).toBe('lib/types')
  })

  it('builds Git dependencies before the loader resolves their published entrypoints', async () => {
    const manifest = await readJson<PackageManifest>('package.json')

    expect(manifest.scripts?.prepare).toBe('pnpm run build')
    expect(manifest.scripts?.['pack:verify']).toBe('pnpm pack --pack-destination ./.artifacts')
  })

  it('ships README assets referenced by the npm package page', async () => {
    const manifest = await readJson<PackageManifest>('package.json')

    expect(manifest.files).toContain('assetes')
  })
})
