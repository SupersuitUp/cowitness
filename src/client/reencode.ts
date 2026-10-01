// Every member upload reaches the server as a JPEG. iOS already hands the page a
// JPEG for a HEIC photo, but this also rotates by the EXIF orientation, caps the
// long edge, and drops EXIF (location included) before anything leaves the phone.
export const MAX_EDGE = 4096
export const JPEG_QUALITY = 0.92

export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max) return { width, height }
  const scale = max / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

type Source = { image: CanvasImageSource; width: number; height: number; release(): void }

/** Decoded pixels anything can draw from, in the same shape a camera frame has. */
export const decodeFrame = (file: Blob) => decode(file)

// createImageBitmap with an orientation option can throw in Safari. The fallback
// decodes through an <img>, which iOS draws with its EXIF orientation applied.
async function decode(file: Blob): Promise<Source> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
  } catch {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const release = () => { img.src = ''; URL.revokeObjectURL(url) }
    try {
      img.src = url
      await img.decode()
    } catch (e) {
      release()
      throw e
    }
    // The URL is revoked only after the draw, in toJpeg's finally, so Safari never
    // loses the pixels between decode and drawImage.
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release }
  }
}

export async function toJpeg(file: Blob): Promise<Blob> {
  const source = await decode(file)
  const canvas = document.createElement('canvas')
  try {
    const { width, height } = fitWithin(source.width, source.height)
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(source.image, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', JPEG_QUALITY)
    })
  } finally {
    source.release()
    // iOS caps total canvas memory per page. A canvas that is merely unreferenced
    // keeps its backing store until GC, so a ten-photo batch could run out; a zero
    // size frees it now.
    canvas.width = 0
    canvas.height = 0
  }
}
