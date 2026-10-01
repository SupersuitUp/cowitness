// Where the album's photos are taken. A wall time with no zone is written as it is; an instant is
// written as the wall time here, with its offset, which the phone uses to place it correctly.
export const PHOTO_ZONE = 'America/Chicago'

const pad = (n: number) => String(n).padStart(2, '0')

export function exifDateParts(takenAt: string, zone = PHOTO_ZONE): { dateTime: string; offset: string | null } {
  const wall = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(takenAt)
  if (wall) return { dateTime: `${wall[1]}:${wall[2]}:${wall[3]} ${wall[4]}:${wall[5]}:${wall[6]}`, offset: null }
  const t = Date.parse(takenAt)
  if (Number.isNaN(t)) throw new Error(`not a date: ${takenAt}`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  const mins = Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000)
  const sign = mins < 0 ? '-' : '+'
  return {
    dateTime: `${parts.year}:${parts.month}:${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    offset: `${sign}${pad(Math.floor(Math.abs(mins) / 60))}:${pad(Math.abs(mins) % 60)}`,
  }
}

// The JPEG's segments up to the image data, as [marker, start, length-including-header].
function segments(jpeg: Buffer): { marker: number; start: number; end: number }[] {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG')
  const out: { marker: number; start: number; end: number }[] = []
  let p = 2
  while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
    const marker = jpeg[p + 1]
    if (marker === 0xda || marker === 0xd9) break // start of scan: the image data
    const end = p + 2 + jpeg.readUInt16BE(p + 2)
    out.push({ marker, start: p, end })
    p = end
  }
  return out
}

const isExif = (jpeg: Buffer, s: { marker: number; start: number }) =>
  s.marker === 0xe1 && jpeg.toString('latin1', s.start + 4, s.start + 10) === 'Exif\0\0'

// A minimal big-endian TIFF: IFD0 { DateTime, ExifIFD pointer } -> Exif IFD { DateTimeOriginal,
// DateTimeDigitized, OffsetTimeOriginal? }.
function tiff(dateTime: string, offset: string | null): Buffer {
  const ascii = (s: string) => Buffer.from(`${s}\0`, 'latin1')
  const dt = ascii(dateTime) // 20 bytes
  const exifEntries: [number, Buffer][] = [[0x9003, dt], [0x9004, dt]]
  if (offset) exifEntries.push([0x9011, ascii(offset)])
  const ifd0At = 8
  const ifd0Size = 2 + 2 * 12 + 4
  const dtAt = ifd0At + ifd0Size
  const exifAt = dtAt + dt.length
  const exifSize = 2 + exifEntries.length * 12 + 4
  let dataAt = exifAt + exifSize
  const buf = Buffer.alloc(dataAt + exifEntries.reduce((n, [, v]) => n + v.length, 0))
  buf.write('MM', 0, 'latin1'); buf.writeUInt16BE(42, 2); buf.writeUInt32BE(ifd0At, 4)
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    buf.writeUInt16BE(tag, at); buf.writeUInt16BE(type, at + 2); buf.writeUInt32BE(count, at + 4); buf.writeUInt32BE(value, at + 8)
  }
  buf.writeUInt16BE(2, ifd0At)
  entry(ifd0At + 2, 0x0132, 2, dt.length, dtAt) // DateTime
  entry(ifd0At + 14, 0x8769, 4, 1, exifAt) // Exif IFD pointer
  buf.writeUInt32BE(0, ifd0At + 2 + 24)
  dt.copy(buf, dtAt)
  buf.writeUInt16BE(exifEntries.length, exifAt)
  exifEntries.forEach(([tag, v], i) => { entry(exifAt + 2 + i * 12, tag, 2, v.length, dataAt); v.copy(buf, dataAt); dataAt += v.length })
  buf.writeUInt32BE(0, exifAt + 2 + exifEntries.length * 12)
  return buf
}

// The same JPEG with the date written in, or the SAME buffer when it already carries EXIF (a date is
// never overwritten, and a second EXIF segment would be ignored by every reader anyway).
export function insertExifDate(jpeg: Buffer, takenAt: string, zone = PHOTO_ZONE): Buffer {
  if (segments(jpeg).some((s) => isExif(jpeg, s))) return jpeg
  const { dateTime, offset } = exifDateParts(takenAt, zone)
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(dateTime, offset)])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xffe1, 0); header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)])
}
