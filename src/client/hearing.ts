// Is it hearing the speaker? A recorder that is running and a recorder that is running with the wrong
// input selected look identical: a timer counting up either way. So the level is measured off
// the live stream and drawn, and a run that stays near the noise floor says so out loud rather
// than being discovered ten minutes later in an empty transcript.
//
// It reports SOUND, never words. Nothing here can tell speech from a fan, and a meter that
// claimed to would be lying in whatever language is spoken.

/** Root mean square of one analyser frame, 0 to 1. Silence is 0; normal speech sits near 0.05-0.3. */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

// A microphone picking up a quiet room still reads a little above zero, and speech from across
// a kitchen reads lower than you would guess. The floor is deliberately low: the point is to
// catch a DEAD input, not to grade how loud they are.
export const SOUND_FLOOR = 0.01

// How long everything can sit under the floor before it is worth saying. Long enough that a
// pause for thought never triggers it.
export const QUIET_SEC = 6

export type Hearing = 'listening' | 'quiet'

/** `loudestRecently` is the highest level seen in the last QUIET_SEC seconds. */
export function hearing(loudestRecently: number, elapsedSec: number): Hearing {
  if (elapsedSec < QUIET_SEC) return 'listening'
  return loudestRecently >= SOUND_FLOOR ? 'listening' : 'quiet'
}

// The meter is drawn as a proportion of full, and a linear scale spends almost all of its width
// on a range speech never reaches. This is the curve that makes ordinary talking visibly move it.
export function meterWidth(level: number): number {
  const scaled = Math.sqrt(Math.min(1, Math.max(0, level / 0.35)))
  return Math.round(scaled * 100)
}
