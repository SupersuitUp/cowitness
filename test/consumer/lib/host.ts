import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import type { CowitnessHost } from '@supersuit/cowitness/server'

// Nothing here runs at import time: the build needs no credentials, only the types to line up.
const refuse = async (): Promise<never> => { throw new Error('the consumer app files nothing') }
export const host: CowitnessHost<'a' | 'b'> = {
  member: async () => null,
  db: () => getFirestore(),
  collection: 'snaps',
  storage: { bucket: () => getStorage().bucket(), prefix: 'app/' },
  media: { urls: async () => ({ thumbUrl: null, displayUrl: null }), signedUrl: refuse, filePhoto: refuse, fileVideo: refuse },
  announce: { shared: () => {}, witnessed: () => {}, message: () => {}, heart: () => {} },
}
