'use client'

import type { Ref } from 'react'

interface Props {
  ref: Ref<HTMLInputElement>
  label: string
  onFiles(files: File[]): void
  /** Several at once (Photos) or exactly one (a snap). */
  multiple?: boolean
  /** What the picker will show. Both kinds unless a button means one of them. */
  accept?: string
}

// The hidden pick input (photos and videos) a visible button clicks. Visually hidden rather
// than display:none, which some iOS versions will not open a picker for. A
// cancelled picker reports no files, and nothing happens.
export function PhotoInput({ ref, label, onFiles, multiple = true, accept = 'image/*,video/*' }: Props) {
  return (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple={multiple}
      aria-label={label}
      tabIndex={-1}
      className="sr-only"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? [])
        // Cleared so choosing the same photos again still reports a change.
        e.target.value = ''
        if (files.length > 0) onFiles(files)
      }}
    />
  )
}
