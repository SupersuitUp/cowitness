import { VIDEO_MAX_BYTES } from '../shared-rules.js'
import { clientConfig } from './config.js'
import { takenAtOf } from './photo-date.js'
import { capturePoster, readVideoMeta, videoContentType, type VideoMeta } from './video-meta.js'

// The four upload helpers Cowitness needs, moved from the app it was built in. The bytes go up on
// the app's own tickets, read from its configuration.

export const postJson = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// When it was taken: the camera's own date from the file's metadata, read before any re-encode
// drops it; else the file's timestamp.
export async function takenAt(file: File): Promise<string | undefined> {
  const fromCamera = await takenAtOf(file)
  if (fromCamera) return fromCamera
  return Number.isFinite(file.lastModified) && file.lastModified > 0
    ? new Date(file.lastModified).toISOString()
    : undefined
}

interface Ticket {
  photoId: string; videoUrl: string; posterUrl: string
  requiredHeaders: { video: Record<string, string>; poster: Record<string, string> }
}

/** A video whose bytes are in storage but whose record is not filed yet. */
export interface SentVideo { photoId: string; meta: VideoMeta }

// A video goes up as the phone's own file, unchanged, straight to storage, with its poster when the
// phone can draw one. Filing it is the caller's.
export async function sendVideoBytes(file: File, opts: { meta?: VideoMeta | null; onProgress?(fraction: number): void } = {}): Promise<SentVideo> {
  const contentType = videoContentType(file)
  if (!contentType || file.size > VIDEO_MAX_BYTES) throw new Error('video cannot be added')
  const meta = opts.meta ?? (await readVideoMeta(file))
  if (!meta) throw new Error('video unreadable')
  // Before the ticket, so its 15 minutes all go to the upload itself.
  const poster = await capturePoster(file)
  const issued = await postJson(clientConfig().uploadUrls.video, { contentType, size: file.size })
  if (!issued.ok) throw new Error('no upload url')
  const t = (await issued.json()) as Ticket
  await putWithProgress(t.videoUrl, file, t.requiredHeaders.video, opts.onProgress)
  if (poster) {
    // A missing poster only means a dark tile, so its failure never costs the video.
    await fetch(t.posterUrl, { method: 'PUT', headers: t.requiredHeaders.poster, body: poster }).catch(() => null)
  }
  return { photoId: t.photoId, meta }
}

// fetch cannot report upload progress, and a phone video can take minutes, so the PUT goes
// through XMLHttpRequest. Headers are sent exactly as issued.
export function putWithProgress(
  url: string, body: Blob, headers: Record<string, string>, onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error(`upload failed ${xhr.status}`), { status: xhr.status })))
    xhr.onerror = () => reject(new Error('upload failed'))
    xhr.onabort = () => reject(new Error('upload aborted'))
    xhr.send(body)
  })
}
