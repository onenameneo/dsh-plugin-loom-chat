import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PLUGIN_ID = 'dsh-loom-chat'
const CSS_VIRTUAL_PREFIX = '\0dsh-loom-chat-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const EXTERNALS = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale',
  'react',
  'react/jsx-runtime',
]

/**
 * Compile one CSS Module into a browser module that injects its stylesheet and
 * exports the hashed class-name map consumed by React components.
 * @param fileId - absolute stylesheet path used as the CSS Modules filename.
 * @param source - stylesheet source text.
 * @returns ESM source for the virtual CSS module.
 */
export function cssModuleVirtualSource(fileId: string, source: string): string {
  const { code, exports: cssExports } = transform({
    filename: fileId,
    code: Buffer.from(source),
    cssModules: { pattern: '[hash]_[local]' },
    minify: true,
  })
  const classMap: Record<string, string> = {}
  for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
  const tagId = `${PLUGIN_ID}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(code.toString())};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
    '  const tag = document.createElement("style");',
    `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

export default defineConfig({
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: EXTERNALS,
  },
  plugins: [{
    name: 'dsh-loom-chat-css-text',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      const fileId = resolve(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + fileId + CSS_VIRTUAL_SUFFIX
    },
    async load(id) {
      if (!id.startsWith(CSS_VIRTUAL_PREFIX) || !id.endsWith(CSS_VIRTUAL_SUFFIX)) return null
      const fileId = id.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      return cssModuleVirtualSource(fileId, await readFile(fileId, 'utf8'))
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
