'use client'

// The capture layer alone, for an app that is not a Next.js app (or does not mount Cowitness at
// all) and still wants the same two-shot photo: your face, then what you are looking at, composed
// into one jpeg. `/client` reaches next/navigation through AddSnap; nothing here reaches anything
// but React. The classes are Tailwind's, so the app's Tailwind has to scan this package's dist/.
//
// The opening tap calls askForMotion() and openStream('user') itself, because a phone grants a
// camera and the motion sensor only inside a tap, and hands SnapCamera the promise as `stream`.
export { SnapCamera } from './snap-camera.js'
export { openStream } from './dual-camera.js'
export { askForMotion } from './upright.js'
