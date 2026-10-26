import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { candidateNames, findFile, listFiles, mapShadows, shadowDirs } from '../src/files.js'
import { makeTree } from './helpers.js'

describe('candidateNames', () => {
  it('puts the exact name first, then the rest of its family', () => {
    expect(candidateNames('Footer.jsx')).toEqual([
      'Footer.jsx',
      'Footer.js',
      'Footer.ts',
      'Footer.tsx',
      'Footer.mjs',
      'Footer.cjs',
      'Footer.mts',
      'Footer.cts',
    ])
  })

  it('keeps .astro to .astro', () => {
    expect(candidateNames('Header.astro')).toEqual(['Header.astro'])
  })

  it('matches stylesheets, data, images and markdown within their own family', () => {
    expect(candidateNames('theme.css')).toEqual(['theme.css', 'theme.sass', 'theme.scss', 'theme.less'])
    expect(candidateNames('menu.json')).toEqual(['menu.json', 'menu.yaml', 'menu.yml'])
    expect(candidateNames('logo.svg')).toContain('logo.png')
    expect(candidateNames('logo.svg')).not.toContain('logo.css')
    expect(candidateNames('post.md')).toEqual(['post.md', 'post.mdx'])
  })

  it('matches only the exact name for an extension outside every family', () => {
    expect(candidateNames('brand.woff2')).toEqual(['brand.woff2'])
  })

  it('keeps an inner extension', () => {
    expect(candidateNames('button.css.ts')).toContain('button.css.tsx')
  })
})

describe('findFile', () => {
  it('finds the file at the same path', () => {
    const dir = makeTree({ 'components/Footer.tsx': '' })
    expect(findFile(dir, 'components/Footer.tsx')).toBe(path.join(dir, 'components/Footer.tsx'))
  })

  it('finds a file of the same family', () => {
    const dir = makeTree({ 'components/Footer.tsx': '' })
    expect(findFile(dir, 'components/Footer.jsx')).toBe(path.join(dir, 'components/Footer.tsx'))
  })

  it('prefers the exact name', () => {
    const dir = makeTree({ 'components/Footer.tsx': '', 'components/Footer.jsx': '' })
    expect(findFile(dir, 'components/Footer.jsx')).toBe(path.join(dir, 'components/Footer.jsx'))
  })

  it('does not cross families', () => {
    const dir = makeTree({ 'components/Footer.css': '' })
    expect(findFile(dir, 'components/Footer.tsx')).toBeNull()
  })

  it('returns null when the directory does not exist', () => {
    const dir = makeTree({})
    expect(findFile(path.join(dir, 'missing'), 'components/Footer.tsx')).toBeNull()
  })
})

describe('shadowDirs', () => {
  it('lists the project first, then the other themes, last theme first', () => {
    const a = { name: '@acme/base', dir: '/themes/base' }
    const b = { name: 'blog', dir: '/themes/blog' }
    const c = { name: 'docs', dir: '/themes/docs' }
    expect(shadowDirs(a, [a, b, c], '/site/src')).toEqual([
      '/site/src/@acme/base',
      '/themes/docs/src/@acme/base',
      '/themes/blog/src/@acme/base',
    ])
  })
})

describe('listFiles', () => {
  it('skips the files the OS and editors leave behind, but keeps dot directories', () => {
    const dir = makeTree({
      '.DS_Store': '',
      'components/Footer.tsx': '',
      'components/.Footer.tsx.swp': '',
      'components/Footer.tsx~': '',
      'pages/.well-known/security.txt.ts': '',
    })
    expect(listFiles(dir)).toEqual([path.join(dir, 'components/Footer.tsx'), path.join(dir, 'pages/.well-known/security.txt.ts')])
  })
})

describe('mapShadows', () => {
  it('maps each shadowed theme file to its shadows, the project first, then the other themes', () => {
    const root = makeTree({
      'a/src/components/X.tsx': '',
      'a/src/components/Y.tsx': '',
      'b/src/a/components/X.jsx': '',
      'site/src/a/components/X.tsx': '',
    })
    const at = (p: string) => path.join(root, p)
    const themes = [
      { name: 'a', dir: at('a') },
      { name: 'b', dir: at('b') },
    ]
    const { chains, originals } = mapShadows(themes, at('site/src'))
    expect([...chains]).toEqual([[at('a/src/components/X.tsx'), [at('site/src/a/components/X.tsx'), at('b/src/a/components/X.jsx')]]])
    expect(originals.get(at('site/src/a/components/X.tsx'))).toBe(at('a/src/components/X.tsx'))
    expect(originals.get(at('b/src/a/components/X.jsx'))).toBe(at('a/src/components/X.tsx'))
  })

  it('prefers the exact name when one directory has two shadows of a file', () => {
    const root = makeTree({
      'theme/src/components/Footer.jsx': '',
      'site/src/acme/components/Footer.tsx': '',
      'site/src/acme/components/Footer.jsx': '',
    })
    const { chains } = mapShadows([{ name: 'acme', dir: path.join(root, 'theme') }], path.join(root, 'site/src'))
    expect(chains.get(path.join(root, 'theme/src/components/Footer.jsx'))).toEqual([path.join(root, 'site/src/acme/components/Footer.jsx')])
  })

  it("lists the project's shadow files that mirror no theme file", () => {
    const root = makeTree({
      'theme/src/components/Footer.jsx': '',
      'site/src/acme/components/Footer.tsx': '',
      'site/src/acme/components/Fotter.tsx': '',
      'site/src/acme/styles/missing.css': '',
    })
    const theme = { name: 'acme', dir: path.join(root, 'theme') }
    expect(mapShadows([theme], path.join(root, 'site/src')).orphans).toEqual([
      path.join(root, 'site/src/acme/components/Fotter.tsx'),
      path.join(root, 'site/src/acme/styles/missing.css'),
    ])
  })

  it('checks the shadow directory of every theme', () => {
    const root = makeTree({
      'a/src/x.ts': '',
      'b/src/y.ts': '',
      'site/src/a/y.ts': '',
      'site/src/b/y.ts': '',
    })
    const themes = [
      { name: 'a', dir: path.join(root, 'a') },
      { name: 'b', dir: path.join(root, 'b') },
    ]
    expect(mapShadows(themes, path.join(root, 'site/src')).orphans).toEqual([path.join(root, 'site/src/a/y.ts')])
  })

  it('is empty when the project shadows nothing', () => {
    const root = makeTree({ 'theme/src/x.ts': '', 'site/src/pages/index.astro': '' })
    expect(mapShadows([{ name: 'acme', dir: path.join(root, 'theme') }], path.join(root, 'site/src'))).toEqual({
      chains: new Map(),
      originals: new Map(),
      orphans: [],
    })
  })
})
