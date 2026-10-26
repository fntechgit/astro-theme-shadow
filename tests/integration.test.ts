import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AstroIntegration } from 'astro'
import type { Plugin } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { resolveThemes, themeShadow } from '../src/integration.js'
import type { ThemeShadowOptions } from '../src/types.js'
import { makeTree } from './helpers.js'

describe('resolveThemes', () => {
  it('finds a theme package from the project root', () => {
    const root = makeTree({
      'site/package.json': '{}',
      'site/node_modules/@acme/theme/package.json': '{"name":"@acme/theme"}',
    })
    expect(resolveThemes(['@acme/theme'], path.join(root, 'site'))).toEqual([
      { name: '@acme/theme', dir: path.join(root, 'site/node_modules/@acme/theme') },
    ])
  })

  it("resolves a ThemeConfig's directory from the project root", () => {
    const root = makeTree({ 'theme/src/x.ts': '', 'site/package.json': '{}' })
    expect(resolveThemes([{ name: 'local', dir: '../theme' }], path.join(root, 'site'))).toEqual([
      { name: 'local', dir: path.join(root, 'theme') },
    ])
  })

  it("uses the directory's name as it is on disk, as Vite does", ({ skip }) => {
    const root = makeTree({ 'theme/src/x.ts': '', 'site/package.json': '{}' })
    if (!existsSync(path.join(root, 'THEME'))) skip('the disk is case-sensitive')
    expect(resolveThemes([{ name: 'local', dir: '../Theme' }], path.join(root, 'site'))).toEqual([
      { name: 'local', dir: path.join(root, 'theme') },
    ])
  })

  it('names a theme it cannot find', () => {
    const root = makeTree({ 'site/package.json': '{}' })
    expect(() => resolveThemes(['@acme/missing'], path.join(root, 'site'))).toThrow(/cannot find the theme @acme\/missing/)
  })
})

type SetupHook = NonNullable<AstroIntegration['hooks']['astro:config:setup']>

function runSetup(files: Record<string, string>, options: Partial<ThemeShadowOptions> = {}) {
  const root = makeTree({ 'site/package.json': '{}', ...files })
  const site = path.join(root, 'site')
  const context = {
    config: { root: pathToFileURL(`${site}/`), srcDir: pathToFileURL(`${site}/src/`) },
    command: 'dev',
    injectRoute: vi.fn(),
    addWatchFile: vi.fn(),
    updateConfig: vi.fn(),
    logger: { warn: vi.fn() },
  }
  const integration = themeShadow({ themes: [{ name: 'acme', dir: '../theme' }], ...options })
  const setup = integration.hooks['astro:config:setup'] as SetupHook
  const run = () => setup(context as unknown as Parameters<SetupHook>[0])
  const plugin = (name: string) => {
    const plugins = context.updateConfig.mock.calls[0][0].vite.plugins as Plugin[]
    return plugins.find((p) => p.name === name) as Plugin
  }
  return { root, site, context, run, plugin }
}

