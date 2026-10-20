import type { Frame } from './dual-camera.js'

// How far the back camera can zoom, and whether the camera itself does it.
//
// A camera that reports a zoom capability (Chrome on Android, Safari on iOS 17 and later) zooms
// optically or on the sensor, which is sharper than anything a page can do. One that does not is
// zoomed digitally instead: the preview is scaled up and the frame cropped to the same middle at
// the shutter, so what was framed is what is sent on every phone.
//
// `base` is the zoom the camera opened at, and every label is relative to it. Phones disagree on
// what their raw numbers mean (on some iPhones 1 is the ultra-wide and 2 the main lens), so "1×"
// is always the view the person was first shown, and a camera that can go wider offers 0.5×.
export interface ZoomRange { min: number; max: number; base: number; hardware: boolean }

/** The furthest a digital zoom goes: past this a 1920-wide frame is too few pixels to send. */
export const DIGITAL_MAX = 3

interface ZoomCapability { min?: number; max?: number }

export function zoomRange(track: MediaStreamTrack | undefined): ZoomRange {
  const caps = (track?.getCapabilities?.() ?? {}) as { zoom?: ZoomCapability }
  const { min, max } = caps.zoom ?? {}
  if (typeof min === 'number' && typeof max === 'number' && max > min) {
    const current = (track?.getSettings?.() as { zoom?: number } | undefined)?.zoom
    const base = typeof current === 'number' ? clamp(current, { min, max }) : min
    return { min, max, base, hardware: true }
  }
  return { min: 1, max: DIGITAL_MAX, base: 1, hardware: false }
}

export function clamp(zoom: number, range: Pick<ZoomRange, 'min' | 'max'>): number {
  return Math.min(range.max, Math.max(range.min, zoom))
}

// The buttons under the preview, as multiples of the opening view. Five times replaces three when
// the camera reaches it, so a long-zoom phone still shows four buttons at most.
export function zoomSteps(range: ZoomRange): number[] {
  const fits = (s: number) => range.base * s >= range.min - 1e-6 && range.base * s <= range.max + 1e-6
  const steps = [0.5, 1, 2, 3, 5].filter(fits)
  return steps.includes(5) ? steps.filter((s) => s !== 3) : steps
}

/** A zoom as the person reads it: "0.5", "1", "2.5". */
export function zoomLabel(zoom: number, range: ZoomRange): string {
  return String(Math.round((zoom / range.base) * 10) / 10)
}

/** Two fingers moving apart zoom in by the ratio they moved, from where the pinch began. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number, range: ZoomRange): number {
  if (startDistance <= 0) return startZoom
  return clamp(startZoom * (distance / startDistance), range)
}

/** Ask the camera itself to zoom. A refusal leaves the view where it was rather than failing the shot. */
export async function applyHardwareZoom(track: MediaStreamTrack | undefined, zoom: number): Promise<void> {
  if (!track?.applyConstraints) return
  try {
    await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] })
  } catch {
    // A phone that advertised zoom and then refused it keeps the view it had.
  }
}

// The middle 1/zoom of a frame, which is exactly what a preview scaled by `zoom` from its centre
// showed. The original frame is released, so a cropped snap holds one canvas, not two.
export function cropFrame(frame: Frame, zoom: number): Frame {
  if (zoom <= 1) return frame
  const width = Math.max(1, Math.round(frame.width / zoom))
  const height = Math.max(1, Math.round(frame.height / zoom))
  const canvas = document.createElement('canvas')
  try {
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(frame.image, (frame.width - width) / 2, (frame.height - height) / 2, width, height, 0, 0, width, height)
  } catch (err) {
    canvas.width = 0
    canvas.height = 0
    throw err
  } finally {
    frame.release()
  }
  return { image: canvas, width, height, release: () => { canvas.width = 0; canvas.height = 0 } }
}
