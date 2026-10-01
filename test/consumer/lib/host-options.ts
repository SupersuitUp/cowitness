import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { circleOf, mayHear, resolveFeatures, type Person, type Snap } from '@supersuit/cowitness'
import { askPeopleOnce, createCowitnessHandlers, createCowitnessStore, type CowitnessHost } from '@supersuit/cowitness/server'
import { OPTIONS } from './options-features'

// Every option on, so a type or an export an option needs and the package forgot fails this build.
// Nothing here runs at import time but the package's own start-up checks: the build needs no credentials.
type K = 'a' | 'b' | 'c'
const PEOPLE: Person<K>[] = [{ key: 'a', role: 'shares' }, { key: 'b', role: 'shares' }, { key: 'c', role: 'witnesses' }]
const features = resolveFeatures(OPTIONS)
// The package builds a circle exactly when the audience kind or "just us" is on, so the host passes
// one then and only then. An app with neither on passes none: a circle left over from an option it
// turned off would tell a person who now only witnesses about a snap that is still "just us".
const needsCircle = features.witnessing === 'audience' || features.justUs

export type Moment = 'shared' | 'witnessed' | 'message' | 'heart' | 'spoken' | 'tagged'
export interface Told { to: K; what: Moment; snapId: string }

const refuse = async (): Promise<never> => { throw new Error('the consumer app files nothing') }

export function optionsHostWith(parts: { deliver?: (t: Told) => void; people?: () => Promise<Person<K>[]> } = {}): CowitnessHost<K> {
  const deliver = parts.deliver ?? (() => {})
  const people = parts.people ?? (async () => PEOPLE)
  // Everyone but the person who acted, each one checked with mayHear before anything is said.
  const tell = (what: Moment) => async (actor: K, s: Snap<K>) => {
    const all = await people()
    const circle = needsCircle ? circleOf(features.witnessing, all) : undefined
    for (const p of all) if (p.key !== actor && mayHear(s, p.key, circle)) deliver({ to: p.key, what, snapId: s.id })
  }
  return {
    member: async () => null,
    db: () => getFirestore(),
    collection: 'moments',
    storage: { bucket: () => getStorage().bucket(), prefix: 'app/' },
    media: { urls: async () => ({ thumbUrl: null, displayUrl: null }), signedUrl: refuse, filePhoto: refuse, fileVideo: refuse },
    announce: {
      shared: tell('shared'), witnessed: tell('witnessed'), message: tell('message'), heart: tell('heart'),
      spoken: tell('spoken'), tagged: tell('tagged'),
    },
    features: OPTIONS,
    people,
    tags: { list: async () => [{ id: 't-first', label: 'First' }] },
    prompts: { collection: 'moments_prompts', timeZone: 'America/Los_Angeles', people: async () => [], save: async () => {}, nudge: () => {} },
  }
}

export const optionsHost = optionsHostWith()
export const optionsHandlers = createCowitnessHandlers(optionsHost)

// One page's data. The store is made here, per request, from askPeopleOnce: the page asks who its
// people are once, and the next request asks again, so a change in who is who shows at once. Made
// once at module scope it would keep the first answer until a redeploy.
export async function optionsHome(me: K, host: CowitnessHost<K> = optionsHost) {
  const store = createCowitnessStore(askPeopleOnce(host))
  const [can, tagChoices, home] = await Promise.all([store.whoAmI(me), store.tagChoices(), store.listCowitness(me)])
  return { can, tagChoices, ...home }
}
