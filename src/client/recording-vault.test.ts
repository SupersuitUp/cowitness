import { describe, expect, it } from 'vitest'
import {
  memoryVault, newRecordingId, beginRecording, keepChunk, endRecording, forget,
  recoverable, expired, audioOf, describeRecovered, downloadName, isEmpty, VAULT_KEEP_DAYS,
} from './recording-vault.js'
import { formatClock } from './recorder.js'

const chunk = (n: number) => new Blob([new Uint8Array(n)], { type: 'audio/webm' })
const DAY = 24 * 60 * 60 * 1000

// One second of recording, the way MediaRecorder delivers it.
async function record(store: ReturnType<typeof memoryVault>, opts: { noteId?: string; seconds?: number; stop?: boolean; now?: string } = {}) {
  const id = newRecordingId()
  await beginRecording(store, { id, noteId: opts.noteId ?? 'n1', mimeType: 'audio/webm', now: opts.now })
  const seconds = opts.seconds ?? 3
  for (let i = 0; i < seconds; i += 1) await keepChunk(store, id, chunk(6000), i + 1)
  if (opts.stop !== false) await endRecording(store, id, seconds)
  return id
}

describe('the recording vault', () => {
  it('holds every chunk as it arrives, so what is on disk trails the mic by one second', async () => {
    const store = memoryVault()
    const id = newRecordingId()
    await beginRecording(store, { id, noteId: 'n1', mimeType: 'audio/webm' })
    expect((await store.get(id))?.chunks).toHaveLength(0)
    await keepChunk(store, id, chunk(6000))
    await keepChunk(store, id, chunk(6000))
    // Nothing has stopped the recorder, and two seconds are already safe.
    const held = await store.get(id)
    expect(held?.chunks).toHaveLength(2)
    expect(held?.stopped).toBe(false)
    expect(audioOf(held!).size).toBe(12000)
  })

  it('offers back a recording that was stopped but never sent', async () => {
    const store = memoryVault()
    await record(store, { seconds: 372 })
    const [found] = await recoverable(store, 'n1')
    expect(found.stopped).toBe(true)
    expect(found.durationSec).toBe(372)
    expect(describeRecovered(found, formatClock)).toBe('A 6:12 recording that never finished sending.')
  })

  it('offers back a recording the page died in the middle of, which is the one nothing else could save', async () => {
    const store = memoryVault()
    await record(store, { seconds: 4, stop: false })
    const [found] = await recoverable(store, 'n1')
    expect(found.stopped).toBe(false)
    expect(audioOf(found).size).toBe(24000)
    expect(describeRecovered(found, formatClock)).toContain('interrupted while you were still talking')
  })

  it('knows its own length even though it never reached a stop, so a rescue is not filed as zero seconds', async () => {
    const store = memoryVault()
    await record(store, { seconds: 40, stop: false })
    const [found] = await recoverable(store, 'n1')
    // Filed in production as "Recording 2" with no time beside it, because nothing had written
    // a duration. The chunk that arrives at second 40 now says so.
    expect(found.durationSec).toBe(40)
    expect(formatClock(found.durationSec)).toBe('0:40')
  })

  it('never offers back an empty one, because that teaches the person to ignore the offer', async () => {
    const store = memoryVault()
    const id = newRecordingId()
    await beginRecording(store, { id, noteId: 'n1', mimeType: 'audio/webm' })
    await keepChunk(store, id, chunk(0))
    await endRecording(store, id, 2)
    expect(isEmpty((await store.get(id))!)).toBe(true)
    expect(await recoverable(store, 'n1')).toEqual([])
  })

  it('keeps each note to its own recordings, newest first', async () => {
    const store = memoryVault()
    await record(store, { noteId: 'n1', now: '2026-09-20T10:00:00.000Z' })
    await record(store, { noteId: 'n1', now: '2026-09-22T10:00:00.000Z' })
    await record(store, { noteId: 'n2', now: '2026-09-23T10:00:00.000Z' })
    const mine = await recoverable(store, 'n1')
    expect(mine.map((r) => r.createdAt)).toEqual(['2026-09-22T10:00:00.000Z', '2026-09-20T10:00:00.000Z'])
    expect(await recoverable(store, 'n2')).toHaveLength(1)
  })

  it('forgets a recording once it is safely filed, and a late chunk does not resurrect it', async () => {
    const store = memoryVault()
    const id = await record(store)
    await forget(store, id)
    // ondataavailable can still be in flight when the send finishes.
    await keepChunk(store, id, chunk(6000))
    expect(await store.get(id)).toBeUndefined()
    expect(await recoverable(store, 'n1')).toEqual([])
  })

  it('stops holding their audio forever, but only after the keep window', async () => {
    const store = memoryVault()
    const now = new Date('2026-09-23T00:00:00.000Z')
    await record(store, { now: new Date(now.getTime() - (VAULT_KEEP_DAYS - 1) * DAY).toISOString() })
    await record(store, { now: new Date(now.getTime() - (VAULT_KEEP_DAYS + 1) * DAY).toISOString() })
    expect(await recoverable(store, 'n1', { now })).toHaveLength(1)
    expect(await expired(store, { now })).toHaveLength(1)
  })

  it('names a rescued file so it is recognisable on their desktop', async () => {
    const store = memoryVault()
    const id = await record(store, { now: '2026-09-23T04:41:07.000Z' })
    expect(downloadName((await store.get(id))!)).toBe('recording-2026-09-23-04-41-07.webm')
    const mp4 = { ...(await store.get(id))!, mimeType: 'audio/mp4' }
    expect(downloadName(mp4)).toBe('recording-2026-09-23-04-41-07.m4a')
  })

  it('a chunk that lands just before the stop keeps both the chunk and the stop, even on a slow store', async () => {
    // IndexedDB answers each call on its own schedule. Here every read is quick and every write
    // lands AFTER the ones issued behind it, so two unordered read-then-writes both read the
    // record as it was and the first write issued is the one that survives.
    const store = racingStore()
    const id = newRecordingId()
    await beginRecording(store, { id, noteId: 'n1', mimeType: 'audio/webm' })
    // The recorder's last ondataavailable and its onstop, one straight after the other, unawaited.
    await Promise.all([keepChunk(store, id, chunk(6000), 2), endRecording(store, id, 2)])
    const rec = await store.inner.get(id)
    expect(rec?.chunks).toHaveLength(1)
    expect(rec?.stopped).toBe(true)
  })

  it('a chunk still being written when the recording is let go of never brings it back', async () => {
    const store = racingStore()
    const id = newRecordingId()
    await beginRecording(store, { id, noteId: 'n1', mimeType: 'audio/webm' })
    // Sent, and let go of, while the recorder's last chunk was still being written.
    await Promise.all([keepChunk(store, id, chunk(6000), 1), forget(store, id)])
    expect(await store.inner.all()).toEqual([])
  })
})

// Reads and deletes answer in a millisecond; each put waits less than the one before it, so
// puts land in the reverse of the order they were issued, and after any quick delete.
function racingStore() {
  const inner = memoryVault()
  let writeDelay = 60
  const after = <T,>(ms: number, fn: () => Promise<T>) => new Promise<T>((r) => { setTimeout(() => { void fn().then(r) }, ms) })
  const nextWrite = () => (writeDelay = Math.max(1, writeDelay - 10))
  return {
    inner,
    get: (id: string) => after(1, () => inner.get(id)),
    all: () => after(1, () => inner.all()),
    put: (rec: Parameters<typeof inner.put>[0]) => after(nextWrite(), () => inner.put(rec)),
    delete: (id: string) => after(1, () => inner.delete(id)),
  }
}
