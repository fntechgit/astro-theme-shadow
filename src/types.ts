export interface ThemeConfig {
  /** The theme's package name, e.g. '@acme/event-site'. */
  name: string
  /** The theme's root directory: the one that holds its package.json and src/. */
  dir: string
}

/**
 * A theme package name, resolved from the project's root, or a
 * ThemeConfig for a theme that is not installed as a package.
 */
export type ThemeEntry = string | ThemeConfig

export interface ThemeShadowOptions {
  /** Themes in priority order: when two themes provide a route, the last one wins. */
  themes: ThemeEntry[]
  /** Whether each theme's src/pages becomes routes of the site (default: true). */
  routes?: boolean
}
