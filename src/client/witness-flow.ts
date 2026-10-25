// The witness session's steps, as data. It only ever moves forward: nothing is skippable,
// but Next with nothing said still counts, because a snap seen in silence was still seen.
export interface Session { index: number; total: number }

export const begin = (total: number): Session => ({ index: 0, total })
export const isDone = (s: Session) => s.index >= s.total
export const advance = (s: Session): Session => ({ ...s, index: Math.min(s.index + 1, s.total) })
export const progressLabel = (s: Session) => `${Math.min(s.index + 1, s.total)} of ${s.total}`

export function witnessPatch(typed: string): { kind: 'witness'; text?: string } {
  const text = typed.trim()
  return text ? { kind: 'witness', text } : { kind: 'witness' }
}

// Opening someone else's snap on its own page is seeing it too, so it is witnessed the same way a
// silent Next is, and the person who shared it is told. Never for one's own snap, a hidden one, or
// one this person has already seen. Where each witness has their own seen (`witnessedBy` is
// present), only theirs counts; the server still refuses anyone who does not witness.
export function witnessesOnOpen(
  s: { by: string; hiddenAt: string | null; witnessedAt: string | null; witnessedBy?: Partial<Record<string, string>> },
  me: string,
): boolean {
  if (s.by === me || s.hiddenAt !== null) return false
  return s.witnessedBy ? s.witnessedBy[me] === undefined : s.witnessedAt === null
}

export const SWIPE_UP_PX = 60
export const isSwipeUp = (startY: number, endY: number) => startY - endY >= SWIPE_UP_PX

// Whether a snap's recording is sent. Typed words are the reaction: once the person has typed something,
// what was said before is let go of on the phone and never uploaded, so a typed
// comment and a recording never both go. Nothing typed: it goes if it held speech.
export const sendsRecording = (worthKeeping: boolean, typed: string) => worthKeeping && typed.trim() === ''
