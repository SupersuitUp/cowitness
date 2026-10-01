import { isRuleError } from '../errors.js'

// Every route answers in one shape: a refusal's own words and status, an unreadable body as 400,
// anything else as an opaque 500 that is logged here and never shown to the client. What counts
// as a refusal is the package's own RuleError unless the host supplies its own check, so an error
// is never shown merely because it carries a 4xx status.
export async function handle(fn: () => Promise<Response>, isRefusal: (err: unknown) => boolean = isRuleError): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (isRefusal(err)) {
      const { message, status } = err as { message: string; status?: number }
      return Response.json({ error: message }, { status: typeof status === 'number' ? status : 403 })
    }
    // req.json() throws a SyntaxError on an unparsable body.
    if (err instanceof SyntaxError) return Response.json({ error: 'bad request' }, { status: 400 })
    console.error(err)
    return Response.json({ error: 'something went wrong' }, { status: 500 })
  }
}
