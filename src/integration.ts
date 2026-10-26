import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { convertPathToPattern } from 'tinyglobby'
import type { Plugin } from 'vite'
import { isInside, isLeftover, mapShadows, srcOf } from './files.js'
import { isPage, listPages, routeKey, themeRoutes } from './routes.js'
import { shadowPlugin } from './shadow-plugin.js'
import type { ThemeConfig, ThemeEntry, ThemeShadowOptions } from './types.js'

/**
 * Themes named by package resolve from the project root. Directories are
 * real paths with the names as they are on disk, because Vite's module ids
 * are.
 */
export function resolveThemes(entries: ThemeEntry[], root: string): ThemeConfig[] {
  const require = createRequire(path.join(root, 'package.json'))
  return entries.map((entry) => {
    if (typeof entry !== 'string') return { name: entry.name, dir: realpathSync.native(path.resolve(root, entry.dir)) }
    let manifest: string
    try {
      manifest = require.resolve(`${entry}/package.json`)
    } catch (cause) {
      throw new Error(
        `astro-theme-shadow: cannot find the theme ${entry} from ${root}. ` +
          `Install it; if its package.json has "exports", it must export "./package.json".`,
        { cause },
      )
    }
    return { name: entry, dir: path.dirname(realpathSync.native(manifest)) }
  })
}

/** The files Astro scans for dependencies in the site's src: all code for the server, the files that can hold browser code for the client. */
const SERVER_CODE = '{astro,jsx,tsx,js,mjs,ts,mts,mdx,vue,svelte,html}'
const CLIENT_CODE = '{astro,jsx,tsx,mdx,vue,svelte,html}'

/**
 * Vite pre-bundles the dependencies it finds by scanning the project's src.
 * Theme files sit outside it, so their dependencies would be found
 * mid-request and bundled a second time, and the first render would meet
 * two copies of React ("Invalid hook call"). This scans the themes the way
 * Astro scans the site. Vite skips test folders only when no one sets the
 * scan entries, so the themes' tests are left out here.
 *
 * The themes themselves are never pre-bundled, so their imports always
 * reach the shadow plugin: the browser gets them as source, and server
 * builds bundle them where Vite would leave a package's plain .js files to
 * Node.
 */
function themeDependencies(themes: ThemeConfig[]): Plugin {
  const scan = (extensions: string) =>
    themes.flatMap((t) => {
      const src = convertPathToPattern(srcOf(t))
      return [`${src}/**/*.${extensions}`, `!${src}/**/__tests__/**`, `!${src}/**/*.{test,spec}.*`]
    })
  const names = themes.map((t) => t.name)
  return {
    name: 'astro-theme-shadow:dependencies',
    configEnvironment: (name) =>
      name === 'client'
        ? { optimizeDeps: { entries: scan(CLIENT_CODE), exclude: names } }
        : { optimizeDeps: { entries: scan(SERVER_CODE) }, resolve: { noExternal: names } },
  }
}

/**
 * Restarts the dev server when a file is added or removed that changes what
 * a theme file or route resolves to, the way editing astro.config does.
 * Astro restarts when a path given to addWatchFile changes; `trigger` is
 * such a path, and this reports a change to it.
 */
function restartOn(changesResolution: (file: string) => boolean, trigger: string): Plugin {
  return {
    name: 'astro-theme-shadow:restart',
    configureServer(server) {
      const onAddOrRemove = (file: string) => {
        if (changesResolution(file)) server.watcher.emit('change', trigger)
      }
      server.watcher.on('add', onAddOrRemove)
      server.watcher.on('unlink', onAddOrRemove)
    },
  }
}

/**
 * Theme shadowing for Astro. The site gets every page in each theme's
 * src/pages that it does not define itself, and replaces any theme file by
 * putting a file at the same path under src/<theme name>/.
 */
export function themeShadow(options: ThemeShadowOptions): AstroIntegration {
  return {
    name: 'astro-theme-shadow',
    hooks: {
      'astro:config:setup': ({ config, injectRoute, addWatchFile, updateConfig, logger }) => {
        const root = path.resolve(fileURLToPath(config.root))
        // `srcDir` is how the file watcher names files; the plugin compares
        // against Vite's ids, which are real paths.
        const srcDir = path.resolve(fileURLToPath(config.srcDir))
        const realRoot = realpathSync.native(root)
        const realSrcDir = existsSync(srcDir) ? realpathSync.native(srcDir) : srcDir
        const themes = resolveThemes(options.themes, root)

        const shadows = mapShadows(themes, realSrcDir)
        if (shadows.orphans.length > 0) {
          const list = shadows.orphans.map((file) => `  ${path.relative(realRoot, file)}`).join('\n')
          throw new Error(`astro-theme-shadow: these files shadow no theme file:\n${list}`)
        }

        const withRoutes = options.routes !== false
        const sitePages = path.join(srcDir, 'pages')
        if (withRoutes) {
          for (const route of themeRoutes(themes, sitePages, shadows, (message) => logger.warn(message))) injectRoute(route)
        }

        const shadowRoots = themes.map((t) => path.join(srcDir, t.name))
        const themeRouteKeys = new Set(themes.flatMap((t) => listPages(path.join(srcOf(t), 'pages')).map(routeKey)))
        const takesThemeRoute = (file: string) => {
          const page = path.relative(sitePages, file).split(path.sep).join('/')
          return isInside(file, sitePages) && isPage(page) && themeRouteKeys.has(routeKey(page))
        }
        addWatchFile(srcDir)

        updateConfig({
          vite: {
            plugins: [
              shadowPlugin({ themes, root: realRoot, srcDir: realSrcDir, shadows }),
              themeDependencies(themes),
              restartOn(
                (file) =>
                  !isLeftover(file) &&
                  (shadowRoots.some((dir) => isInside(file, dir)) || (withRoutes && takesThemeRoute(file))),
                srcDir,
              ),
            ],
          },
        })
      },
    },
  }
}
