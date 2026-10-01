// A recording is the one thing in this app that cannot be made again. Everything else here
// can be retyped; six minutes of thinking out loud cannot. So the chunks go into
// the browser's own database AS THE RECORDER PRODUCES THEM, once a second, which means what
// is on disk is never more than a second behind what was said. A tab that crashes, a laptop
// that sleeps, a connection that dies mid-upload: the recording is still there on the next
// visit, and the page offers it back.
//
// The store is an interface rather than IndexedDB directly, so every rule below is tested
// against an in-memory one. `indexedDbVault()` is the browser implementation and is
// deliberately four small methods with no logic in them.
import { clientConfig } from './config.js'

export interface VaultRecord {
  id: string
  noteId: string
  mimeType: string
  createdAt: string
  durationSec: number
  /** The recorder reached its own stop. False means the page died mid-sentence. */
  stopped: boolean
  chunks: Blob[]
}

export interface VaultStore {
  get(id: string): Promise<VaultRecord | undefined>
  put(rec: VaultRecord): Promise<void>
  delete(id: string): Promise<void>
  all(): Promise<VaultRecord[]>
}

// Kept long enough that a week away from the laptop does not lose anything, and not forever,
// because this is the operator's own disk. Only ever applied to recordings that were already
// offered back and left alone.
export const VAULT_KEEP_DAYS = 30

export const newRecordingId = () =>
  `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// Every write to one recording goes through here, in the order it was called. keepChunk and
// endRecording each read the record and write it back, and the recorder fires its last
// ondataavailable and its onstop back to back without waiting. On IndexedDB both reads can see
// the record as it was before either write, and then whichever write lands last wins: the final
// chunk is lost, or `stopped` stays false and sendHeld skips the recording forever. Chaining
// per id means each read sees the previous write. A failed step does not break the chain.
const chains = new WeakMap<VaultStore, Map<string, Promise<unknown>>>()

function inOrder<T>(store: VaultStore, id: string, step: () => Promise<T>): Promise<T> {
  let byId = chains.get(store)
  if (!byId) { byId = new Map(); chains.set(store, byId) }
  const before = byId.get(id) ?? Promise.resolve()
  const run = before.then(step, step)
  const tail = run.catch(() => {})
  byId.set(id, tail)
  void tail.then(() => { if (byId.get(id) === tail) byId.delete(id) })
  return run
}

export async function beginRecording(
  store: VaultStore, input: { id: string; noteId: string; mimeType: string; now?: string },
): Promise<VaultRecord> {
  const rec: VaultRecord = {
    id: input.id, noteId: input.noteId, mimeType: input.mimeType,
    createdAt: input.now ?? new Date().toISOString(),
    durationSec: 0, stopped: false, chunks: [],
  }
  await inOrder(store, rec.id, () => store.put(rec))
  return rec
}

// Read-modify-write per chunk. A chunk that arrives for a recording already forgotten (the
// send finished while the last ondataavailable was in flight) is dropped rather than
// resurrecting the record.
//
// `atSec` is how long the recorder had been running when this chunk arrived, and it is written
// EVERY time, so the record always knows its own length. A recording the page died in the
// middle of never reaches `endRecording`, and without this it comes back as a clip of zero
// seconds: filed, playable, and listed with no length, which reads as a rescue that half
// worked. Measured in production on a 40-second recording that was interrupted.
export function keepChunk(store: VaultStore, id: string, chunk: Blob, atSec?: number): Promise<void> {
  return inOrder(store, id, async () => {
    const rec = await store.get(id)
    if (!rec) return
    const durationSec = typeof atSec === 'number' && atSec > rec.durationSec ? Math.round(atSec) : rec.durationSec
    await store.put({ ...rec, chunks: [...rec.chunks, chunk], durationSec })
  })
}

export function endRecording(store: VaultStore, id: string, durationSec: number): Promise<void> {
  return inOrder(store, id, async () => {
    const rec = await store.get(id)
    if (!rec) return
    await store.put({ ...rec, stopped: true, durationSec })
  })
}

export const forget = (store: VaultStore, id: string) => inOrder(store, id, () => store.delete(id))

export const audioOf = (rec: VaultRecord) => new Blob(rec.chunks, { type: rec.mimeType })

export const isEmpty = (rec: VaultRecord) => rec.chunks.every((c) => c.size === 0)

/**
 * What is still here from a previous visit, newest first. An interrupted recording counts:
 * a page that died mid-sentence leaves audio that is partial and still theirs. An empty one
 * never does, because offering back nothing teaches the person to ignore the offer.
 */
export async function recoverable(
  store: VaultStore, noteId: string, opts: { now?: Date } = {},
): Promise<VaultRecord[]> {
  const now = opts.now ?? new Date()
  const cutoff = now.getTime() - VAULT_KEEP_DAYS * 24 * 60 * 60 * 1000
  const all = await store.all()
  return all
    .filter((r) => r.noteId === noteId && !isEmpty(r) && Date.parse(r.createdAt) >= cutoff)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/**
 * Records past the keep window, whatever note they belong to, so the browser's disk is not a leak.
 * Notes' sweep of this also covers Cowitness `snap:` records: a held reaction older than 30 days is dropped.
 */
export async function expired(store: VaultStore, opts: { now?: Date } = {}): Promise<VaultRecord[]> {
  const now = opts.now ?? new Date()
  const cutoff = now.getTime() - VAULT_KEEP_DAYS * 24 * 60 * 60 * 1000
  return (await store.all()).filter((r) => Date.parse(r.createdAt) < cutoff || isEmpty(r))
}

// What to call it on screen. It says whether the recording finished, because "never finished
// sending" and "the page closed while you were talking" are different things to the person.
export function describeRecovered(rec: VaultRecord, clock: (sec: number) => string): string {
  const length = rec.durationSec > 0 ? clock(rec.durationSec) : 'unfinished'
  return rec.stopped
    ? `A ${length} recording that never finished sending.`
    : `A recording that was interrupted while you were still talking. What was captured is here.`
}

// The file name a download gets, so a rescued recording is recognisable on their desktop.
export function downloadName(rec: VaultRecord): string {
  const ext = ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' })[rec.mimeType] ?? 'webm'
  return `recording-${rec.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.${ext}`
}

// --- the browser store, which holds no rules of its own ---

const SHELF = 'pending'

// The database is named by the app (CowitnessClientConfig.vaultName), so an app that held
// recordings before it used this package keeps finding them: it passes the name it always used.
function open(db: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(db, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(SHELF)) req.result.createObjectStore(SHELF, { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexeddb unavailable'))
  })
}

const done = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })

async function shelf(db: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open(db)).transaction(SHELF, mode).objectStore(SHELF)
}

export function indexedDbVault(db: string = clientConfig().vaultName): VaultStore | null {
  if (typeof indexedDB === 'undefined') return null
  return {
    async get(id) { return done(await shelf(db, 'readonly').then((s) => s.get(id))) },
    async put(rec) { await done(await shelf(db, 'readwrite').then((s) => s.put(rec))) },
    async delete(id) { await done(await shelf(db, 'readwrite').then((s) => s.delete(id))) },
    async all() { return done(await shelf(db, 'readonly').then((s) => s.getAll())) },
  }
}

/** An in-memory store, for tests and for a browser with no IndexedDB (private windows, old Safari). */
export function memoryVault(): VaultStore {
  const held = new Map<string, VaultRecord>()
  return {
    async get(id) { return held.get(id) },
    async put(rec) { held.set(rec.id, rec) },
    async delete(id) { held.delete(id) },
    async all() { return [...held.values()] },
  }
}
