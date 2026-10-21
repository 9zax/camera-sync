import { useEffect, useMemo, useState } from "react"
import YarlLightbox from "yet-another-react-lightbox"
import { Zoom } from "yet-another-react-lightbox/plugins"
import "yet-another-react-lightbox/styles.css"
import { Download, Heart, X } from "lucide-react"
import { photoUrl, type PhotoItem } from "@/lib/api"
import { formatBytes, formatThaiDateTime } from "@/lib/format"

export function Lightbox({
  photos,
  index,
  onClose,
  isLiked,
  onToggleLike,
}: {
  photos: PhotoItem[]
  index: number | null
  onClose: () => void
  isLiked: (id: string) => boolean
  onToggleLike?: (id: string) => void
}) {
  const open = index !== null && photos.length > 0
  // The slide to start on. YARL only re-jumps when this prop changes, so it
  // stays put while the user navigates (see controller index !== prevIndex).
  const start = index ?? 0
  const [view, setView] = useState(start)

  useEffect(() => {
    if (open) setView(start)
  }, [open, start])

  const slides = useMemo(
    () =>
      photos.map((p) => ({
        src: photoUrl(p.id, "web"),
        alt: p.filename,
        width: p.width,
        height: p.height,
      })),
    [photos],
  )

  const photo = photos[view]

  if (!open || !photo) return null

  const liked = isLiked(photo.id)

  return (
    <YarlLightbox
      open={open}
      close={onClose}
      index={start}
      slides={slides}
      plugins={[Zoom]}
      toolbar={{ buttons: [] }}
      // preload neighbours so prev/next never shows an empty frame
      carousel={{ preload: 2, finite: false, imageFit: "contain" }}
      animation={{ fade: 2 }}
      controller={{
        closeOnBackdropClick: true,
        closeOnPullDown: true,
        closeOnEscape: true,
      }}
      on={{ view: ({ index: i }) => setView(i) }}
      labels={{ Previous: "ก่อนหน้า", Next: "ถัดไป", Lightbox: "ภาพเต็มจอ" }}
      render={{
        controls: () => (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-3 py-2.5 text-sm text-white/80">
            <div className="min-w-0 flex-1">
              <span className="truncate font-medium text-white">{photo.filename}</span>
              {photo.taken_at && (
                <span className="ml-3 hidden text-white/60 sm:inline">
                  {formatThaiDateTime(photo.taken_at)}
                </span>
              )}
              <span className="ml-3 whitespace-nowrap text-white/50">
                {view + 1} / {photos.length} · {photo.width}×{photo.height} ·{" "}
                {formatBytes(photo.bytes)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {onToggleLike && (
                <button
                  onClick={() => onToggleLike(photo.id)}
                  className="pointer-events-auto flex size-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  title={liked ? "เอาออกจากรายการถูกใจ" : "ถูกใจรูปนี้"}
                >
                  <Heart
                    className={`size-5 ${
                      liked ? "fill-[oklch(84%_0.19_80.46)] text-[oklch(84%_0.19_80.46)]" : ""
                    }`}
                  />
                </button>
              )}
              <a
                href={photoUrl(photo.id, "orig")}
                download={photo.filename}
                className="pointer-events-auto flex size-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                title="ดาวน์โหลดไฟล์ต้นฉบับ"
              >
                <Download className="size-5" />
              </a>
              <button
                onClick={onClose}
                className="pointer-events-auto flex size-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                title="ปิด (Esc)"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        ),
      }}
    />
  )
}
