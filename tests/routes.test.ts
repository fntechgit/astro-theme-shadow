import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mapShadows } from '../src/files.js'
import { listPages, routePattern, themeRoutes } from '../src/routes.js'
import { makeTree } from './helpers.js'

describe('listPages', () => {
  it('lists page files as posix paths, skipping _ files and _ directories', () => {
    const dir = makeTree({
      'index.astro': '',
      'about.md': '',
      'notes.mdx': '',
      'legacy.html': '',
      'rss.xml.ts': '',
      'api/ping.js': '',
      'blog/[slug].astro': '',
      '_draft.astro': '',
      '_partials/nav.astro': '',
      'styles.css': '',
    })
    expect(listPages(dir)).toEqual([
      'about.md',
      'api/ping.js',
      'blog/[slug].astro',
      'index.astro',
      'legacy.html',
      'notes.mdx',
      'rss.xml.ts',
    ])
  })

  it('is empty when the directory does not exist', () => {
    expect(listPages('/does/not/exist')).toEqual([])
  })
})

describe('routePattern', () => {
  it('gives the pattern Astro gives the same file', () => {
    expect(routePattern('index.astro')).toBe('/')
    expect(routePattern('about.astro')).toBe('/about')
    expect(routePattern('blog/index.astro')).toBe('/blog')
    expect(routePattern('blog/[slug].astro')).toBe('/blog/[slug]')
    expect(routePattern('[...path].astro')).toBe('/[...path]')
    expect(routePattern('rss.xml.ts')).toBe('/rss.xml')
  })
})

describe('themeRoutes', () => {
  const setup = (files: Record<string, string>, names: string[] = ['base']) => {
    const root = makeTree(files)
    const themes = names.map((name) => ({ name, dir: path.join(root, name) }))
    const routes = (warn = vi.fn()) =>
      themeRoutes(themes, path.join(root, 'site/src/pages'), mapShadows(themes, path.join(root, 'site/src')), warn)
    return { root, routes }
  }

  it('gives every theme page its pattern and absolute entrypoint', () => {
    const { root, routes } = setup({
      'base/src/pages/index.astro': '',
      'base/src/pages/blog/[slug].astro': '',
    })
    expect(routes()).toEqual([
      { pattern: '/blog/[slug]', entrypoint: path.join(root, 'base/src/pages/blog/[slug].astro') },
      { pattern: '/', entrypoint: path.join(root, 'base/src/pages/index.astro') },
    ])
  })

  it("routes a shadowed page to its shadow, the file Astro reads the page's styles and prerender setting from", () => {
    const { root, routes } = setup({
      'base/src/pages/about.astro': '',
      'site/src/base/pages/about.astro': '',
    })
    expect(routes()).toEqual([{ pattern: '/about', entrypoint: path.join(root, 'site/src/base/pages/about.astro') }])
  })

  it('leaves out the routes the site defines, whatever it names their params', () => {
    const { routes } = setup({
      'base/src/pages/index.astro': '',
      'base/src/pages/register.astro': '',
      'base/src/pages/blog/[slug].astro': '',
      'site/src/pages/register.md': '',
      'site/src/pages/blog/[id].astro': '',
    })
    expect(routes().map((r) => r.pattern)).toEqual(['/'])
  })

  it('lets the last theme win a route two themes provide, with a warning', () => {
    const { root, routes } = setup(
      {
        'base/src/pages/about.astro': '',
        'base/src/pages/index.astro': '',
        'blog/src/pages/about.astro': '',
      },
      ['base', 'blog'],
    )
    const warn = vi.fn()
    expect(routes(warn)).toEqual([
      { pattern: '/about', entrypoint: path.join(root, 'blog/src/pages/about.astro') },
      { pattern: '/', entrypoint: path.join(root, 'base/src/pages/index.astro') },
    ])
    expect(warn).toHaveBeenCalledWith('/about: the page from blog replaces the one from base')
  })

  it('warns when one theme has two pages for a route', () => {
    const { root, routes } = setup({ 'base/src/pages/blog.astro': '', 'base/src/pages/blog/index.astro': '' })
    const warn = vi.fn()
    expect(routes(warn)).toEqual([{ pattern: '/blog', entrypoint: path.join(root, 'base/src/pages/blog/index.astro') }])
    expect(warn.mock.calls).toEqual([['/blog: base has two pages for it, blog.astro and blog/index.astro; using blog/index.astro']])
  })

  it('is empty for a theme without pages', () => {
    const { routes } = setup({ 'base/src/components/x.ts': '' })
    expect(routes()).toEqual([])
  })
})
