export type Facing = 'environment' | 'user'

/** One drawn frame, held on a canvas until it has been composed and let go of. */
export interface Frame { image: CanvasImageSource; width: number; height: number; release(): void }
/** A camera that is open and playing: its tracks, and the element its pixels can be read from. */
export interface Camera { stream: MediaStream; video: HTMLVideoElement }
// The pictures of one snap. The selfie is null when the front camera never came, and `screen` is
// a screenshot the operator took themselves, which iOS will not let any app capture for them.
export interface Shot { back: Frame; front: Frame | null; screen?: Frame | null }

export interface CameraIo {
  open(facing: Facing): Promise<Camera>
  grab(cam: Camera): Promise<Frame>
  close(cam: Camera): void
}

// One frame, then the camera goes. A phone runs ONE camera at a time, so holding a camera open
// after its frame is taken is what stops the next one from opening; the close is in a `finally`
// because a failed grab strands the camera just as surely as a successful one.
export async function grabAndClose(io: CameraIo, cam: Camera): Promise<Frame> {
  try {
    return await io.grab(cam)
  } finally {
    io.close(cam)
  }
}

/** The widest a corner preview is drawn, in pixels. */
export const THUMB_EDGE = 320

// A small jpeg of a frame, for showing the selfie in the corner while the back camera is framed.
// The frame itself is full camera resolution and there is no reason to hold that in an <img>.
export function frameThumb(frame: Frame, maxEdge = THUMB_EDGE): string {
  const long = Math.max(frame.width, frame.height)
  const scale = long > maxEdge ? maxEdge / long : 1
  const width = Math.max(1, Math.round(frame.width * scale))
  const height = Math.max(1, Math.round(frame.height * scale))
  const canvas = document.createElement('canvas')
  try {
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(frame.image, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

// What to ask a phone for. `ideal` rather than `exact`: a laptop or a phone with one camera
// answers with the camera it has instead of refusing, which is what the fallback above wants.
export function cameraConstraints(facing: Facing): MediaStreamConstraints {
  return { audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 } } }
}

/** Open a camera's tracks. Called inside the tap, because a phone grants a camera only there. */
export function openStream(facing: Facing): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('no camera'))
  return navigator.mediaDevices.getUserMedia(cameraConstraints(facing))
}

// A stream playing into an element. `muted` and `playsInline` are what let an iPhone play it at
// all, on screen or off; an element that is never added to the page still plays and can be drawn
// from, which is how the selfie is taken without ever being shown.
export function playing(stream: MediaStream, video: HTMLVideoElement): Camera {
  video.muted = true
  video.playsInline = true
  video.autoplay = true
  video.srcObject = stream
  void video.play().catch(() => {})
  return { stream, video }
}

export const browserCamera: CameraIo = {
  async open(facing) {
    return playing(await openStream(facing), document.createElement('video'))
  },

  async grab(cam) {
    await ready(cam.video)
    const width = cam.video.videoWidth
    const height = cam.video.videoHeight
    if (!width || !height) throw new Error('camera gave no frame')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(cam.video, 0, 0, width, height)
    // iOS caps a page's total canvas memory, and an unreferenced canvas keeps its backing
    // store until collection, so a frame says when it is done with rather than being dropped.
    return { image: canvas, width, height, release: () => { canvas.width = 0; canvas.height = 0 } }
  },

  close(cam) {
    cam.stream.getTracks().forEach((t) => t.stop())
    if (cam.video.srcObject === cam.stream) cam.video.srcObject = null
  },
}

// A video element has no pixels until it has decoded something, and videoWidth is 0 until then.
function ready(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const done = () => { off(); resolve() }
    const failed = () => { off(); reject(new Error('camera did not start')) }
    const off = () => {
      video.removeEventListener('loadeddata', done)
      video.removeEventListener('error', failed)
    }
    video.addEventListener('loadeddata', done, { once: true })
    video.addEventListener('error', failed, { once: true })
  })
}
