# @supersuit/cowitness

Cowitness: you share a photo or video from your day, and the people you share with witness it.
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
  The package never sends a push itself.
- Optional `commentImages` for pictures sent in messages, and optional `transcription` (without it,
  spoken reactions stay playable with no words).
- Optional `isRefusal(err)`. A refusal is an error whose words reach the phone. The package's own
  rule errors are always refusals; `isRefusal` **adds** to them and never replaces them, so an
  app lists only its own. An error that is not a refusal never has its words sent to the phone,
  whatever status it carries. A refusal answers with its `status` when that is 400-499, and 403
  when it has none; any other status is treated as an internal error (logged, opaque 500).
- Optional `log(message, err)`: where failures the person must not see are reported, such as an
  `announce` call or a `commentImages.attach` that throws after its snap or comment was saved. That
  failure never changes the route's answer; without `log` it is dropped.

### What the host is responsible for

The package hands three security decisions to the host, and cannot check them for you.

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

Each file is `export const runtime = 'nodejs'` and one line such as `export const { GET, PATCH } = handlers.snap`.

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

`rows`, `streak`, `witnessed` and `queue` come from `createCowitnessStore(host).listCowitness(me)`
in a server component. `names` maps each member key to a display name and is passed from the
server, so names never ship to a signed-out visitor.

## Releasing

A release is a version tag. Bump `version` (`npm version <x.y.z> --no-git-tag-version`), add the
CHANGELOG entry, commit `package.json` and `package-lock.json` together, push, then
`git tag v<x.y.z> && git push origin v<x.y.z>`. GitHub Actions tests, builds and publishes through
npm trusted publishing. Nothing is ever published from a laptop.
