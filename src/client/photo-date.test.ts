// @vitest-environment node
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { readTakenAt } from './photo-date.js'

const jpeg = (exif?: Parameters<ReturnType<typeof sharp>['withExif']>[0]) => {
  const s = sharp({ create: { width: 30, height: 20, channels: 3, background: '#c33' } })
  return (exif ? s.withExif(exif) : s).jpeg().toBuffer()
}
const bytes = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

describe('the date a photo was taken, read on the phone before its metadata is dropped', () => {
  it('reads the camera time with its offset', async () => {
    const b = await jpeg({ IFD2: { DateTimeOriginal: '2026:09:15 19:42:10', OffsetTimeOriginal: '-05:00' } })
    expect(readTakenAt(bytes(b))).toBe('2026-09-15T19:42:10-05:00')
  })
  it('reads the camera time alone as wall time when there is no offset', async () => {
    const b = await jpeg({ IFD2: { DateTimeOriginal: '2026:09:15 19:42:10' } })
    expect(readTakenAt(bytes(b))).toBe('2026-09-15T19:42:10')
  })
  it('reads both byte orders: sharp writes one, insertExifDate the other', async () => {
    const { insertExifDate } = await import('../../test/support/exif-date.js')
    const b = await jpeg({ IFD0: { Make: 'x' }, IFD2: { DateTimeOriginal: '2025:12:31 23:59:59' } })
    expect(readTakenAt(bytes(b))).toBe('2025-12-31T23:59:59')
    expect(readTakenAt(bytes(insertExifDate(await jpeg(), '2026-01-02T03:04:05')))).toBe('2026-01-02T03:04:05')
  })
  it('answers null for a picture with no date, and for something that is not a JPEG', async () => {
    expect(readTakenAt(bytes(await jpeg()))).toBeNull()
    expect(readTakenAt(new TextEncoder().encode('hello').buffer)).toBeNull()
  })
})
