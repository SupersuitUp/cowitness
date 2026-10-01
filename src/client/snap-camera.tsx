'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useHistoryLayer } from './history-layer.js'
import { browserCamera, frameThumb, grabAndClose, openStream, playing, type Camera, type Frame } from './dual-camera.js'
import { quarterTurnsFrom, readTilt, screenAngle, turnFrame } from './upright.js'
import { drawCameras, drawWithScreen, encodeSnap, frameFrom, freeCanvas, previewUrl, snapFile } from './snap-compose.js'

interface Props {
  /** The front camera, asked for inside the tap: a phone grants one only there. */
  stream: Promise<MediaStream>
  /** The composed snap, handed on to the sheet that takes a caption and sends it. */
  onCapture(file: File): void
  onClose(): void
  /** No camera to be had: fall back to the photos already on the device. */
  onPickInstead(): void
}

type Stage = 'selfie' | 'back' | 'ready' | 'nocamera'

// What the layer asks for, in order. The last one is optional and is named anyway.
const STEPS: Array<{ key: Stage; label: string }> = [
  { key: 'selfie', label: 'Selfie' },
  { key: 'back', label: 'Photo' },
  { key: 'ready', label: 'Screenshot' },
]

// The capture layer: your face, then the thing you are looking at, composed into one image.
//
// The order is the reason a selfie can be SEEN at all. A phone runs one camera at a time, so
// nothing can preview the front camera while the back one is live; taking the selfie first means
// the front camera has the screen to itself, and by the time the back camera is being framed the
// selfie already exists and sits in the corner as a picture rather than as a promise.
//
// It produces a file and nothing else. The caption, Send and every retry stay in the sheet the
// picker opens, so a snap taken here and one chosen from the library travel the identical path.
export function SnapCamera({ stream, onCapture, onClose, onPickInstead }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const cam = useRef<Camera | null>(null)
  const selfie = useRef<Frame | null>(null)
  // The composed pixels, kept as a CANVAS between the shot and Send. Encoding here and decoding
  // again to add a screenshot would put two jpeg generations on the same picture before it left
  // the phone, so nothing is encoded until the snap is actually taken.
  const composed = useRef<HTMLCanvasElement | null>(null)
  const [stage, setStage] = useState<Stage>('selfie')
  // True whenever no camera is live: while one is opening, and while a frame is being taken.
  const [busy, setBusy] = useState(true)
  const [thumb, setThumb] = useState<string | null>(null)
  // A selfie taken sideways is shown sideways in the corner, as it will be in the snap.
  const [selfieWide, setSelfieWide] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [screened, setScreened] = useState(false)
  const [trouble, setTrouble] = useState('')
  const picker = useRef<HTMLInputElement>(null)

  const release = useCallback(() => {
    if (cam.current) browserCamera.close(cam.current)
    cam.current = null
    selfie.current?.release()
    selfie.current = null
    freeCanvas(composed.current)
    composed.current = null
  }, [])

  // A stream onto the element on screen. The element belongs to this component rather than to the
  // camera, so React keeps rendering the preview and only the stream underneath is swapped.
  const attach = useCallback((opening: Promise<MediaStream>) => {
    let wanted = true
    void opening.then((ms) => {
      if (!wanted || !video.current) { ms.getTracks().forEach((t) => t.stop()); return }
      cam.current = playing(ms, video.current)
      setBusy(false)
    }).catch(() => { if (wanted) setStage('nocamera') })
    return () => { wanted = false }
  }, [])

  useEffect(() => attach(stream), [stream, attach])

  // The cameras and the preview URL are let go of however this ends, including a navigation that
  // never runs the close button at all.
  useEffect(() => () => release(), [release])

  const close = useHistoryLayer('snap-camera', true, () => { release(); onClose() })

  const shutter = async () => {
    const live = cam.current
    if (busy || !live) return
    setBusy(true)
    setTrouble('')
    try {
      // Turned upright by how the phone was held at the shutter, unless the page turned with it,
      // in which case iOS has already turned the camera stream too (upright.ts says why).
      const facing = stage === 'selfie' ? 'user' : 'environment'
      const frame = turnFrame(await grabAndClose(browserCamera, live), quarterTurnsFrom(readTilt(), facing, screenAngle()))
      cam.current = null
      if (stage === 'selfie') {
        selfie.current = frame
        setThumb(frameThumb(frame))
        setSelfieWide(frame.width > frame.height)
        setStage('back')
        attach(openStream('environment'))
        return
      }
      // drawCameras releases both frames, so the selfie is spent by the time this returns.
      composed.current = drawCameras({ back: frame, front: selfie.current })
      selfie.current = null
      setPreview(previewUrl(composed.current))
      setStage('ready')
      // Nothing is opening and nothing is being taken: the choices below are live again.
      setBusy(false)
    } catch {
      setTrouble('That did not take. Try again.')
      restart()
    }
  }

  // iOS refuses to hand any app the contents of another app's screen, so a screenshot can only
  // be one the person took themselves. It is laid beside the camera CANVAS, which has been through no
  // encoder at all, rather than beside a jpeg decoded back from one.
  const addScreenshot = async (picked: File) => {
    const cameras = composed.current
    if (!cameras || busy) return
    setBusy(true)
    setTrouble('')
    try {
      const next = drawWithScreen(cameras, await frameFrom(picked))
      freeCanvas(cameras)
      composed.current = next
      setPreview(previewUrl(next))
      setScreened(true)
    } catch {
      setTrouble("That screenshot couldn't be read.")
    } finally {
      setBusy(false)
    }
  }

  // The one encode, at the one moment the pixels are finally going somewhere.
  const use = async () => {
    const canvas = composed.current
    if (!canvas || busy) return
    setBusy(true)
    try {
      onCapture(snapFile(await encodeSnap(canvas)))
    } catch {
      setTrouble('That did not save. Try again.')
      setBusy(false)
    }
  }

  const restart = () => {
    setPreview(null)
    setThumb(null)
    setScreened(false)
    setStage('selfie')
    setBusy(true)
    release()
    attach(openStream('user'))
  }

  const framing = stage === 'selfie' || stage === 'back'
  const mirrored = stage === 'selfie'

  return (
    <div role="dialog" aria-modal="true" aria-label="Take a snap" className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <div className="flex h-14 shrink-0 items-center px-2">
        <button type="button" aria-label="Close" onClick={close} className="h-11 w-11 text-2xl leading-none">×</button>
        {/* The third step is optional and comes last, which is exactly how it goes unnoticed. The
            steps are named from the start so nobody has to reach one to find out it exists. */}
        <ol className="ml-1 flex items-center gap-1 text-[13px]">
          {STEPS.map(({ key, label }, i) => (
            <li key={key} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="opacity-40">›</span>}
              <span
                aria-current={stage === key ? 'step' : undefined}
                className={stage === key ? 'font-medium' : 'opacity-50'}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
        <span aria-live="polite" className="ml-2 truncate text-sm opacity-80">{trouble}</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <video
          ref={video}
          hidden={!!preview}
          playsInline
          muted
          className={`h-full w-full object-cover${mirrored ? ' -scale-x-100' : ''}`}
        />
        {/* contain, not cover: a landscape snap is shown whole rather than cropped back to portrait. */}
        {preview && <img src={preview} alt="The snap you just took" className="h-full w-full object-contain" />}
        {thumb && stage === 'back' && (
          <img
            src={thumb}
            alt="The selfie you just took"
            className={`absolute left-[4%] top-[4%] ${selfieWide ? 'w-[37%]' : 'w-[28%]'} -scale-x-100 rounded-xl border-2 border-white/80 object-cover`}
            style={{ aspectRatio: selfieWide ? '4 / 3' : '3 / 4' }}
          />
        )}
        {stage === 'nocamera' && (
          <div className="absolute inset-0 flex items-center justify-center text-[17px]">No camera.</div>
        )}
      </div>

      <div className="flex h-32 shrink-0 flex-col items-center justify-center gap-3 px-6">
        {stage === 'nocamera' ? (
          <button type="button" onClick={onPickInstead} className="h-12 rounded-full bg-white px-6 text-[17px] font-medium text-black">
            Choose a photo instead
          </button>
        ) : preview ? (
          /* Two rows rather than three abreast: on a phone the row wrapped every label onto two
             lines, and the optional step is the one that most needs to be read. */
          <div className="flex w-full flex-col items-center gap-2">
            {!screened && (
              <button
                type="button"
                onClick={() => picker.current?.click()}
                disabled={busy}
                className="h-11 w-full max-w-xs rounded-full border border-white/40 text-[15px] whitespace-nowrap disabled:opacity-40"
              >
                Add a screenshot
              </button>
            )}
            <div className="flex items-center gap-3">
              <button type="button" onClick={restart} disabled={busy} className="h-11 rounded-full border border-white/40 px-6 text-[15px] whitespace-nowrap disabled:opacity-40">Retake</button>
              <button type="button" onClick={use} disabled={busy} className="h-11 rounded-full bg-white px-8 text-[15px] font-medium whitespace-nowrap text-black disabled:opacity-40">Use it</button>
            </div>
          </div>
        ) : (
          <>
            <span className="text-[13px] opacity-70">{stage === 'selfie' ? 'Your face first' : 'Now what you are looking at'}</span>
            <button
              type="button"
              aria-label={stage === 'selfie' ? 'Take the selfie' : 'Take the snap'}
              onClick={shutter}
              disabled={busy || !framing}
              className="h-[64px] w-[64px] rounded-full border-4 border-white bg-white/20 transition-opacity disabled:opacity-40"
            />
          </>
        )}
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        aria-label="Choose a screenshot"
        tabIndex={-1}
        className="sr-only"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (picked) void addScreenshot(picked)
        }}
      />
    </div>
  )
}
