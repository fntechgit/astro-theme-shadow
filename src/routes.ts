import path from 'node:path'
import { listFiles, type ShadowMap, srcOf } from './files.js'
import type { ThemeConfig } from './types.js'

/** The files Astro routes from src/pages, plus .mdx, which the MDX integration adds. */
const PAGE_EXTENSIONS = new Set(['.astro', '.html', '.md', '.markdown', '.mdown', '.mkdn', '.mkd', '.mdwn', '.mdx', '.js', '.ts'])

/**
 * Whether Astro routes `page`, a posix path relative to a pages directory.
 * Like Astro's own router, it skips any file or directory whose name starts
 * with `_`, and dot entries other than .well-known.
 */
export function isPage(page: string): boolean {
  return (
    PAGE_EXTENSIONS.has(path.extname(page)) &&
    page.split('/').every((part) => !part.startsWith('_') && (!part.startsWith('.') || part === '.well-known'))
  )
}

/** Every page file under `pagesDir`, as a posix path relative to it. */
export function listPages(pagesDir: string): string[] {
  return listFiles(pagesDir)
    .map((file) => path.relative(pagesDir, file).split(path.sep).join('/'))
    .filter(isPage)
}

/** The route pattern Astro gives a page: index.astro → /, blog/index.astro → /blog, rss.xml.ts → /rss.xml. */
export function routePattern(page: string): string {
  const route = page.slice(0, page.length - path.extname(page).length)
  return route === 'index' ? '/' : `/${route.replace(/\/index$/, '')}`
}

/** The route a page serves, the same for two pages that differ only in param names: blog/[id] and blog/[slug]. */
export const routeKey = (page: string) =>
  routePattern(page).replace(/\[(\.\.\.)?[^\]]*\]/g, (_, rest) => (rest ? '[...]' : '[]'))

export interface ThemeRoute {
  pattern: string
  entrypoint: string
}

/**
 * The theme pages to add as routes. A page in the site's own pages
 * directory replaces the theme page on the same route; when two themes
 * provide a route, the last theme wins and `warn` says so. A shadowed page
 * is routed to its shadow, because Astro reads a page's styles and its
 * prerender setting from the route's own file.
 */
export function themeRoutes(
  themes: ThemeConfig[],
  sitePagesDir: string,
  shadows: ShadowMap,
  warn: (message: string) => void,
): ThemeRoute[] {
  const taken = new Set(listPages(sitePagesDir).map(routeKey))
  const routes = new Map<string, ThemeRoute & { theme: string; page: string }>()
  for (const theme of themes) {
    const pagesDir = path.join(srcOf(theme), 'pages')
    for (const page of listPages(pagesDir)) {
      const pattern = routePattern(page)
      const key = routeKey(page)
      if (taken.has(key)) continue
      const previous = routes.get(key)
      if (previous?.theme === theme.name) {
        warn(`${pattern}: ${theme.name} has two pages for it, ${previous.page} and ${page}; using ${page}`)
      } else if (previous) {
        warn(`${pattern}: the page from ${theme.name} replaces the one from ${previous.theme}`)
      }
      const file = path.join(pagesDir, page)
      routes.set(key, { pattern, entrypoint: shadows.chains.get(file)?.[0] ?? file, theme: theme.name, page })
    }
  }
  return [...routes.values()].map(({ pattern, entrypoint }) => ({ pattern, entrypoint }))
}