describe('themeShadow', () => {
  it('adds the theme pages the site does not define as routes', () => {
    const { root, context, run } = runSetup({
      'theme/src/pages/index.astro': '',
      'theme/src/pages/about.astro': '',
      'site/src/pages/about.astro': '',
    })
    run()
    expect(context.injectRoute.mock.calls).toEqual([
      [{ pattern: '/', entrypoint: path.join(root, 'theme/src/pages/index.astro') }],
    ])
  })

  it('routes a shadowed theme page to its shadow', () => {
    const { root, context, run } = runSetup({
      'theme/src/pages/about.astro': '',
      'site/src/acme/pages/about.astro': '',
    })
    run()
    expect(context.injectRoute.mock.calls).toEqual([
      [{ pattern: '/about', entrypoint: path.join(root, 'site/src/acme/pages/about.astro') }],
    ])
  })

  it('adds no routes with routes: false', () => {
    const { context, run } = runSetup({ 'theme/src/pages/index.astro': '' }, { routes: false })
    run()
    expect(context.injectRoute).not.toHaveBeenCalled()
  })

  it('fails on files that shadow no theme file, naming them', () => {
    const { run } = runSetup({
      'theme/src/components/Footer.tsx': '',
      'site/src/acme/components/Fotter.tsx': '',
    })
    expect(run).toThrow('these files shadow no theme file:\n  src/acme/components/Fotter.tsx')
  })

  it('ignores the files the OS and editors leave in a shadow directory', () => {
    const { run } = runSetup({
      'theme/src/components/Footer.tsx': '',
      'site/src/acme/.DS_Store': '',
      'site/src/acme/components/.Footer.tsx.swp': '',
      'site/src/acme/components/Footer.tsx~': '',
    })
    expect(run).not.toThrow()
  })

  it('adds its Vite plugins', () => {
    const { context, run } = runSetup({ 'theme/src/pages/index.astro': '' })
    run()
    const names = context.updateConfig.mock.calls[0][0].vite.plugins.map((p: Plugin) => p.name)
    expect(names).toEqual(['astro-theme-shadow', 'astro-theme-shadow:dependencies', 'astro-theme-shadow:restart'])
  })

  describe('dependencies', () => {
    const start = () => {
      const s = runSetup({ 'theme/src/pages/index.astro': '' })
      s.run()
      const configEnvironment = s.plugin('astro-theme-shadow:dependencies').configEnvironment as (name: string) => unknown
      const src = path.join(s.root, 'theme/src')
      const scan = (extensions: string) => [`${src}/**/*.${extensions}`, `!${src}/**/__tests__/**`, `!${src}/**/*.{test,spec}.*`]
      return { configEnvironment, scan }
    }

    it("scans the theme's browser code but not its tests, and serves the theme to the browser as source", () => {
      const { configEnvironment, scan } = start()
      expect(configEnvironment('client')).toEqual({
        optimizeDeps: { entries: scan('{astro,jsx,tsx,mdx,vue,svelte,html}'), exclude: ['acme'] },
      })
    })

    it("scans all the theme's code but its tests for the server, and bundles the theme", () => {
      const { configEnvironment, scan } = start()
      for (const env of ['ssr', 'prerender']) {
        expect(configEnvironment(env)).toEqual({
          optimizeDeps: { entries: scan('{astro,jsx,tsx,js,mjs,ts,mts,mdx,vue,svelte,html}') },
          resolve: { noExternal: ['acme'] },
        })
      }
    })
  })
})

describe('dev restarts', () => {
  const start = (options: Partial<ThemeShadowOptions> = {}) => {
    const s = runSetup(
      {
        'theme/src/components/Footer.tsx': '',
        'theme/src/pages/index.astro': '',
        'theme/src/pages/blog/[slug].astro': '',
      },
      options,
    )
    s.run()
    const watcher = new EventEmitter()
    const changes = vi.fn()
    watcher.on('change', changes)
    const configureServer = s.plugin('astro-theme-shadow:restart').configureServer as (server: unknown) => void
    configureServer({ watcher })
    const src = (p: string) => path.join(s.site, 'src', p)
    return { ...s, watcher, changes, src }
  }

  it('registers src/ as the file whose change restarts Astro', () => {
    const { context, site } = start()
    expect(context.addWatchFile).toHaveBeenCalledWith(path.join(site, 'src'))
  })

  it('restarts when a shadow is added or removed', () => {
    const { watcher, changes, src, site } = start()
    watcher.emit('add', src('acme/components/Footer.tsx'))
    watcher.emit('unlink', src('acme/components/Footer.tsx'))
    expect(changes.mock.calls).toEqual([[path.join(site, 'src')], [path.join(site, 'src')]])
  })

  it('restarts when a site page that takes a theme route is added or removed', () => {
    const { watcher, changes, src } = start()
    watcher.emit('add', src('pages/blog/[id].astro'))
    watcher.emit('unlink', src('pages/index.md'))
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('leaves every other file to Vite', () => {
    const { watcher, changes, src } = start()
    watcher.emit('add', src('pages/contact.astro'))
    watcher.emit('add', src('pages/_draft.astro'))
    watcher.emit('add', src('components/Footer.tsx'))
    watcher.emit('change', src('acme/components/Footer.tsx'))
    expect(changes.mock.calls).toEqual([[src('acme/components/Footer.tsx')]])
  })

  it('ignores the files the OS and editors leave behind', () => {
    const { watcher, changes, src } = start()
    watcher.emit('add', src('acme/components/.Footer.tsx.swp'))
    watcher.emit('add', src('acme/components/Footer.tsx~'))
    watcher.emit('add', src('acme/.DS_Store'))
    expect(changes).not.toHaveBeenCalled()
  })

  it('leaves site pages alone with routes: false', () => {
    const { watcher, changes, src } = start({ routes: false })
    watcher.emit('add', src('pages/index.astro'))
    expect(changes).not.toHaveBeenCalled()
  })
})
