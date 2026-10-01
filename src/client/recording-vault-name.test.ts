import { afterEach, describe, expect, it, vi } from 'vitest'
import { indexedDbVault } from './recording-vault.js'

// A fake IndexedDB that answers every request on a later turn of the event loop (as a real one does,
// after the caller has attached its handlers) and records which database was opened.
function fakeIndexedDb() {
  const answer = <T,>(result: T) => {
    const req: { result?: T; onsuccess?: () => void; onerror?: () => void } = {}
    setTimeout(() => { req.result = result; req.onsuccess?.() }, 0)
    return req
  }
  const store = { getAll: () => answer([]), get: () => answer(undefined), put: () => answer(undefined), delete: () => answer(undefined) }
  const db = { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => store }) }
  return { open: vi.fn(() => answer(db)) }
}

describe('where held recordings are kept', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is the database the app names, so recordings held before the app used this package are found', async () => {
    const idb = fakeIndexedDb()
    vi.stubGlobal('indexedDB', idb)
    await indexedDbVault()!.all()
    expect(idb.open).toHaveBeenLastCalledWith('test-recordings', 1)
    await indexedDbVault('legacy-recordings')!.all()
    expect(idb.open).toHaveBeenLastCalledWith('legacy-recordings', 1)
  })
})
