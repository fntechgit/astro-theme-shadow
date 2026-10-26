import path from 'node:path'
import type { Plugin } from 'vite'
import { isInside, type ShadowMap, srcOf } from './files.js'
import type { ThemeConfig } from './types.js'

export interface ShadowPluginOptions {
  themes: ThemeConfig[]
  /** The project root, which paths starting with / can be relative to. */
  root: string
  /** The project's src directory: a theme's shadows live in <srcDir>/<theme name>/. */
  srcDir: string
  shadows: ShadowMap
}

const splitQuery = (id: string): [string, string] => {
  const i = id.indexOf('?')
  return i === -1 ? [id, ''] : [id.slice(0, i), id.slice(i)]
}

/**
 * The Vite plugin that does the shadowing. An import that resolves to a
 * theme file with a shadow resolves to the shadow instead, except when the
 * theme file or one of its shadows imports it: a shadow that imports the
 * file it replaces gets the theme file, so it can wrap it.
 *
 * Two fallbacks apply when Vite cannot resolve an import:
 * - `<theme name>/<path>` resolves inside the theme's directory, so a theme
 *   that is not installed as a package is imported by its name too;
 * - an import from a shadow resolves from the theme file it shadows, so a
 *   copied theme file keeps its relative imports and the theme's packages.
 */
export function shadowPlugin({ themes, root, srcDir, shadows }: ShadowPluginOptions): Plugin {
  const themeOf = (file: string) => themes.find((t) => isInside(file, srcOf(t)))
  const themeNamed = (source: string) => themes.find((t) => source.startsWith(`${t.name}/`))

  /** Whether imports from `file` can lead to a shadow: it is a theme file or a project shadow. */
  const importsShadows = (file: string) =>
    themes.some((t) => isInside(file, srcOf(t)) || isInside(file, path.join(srcDir, t.name)))

  /**
   * The shadow an import of `file` from `importer` resolves to: the first
   * shadow of `file`, unless `importer` is that file or one of its shadows.
   * Null keeps `file`.
   */
  function shadowFor(file: string, importer: string): string | null {
    const chain = shadows.chains.get(file)
    if (!chain || importer === file || chain.includes(importer)) return null
    return chain[0]
  }

  return {
    name: 'astro-theme-shadow',
    enforce: 'pre',

    async resolveId(source, importer, options) {
      const resolveOptions = { ...options, skipSelf: true }
      const [importerFile] = splitQuery(importer ?? '')
      const [target, query] = splitQuery(source.startsWith('/@fs/') ? source.slice('/@fs'.length) : source)
      // A path into a theme with no query, absolute or from the project
      // root: an island's component, which Astro's compiler resolves outside
      // Vite, or an injected page. It comes with no importer, or with one
      // that says nothing (the root index.html, a virtual module). A query
      // asks for a part of one exact file (an .astro style block), so it is
      // left alone.
      const isThemePath =
        path.isAbsolute(target) && !query && (themeOf(target) ?? themeOf(path.join(root, target))) !== undefined
      const named = themeNamed(source)
      if (!isThemePath && !named && !importsShadows(importerFile)) return null

      let resolved = await this.resolve(source, importer, resolveOptions)
      if (!resolved && named) {
        resolved = await this.resolve(path.join(named.dir, source.slice(named.name.length + 1)), importer, resolveOptions)
      }
      const original = shadows.originals.get(importerFile)
      if (!resolved && original) resolved = await this.resolve(source, original, resolveOptions)
      if (!resolved || resolved.external) return resolved

      const [file, resolvedQuery] = splitQuery(resolved.id)
      const shadow = shadowFor(file, importerFile)
      return shadow ? { ...resolved, id: shadow + resolvedQuery } : resolved
    },
  }
}
