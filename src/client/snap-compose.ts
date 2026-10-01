import { JPEG_QUALITY, decodeFrame } from './reencode.js'
import { INSET_RADIUS, coverSource, frameSize, insetRect, panelLayout, type Rect } from './snap-frames.js'
import type { Frame, Shot } from './dual-camera.js'
import { BG } from './theme.js'

/** The cream edge that separates the selfie from whatever it sits on, as a share of its width. */
const EDGE = 0.02

// The pictures of one snap are drawn onto a CANVAS and the canvas is what is kept. Encoding is a
// separate step that happens exactly once, when the snap is taken, because every jpeg written and
// read back loses detail that never comes back: composing the cameras, then decoding that to add a
// screenshot, then handing the result to an upload path that re-encodes it, is three generations
// of loss on the same pixels. The canvas carries them losslessly between the steps instead.
export function drawCameras(shot: Omit<Shot, 'screen'>): HTMLCanvasElement {
  const size = frameSize(shot.back)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = context(canvas)
  const whole: Rect = { x: 0, y: 0, width: size.width, height: size.height }
  try {
    cover(ctx, shot.back, whole)
    if (shot.front) drawInset(ctx, shot.front, whole)
  } finally {
    shot.back.release()
    shot.front?.release()
  }
  return canvas
}

// A screenshot beside the cameras. It takes the CANVAS rather than the composed jpeg, so the
// camera half arrives at the encoder having been through no encoder at all.
export function drawWithScreen(cameras: HTMLCanvasElement, screen: Frame): HTMLCanvasElement {
  const panels = panelLayout({ width: cameras.width, height: cameras.height })
  const canvas = document.createElement('canvas')
  canvas.width = panels.frame.width
  canvas.height = panels.frame.height
  const ctx = context(canvas)
  try {
    ctx.drawImage(cameras, 0, 0, cameras.width, cameras.height,
      panels.camera.x, panels.camera.y, panels.camera.width, panels.camera.height)
    cover(ctx, screen, panels.screenshot)
  } finally {
    screen.release()
  }
  return canvas
}

/** The one encode. Everything before this point is pixels. */
export function encodeSnap(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', JPEG_QUALITY)
  })
}

/** Something to look at while deciding. Its loss is nobody's, because it is never sent. */
export function previewUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.7)
}

/** iOS caps a page's total canvas memory and only frees a backing store on collection. */
export function freeCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}

/** A picture already on disk, as a frame. */
export const frameFrom = (file: Blob): Promise<Frame> => decodeFrame(file)

/** The composed bytes as the kind of file the snap path already knows how to send. */
export function snapFile(blob: Blob): File {
  return new File([blob], 'snap.jpg', { type: 'image/jpeg', lastModified: Date.now() })
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  return ctx
}

/** One picture filling one slot, cropped rather than squashed. */
function cover(ctx: CanvasRenderingContext2D, frame: Frame, into: Rect): void {
  const from = coverSource(frame, into)
  ctx.drawImage(frame.image, from.x, from.y, from.width, from.height, into.x, into.y, into.width, into.height)
}

// The selfie sits in the corner of the CAMERA panel rather than of the composed frame, so a
// screenshot beside it does not push it into the middle of the picture.
function drawInset(ctx: CanvasRenderingContext2D, front: Frame, panel: Rect): void {
  const inset = insetRect(panel, front)
  const box: Rect = { ...inset, x: panel.x + inset.x, y: panel.y + inset.y }
  const radius = Math.round(box.width * INSET_RADIUS)
  ctx.save()
  ctx.beginPath()
  path(ctx, box, radius)
  ctx.clip()
  // Mirrored about the box's own middle, because that is how the selfie looked on screen before
  // the shutter (the live preview and the corner thumbnail are both flipped). The camera's raw
  // frame is the unflipped view, which reads as a stranger's photo of you.
  ctx.translate(box.x * 2 + box.width, 0)
  ctx.scale(-1, 1)
  cover(ctx, front, box)
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  path(ctx, box, radius)
  ctx.lineWidth = Math.max(2, Math.round(box.width * EDGE))
  ctx.strokeStyle = BG
  ctx.stroke()
  ctx.restore()
}

// roundRect landed in Safari 16.4; a browser without it gets square corners rather than an
// exception, because a squared-off selfie is a snap and a thrown error is nothing.
function path(ctx: CanvasRenderingContext2D, box: Rect, radius: number): void {
  if (typeof ctx.roundRect === 'function') ctx.roundRect(box.x, box.y, box.width, box.height, radius)
  else ctx.rect(box.x, box.y, box.width, box.height)
}

