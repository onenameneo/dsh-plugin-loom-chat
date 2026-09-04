import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const artifactDirectory = join(projectRoot, '.artifacts')
const packageManifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const tarballs = readdirSync(artifactDirectory)
  .filter(file => file.startsWith(`${packageManifest.name}-`) && file.endsWith('.tgz'))
  .sort()
const tarball = tarballs.at(-1)
if (tarball === undefined) throw new Error(`No tarball found for ${packageManifest.name}`)

const tarballPath = join(artifactDirectory, tarball)
const entries = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

function collectExportTargets(value) {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []

  return Object.values(value).flatMap(collectExportTargets)
}

function exportTargetPattern(target) {
  if (!target.startsWith('./')) {
    throw new Error(`Package export target must be relative: ${target}`)
  }

  const escaped = target.slice(2).replace(/[|\\{}()[\]^$+?.]/gu, '\\$&').replaceAll('*', '.+')
  return new RegExp(`^package/${escaped}$`, 'u')
}

const required = [
  'package/package.json',
  'package/lib/index.js',
  'package/lib/client.js',
  'package/lib/invariant.js',
  'package/cordis.patch.yml',
  'package/README.md',
  'package/README.zh.md',
  'package/LICENSE',
]
for (const entry of required) {
  if (!entries.includes(entry)) throw new Error(`Tarball is missing required entry: ${entry}`)
}

const forbidden = /(?:^|\/)(?:src|openspec|node_modules)(?:\/|$)|deepseek-harness/u
const violations = entries.filter(entry => forbidden.test(entry))
if (violations.length > 0) throw new Error(`Tarball contains forbidden development paths: ${violations.join(', ')}`)

const packedManifest = JSON.parse(execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], { encoding: 'utf8' }))
if (packedManifest.name !== packageManifest.name || packedManifest.version !== packageManifest.version) {
  throw new Error('Packed package manifest does not match the workspace package manifest')
}
if (packedManifest.exports?.['./client']?.default !== './lib/client.js') {
  throw new Error('Packed package is missing the public ./client entry point')
}

const exportTargets = collectExportTargets(packedManifest.exports)
const missingExportTargets = exportTargets.filter(target => {
  const pattern = exportTargetPattern(target)
  return !entries.some(entry => pattern.test(entry))
})
if (missingExportTargets.length > 0) {
  throw new Error(`Packed package exports point to missing tarball entries: ${missingExportTargets.join(', ')}`)
}

console.log(`Pack verification passed: ${tarball}`)
