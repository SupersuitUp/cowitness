'use client'

import { useEffect, useState } from 'react'
import { NoPoster, VideoMark } from './video-mark.js'
import { isVideoFile } from './video-meta.js'

export interface PickedPhoto {
  id: string
  file: File
  /** A ready image URL (dev fixtures; a poster for a video). Without one, the preview makes its own object URL. */
  src?: string
  /** A video's length, once read. */
  durationSec?: number
  /** Why this video will not be added ("Couldn't read this video"). */
  problem?: string | null
  /** True while a video's length is still being read. */
  pending?: boolean
}

// A small square preview. It owns its object URL, so the URL is given back when
// the item is removed or the sheet closes, and a StrictMode remount makes a fresh one.
export function PickedPreview({ photo }: { photo: PickedPhoto }) {
  const video = isVideoFile(photo.file)
  const [url, setUrl] = useState<string | null>(photo.src ?? null)
  useEffect(() => {
    if (photo.src || photo.problem) return
    const made = URL.createObjectURL(photo.file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [photo.file, photo.src, photo.problem])

  if (video && photo.problem) {
    return (
      <>
        <NoPoster />
        <p className="absolute inset-x-1 top-1/2 -translate-y-1/2 text-center text-[11px] leading-tight text-white">{photo.problem}</p>
      </>
    )
  }
  if (!url) return null
  if (video && !photo.src) {
    return (
      <>
        {/* #t skips a black first frame; iOS draws that frame without playing. */}
        <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        <VideoMark durationSec={photo.durationSec} small />
      </>
    )
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, nothing for the image optimizer to do */}
      <img src={url} alt="" className="h-full w-full object-cover" draggable={false} decoding="async" loading="lazy" />
      {video && <VideoMark durationSec={photo.durationSec} small />}
    </>
  )
}
