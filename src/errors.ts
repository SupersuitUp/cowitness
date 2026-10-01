export type RuleStatus = 400 | 401 | 403 | 404 | 409

// A refusal a person can be told about: its message is written for a reader and goes back to the
// client word for word, with its status.
export class RuleError extends Error {
  constructor(message: string, public status: RuleStatus = 403) {
    super(message)
  }
}

// Whether an error is this package's own refusal. A host app with refusals of its own says so
// through the optional `isRefusal` hook on its host, so an error is never shown to a client merely
// because it carries a 4xx status.
export function isRuleError(err: unknown): err is RuleError {
  return err instanceof RuleError
}
