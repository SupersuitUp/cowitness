import { VIDEO_MAX_BYTES } from '../shared-rules.js'
import type { VideoContentType } from '../types.js'
import { fitWithin } from './reencode.js'

export interface VideoMeta { durationSec: number; width: number; height: number }

export const TOO_LARGE = 'This video is too large to add'
export const UNREADABLE = "Couldn't read this video"
export const POSTER_EDGE = 720
export const POSTER_QUALITY = 0.8
const META_TIMEOUT_MS = 15_000
const POSTER_TIMEOUT_MS = 3_000

const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || ['mov', 'mp4', 'm4v'].includes(extension(file.name))
}

// The two types the album stores. iOS labels a phone video video/quicktime and
// sometimes gives no type at all, so the extension decides then.
export function videoContentType(file: File): VideoContentType | null {
  if (file.type === 'video/quicktime') return 'video/quicktime'
  if (file.type === 'video/mp4' || file.type === 'video/x-m4v') return 'video/mp4'
  if (file.type) return null
  const ext = extension(file.name)
  return ext === 'mov' ? 'video/quicktime' : ext === 'mp4' || ext === 'm4v' ? 'video/mp4' : null
}

/** What stops a video before anything is read from it, or null. */
export function videoProblem(file: File): string | null {
  if (file.size > VIDEO_MAX_BYTES) return TOO_LARGE
  return videoContentType(file) ? null : UNREADABLE
}

// Wall-clock time on THE PERSON'S phone, with no zone: the form finalize takes, so the
// video sorts among that night's photos.
export function localWallClock(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Runs `use` against a detached <video> of the file and always cleans up: the
// timer, the element's hold on the file, and the object URL. Resolves once.
function withVideo<T>(
  file: File, preload: 'metadata' | 'auto', timeoutMs: number,
  use: (video: HTMLVideoElement, done: (value: T | null) => void) => void,
): Promise<T | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false
    const done = (value: T | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    // iOS reads a detached video only when it is muted, inline, and told to load.
    video.muted = true
    video.playsInline = true
    video.setAttribute('muted', '')
    video.setAttribute('playsinline', '')
    video.preload = preload
    video.onerror = () => done(null)
    use(video, done)
    video.src = url
    video.load()
  })
}

// Length and display size. A duration of 0 or one the browser cannot tell (an
// HEVC file in a browser without HEVC) means unreadable: a video needs a length.
export function readVideoMeta(file: File, timeoutMs = META_TIMEOUT_MS): Promise<VideoMeta | null> {
  return withVideo<VideoMeta>(file, 'metadata', timeoutMs, (video, done) => {
    video.onloadedmetadata = () => {
      const { duration, videoWidth, videoHeight } = video
      done(Number.isFinite(duration) && duration > 0 && videoWidth > 0 && videoHeight > 0
        ? { durationSec: duration, width: Math.round(videoWidth), height: Math.round(videoHeight) }
        : null)
    }
  })
}

const SAMPLE_EDGE = 16
const BLACK_MEAN = 8

/** True when RGBA pixels average darker than 8/255: the frame an unplayed iOS video draws. */
export function isMostlyBlack(rgba: Uint8ClampedArray): boolean {
  let sum = 0
  let n = 0
  for (let i = 0; i + 2 < rgba.length; i += 4) { sum += (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3; n += 1 }
  return n === 0 || sum / n < BLACK_MEAN
}

// A 16x16 sample of what was drawn. An unreadable sample counts as black, since
// a poster nobody can check is not worth keeping forever.
function drewBlack(canvas: HTMLCanvasElement): boolean {
  const sample = document.createElement('canvas')
  sample.width = SAMPLE_EDGE
  sample.height = SAMPLE_EDGE
  try {
    const ctx = sample.getContext('2d')
    if (!ctx) return true
    ctx.drawImage(canvas, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE)
    return isMostlyBlack(ctx.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE).data)
  } catch {
    return true
  } finally {
    sample.width = 0
    sample.height = 0
  }
}

// A still from 0.1s in, at most 720px on the long edge, as a JPEG. Null when the
// phone will not give a frame within 3 seconds, or gives an all-black one (iOS
// often does for a video that has never played); the video goes up without one.
export function capturePoster(file: File, timeoutMs = POSTER_TIMEOUT_MS): Promise<Blob | null> {
  return withVideo<Blob>(file, 'auto', timeoutMs, (video, done) => {
    video.onloadedmetadata = () => { video.currentTime = Math.min(0.1, video.duration / 2 || 0) }
    video.onseeked = () => {
      const { width, height } = fitWithin(video.videoWidth, video.videoHeight, POSTER_EDGE)
      if (!width || !height) { done(null); return }
      const canvas = document.createElement('canvas')
      // Zero the canvas once used: iOS caps canvas memory per page.
      const release = () => { canvas.width = 0; canvas.height = 0 }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      try {
        if (!ctx) throw new Error('no canvas')
        ctx.drawImage(video, 0, 0, width, height)
        if (drewBlack(canvas)) throw new Error('black frame')
      } catch { release(); done(null); return }
      canvas.toBlob((blob) => { release(); done(blob) }, 'image/jpeg', POSTER_QUALITY)
    }
  })
}
