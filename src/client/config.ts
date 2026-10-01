import type { ReactNode } from 'react'
import type { Comment, MemberNames } from '../types.js'
import { resolveFeatures, type CowitnessFeatures } from '../features.js'

// What a snap's conversation slot is given. The app draws the conversation itself, so a snap's
// messages look exactly like every other conversation in that app.
export interface ThreadSlotProps {
  snapId: string
  me: string
  names: MemberNames
  comments: Comment[] | undefined
  /** The server's conversation after a send landed. */
  onSent(next: Comment[]): void
  /** Where a message's recording plays from, or null. */
  audioSrc(c: Comment): string | null
  /** Transcribe this message's recording again. */
  onRetranscribe(commentId: string): void
}

export interface CowitnessClientConfig {
  /** Where the app mounted the snap handlers; a snap is <apiBase>/<id>. */
  apiBase: string
  /** Where the Cowitness pages live: the shelf at <pageBase>/witnessed, a snap at <pageBase>/<id>. */
  pageBase: string
  /** The app's own upload tickets, which a snap's bytes travel through as an album photo's do. */
  uploadUrls: { photo: string; video: string }
  /** The IndexedDB database spoken reactions wait in until the server has them. An app that held
   *  recordings before it used this package passes the name it always used. */
  vaultName: string
  /** Draws the conversation under a snap. */
  renderThread(props: ThreadSlotProps): ReactNode
  /** Which options are on, the same value the app gives its host. Absent: none. */
  features?: Partial<CowitnessFeatures>
}

let current: CowitnessClientConfig | null = null

export function configure(c: CowitnessClientConfig): void {
  current = c
}

export function clientConfig(): CowitnessClientConfig {
  if (!current) throw new Error('Cowitness is not configured: render its screens inside <CowitnessProvider>')
  return current
}

// The options the screens draw for. Unconfigured or absent, every option is off.
export const clientFeatures = (): CowitnessFeatures => resolveFeatures(current?.features)
