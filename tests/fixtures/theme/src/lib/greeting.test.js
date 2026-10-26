import { expect, it } from 'vitest'
import { greeting } from './greeting.js'

it('greets', () => expect(greeting).toMatch(/^hello/))
