import { globSync } from 'tinyglobby'

/** Server-only code: it imports a package the browser never needs. */
export const GET = () => Response.json({ glob: typeof globSync })
