# @supersuit/cowitness

Cowitness: you share a photo, a video or a voice note from your day, and the people you share with witness it.
They go through what is waiting one item at a time, full screen, and can say something back,
typed or spoken. You can see when they have seen it. A streak counts the days in a row you shared.

The package knows how the feature works: the record of a snap, every rule (who sees what, what is
waiting for whom and in what order, hiding, streaks, how long a spoken reaction may be), reading
and writing snaps, every screen, spoken reactions held on the phone until the server has them,
and the request handlers. The app says who the people are, where things are kept, how a file is
uploaded, what each moment becomes for the people told, and how it looks.

## Install

```bash
npm install @supersuit/cowitness
```

Peers: `react` and `react-dom` 19, `next` 16, and `firebase-admin` 13 for the server entry. With
Tailwind 4, add to the stylesheet that imports Tailwind:

```css
@source "../node_modules/@supersuit/cowitness/dist";
```

## Three entry points

- `@supersuit/cowitness`: the types and every rule, pure (`snapRow`, `streaksOf`, `cowitnessTile`, ...).
- `@supersuit/cowitness/server`: `createCowitnessStore(host)` and `createCowitnessHandlers(host)`. Server only.
- `@supersuit/cowitness/client`: `CowitnessProvider`, `CowitnessHome`, `SnapDetail`, `SnapsArchive`,
  `StreakStrip`, `AddSnap`, `WitnessSession`, and the recording pieces other screens may share.

## The host (server)

The `CowitnessHost<M>` type, exported from `@supersuit/cowitness/server`, documents every member in
its JSDoc. In short:

- `member(req)` says who is asking, or `null`. **The host enforces membership**: the package asks
  who the caller is and acts for that member, but it never decides who may use the feature at all.
  Anyone `member` returns can read and write snaps, so `member` is where a signed-out visitor, or
  a signed-in stranger, is turned away.
- `db()` and `collection`: the Firestore list snaps are kept in.
- `storage.bucket()` and `storage.prefix`: spoken reactions are stored at
  `<prefix>snaps-audio/<snap>/<id>.<ext>`.
- `media.urls`, `media.signedUrl`, and the app's own upload pipeline as `media.filePhoto` and
  `media.fileVideo`.
- `announce.shared / witnessed / message / heart`: what each moment becomes for the people told.
  The package never sends a push itself. Two more are optional: `announce.spoken` (a spoken
  reaction was filed; its words arrive later) and `announce.tagged` (a snap's tags were set, when
  it was shared or later). Each is called only if the host supplies it: `spoken` is how an app opts
  in to hearing about spoken reactions, and `tagged` is only ever called when tags are on.
- Optional `commentImages` for pictures sent in messages, and optional `transcription` (without it,
  spoken reactions stay playable with no words).
- Optional `isRefusal(err)`. A refusal is an error whose words reach the phone. The package's own
  rule errors are always refusals; `isRefusal` **adds** to them and never replaces them, so an
  app lists only its own. An error that is not a refusal never has its words sent to the phone,
  whatever status it carries. A refusal answers with its `status` when that is 400-499, and 403
  when it has none; any other status is treated as an internal error (logged, opaque 500).
- `media.urls` is never given a voice snap. A voice snap has no picture, so its one URL, the
  recording's, comes from `media.signedUrl`, behind the same visibility check.
