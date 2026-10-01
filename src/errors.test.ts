import { describe, expect, it } from 'vitest'
import { RuleError, isRuleError } from './errors.js'

describe('a refusal', () => {
  it('carries its status, 403 when none is given', () => {
    expect(new RuleError('private').status).toBe(403)
    expect(new RuleError('not found', 404).status).toBe(404)
    expect(new RuleError('x', 400)).toBeInstanceOf(Error)
  })

  it('is recognised as this package\'s own, and an error with a 4xx status alone is not one', () => {
    class OtherError extends Error { constructor(message: string, public status: number) { super(message) } }
    expect(isRuleError(new RuleError('x', 409))).toBe(true)
    expect(isRuleError(new OtherError('upload not found or expired', 400))).toBe(false)
    expect(isRuleError(new OtherError('boom', 500))).toBe(false)
    expect(isRuleError(new Error('plain'))).toBe(false)
    expect(isRuleError({ message: 'not an Error', status: 400 })).toBe(false)
  })
})
