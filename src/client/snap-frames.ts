import { fitWithin } from './reencode.js'

/** How much of the frame's short edge the selfie takes. */
export const INSET_SHARE = 0.28
/** How far the selfie sits from the top-left corner, also as a share of the short edge. */
export const INSET_MARGIN = 0.04
/** The selfie box's shape, width over height, when the selfie was taken upright. A selfie taken
 * sideways gets the same box turned, so it is never cropped back to portrait. */
export const INSET_ASPECT = 3 / 4
/** The selfie's corner rounding, as a share of its width. */
export const INSET_RADIUS = 0.08

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

// The composed snap is the back camera's own frame, capped exactly as any other upload is.
export function frameSize(back: Size): Size {
  return fitWithin(back.width, back.height)
}

// Where the selfie sits. Sized off the SHORT edge, so a frame the phone hands over landscape
// and the same frame portrait put the same-looking selfie in the corner; sizing off the width
// would make it swell whenever the phone was turned.
export function insetRect(frame: Size, selfie?: Size): Rect {
  const short = Math.min(frame.width, frame.height)
  const across = Math.max(1, Math.round(short * INSET_SHARE))
  const along = Math.max(1, Math.round(across / INSET_ASPECT))
  const margin = Math.round(short * INSET_MARGIN)
  const sideways = !!selfie && selfie.width > selfie.height
  return { x: margin, y: margin, width: sideways ? along : across, height: sideways ? across : along }
}

// The part of a source to draw so it fills a hole of a different shape without stretching
// anybody's face: the overhanging edge is cropped, evenly, so the middle stays the middle.
export function coverSource(source: Size, dest: Size): Rect {
  const sourceAspect = source.width / source.height
  const destAspect = dest.width / dest.height
  if (sourceAspect > destAspect) {
    const width = Math.round(source.height * destAspect)
    return { x: Math.round((source.width - width) / 2), y: 0, width, height: source.height }
  }
  const height = Math.round(source.width / destAspect)
  return { x: 0, y: Math.round((source.height - height) / 2), width: source.width, height }
}

/** The composed frame and the two panels inside it, when a screenshot is part of the snap. */
export interface Panels { frame: Size; camera: Rect; screenshot: Rect }

// A screenshot shrunk into a corner is unreadable, and it is the densest of the three pictures,
// so with one in the snap the composite stops being a photo with corners and becomes two panels.
//
// The seam follows the frames' own orientation rather than a preference: the frame doubles along
// its SHORT axis, so tall pictures sit side by side and wide ones stack. Either way each panel
// keeps the camera's own shape, which is also close to a phone screenshot's, and neither is
// crushed. A square frame counts as tall, so the seam is always somewhere.
export function panelLayout(camera: Size): Panels {
  const tall = camera.height >= camera.width
  const frame = tall
    ? fitWithin(camera.width * 2, camera.height)
    : fitWithin(camera.width, camera.height * 2)
  if (tall) {
    const half = Math.round(frame.width / 2)
    return {
      frame,
      camera: { x: 0, y: 0, width: half, height: frame.height },
      screenshot: { x: half, y: 0, width: frame.width - half, height: frame.height },
    }
  }
  const half = Math.round(frame.height / 2)
  return {
    frame,
    camera: { x: 0, y: 0, width: frame.width, height: half },
    screenshot: { x: 0, y: half, width: frame.width, height: frame.height - half },
  }
}
