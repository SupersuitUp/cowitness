// When a photo was taken, read from the file on the phone BEFORE toJpeg redraws it and drops its
// metadata (location included, on purpose). Only the date leaves the phone. Before this the app sent
// file.lastModified, which on an iPhone is often the moment the photo was picked, so a photo saved
// back out of the app could be dated the day it was uploaded.
//
// Reads the first EXIF segment of a JPEG: DateTimeOriginal, with OffsetTimeOriginal when present.
// Returns an ISO-shaped string: 'YYYY-MM-DDTHH:MM:SS-05:00', or wall time 'YYYY-MM-DDTHH:MM:SS'
// when the camera wrote no offset, or null.

const HEAD_BYTES = 256 * 1024

export function readTakenAt(buf: ArrayBuffer): string | null {
  try {
    const v = new DataView(buf)
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null
    let p = 2
    while (p + 4 <= v.byteLength && v.getUint8(p) === 0xff) {
      const marker = v.getUint8(p + 1)
      if (marker === 0xda || marker === 0xd9) return null
      const len = v.getUint16(p + 2)
      if (marker === 0xe1 && ascii(v, p + 4, 6) === 'Exif\0\0') return fromTiff(v, p + 10)
      p += 2 + len
    }
    return null
  } catch {
    return null
  }
}

function ascii(v: DataView, at: number, n: number): string {
  let s = ''
  for (let i = 0; i < n && at + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(at + i))
  return s
}

function fromTiff(v: DataView, t: number): string | null {
  const le = ascii(v, t, 2) === 'II'
  const u16 = (at: number) => v.getUint16(t + at, le)
  const u32 = (at: number) => v.getUint32(t + at, le)
  // The value of an ASCII entry: inline when 4 bytes or fewer, else at an offset.
  const text = (entry: number) => {
    const count = u32(entry + 4)
    const at = count <= 4 ? entry + 8 : u32(entry + 8)
    return ascii(v, t + at, count).replace(/\0+$/, '')
  }
  const find = (ifd: number, tag: number) => {
    const n = u16(ifd)
    for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12
    return -1
  }
  const ifd0 = u32(4)
  const ptr = find(ifd0, 0x8769)
  if (ptr < 0) return null
  const exif = u32(ptr + 8)
  const dto = find(exif, 0x9003)
  if (dto < 0) return null
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text(dto))
  if (!m) return null
  const wall = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
  const off = find(exif, 0x9011)
  const offset = off >= 0 ? text(off) : ''
  return /^[+-]\d{2}:\d{2}$/.test(offset) ? `${wall}${offset}` : wall
}

/** The date for a picked file, from its own metadata, read from the first 256 KB only. */
export async function takenAtOf(file: Blob): Promise<string | null> {
  try { return readTakenAt(await bytesOf(file.slice(0, HEAD_BYTES))) } catch { return null }
}

// Blob.arrayBuffer where it exists; FileReader where it does not (older Safari, test DOMs).
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}
