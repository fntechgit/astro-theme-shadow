import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mapShadows } from '../src/files.js'
import { shadowPlugin } from '../src/shadow-plugin.js'
import type { ThemeConfig } from '../src/types.js'
import { makeTree } from './helpers.js'

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.astro', '.svg', '.png']

const splitQuery = (id: string) => {
  const i = id.indexOf('?')
  return i === -1 ? [id, ''] : [id.slice(0, i), id.slice(i)]
}

/**
 * A stand-in for Vite's resolver: absolute, root-relative and relative
 * paths with extension probing, installed theme packages by name, `react` as
 * an external, and `only-in-theme`, a package only a theme's files can reach.
 */
function fakeResolver(themes: ThemeConfig[], root: string, installed: boolean) {
  return vi.fn(async (source: string, importer?: string) => {
    if (source === 'react') return { id: 'react', external: true }
    const [spec, query] = splitQuery(source.startsWith('/@fs/') ? source.slice(4) : source)
    const importerFile = importer ? splitQuery(importer)[0] : ''
    let base: string | undefined
    if (path.isAbsolute(spec)) base = existsSync(path.dirname(spec)) ? spec : path.join(root, spec)
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(importerFile), spec)
    else if (spec === 'only-in-theme') {
      const theme = themes.find((t) => importerFile.startsWith(t.dir + path.sep))
      if (theme) base = path.join(theme.dir, 'node_modules/only-in-theme/index.js')
    } else if (installed) {
      const theme = themes.find((t) => spec.startsWith(`${t.name}/`))
      if (theme) base = path.join(theme.dir, spec.slice(theme.name.length + 1))
    }
    const file = base && EXTENSIONS.map((ext) => base + ext).find((f) => existsSync(f) && path.extname(f))
    return file ? { id: file + query } : null
  })
}

/**
 * `themeDirs` maps each theme's name to its directory in the tree. With
 * `installed: false` the themes are not packages the resolver can find by name.
 */
function setup(files: Record<string, string>, themeDirs: Record<string, string>, { installed = true } = {}) {
  const root = makeTree(files)
  const themes = Object.entries(themeDirs).map(([name, dir]) => ({ name, dir: path.join(root, dir) }))
  const srcDir = path.join(root, 'site/src')
  const plugin = shadowPlugin({ themes, root: path.join(root, 'site'), srcDir, shadows: mapShadows(themes, srcDir) })
  const contextResolve = fakeResolver(themes, path.join(root, 'site'), installed)
  const resolveId = plugin.resolveId as (this: unknown, source: string, importer?: string, options?: object) => unknown
  return {
    root,
    contextResolve,
    async resolve(source: string, importer?: string) {
      const result = (await resolveId.call({ resolve: contextResolve }, source, importer, {})) as
        | string
        | { id: string; external?: boolean }
        | null
      return typeof result === 'string' ? result : (result?.id ?? null)
    },
  }
}

const THEME = '@fixture/theme'

