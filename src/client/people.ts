import type { MemberNames } from '../types.js'

// The other person in an each-other Cowitness, from the names the screen was handed by the server.
export const otherIn = (names: MemberNames, me: string): string => Object.keys(names).find((k) => k !== me) ?? me
