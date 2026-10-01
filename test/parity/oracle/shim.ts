// What the frozen Us files imported from the rest of Us, with the sample members every test uses.
export type Member = 'ana' | 'ben'
export const PAIR = ['ana', 'ben'] as const
export const ADMIN: Member = 'ana'
export const otherOf = (m: Member): Member => (m === 'ana' ? 'ben' : 'ana')
export interface AgendaSummary { open: number; next: string | null }
