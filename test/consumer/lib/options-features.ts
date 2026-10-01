import type { CowitnessFeatures } from '@supersuit/cowitness'

// Every option on, in one place: the host and the screens are handed this same value, as an app
// must, so the screens never offer what the server would refuse.
export const OPTIONS: Partial<CowitnessFeatures> = {
  witnessing: 'audience', voiceSnaps: true, justUs: true, tags: true, doubleCamera: false, prompts: true,
  streak: { kind: 'household', timeZone: 'America/Los_Angeles', since: '2026-01-01', freeSkipsPerWeek: 1 },
}
