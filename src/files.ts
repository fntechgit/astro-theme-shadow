import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { ThemeConfig } from './types.js'

/**
 * Extensions that stand in for each other: a file can be shadowed by a file
 * of the same name with any extension of its family, so Footer.tsx shadows
 * Footer.jsx, but a stylesheet never shadows code. An extension in no family
 * (.astro among them) is matched by the exact name only.
 */
const FAMILIES = [
  ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'],
  ['.md', '.mdx'],
  ['.json', '.yaml', '.yml'],
  ['.css', '.sass', '.scss', '.less'],
  ['.jpeg', '.jpg', '.png', '.webp', '.avif', '.gif', '.svg'],
]

/** The names a match for `fileName` may have: the exact name first, then the rest of its family. */
export function candidateNames(fileName: string): string[] {
  const ext = path.extname(fileName)
  const stem = fileName.slice(0, fileName.length - ext.length)
  const family = FAMILIES.find((f) => f.includes(ext)) ?? []
  return [fileName, ...family.filter((e) => e !== ext).map((e) => stem + e)]
}

/**
 * The file at `rel` under `dir`, under its own name or another name of its
 * family; null if there is none. Names compare exactly, so a match found on
 * a case-insensitive disk is also found on a case-sensitive one.
 */
export function findFile(dir: string, rel: string): string | null {
  const parent = path.join(dir, path.dirname(rel))
  let names: string[]
  try {
    names = readdirSync(parent)
  } catch {
    return null
  }
  const match = candidateNames(path.basename(rel)).find((name) => names.includes(name))
  return match ? path.join(parent, match) : null
}

export const srcOf = (theme: ThemeConfig) => path.join(theme.dir, 'src')

export function isInside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

/**
 * Whether a file is one the OS or an editor leaves behind: a dotfile, such
 * as .DS_Store or a vim swap file, or a backup ending in ~.
 */
export const isLeftover = (file: string) => {
  const name = path.basename(file)
  return name.startsWith('.') || name.endsWith('~')
}

/** Every file under `dir` but the leftovers, sorted; empty when `dir` does not exist. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !isLeftover(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

/**
 * The directories that can shadow `theme`'s files, highest priority first:
 * the project's src/<theme name>/, then src/<theme name>/ inside each other
 * theme, the last theme first.
 */
export function shadowDirs(theme: ThemeConfig, themes: ThemeConfig[], srcDir: string): string[] {
  return [
    path.join(srcDir, theme.name),
    ...themes
      .filter((t) => t.name !== theme.name)
      .reverse()
      .map((t) => path.join(srcOf(t), theme.name)),
  ]
}

export interface ShadowMap {
  /** The shadows of each shadowed theme file, highest priority first. */
  chains: Map<string, string[]>
  /** The theme file each shadow stands in for. */
  originals: Map<string, string>
  /** Files in the project's shadow directories that shadow no theme file: a typo, or a theme file that moved. */
  orphans: string[]
}

/**
 * Which files shadow which. It is read once per start: the dev server
 * restarts when a shadow is added or removed.
 */
export function mapShadows(themes: ThemeConfig[], srcDir: string): ShadowMap {
  const chains = new Map<string, string[]>()
  const originals = new Map<string, string>()
  const orphans: string[] = []
  for (const theme of themes) {
    const dirs = shadowDirs(theme, themes, srcDir)
    const shadowed = new Set<string>()
    for (const [i, dir] of dirs.entries()) {
      for (const file of listFiles(dir)) {
        const original = findFile(srcOf(theme), path.relative(dir, file))
        if (original) {
          originals.set(file, original)
          shadowed.add(original)
        } else if (i === 0) orphans.push(file)
      }
    }
    // A directory with two shadows of one file uses the one findFile prefers: the exact name.
    for (const original of shadowed) {
      const rel = path.relative(srcOf(theme), original)
      chains.set(original, dirs.map((dir) => findFile(dir, rel)).filter((file) => file !== null))
    }
  }
  return { chains, originals, orphans: orphans.sort() }
}
