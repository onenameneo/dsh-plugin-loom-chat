import { describe, expect, it } from 'vitest'
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
})