- The options' parts, each needed only when its option is on: `features`, `people()`, `tags` and
  `prompts` (see [Options](#options)).
- Optional `log(message, err)`: where failures the person must not see are reported, such as an
  `announce` call or a `commentImages.attach` that throws after its snap or comment was saved. That
  failure never changes the route's answer; without `log` it is dropped.

### What the host is responsible for

The package hands these security decisions to the host, and cannot check them for you.

- **`member` turns away anyone who is not a member.** See above.
- **`media.filePhoto` and `media.fileVideo` guard the upload.** The `photoId` a phone sends comes
  straight from the request body and becomes the snap's id, so the pipeline must:
  - check that the upload was issued to the member `m` it is filing for;
  - claim it exactly once;
  - refuse when `into.ref` already exists.

  Without those checks a member could file over another member's snap, or take another member's
  upload.
- **Your pipeline's refusals must reach the phone, so pass them as `isRefusal`.** If
  `media.filePhoto`, `media.fileVideo` or `transcription.transcribe` throw refusals of your own
  (an expired or already-claimed upload, a transcriber's readable reason), list them in
  `isRefusal`. The phone's resend depends on it. A Send whose first answer was lost files the same
  id again, and a 400, 403 or 409 from your pipeline is what makes the phone ask whether the snap
  was already filed. If `isRefusal` leaves them out, that refusal becomes an opaque 500 and the
  retry fails. The person then sends again, and a second snap is filed. The wording is yours; the
  phone reads only the status.
- **An announcement MUST be filtered with `mayHear`.** Every announcement hands the host the snap,
  and a "just us" snap carries `justUs: true`. Before telling anyone, check each recipient:

  ```ts
  import { circleOf, mayHear } from '@supersuit/cowitness'

  const circle = witnessing === 'audience' || justUs ? circleOf(witnessing, await people()) : undefined
  const told = everyone.filter((p) => p !== actor && mayHear(snap, p, circle))
  ```

  Pass a circle exactly when the package builds one: when the audience kind or "just us" is on,
  made from `people()` as it reads now. With neither on, pass none, and never keep a circle from
  before an option was turned off. A snap filed "just us" stays "just us" after the option goes off,
  and with no circle it may be told to its author only. "Tell everyone but the actor" puts a private
  moment on the lock screen of a person every route refuses to show it to.
- **Apply a lifecycle rule to abandoned voice uploads.** A voice note goes straight to storage on a
  signed PUT, at `<prefix>snaps-voice/<snap>.<ext>`, before it is filed, so a phone that uploads
  and never files leaves bytes nobody will play. Filed notes live at the same paths, and a storage
  age rule cannot tell the two apart, so the rule runs from the app's own timer: delete objects
  under `<prefix>snaps-voice/` older than a day whose id has no snap in the collection.

## Options

With no options the package is exactly what 0.1.3 was; every new field is optional and written
only by an app that turned its option on. This holds for every request 0.1.3's own client sends.
One request it did not send is now refused: with the options off, a filing body that carries
`justUs: true` or any `tags` but `null` answers 400 rather than being filed with the field ignored, because an app
that sends them believes the option is on, and ignoring the flag would show a private snap to
everyone.

Turn options on in `host.features` (`Partial<CowitnessFeatures>`), and pass the same value to the
screens as `config.features`. A misspelt option or a wrong value is refused when the app starts, and
so is an option turned on without the host part it needs.

| Option | What it does for a person | Host part it needs | Default | Record fields it writes |
|---|---|---|---|---|
| `witnessing: 'audience'` | Some people share and others only witness (a household and its relatives). Each witness has their own seen, their own queue and their own shelf; the first seen stays the snap's receipt for the person who shared it. | `people()`, each person's `role`: `'shares'`, `'witnesses'` or `'both'` | `'each-other'`: everyone shares and witnesses everyone else | `witnessedBy` (each witness's seen) |
| `justUs: true` | A snap can be marked "just us": seen only by the people who share. | `people()` | off | `justUs: true`, only when set |
| `tags: true` | A snap is tagged from the app's list, when it is shared or later. | `tags.list()`, and `tags.max` per snap (default 1) | off | `tags`, only a non-empty list |
| `voiceSnaps: true` | A voice note can be shared as a snap, played with its words under it. | `transcription` makes the words; without it a voice snap plays with none | off | `kind: 'voice'` and `voice` |
| `prompts: true` | Capture reminders at each person's own times, one person per reminder, "not today" for a day. | `prompts`: `collection`, `timeZone`, `people()`, `save()`, `nudge()` | off | none on a snap; one claim per reminder sent in `prompts.collection` |
| `streak: { kind: 'household', ... }` | One streak for everyone who shares, in one time zone, from a start date, with one free skip a week when `freeSkipsPerWeek` is 1. A person who only witnesses is shown no streak. | none | `{ kind: 'each-and-together' }` | none |
| `doubleCamera: false` | The share sheet stops offering the double camera. | none | on | none |

A record without the new fields reads exactly as before. A snap filed "just us" stays private
whatever the options say later: with no circle to say who shares, it is its author's alone.

### Running reminders

The package never sends a reminder on its own schedule. The app calls `store.sendDuePrompts(new Date())`
from its own authorized timer (a cron route that checks its own secret, for example). Every ten
minutes is enough: a slot stays due for an hour, and each one is claimed in `prompts.collection`
before it is sent, so overlapping or repeated runs never send it twice. The app decides in
`prompts.nudge(m, slotKey)` what a reminder becomes, usually a push.

## Mounting the handlers

| `createCowitnessHandlers(host)` | Route file (segment config stays in the file) |
|---|---|
| `.snaps.GET` | `<api>/route.ts` |
| `.photo.POST`, `.video.POST` | `<api>/photo/route.ts`, `<api>/video/route.ts` |
| `.snap.GET`, `.snap.PATCH` | `<api>/[id]/route.ts` |
| `.reactions.POST` | `<api>/[id]/reactions/route.ts`, with `export const maxDuration = 300` |
| `.reactionUploadUrl.POST` | `<api>/[id]/reactions/upload-url/route.ts` |
| `.reactionAudio.GET` | `<api>/[id]/reactions/[commentId]/audio/route.ts` |
| `.reactionTranscribe.POST` | `<api>/[id]/reactions/[commentId]/transcribe/route.ts`, with `maxDuration = 300` |
| `.voiceUploadUrl.POST` | `<api>/voice/upload-url/route.ts` |
| `.voice.POST` | `<api>/voice/route.ts`, with `export const maxDuration = 300` |
| `.voiceTranscribe.POST` | `<api>/[id]/voice/transcribe/route.ts`, with `maxDuration = 300` |
| `.prompts.GET`, `.prompts.PATCH` | `<api>/prompts/route.ts` |

Each file is `export const runtime = 'nodejs'` and one line such as `export const { GET, PATCH } = handlers.snap`.
`photo`, `video`, `voice` and `prompts` are static segments beside `[id]`, which Next.js matches
first. The option routes answer 404 while their option is off.

The voice upload ticket (`voiceUploadUrl`) answers `{ snapId, url, requiredHeaders }`, or
`{ snapId, uploaded: true }` when the bytes are already there. The PUT must send `requiredHeaders`
exactly as issued: they are signed, and they include `x-goog-meta-cowitness-by`, which stamps the
bytes with who the ticket was issued to. Filing refuses bytes stamped for someone else, or not
stamped at all, with 403, so nobody can file another person's recording by naming its id. The
package's own phone code (`sendVoiceSnap`) does this already.

A voice snap's words can be asked for again (`voiceTranscribe`): by the person who shared it at any
time except during a live run, and by anyone else who can see it only when the run failed or has
stalled for five minutes. A spoken reaction's words, as before, can be asked for again by anyone
who can see the snap, except during a live run.

## The screens (client)

Render the screens inside `CowitnessProvider`, from one of the app's own `'use client'`
components, because `renderThread` is a function:

```tsx
<CowitnessProvider
  config={{ apiBase, pageBase, uploadUrls: { photo, video }, vaultName, renderThread: (p) => <MyThread {...p} /> }}
  theme={{ serif, bg, ink, muted, hairline, onInk, accent, accentTint, accentSoft, danger, placeholder }}
>
  <CowitnessHome rows={rows} streak={streak} witnessed={witnessed} queue={queue} me={me} names={names} />
</CowitnessProvider>
```

**Config: pass every value, because nothing defaults.** The package cannot guess where an app
mounted its routes or what it calls things, so a missing value is a wrong address, not a fallback.

| Config value | What it is |
|---|---|
| `apiBase` | Where the app mounted the snap handlers; a snap is `<apiBase>/<id>`. |
| `pageBase` | Where the Cowitness pages live: the shelf at `<pageBase>/witnessed`, a snap at `<pageBase>/<id>`. |
| `uploadUrls.photo`, `uploadUrls.video` | The app's own upload-ticket routes, which a snap's bytes travel through. |
| `vaultName` | The IndexedDB database spoken reactions wait in until the server has them. An app that held recordings before it used this package passes the name it always used. |
| `renderThread` | Draws the conversation under a snap, so messages look like every other conversation in the app. |
| `features` | Optional. The options, the same value the host has. Absent: none, and the screens are exactly 0.1.3's. A screen given different options from the server offers what the server refuses. |

`renderThread` is given `ThreadSlotProps`:

| Prop | What it is |
|---|---|
| `snapId` | The snap the conversation belongs to. |
| `me` | The member key of the person looking. |
| `names` | Each member key's display name. |
| `comments` | The snap's conversation as the server last sent it, or `undefined` when it has none. |
| `onSent(next)` | Call with the server's conversation after a send lands, so the snap shows it. |
| `audioSrc(c)` | Where a message's recording plays from, or `null` when it has none. |
| `onRetranscribe(commentId)` | Call to transcribe a message's recording again, with no re-recording. |

**Theme: every token.** A token left out keeps a neutral default.

| Token | What it colours |
|---|---|
| `serif` | The font stack for headings and captions. |
| `bg` | The page background, and the background a double-camera snap is drawn on. |
| `ink` | Text and the full-screen backdrop. Must be `#rrggbb`: a video with no poster is drawn in ink at 90%. |
| `muted` | Secondary text. |
| `hairline` | Dividers and borders. |
| `onInk` | Text drawn on top of ink. |
| `accent` | The unseen dot, the streak and the primary actions. |
| `accentTint` | The accent's pale background. |
| `accentSoft` | The softer accent a failed-save note is written in. |
| `danger` | Destructive actions and errors. |
| `placeholder` | The hint text inside an empty field. |

`rows`, `streak`, `witnessed` and `queue` come from `store.listCowitness(me)` in a server
component. `names` maps each member key to a display name and is passed from the server, so names
never ship to a signed-out visitor.

**Make the store per request, with `askPeopleOnce`:**

```ts
const store = createCowitnessStore(askPeopleOnce(host))
const [can, tagChoices, home] = await Promise.all([store.whoAmI(me), store.tagChoices(), store.listCowitness(me)])
```

A page drawn from several store calls would otherwise ask the app who its people are once per call;
a store made from `askPeopleOnce(host)` asks once for the whole request. Make it inside the request,
never at module scope: a store made once per process keeps the people it first read until a
redeploy, so a person moved from sharing to only witnessing would go on seeing "just us" snaps, and a
failed first read would fail every request after it. A host with no `people()` is handed back as
it is.

### The screens with options

- `CowitnessHome` takes `can` (`{ share, witness }`, from `store.whoAmI(me)`; default both), so a
  person who only witnesses is never offered the share sheet and is shown no household streak, and a
  person who only shares is not told what is waiting. `tagChoices` (from `store.tagChoices()`) is the
  list the share sheet tags from, and `languages` the languages a voice note's speaker may name.
- `SnapDetail` and `SnapsArchive` take `tagLabels` (each tag id's label), and show a snap's tags
  only when it is given.
- `AddSnap` takes `shares`: "just us" is offered only when it is true, because the server refuses
  it from anyone else. It defaults to false; `CowitnessHome` passes `can.share`.
- `VoiceMedia` plays a voice snap with its words under it. Pass `me`, the person looking, so "Try
  again" is offered exactly where the server allows it (see the voice transcription rule above);
  without `me` it is offered only for a failed or stalled run. `SnapDetail` and `WitnessSession`
  use it already.
- `VoiceNote` is the record button: tap to record, tap to stop, every second kept in the phone's
  vault as it is made. `onRecorded({ blob, durationSec, id })` is handed the note; `onCancel` is
  optional, and Cancel is drawn only when it is given. `vaultKey` names what the note is held as (a
  voice snap by default).
- `sendVoiceSnap` sends a held voice note as a snap, under its own id, so a retry files the same
  snap. `sendHeldVoiceSnaps(vault, send?, onDropped?)` resends what is still held; a note the server
  refuses for good (a 4xx other than 408 or 429) is let go and `onDropped({ id, caption, status })`
  is told once, so the app can say so in a line rather than retry it every visit.
- `CaptureReminders` edits a person's own reminder times and "not today" against `<api>/prompts`.
  Its `initial` is `store.promptSettings(me)`, and its children are drawn inside it: put the app's
  own notification switch there, since a reminder is only as good as the permission to show it.
- `sendReaction(snapId, blob, durationSec, commentId)` files a spoken reply under a snap, for an
  app whose own conversation (`renderThread`) records spoken replies.

## Releasing

A release is a version tag. Bump `version` (`npm version <x.y.z> --no-git-tag-version`), add the
CHANGELOG entry, commit `package.json` and `package-lock.json` together, push, then
`git tag v<x.y.z> && git push origin v<x.y.z>`. GitHub Actions tests, builds and publishes through
npm trusted publishing. Nothing is ever published from a laptop.