describe('shadowPlugin with one theme', () => {
  const start = (options?: { installed: boolean }) => {
    const s = setup(
      {
        'theme/src/components/Header.astro': '',
        'theme/src/components/Footer.tsx': '',
        'theme/src/components/Counter.tsx': '',
        'theme/src/components/Plain.tsx': '',
        'theme/src/components/links.ts': '',
        'theme/src/images/logo.svg': '',
        'theme/node_modules/only-in-theme/index.js': '',
        [`site/src/${THEME}/components/Header.astro`]: '',
        [`site/src/${THEME}/components/Footer.tsx`]: '',
        [`site/src/${THEME}/components/Counter.jsx`]: '',
        [`site/src/${THEME}/images/logo.png`]: '',
        'site/src/pages/index.astro': '',
      },
      { [THEME]: 'theme' },
      options,
    )
    const theme = (p: string) => path.join(s.root, 'theme/src', p)
    return {
      ...s,
      theme,
      shadow: (p: string) => path.join(s.root, 'site/src', THEME, p),
      site: (p: string) => path.join(s.root, 'site/src', p),
    }
  }

  it('gives a theme file the shadow of the file it imports', async () => {
    const { resolve, theme, shadow } = start()
    expect(await resolve('./Footer', theme('components/Plain.tsx'))).toBe(shadow('components/Footer.tsx'))
  })

  it('matches a shadow of another extension in the same family', async () => {
    const { resolve, theme, shadow } = start()
    expect(await resolve('./Counter', theme('components/Plain.tsx'))).toBe(shadow('components/Counter.jsx'))
  })

  it('keeps the query', async () => {
    const { resolve, theme, shadow } = start()
    expect(await resolve('../images/logo.svg?url', theme('components/Plain.tsx'))).toBe(`${shadow('images/logo.png')}?url`)
  })

  it('leaves a file without a shadow to the theme', async () => {
    const { resolve, theme } = start()
    expect(await resolve('./links', theme('components/Plain.tsx'))).toBe(theme('components/links.ts'))
  })

  it('gives a site file the shadow of a theme file it imports by package name', async () => {
    const { resolve, site, shadow } = start()
    expect(await resolve(`${THEME}/src/components/Footer.tsx`, site('pages/index.astro'))).toBe(shadow('components/Footer.tsx'))
  })

  it('gives a shadow the theme file it shadows when it imports it', async () => {
    const { resolve, theme, shadow } = start()
    expect(await resolve(`${THEME}/src/components/Footer`, shadow('components/Footer.tsx'))).toBe(theme('components/Footer.tsx'))
  })

  it("finds a theme's files by its name inside its directory when it is not installed", async () => {
    const { resolve, theme, shadow, site } = start({ installed: false })
    expect(await resolve(`${THEME}/src/components/Footer.tsx`, site('pages/index.astro'))).toBe(shadow('components/Footer.tsx'))
    expect(await resolve(`${THEME}/src/components/Footer`, shadow('components/Footer.tsx'))).toBe(theme('components/Footer.tsx'))
  })

  it("resolves a shadow's relative import from the theme file's directory when it is not next to the shadow", async () => {
    const { resolve, theme, shadow } = start()
    expect(await resolve('./links', shadow('components/Footer.tsx'))).toBe(theme('components/links.ts'))
  })

  it("resolves a shadow's package import from the theme file when the site cannot", async () => {
    const { resolve, shadow, root } = start()
    expect(await resolve('only-in-theme', shadow('components/Footer.tsx'))).toBe(
      path.join(root, 'theme/node_modules/only-in-theme/index.js'),
    )
  })

  it('still lands on a shadow after that fallback', async () => {
    const { resolve, shadow } = start()
    expect(await resolve('./Counter.tsx', shadow('components/Footer.tsx'))).toBe(shadow('components/Counter.jsx'))
  })

  describe('absolute paths into the theme (island components, injected pages)', () => {
    it('gives the shadow with no importer, or the root index.html', async () => {
      const { resolve, theme, shadow, root } = start()
      expect(await resolve(theme('components/Footer.tsx'))).toBe(shadow('components/Footer.tsx'))
      expect(await resolve(theme('components/Footer.tsx'), path.join(root, 'site/index.html'))).toBe(
        shadow('components/Footer.tsx'),
      )
    })

    it('reads /@fs/ paths and paths without an extension', async () => {
      const { resolve, theme, shadow } = start()
      expect(await resolve(`/@fs${theme('components/Footer.tsx')}`)).toBe(shadow('components/Footer.tsx'))
      expect(await resolve(theme('components/Footer'))).toBe(shadow('components/Footer.tsx'))
    })

    it('reads paths from the project root, the way Astro imports an injected page', async () => {
      const { resolve, shadow } = start()
      expect(await resolve('/../theme/src/components/Footer.tsx', '\0virtual:astro:page:../theme/src/pages/index@_@astro')).toBe(
        shadow('components/Footer.tsx'),
      )
    })

    it('leaves a path with a query alone: it asks for a part of that exact file', async () => {
      const { resolve, theme } = start()
      expect(await resolve(`${theme('components/Header.astro')}?astro&type=style&index=0&lang.css`)).toBeNull()
    })

    it("keeps a theme file's requests for its own parts", async () => {
      const { resolve, theme } = start()
      const style = `${theme('components/Header.astro')}?astro&type=style&index=0&lang.css`
      expect(await resolve(style, theme('components/Header.astro'))).toBe(style)
    })
  })

  it('does not touch imports between site files', async () => {
    const { resolve, site, contextResolve } = start()
    expect(await resolve('./other', site('pages/index.astro'))).toBeNull()
    expect(contextResolve).not.toHaveBeenCalled()
  })

  it('passes externals through', async () => {
    const { resolve, theme } = start()
    expect(await resolve('react', theme('components/Plain.tsx'))).toBe('react')
  })
})

describe('shadowPlugin with two themes', () => {
  const start = () => {
    const s = setup(
      {
        'a/src/pages/index.astro': '',
        'a/src/components/X.tsx': '',
        'a/src/components/Y.tsx': '',
        'b/src/a/components/X.tsx': '',
        'b/src/a/components/Y.tsx': '',
        'site/src/a/components/X.tsx': '',
      },
      { a: 'a', b: 'b' },
    )
    return { ...s, at: (p: string) => path.join(s.root, p) }
  }

  it("prefers the project's shadow, then the other theme's", async () => {
    const { resolve, at } = start()
    expect(await resolve('../components/X', at('a/src/pages/index.astro'))).toBe(at('site/src/a/components/X.tsx'))
    expect(await resolve('../components/Y', at('a/src/pages/index.astro'))).toBe(at('b/src/a/components/Y.tsx'))
  })

  it('gives every shadow in the chain the original when it imports it', async () => {
    const { resolve, at } = start()
    expect(await resolve('a/src/components/X', at('b/src/a/components/X.tsx'))).toBe(at('a/src/components/X.tsx'))
    expect(await resolve('a/src/components/X', at('site/src/a/components/X.tsx'))).toBe(at('a/src/components/X.tsx'))
  })
})
