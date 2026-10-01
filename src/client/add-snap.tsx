'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SNAP_CAPTION_MAX } from '../snap-rules.js'
import { BottomSheet } from './bottom-sheet.js'
import { PhotoInput } from './photo-input.js'
import { SnapCamera } from './snap-camera.js'
import { openStream } from './dual-camera.js'
import { askForMotion } from './upright.js'
import { PickedPreview } from './picked-preview.js'
import { postSnap, type SentSnap } from './snap-upload.js'
import type { TagChoice } from '../types.js'
import { clientFeatures } from './config.js'
import { VoiceNote } from './voice-note.js'
import { sendVoiceSnap, voiceSnapKey } from './voice-snap.js'
import { formatClock } from './recorder.js'
import { forget, indexedDbVault, keepMeta, keepNoteId, memoryVault } from './recording-vault.js'
import { DANGER, HAIRLINE, INK, MUTED, ON_INK, PLACEHOLDER, SERIF } from './theme.js'

// Two ways to a snap and one way to send it. Take a snap opens the camera and Choose a photo
// opens the library; both happen inside the tap, or iOS refuses them. Either one ends as a file,
// and the sheet rises on the file, for an optional caption and Send. Each option the app turned on
// adds its own piece (a voice note, "just us", a tag) and with every option off nothing is added.
// "Just us" is offered only to a person the app says shares (`shares`), because the server refuses it
// from anyone else.
export function AddSnap({ tagChoices = [], languages, shares = false }: { tagChoices?: TagChoice[]; languages?: readonly string[]; shares?: boolean } = {}) {
  const router = useRouter()
  const f = clientFeatures()
  const [justUs, setJustUs] = useState(false)
  const [tag, setTag] = useState('')
  const [voice, setVoice] = useState<{ blob: Blob; durationSec: number; id: string } | null>(null)
  const [recording, setRecording] = useState(false)
  const [language, setLanguage] = useState('auto')
  // A voice note whose send failed is held for the next visit, with what was typed for it. One that
  // was never sent is not: closing the sheet throws it away.
  const heldForResend = useRef(false)
  const photos = useRef<HTMLInputElement>(null)
  const videos = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle')
  // The back camera, asked for in the tap that opens the capture layer. Null: the layer is shut.
  const [camera, setCamera] = useState<Promise<MediaStream> | null>(null)
  const [progress, setProgress] = useState(0)
  // What an earlier Send of this same pick already stored, so trying again files it rather than
  // uploading it twice. A new pick, or closing the sheet, forgets it.
  const sent = useRef<SentSnap | null>(null)
  // Bytes the capture layer drew are already a normalized jpeg; running them through the upload
  // path's re-encode would be a second lossy generation on pixels that have been through one.
  const drawn = useRef(false)

  // Everything the camera needs a gesture for happens here, the way the microphone is asked for
  // in the Witness tap: the permission and the stream both belong to this tap, not to an effect.
  // The FRONT camera opens first, because the selfie is the first of the two shots.
  // The motion sensor is asked for in the same tap: it is how a landscape snap comes out landscape.
  const openCamera = () => {
    void askForMotion()
    const opening = openStream('user')
    opening.catch(() => {})
    setCamera(opening)
  }

  // A snap the camera composed goes to the same sheet a picked photo goes to, with nothing
  // stored yet to reuse.
  const captured = (taken: File) => { setCamera(null); sent.current = null; drawn.current = true; setFile(taken) }

  const picked = (files: File[]) => { sent.current = null; drawn.current = false; setFile(files[0] ?? null) }

  const pickInstead = () => { setCamera(null); photos.current?.click() }

  const close = () => {
    setFile(null); setCaption(''); setState('idle'); setProgress(0); sent.current = null; drawn.current = false
    if (voice && !heldForResend.current) void forget(indexedDbVault() ?? memoryVault(), voice.id).catch(() => {})
    heldForResend.current = false
    setVoice(null); setJustUs(false); setTag('')
  }

  // A voice note is already held in the phone's vault; what was typed for it is kept beside it
  // before the send, so a send that fails is resent later as it was meant. Let go once filed.
  const sendVoice = async (v: { blob: Blob; durationSec: number; id: string }, extra: { justUs?: boolean; tags?: string[] }) => {
    const store = indexedDbVault() ?? memoryVault()
    const meta = { caption, language, ...extra }
    await keepMeta(store, v.id, meta)
    await sendVoiceSnap(v.blob, v.durationSec, v.id, meta, { onNewId: (fresh) => keepNoteId(store, v.id, voiceSnapKey(fresh)) })
    await forget(store, v.id)
  }

  const send = async () => {
    if ((!file && !voice) || state === 'sending') return
    setState('sending')
    const extra = { ...(justUs ? { justUs: true } : {}), ...(tag ? { tags: [tag] } : {}) }
    try {
      if (voice) await sendVoice(voice, extra)
      else if (file) await postSnap(file, caption, {
        onProgress: setProgress, composed: drawn.current,
        ...(sent.current ? { sent: sent.current } : {}),
        onSent: (s) => { sent.current = s },
        ...(Object.keys(extra).length ? { extra } : {}),
      })
      close()
      router.refresh()
    } catch {
      if (voice) heldForResend.current = true
      setState('failed')
    }
  }

  return (
    <>
      <div className="mx-4 flex flex-col gap-3">
        {f.doubleCamera && <button
          type="button"
          onClick={openCamera}
          className="flex h-14 items-center justify-center rounded-2xl text-[17px] font-medium transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none"
          style={{ backgroundColor: INK, color: ON_INK }}
        >
          Double camera photo
        </button>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => photos.current?.click()}
            className="flex h-12 flex-1 items-center justify-center rounded-2xl text-[15px] transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none"
            style={{ color: INK, border: `1px solid ${HAIRLINE}` }}
          >
            Photo
          </button>
          <button
            type="button"
            onClick={() => videos.current?.click()}
            className="flex h-12 flex-1 items-center justify-center rounded-2xl text-[15px] transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none"
            style={{ color: INK, border: `1px solid ${HAIRLINE}` }}
          >
            Video
          </button>
          {f.voiceSnaps && (
            <button
              type="button"
              onClick={() => setRecording(true)}
              className="flex h-12 flex-1 items-center justify-center rounded-2xl text-[15px] transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none"
              style={{ color: INK, border: `1px solid ${HAIRLINE}` }}
            >
              Voice note
            </button>
          )}
        </div>
      </div>
      {camera && (
        <SnapCamera stream={camera} onCapture={captured} onClose={() => setCamera(null)} onPickInstead={pickInstead} />
      )}
      <PhotoInput ref={photos} label="Choose a photo" accept="image/*" multiple={false} onFiles={picked} />
      <PhotoInput ref={videos} label="Choose a video" accept="video/*" multiple={false} onFiles={picked} />
      {recording && (
        <BottomSheet title="Voice note" onClose={() => setRecording(false)}>
          <VoiceNote onCancel={() => setRecording(false)} onRecorded={(r) => { setRecording(false); sent.current = null; heldForResend.current = false; setVoice(r) }} />
        </BottomSheet>
      )}
      {(file || voice) && (
        <BottomSheet title="New snap" onClose={close} locked={state === 'sending'}>
          <div className="relative mx-auto mt-3 aspect-square w-40 overflow-hidden rounded-xl" style={{ backgroundColor: HAIRLINE }}>
            {file ? <PickedPreview photo={{ id: 'snap', file }} /> : voice && (
              <span className="flex h-full w-full items-center justify-center text-[28px]" style={{ color: INK, fontFamily: SERIF }}>{formatClock(voice.durationSec)}</span>
            )}
          </div>
          {voice && languages?.length ? (
            <select
              aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}
              className="mx-auto mt-3 block h-11 rounded-2xl px-3 text-sm" style={{ color: INK, border: `1px solid ${HAIRLINE}` }}
            >
              <option value="auto">Any language</option>
              {languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          ) : null}
          <label htmlFor="snap-caption" className="sr-only">Caption</label>
          <textarea
            id="snap-caption"
            value={caption}
            maxLength={SNAP_CAPTION_MAX}
            onChange={(e) => { setCaption(e.target.value); if (state === 'failed') setState('idle') }}
            placeholder="Add a caption, if you want"
            rows={2}
            className="mt-4 w-full resize-none rounded-2xl bg-white/70 px-4 py-3 text-[17px] leading-relaxed outline-none placeholder:text-[color:var(--cowitness-placeholder)] focus:bg-white"
            style={{ color: INK, fontFamily: SERIF, border: `1px solid ${HAIRLINE}`, ['--cowitness-placeholder' as string]: PLACEHOLDER }}
          />
          {f.justUs && shares && (
            <button
              type="button" role="switch" aria-checked={justUs} aria-label="Just us" onClick={() => setJustUs(!justUs)}
              className="mt-3 flex h-11 w-full items-center justify-between text-sm" style={{ color: INK }}
            >
              <span>Just us</span><span style={{ color: MUTED }}>{justUs ? 'Only the people who share see this' : 'Off'}</span>
            </button>
          )}
          {f.tags && tagChoices.length > 0 && (
            <label className="mt-3 block text-sm" style={{ color: INK }}>
              Tag
              <select
                aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}
                className="mt-1 h-11 w-full rounded-2xl px-3" style={{ border: `1px solid ${HAIRLINE}` }}
              >
                <option value="">None</option>
                {tagChoices.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span aria-live="polite" className="text-sm" style={{ color: state === 'failed' ? DANGER : MUTED }}>
              {state === 'failed' ? 'Not sent. Try again.' : state === 'sending' && progress > 0 ? `Sending ${Math.round(progress * 100)}%` : ''}
            </span>
            <button
              type="button"
              onClick={send}
              disabled={state === 'sending'}
              className="h-11 rounded-full px-6 text-sm font-medium transition-opacity disabled:opacity-40"
              style={{ backgroundColor: INK, color: ON_INK }}
            >
              {state === 'sending' ? 'Sending' : 'Send'}
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  )
}
