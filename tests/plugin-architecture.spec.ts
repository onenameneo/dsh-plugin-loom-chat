import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = join(import.meta.dirname, '..')

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(file))
    else if (/\.(?:json|ts|tsx)$/u.test(entry.name)) files.push(file)
  }
  return files
}

describe('plugin architecture boundary', () => {
  it('uses the Harness-owned chat and composer surfaces in Canvas', async () => {
    const sessionSurface = await readFile(join(projectRoot, 'src/client/NativeSessionSurface.tsx'), 'utf8')
    const composer = await readFile(join(projectRoot, 'src/client/NativeComposer.tsx'), 'utf8')

    expect(sessionSurface).toContain("../vendor/dsh-harness-chat/chat/ChatView.js")
    expect(sessionSurface).toContain("../vendor/dsh-harness-attachment/client/MessageImages.js")
    expect(sessionSurface).not.toContain("../vendor/dsh-conversation/chat/ChatView.js")
    const canvasBranch = await readFile(join(projectRoot, 'src/client/CanvasBranchAction.tsx'), 'utf8')
    expect(canvasBranch).toContain("@deepseek-ai/dsh-client-ui-primitives")
    expect(canvasBranch).not.toContain('CanvasTooltip')
    expect(composer).toContain("../vendor/dsh-harness-conversation/skeleton/InputBar.js")
    expect(composer).toContain("../vendor/dsh-harness-attachment/client/ComposerAttachments.js")
    expect(composer).not.toContain("../vendor/dsh-conversation/skeleton/InputBar.js")
    expect(composer).not.toContain('CanvasComposerAttachments')
    expect(await sourceFiles(join(projectRoot, 'src/client'))).not.toContain(join(projectRoot, 'src/client/CanvasMessage.tsx'))
  })

  it('does not depend on unpublished deepseek-harness rendering APIs', async () => {
    const files = [join(projectRoot, 'package.json'), ...await sourceFiles(join(projectRoot, 'src'))]
    const contents = await Promise.all(files.map(async file => ({ file, text: await readFile(file, 'utf8') })))
    const forbidden = [
      'renderSessionSlot',
      'conversation.composer.full',
      'ISession.open',
      'ISessions.infoOf',
      'variant: \'canvas\'',
    ]
    const violations = contents.flatMap(({ file, text }) => forbidden
      .filter(term => text.includes(term))
      .map(term => `${relative(projectRoot, file)}: ${term}`))
    expect(violations).toEqual([])
  })

  it('bundles Harness runtime value imports that are not module-table externals', async () => {
    const buildConfig = await readFile(join(projectRoot, 'tsdown.config.ts'), 'utf8')

    expect(buildConfig).toContain("alwaysBundle: (specifier: string) => specifier === '@deepseek-ai/dsh-session'")
    expect(buildConfig).toContain("specifier === '@deepseek-ai/dsh-brand'")
    expect(buildConfig).toContain("specifier === 'lexical'")
    expect(buildConfig).toContain("specifier === 'clsx'")
    expect(buildConfig).toContain("conditionNames: ['production', 'browser', 'import', 'module', 'default']")
  })

  it('does not pass the host Lexical editor into the separately bundled Canvas composer', async () => {
    const composer = await readFile(join(projectRoot, 'src/client/NativeComposer.tsx'), 'utf8')

    // The host conversation bundle and this plugin each own a Lexical runtime.
    // Passing input.editor across that boundary triggers Lexical error #195,
    // even when both copies report the same version.
    expect(composer).not.toContain('rawInput?.editor as LexicalEditor')
    expect(composer).not.toContain('hostEditor')
  })
})
