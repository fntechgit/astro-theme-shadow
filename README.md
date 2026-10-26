# astro-theme-shadow

Themes for Astro. A site gets every page of a theme package, and replaces any
theme file by putting a file at the same path in its own `src/`.

## Install

It is not on npm. Check the repository out next to your project, build it,
and link it:

```bash
git clone https://github.com/fntechgit/astro-theme-shadow.git ../astro-theme-shadow
pnpm --dir ../astro-theme-shadow install
pnpm --dir ../astro-theme-shadow build
pnpm add link:../astro-theme-shadow
```

In CI, check it out at a pinned commit.

Needs Astro 7. Runs on macOS and Linux; Windows paths are not handled yet.

## Quick start

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import { themeShadow } from 'astro-theme-shadow'

export default defineConfig({
  integrations: [themeShadow({ themes: ['@acme/event-site'] })],
})
```

The site now serves every page in `@acme/event-site/src/pages/`.

## Pages

Each page in a theme's `src/pages/` becomes a route of the site, by the same
rules as Astro's own `src/pages/`: `blog/[slug].astro` serves `/blog/[slug]`,
and files and folders starting with `_` are skipped.

A page in the site's own `src/pages/` replaces the theme page on the same
route. Two pages are on the same route even when their params have different
names, like `blog/[id].astro` and `blog/[slug].astro`.

## Shadowing

To replace `@acme/event-site/src/components/Footer.tsx`, put your own file at
the same path under `src/<theme name>/`:

```
your-site/
└── src/
    └── @acme/
        └── event-site/
            └── components/
                └── Footer.tsx    ← replaces the theme's Footer
```

Every import of the theme file gets yours instead: imports from theme pages
and components, imports from your own pages, hydrated islands, and the page
files themselves. A shadowed page keeps its own styles and its own
`prerender` setting.

Import theme files by the theme's name, like
`@acme/event-site/src/components/Footer.tsx`. A relative path from your site
into a theme is not shadowed.

The file can have another extension of the same family:

| Family | Extensions |
|--------|------------|
| Code | `.js` `.jsx` `.ts` `.tsx` `.mjs` `.cjs` `.mts` `.cts` |
| Markdown | `.md` `.mdx` |
| Data | `.json` `.yaml` `.yml` |
| Stylesheets | `.css` `.sass` `.scss` `.less` |
| Images | `.jpeg` `.jpg` `.png` `.webp` `.avif` `.gif` `.svg` |

So `Footer.tsx` replaces `Footer.jsx`, and `logo.png` replaces `logo.svg`. Any
other extension, `.astro` included, matches only itself. The file still has to
work where the theme imports it: Vite imports YAML only with a YAML plugin,
and an SVG the theme renders as a component needs an SVG.

Every file under `src/<theme name>/` must replace a theme file. A file that
matches none fails the build and lists the file: it is a typo, or the theme
moved the file it replaced. Files the OS and editors leave behind are
ignored: names that start with a dot, like `.DS_Store`, and backups ending
in `~`.

### Wrapping the theme file

To change a theme component without copying it, import the theme's file by
its normal path. Your file is the one place that gets the theme's file:

```tsx
// src/@acme/event-site/components/Footer.tsx
import ThemeFooter from '@acme/event-site/src/components/Footer'

export default function Footer() {
  return (
    <div className="site-footer">
      <ThemeFooter />
    </div>
  )
}
```

The import is the theme's real path, so TypeScript and editors know its types.
The theme's Footer still gets your shadows of the files it imports.

### Copying the theme file

You can start a shadow by copying the theme file. Its imports keep working:
an import that does not resolve from your file resolves from the theme file
it replaces. That covers relative imports of the theme's other files, and
packages the theme depends on but your site does not.

TypeScript does not know about that fallback, so your editor flags those
imports. Change them to the theme's path, like
`@acme/event-site/src/components/links`, to keep the types.

### In dev

Adding or removing a shadow restarts the dev server, the same way editing
`astro.config` does. So does adding or removing a page that takes a theme
page's route. Editing a file updates the page as usual.

Only your site's files trigger a restart. After a change inside a theme's own
folder, like a new page, restart the dev server yourself.

## Multiple themes

```js
themeShadow({ themes: ['@acme/base', '@acme/conference'] })
```

When two themes have a page on the same route, the last theme wins and a
warning says so.

A theme can shadow another theme's files, in its own `src/<other theme name>/`.
Your site's shadows come first, then those of the other themes, last theme
first.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `themes` | `(string \| { name, dir })[]` | required | Theme package names, resolved from the project root. Use `{ name, dir }` for a theme that is not installed as a package; `dir` is relative to the project root, and the theme's files are still imported by its name. |
| `routes` | `boolean` | `true` | Whether the themes' pages become routes of the site. |

## Writing a theme

A theme is a package with its files under `src/` and its pages under
`src/pages/`. Declare `astro` as a peer dependency, and export `src/` and the
package.json:

```json
{
  "name": "@acme/event-site",
  "type": "module",
  "exports": {
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "peerDependencies": {
    "astro": "^7"
  }
}
```

## Limits

- A file reached through CSS `@import` or `url()` is not shadowed: Vite
  resolves those itself, without plugins. Shadow the stylesheet that has the
  `@import` instead.
- A theme's `public/` folder is not served: Astro serves one public folder,
  the site's.
- Astro reads `src/middleware`, `src/actions` and `src/content.config` from
  the site only, never from a theme. Re-export the theme's from the site's own
  files, or have the theme's integration add its middleware.

## Development

```bash
pnpm test        # unit tests, plus real Astro builds and dev servers over tests/fixtures
pnpm typecheck
pnpm build       # compiles src/ to dist/
```

## License

MIT
