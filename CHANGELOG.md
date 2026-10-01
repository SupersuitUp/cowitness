# Changelog

Version convention: below 1.0, an addition is a patch and a breaking change is a minor (npm reads `^0.1.2` as 0.1.x only, so templates take a patch on their own and hold a minor for a person).

## 0.2.0 (2026-10-01)

Options, all off by default. With none turned on, for every request 0.1.3's own client sends, every answer, stored record, call into the host and screen is what 0.1.3 produced (a golden recorded from 0.1.3 proves it). One request 0.1.3's client never sent is now refused: with the options off, a filing body carrying `justUs: true` or non-null `tags` answers 400 instead of being filed with the field ignored, because ignoring it would show a private snap to everyone.

- The audience kind: the app says who shares and who witnesses (`people()`); each witness has their own seen (`witnessedBy`), their own queue and shelves; the first seen stays the snap's receipt.
- "Just us": a snap visible only to the people who share. It fails closed: a snap filed "just us" stays private whatever the options say later, and with no circle to say who shares it is its author's alone, across covers, counts, lists, signed links and announcements. Its author always sees it; someone who does not share cannot file one (400). Every announcement hands the app the snap with its flag, and the app must check each recipient with the new `mayHear` before telling them.
- Tags from a list the app supplies (`tags.list`, at most `tags.max` per snap, default one), set when sharing or later; `announce.tagged` tells the app, at filing and when they change.
- Voice notes as snaps: recorded into the phone's vault, sent under its own id so a retry files the same snap, transcribed afterwards like a spoken reaction, played from a signed link. The upload is stamped with who it was issued to (`x-goog-meta-cowitness-by`, in the ticket's `requiredHeaders`), and filing refuses bytes stamped for anyone else. Its words can be asked for again by its author at any time except during a live run, and by anyone else who can see it only when the run failed or stalled.
- Capture reminders: each person's own times, one person per reminder, snooze a day, claimed once before the app's `prompts.nudge` is called; `store.sendDuePrompts` runs from the app's own timer.
- The household streak: one count in one time zone from a start date, with one free skip a week when the app allows it. A person who only witnesses is shown no streak.
- The double camera can be turned off.
- `announce.spoken` tells the app when a spoken reaction is filed. It is opt-in by supplying the callback, not by an option: an app without it hears nothing new.
- `askPeopleOnce(host)` makes a request's store ask the app who its people are once. Make it per request, never at module scope.
- Screens: `CowitnessHome` takes `can`, `tagChoices` and `languages`; `SnapDetail` and `SnapsArchive` take `tagLabels`; `AddSnap` takes `shares`; new `VoiceNote`, `VoiceMedia` and `CaptureReminders`; `sendHeldVoiceSnaps` reports a note the server refused for good through `onDropped`.

Why a minor: `Snap.kind` now includes `'voice'` and `Snap`, `SnapRow` and `SnapPatch` gained members. Nothing behaves differently with the options off, but an app that branches on `kind` or assigns a `Snap` to its own photo type may need a line changed, so a template takes this through `living/bump.mjs --allow-major` and its own check, never silently.

## 0.1.3 (2026-10-01)

- A host's `commentImages.attach` that throws after a comment was saved no longer answers 500 (which
  made the phone send the comment again). The failure goes to `host.log('commentImages.attach
  failed', err)`, or is dropped, and the message is still announced.

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
