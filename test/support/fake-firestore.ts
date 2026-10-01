import type { Firestore } from 'firebase-admin/firestore'

// An in-memory stand-in for the slice of the Firestore Admin API the stores use: collections of
// documents, one equality where(), whole-collection reads, transactions and batches. Every write
// stores a deep copy and every read hands one back, so a store that edits what it read and forgets
// to write it is caught rather than hidden.
type Data = Record<string, unknown>
let auto = 0

export function fakeFirestore() {
  const collections = new Map<string, Map<string, Data>>()
  const coll = (name: string) => {
    let c = collections.get(name)
    if (!c) { c = new Map(); collections.set(name, c) }
    return c
  }
  const snapshot = (name: string, id: string) => {
    const d = coll(name).get(id)
    return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : structuredClone(d)), ref: ref(name, id) }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = (name: string, id: string): any => ({
    id, path: `${name}/${id}`, collectionName: name,
    get: async () => snapshot(name, id),
    set: async (data: Data) => { coll(name).set(id, structuredClone(data)) },
    delete: async () => { coll(name).delete(id) },
    // Firestore's create-once: refused when the document exists. No await before the check, so two
    // overlapping callers can never both create.
    create: async (data: Data) => {
      if (coll(name).has(id)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      coll(name).set(id, structuredClone(data))
    },
  })
  const query = (name: string, keep: (d: Data) => boolean) => ({
    get: async () => ({ docs: [...coll(name).entries()].filter(([, d]) => keep(d)).map(([id]) => snapshot(name, id)) }),
  })
  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => ref(name, id ?? `auto${++auto}`),
      where: (field: string, op: string, value: unknown) => {
        if (op !== '==') throw new Error(`the fake supports == only, not ${op}`)
        return query(name, (d) => d[field] === value)
      },
      get: async () => query(name, () => true).get(),
    }),
    // Writes apply only when the callback returns, as a committed transaction's do.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const writes: (() => void)[] = []
      const tx = {
        get: (r: { get(): Promise<unknown> }) => r.get(),
        set: (r: { collectionName: string; id: string }, data: Data) => { writes.push(() => coll(r.collectionName).set(r.id, structuredClone(data))) },
        delete: (r: { collectionName: string; id: string }) => { writes.push(() => coll(r.collectionName).delete(r.id)) },
      }
      const out = await fn(tx)
      for (const w of writes) w()
      return out
    },
    batch: () => {
      const ops: (() => void)[] = []
      return {
        set: (r: { collectionName: string; id: string }, data: Data) => { ops.push(() => coll(r.collectionName).set(r.id, structuredClone(data))) },
        delete: (r: { collectionName: string; id: string }) => { ops.push(() => coll(r.collectionName).delete(r.id)) },
        commit: async () => { for (const op of ops) op() },
      }
    },
  }
  return {
    db: db as unknown as Firestore,
    seed(name: string, records: Record<string, object>) {
      for (const [id, d] of Object.entries(records)) coll(name).set(id, structuredClone(d as Data))
    },
    raw(name: string, id: string): Data | undefined {
      const d = coll(name).get(id)
      return d === undefined ? undefined : structuredClone(d)
    },
    all(name: string): Record<string, Data> {
      return Object.fromEntries([...coll(name).entries()].map(([id, d]) => [id, structuredClone(d)]))
    },
  }
}
