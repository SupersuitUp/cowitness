import type { ReactNode } from 'react'
import { MUTED } from './theme.js'

// The small grey capitals over a group: a day in a list, "Recordings", a person's name over their
// message. One definition, so every heading of this kind is the same size, weight and grey.
export const SECTION_LABEL = 'text-xs font-medium tracking-wide uppercase'

export function SectionLabel({ as: Tag = 'h2', className = '', children }: { as?: 'h2' | 'h3' | 'p' | 'span'; className?: string; children: ReactNode }) {
  return <Tag className={className ? `${className} ${SECTION_LABEL}` : SECTION_LABEL} style={{ color: MUTED }}>{children}</Tag>
}
