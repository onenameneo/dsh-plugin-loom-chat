import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cssModuleVirtualSource } from '../tsdown.config.js'

describe('css module client build', () => {
  it('exports hashed class names and injects the compiled stylesheet', () => {
    const moduleSource = cssModuleVirtualSource(
      '/tmp/LoomBranchAction.module.css',
      '.action { color: red; }',
    )

    expect(moduleSource).toContain('document.createElement("style")')
    expect(moduleSource).toContain('data-plugin-css')
    expect(moduleSource).toMatch(/export default \{"action":"[^"]+_action"\}/)
    expect(moduleSource).not.toContain('export default ".action')
  })

  it('centers the selection menu through the Menu component root', () => {
    const overlayCss = readFileSync(new URL('../src/client/CanvasOverlay.module.css', import.meta.url), 'utf8')

    expect(overlayCss).toContain(".sessionSelectionMenuAnchor [role='menu']")
    expect(overlayCss).toContain('.sessionSelectionMenuAnchor > span { display: block; width: 0; height: 0; line-height: 0; }')
  })
})
