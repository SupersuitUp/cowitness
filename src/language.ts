// The language a transcription was asked for: one the app listens for, or 'auto'. The list of
// languages comes from the app that hosts this, never from here.
export const spokenLanguage = (v: unknown, languages: readonly string[]): string =>
  v === 'auto' || (typeof v === 'string' && languages.includes(v)) ? (v as string) : 'auto'
