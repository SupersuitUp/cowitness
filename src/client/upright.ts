import type { Facing, Frame } from './dual-camera.js'
import type { Size } from './snap-frames.js'

// Which way up the phone is, so a snap taken in landscape comes out landscape.
//
// Two cases, and only one needs help. With rotation lock OFF, iOS turns the page to landscape and
// turns the camera stream with it, so the frame arrives upright and must be left alone (turning it
// again is what put the first landscape snap back on its side; the manifest's
// portrait lock is not honored there). With rotation lock ON, the page stays portrait, the stream
// stays portrait with the world sideways inside it, and only the motion sensor knows. So the
// sensor decides only while the screen itself is at 0 degrees. On iOS the sensor has to be asked
// for inside a tap.

export interface Tilt { beta: number; gamma: number }

/** Below this share of gravity along the screen, the phone is lying flat and nothing is known. */
const FLAT = 0.5

// Clockwise quarter turns (0-3) that stand a raw camera frame upright.
//
// "Up" in the phone's own axes is the third row of the deviceorientation rotation matrix:
// x = -cos(beta) sin(gamma), y = sin(beta), with +x the right edge and +y the top edge as you
// look at the screen. Whichever edge gravity points away from becomes the top of the picture.
// The front camera looks back at you, so its frame runs the other way along x.
export function quarterTurnsFrom(tilt: Tilt | null, facing: Facing, screenAngle = 0): 0 | 1 | 2 | 3 {
  if (!tilt) return 0
  if (((screenAngle % 360) + 360) % 360 !== 0) return 0
  const rad = Math.PI / 180
  const x = -Math.cos(tilt.beta * rad) * Math.sin(tilt.gamma * rad)
  const y = Math.sin(tilt.beta * rad)
  if (Math.abs(x) < FLAT && Math.abs(y) < FLAT) return 0
  if (Math.abs(y) >= Math.abs(x)) return y > 0 ? 0 : 2
  const rightUp = x > 0
  if (facing === 'user') return rightUp ? 1 : 3
  return rightUp ? 3 : 1
}

export function turnedSize(size: Size, turns: number): Size {
  return turns % 2 === 1 ? { width: size.height, height: size.width } : size
}

// A frame drawn onto a new canvas, turned. The old frame is released: iOS caps a page's canvas
// memory, and holding both sizes of a full-resolution frame is what that cap is for.
export function turnFrame(frame: Frame, turns: number): Frame {
  if (turns % 4 === 0) return frame
  const size = turnedSize(frame, turns)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return frame
  try {
    ctx.translate(size.width / 2, size.height / 2)
    ctx.rotate((turns * Math.PI) / 2)
    ctx.drawImage(frame.image, -frame.width / 2, -frame.height / 2, frame.width, frame.height)
  } finally {
    frame.release()
  }
  return { image: canvas, width: size.width, height: size.height, release: () => { canvas.width = 0; canvas.height = 0 } }
}

let latest: Tilt | null = null
let listening = false

/** How far the page itself is turned from portrait, in degrees; 0 when nothing says. */
export function screenAngle(): number {
  if (typeof window === 'undefined') return 0
  const angle = window.screen?.orientation?.angle
  if (typeof angle === 'number') return angle
  const legacy = (window as unknown as { orientation?: number }).orientation
  return typeof legacy === 'number' ? legacy : 0
}

/** The last reading, or null when the sensor was never granted or has said nothing yet. */
export function readTilt(): Tilt | null {
  return latest
}

interface PermissionAsker { requestPermission?: () => Promise<string> }
interface EventSource { addEventListener(type: 'deviceorientation', l: (e: { beta: number | null; gamma: number | null }) => void): void }

// Called INSIDE the tap that opens the camera, beside getUserMedia: iOS grants the sensor only
// there. A refusal, or no sensor, leaves the frames exactly as the camera gives them.
export async function askForMotion(
  api: PermissionAsker | undefined = typeof DeviceOrientationEvent === 'undefined' ? undefined : (DeviceOrientationEvent as unknown as PermissionAsker),
  target: EventSource | undefined = typeof window === 'undefined' ? undefined : (window as unknown as EventSource),
): Promise<void> {
  if (!api || !target) return
  if (listening) return
  try {
    if (typeof api.requestPermission === 'function' && (await api.requestPermission()) !== 'granted') return
  } catch {
    return
  }
  listening = true
  target.addEventListener('deviceorientation', (e) => {
    if (typeof e.beta === 'number' && typeof e.gamma === 'number') latest = { beta: e.beta, gamma: e.gamma }
  })
}

/** For tests: forget the sensor, as a fresh page would. */
export function resetMotion(): void {
  latest = null
  listening = false
}
