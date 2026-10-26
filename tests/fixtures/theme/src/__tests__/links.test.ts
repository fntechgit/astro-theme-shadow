import { expect, it } from 'vitest'
import { links } from '../components/links'

it('lists the links', () => expect(links).toHaveLength(2))
