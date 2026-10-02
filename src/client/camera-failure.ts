// Why a camera did not open, in words a person can act on. getUserMedia rejects with a
// DOMException whose `name` is the only reliable part (the message differs by browser), so the
// mapping is by name alone and anything unrecognized falls through to 'unknown' with that name
// shown, so a screenshot of the screen says what happened.

export type CameraFailureKind = 'denied' | 'busy' | 'none' | 'unknown'

export interface CameraFailure {
  kind: CameraFailureKind
  title: string
  help: string
  /** Only for 'unknown': the error's name, shown small, e.g. "(NotReadableError)". */
  detail?: string
}

const DENIED = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError'])
const BUSY = new Set(['NotReadableError', 'AbortError', 'TrackStartError'])
const NONE = new Set(['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError'])

export function cameraFailure(err: unknown): CameraFailure {
  const raw = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined
  const name = typeof raw === 'string' && raw ? raw : ''
  if (DENIED.has(name)) {
    return {
      kind: 'denied',
      title: 'Camera is blocked for this app.',
      help: 'On iPhone: Settings → Apps → Safari → Camera → Allow (or Ask). Or in Safari, tap aA → Website Settings → Camera → Allow. Then come back and tap Try again.',
    }
  }
  if (BUSY.has(name)) {
    return {
      kind: 'busy',
      title: 'Another app is using the camera.',
      help: 'End the video call or close the camera app, then tap Try again.',
    }
  }
  if (NONE.has(name)) {
    return { kind: 'none', title: 'No camera found.', help: 'You can still share a photo you already have.' }
  }
  return {
    kind: 'unknown',
    title: "The camera didn't open.",
    help: 'Tap Try again, or share a photo you already have.',
    ...(name ? { detail: `(${name})` } : {}),
  }
}
