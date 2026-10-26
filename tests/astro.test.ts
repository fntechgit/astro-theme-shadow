import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Astro runs through its CLI: its build cannot run inside Vitest's module
// runner, and the CLI is how a site runs it anyway.
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtures = path.join(packageRoot, 'tests/fixtures')
const themeDir = path.join(fixtures, 'theme')
const siteDir = path.join(fixtures, 'site')
const run = promisify(execFile)

// Astro's dev server behaves differently when it sees Vitest's variables.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITEST'))),
  ASTRO_TELEMETRY_DISABLED: '1',
  NO_COLOR: '1',
}

async function astro(args: string[], cwd: string): Promise<string> {
  const { stdout } = await run(path.join(packageRoot, 'node_modules/.bin/astro'), args, { cwd, env })
  return stdout
}

async function astroBuild(root: string) {
  rmSync(path.join(root, 'dist'), { recursive: true, force: true })
  await astro(['build'], root)
}

/** Starts `astro dev` in the background, with no pre-bundled dependencies, and waits until it serves `/`. */
async function astroDev(root: string, origin: string) {
  rmSync(path.join(root, 'node_modules/.vite'), { recursive: true, force: true })
  await astro(['dev', '--background', '--port', new URL(origin).port], root)
  await vi.waitFor(
    async () => {
      const html = await fetch(origin).then((r) => r.text(), () => '')
      if (!html.includes('</html>')) throw new Error('astro dev is not serving yet')
    },
    { timeout: 60_000, interval: 250 },
  )
}

/** Writes `files` (path → contents) under `root`. */
function writeFiles(root: string, files: Record<string, string>) {
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), contents)
  }
}

/** A site that installs nothing itself: it finds Astro and React in this package's node_modules. */
const sitePackageJson = (name: string) => readFileSync(path.join(siteDir, 'package.json'), 'utf8').replace('fixture-site', name)

/** The page's text as React rendered it, without the markers it puts between text parts. */
const text = (html: string) => html.replaceAll('<!-- -->', '')

const islandUrl = (html: string) => html.match(/component-url="([^"]+)"/)?.[1] ?? ''

