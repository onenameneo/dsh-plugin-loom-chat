import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inject as clientInject } from '../src/client/index.js'

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
  dsh?: {
    client?: {
      inject?: string[]
    }
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
    expect(manifest.scripts?.['pack:verify']).toBe('pnpm pack --pack-destination ./.artifacts && node scripts/verify-pack.mjs')
  })

  it('keeps browser injection on published package names only', async () => {
    const manifest = await readJson<PackageManifest>('package.json')
    const inject = manifest.dsh?.client?.inject ?? []

    expect(inject.length).toBeGreaterThan(0)
    expect(inject.every(name => /^@deepseek-ai\//u.test(name))).toBe(true)
    expect(inject).toEqual(expect.arrayContaining([
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-api-workspace-controller',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-ui-commands',
      '@deepseek-ai/dsh-client-ui-chat',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-input-trigger',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-model-selection',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-client-ui-workspace',
    ]))
    expect(inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(JSON.stringify(manifest)).not.toMatch(/(?:file:|link:|deepseek-harness)/u)
  })

  it('declares the remote faces required by model directory resolution', () => {
    expect(clientInject).toEqual(expect.arrayContaining(['remote', 'remote.session']))
  })

  it('ships README assets referenced by the npm package page', async () => {
    const manifest = await readJson<PackageManifest>('package.json')

    expect(manifest.files).toContain('assets')
  })
})
