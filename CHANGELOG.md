# Changelog

## 0.1.2 (2026-10-01)

- The phone's resend no longer depends on one app's refusal wording. On a retried Send, any 400,
  403 or 409 refusal makes it ask whether the snap was already filed (found: sent; gone: start over
  from a fresh ticket), whatever the host's pipeline calls it.
- A host `announce` that throws, or returns a promise that rejects, after its snap or comment was
  saved no longer turns the answer into a 500 (which made the phone send it twice). The failure
  goes to the new optional `host.log(message, err)`, or is dropped.
- A refusal answers with its own status only when that is 400-499 (403 when it has none). A refusal
  carrying any other status is logged and answers an opaque 500, instead of a success or a crash.
- Documented the host's duties: `media.filePhoto`/`fileVideo` must check the upload was issued to
  the member, claim it exactly once and refuse when the record exists; and a pipeline with
  refusals of its own must pass them as `isRefusal`, which the phone's resend relies on.
- README: points at the exported `CowitnessHost` type rather than an unshipped source file, and
  documents `ThreadSlotProps`. The publish workflow now runs the comment-date check.

## 0.1.1 (2026-10-01)

- First release through GitHub Actions with npm trusted publishing and provenance. No change to the package's behaviour.

## 0.1.0 (2026-10-01)

- First version: Cowitness moved out of the app it was built in, unchanged in behaviour.