describe('astro build', () => {
  const read = (file: string) => readFileSync(path.join(siteDir, 'dist', file), 'utf8')
  /** The page's styles: inlined, and from the stylesheets it links. */
  const stylesOf = (html: string) =>
    [html, ...[...html.matchAll(/href="(\/_astro\/[^"]+\.css)"/g)].map((m) => read(m[1]))].join('\n')

  beforeAll(() => astroBuild(siteDir), 120_000)

  it('renders theme pages with the shadows in place', () => {
    const html = read('index.html')
    expect(html).toContain('site header')
    expect(html).not.toContain('theme header')
    expect(html).toContain('site menu')
  })

  it('wraps a theme component imported by its own path, and that component still gets the shadows of its imports', () => {
    const html = text(read('index.html'))
    expect(html).toContain('site wrap of 1 links')
    expect(html).toContain('theme footer: site-home')
  })

  it("ships the shadow's code for a hydrated island", () => {
    const html = read('index.html')
    expect(text(html)).toContain('site counter 0')
    const code = read(islandUrl(html))
    expect(code).toContain('site counter')
    expect(code).not.toContain('theme counter')
  })

  it('shadows a stylesheet, and keeps the styles of a wrapped .astro component', () => {
    const css = stylesOf(read('index.html'))
    expect(css).toContain('site-css')
    expect(css).not.toContain('theme-css')
    expect(css).toContain('site-card-style')
    expect(css).toContain('theme-card-style')
  })

  it('shadows an image with another image type', () => {
    expect(read('index.html').match(/<img[^>]*src="([^"]+)"/)?.[1]).toMatch(/png/)
  })

  it('routes the theme pages the site does not define', () => {
    expect(read('about/index.html')).toContain('theme about')
    expect(read('blog/first/index.html')).toContain('theme post first')
    expect(existsSync(path.join(siteDir, 'dist/_draft'))).toBe(false)
  })

  it("lets a site page replace a theme page, and import the theme's files by its name", () => {
    const html = read('replaced/index.html')
    expect(html).toContain('site replaced')
    expect(html).toContain('site header')
  })

  it('shadows a theme page file with a copy whose relative imports still reach the theme', () => {
    const html = read('shadowed/index.html')
    expect(html).toContain('site shadowed page')
    expect(html).toContain('site header')
  })

  it('keeps the styles of a shadowed page, its components and its layout', () => {
    const css = stylesOf(read('shadowed/index.html'))
    expect(css).toContain('site-shadowed-style')
    expect(css).toContain('site-card-style')
    expect(css).toContain('theme-card-style')
    expect(css).toContain('site-css')
  })
})

describe('a shadowed page that opts out of prerendering', () => {
  const root = path.join(fixtures, '.server-site')

  beforeAll(() => {
    rmSync(root, { recursive: true, force: true })
    writeFiles(root, {
      'package.json': sitePackageJson('server-site'),
      'astro.config.mjs': [
        "import react from '@astrojs/react'",
        "import { defineConfig } from 'astro/config'",
        `import { themeShadow } from '${path.join(packageRoot, 'src/index.ts')}'`,
        '',
        `export default defineConfig({ integrations: [react(), themeShadow({ themes: [{ name: '@fixture/theme', dir: '${themeDir}' }] })] })`,
        '',
      ].join('\n'),
      'src/@fixture/theme/pages/shadowed.astro': '---\nexport const prerender = false\n---\n\n<p>site server page</p>\n',
    })
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it("is read from the shadow, so the page needs an adapter like any server page", async () => {
    const output = await astroBuild(root).then(
      () => 'built',
      (error: { message: string; stdout?: string }) => `${error.message}\n${error.stdout ?? ''}`,
    )
    expect(output).toMatch(/adapter/i)
  }, 120_000)
})

describe('astro dev', () => {
  const origin = 'http://localhost:4391'
  const shadowDir = path.join(siteDir, 'src/@fixture/theme/components')
  const added = [path.join(shadowDir, 'Note.astro'), path.join(shadowDir, 'Toggle.tsx')]
  const sitePost = path.join(siteDir, 'src/pages/blog/[id].astro')
  const poll = { timeout: 30_000, interval: 500 }
  const get = async (url: string) => (await fetch(origin + url)).text()
  const getOrEmpty = (url: string) => get(url).catch(() => '')
  // Files the tests add; a run that was cut short can leave them behind.
  const removeAdded = () => {
    for (const file of added) rmSync(file, { force: true })
    rmSync(path.dirname(sitePost), { recursive: true, force: true })
  }

  beforeAll(async () => {
    removeAdded()
    await astroDev(siteDir, origin)
  }, 90_000)

  afterAll(async () => {
    removeAdded()
    await astro(['dev', 'stop'], siteDir)
  })

  it("serves the shadow's code for a hydrated island", async () => {
    const html = await get('/')
    expect(text(html)).toContain('site counter 0')
    const code = await get(islandUrl(html))
    expect(code).toContain('site counter')
    expect(code).not.toContain('theme counter')
  })

  it('shadows a theme page file', async () => {
    expect(await get('/shadowed')).toContain('site shadowed page')
  })

  it("knows a theme island's dependencies before the first request for them", async () => {
    const code = await get(islandUrl(await get('/about')))
    expect(code).toContain('clsx')
    // Vite logs a dependency it finds late ("dependency optimized: clsx") 200ms after bundling it.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(await astro(['dev', 'logs'], siteDir)).not.toMatch(/dependenc(y|ies) optimized|optimized dependencies changed/)
  })

  it("leaves the theme's tests and server-only code out of the browser's dependencies", () => {
    const metadata = JSON.parse(readFileSync(path.join(siteDir, 'node_modules/.vite/deps/_metadata.json'), 'utf8'))
    const optimized = Object.keys(metadata.optimized)
    expect(optimized).toContain('clsx')
    expect(optimized).not.toContain('vitest')
    expect(optimized).not.toContain('tinyglobby')
  })

  it('picks up a shadow added or removed while it runs', async () => {
    expect(await get('/about')).toContain('theme note')

    writeFileSync(added[0], '<aside>site note</aside>\n')
    writeFileSync(added[1], 'export default function Toggle() {\n  return <button>site toggle</button>\n}\n')
    await expect.poll(() => getOrEmpty('/about'), poll).toContain('site note')
    expect(await get(islandUrl(await get('/about')))).toContain('site toggle')

    for (const file of added) unlinkSync(file)
    await expect.poll(() => getOrEmpty('/about'), poll).toContain('theme note')
    expect(await get(islandUrl(await get('/about')))).toContain('theme toggle')
  }, 90_000)

  it('routes a site page added or removed while it runs, when it takes a theme route', async () => {
    expect(await get('/blog/first')).toContain('theme post first')

    mkdirSync(path.dirname(sitePost), { recursive: true })
    writeFileSync(
      sitePost,
      "---\nexport const getStaticPaths = () => [{ params: { id: 'first' } }]\n---\n\n<p>site post {Astro.params.id}</p>\n",
    )
    await expect.poll(() => getOrEmpty('/blog/first'), poll).toContain('site post first')

    unlinkSync(sitePost)
    await expect.poll(() => getOrEmpty('/blog/first'), poll).toContain('theme post first')
  }, 90_000)
})

/** Builds this package and installs it under `dest` from the tarball `pnpm pack` makes: only its published files. */
async function installPackage(dest: string) {
  await run('pnpm', ['build'], { cwd: packageRoot })
  const packDir = mkdtempSync(path.join(os.tmpdir(), 'theme-shadow-pack-'))
  try {
    const tarball = path.join(packDir, 'package.tgz')
    await run('pnpm', ['pack', '--out', tarball], { cwd: packageRoot })
    mkdirSync(dest, { recursive: true })
    await run('tar', ['-xzf', tarball, '-C', dest, '--strip-components=1'])
  } finally {
    rmSync(packDir, { recursive: true, force: true })
  }
}

describe('a theme installed as a package, and this package installed from its tarball', () => {
  const root = path.join(fixtures, '.npm-site')
  const read = (file: string) => readFileSync(path.join(root, 'dist', file), 'utf8')

  beforeAll(async () => {
    rmSync(root, { recursive: true, force: true })
    cpSync(themeDir, path.join(root, 'node_modules/@fixture/theme'), { recursive: true })
    await installPackage(path.join(root, 'node_modules/astro-theme-shadow'))
    writeFiles(root, {
      'package.json': sitePackageJson('npm-site'),
      'astro.config.mjs': [
        "import react from '@astrojs/react'",
        "import { defineConfig } from 'astro/config'",
        "import { themeShadow } from 'astro-theme-shadow'",
        '',
        "export default defineConfig({ devToolbar: { enabled: false }, integrations: [react(), themeShadow({ themes: ['@fixture/theme'] })] })",
        '',
      ].join('\n'),
      'src/@fixture/theme/components/Header.astro': '<header>site header</header>\n',
      'src/@fixture/theme/lib/name.js': "export const name = 'site name'\n",
      'src/components/Greet.tsx': [
        "import { greeting } from '@fixture/theme/src/lib/greeting.js'",
        '',
        'export default function Greet() {',
        '  return <p>{greeting}</p>',
        '}',
        '',
      ].join('\n'),
      'src/pages/extra.astro': [
        '---',
        "import Header from '@fixture/theme/src/components/Header.astro'",
        "import { greeting } from '@fixture/theme/src/lib/greeting.js'",
        "import Greet from '../components/Greet'",
        '---',
        '',
        '<html><head><title>extra</title></head><body>',
        '<Header />',
        '<p>{greeting}</p>',
        '<Greet client:load />',
        '</body></html>',
        '',
      ].join('\n'),
    })
    await astroBuild(root)
  }, 180_000)

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('shadows its files, imported from its pages or by package name', () => {
    expect(read('index.html')).toContain('site header')
    expect(read('extra/index.html')).toContain('site header')
  })

  it('bundles its plain .js files, which Vite would leave to Node, so their imports are shadowed too', () => {
    expect(read('extra/index.html')).toContain('hello, site name')
  })

  it('ships the shadows in the browser code too', () => {
    const scripts = readdirSync(path.join(root, 'dist/_astro')).filter((file) => file.endsWith('.js'))
    const code = scripts.map((file) => read(`_astro/${file}`)).join('\n')
    expect(code).toContain('site name')
    expect(code).not.toContain('theme name')
  })

  describe('in astro dev', () => {
    const origin = 'http://localhost:4392'
    const get = async (url: string) => (await fetch(origin + url)).text()

    beforeAll(() => astroDev(root, origin), 90_000)
    afterAll(() => astro(['dev', 'stop'], root))

    it('serves its plain .js files to the browser as source, so their imports are shadowed', async () => {
      const island = await get(islandUrl(await get('/extra')))
      const greetingUrl = island.match(/from\s*["']([^"']*greeting[^"']*)["']/)?.[1] ?? ''
      expect(greetingUrl).not.toContain('.vite/deps')
      expect(await get(greetingUrl)).toContain('/src/@fixture/theme/lib/name.js')
    })
  })
})
