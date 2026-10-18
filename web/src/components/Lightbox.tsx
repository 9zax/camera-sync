import { useCallback, useEffect, useRef, useState } from "react"
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type Variants,
} from "motion/react"
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react"
import { photoUrl, type PhotoItem } from "@/lib/api"
import { formatBytes, formatThaiDateTime } from "@/lib/format"

const slideVariants: Variants = {
  enter: (dir: number) => ({ x: dir >= 0 ? 90 : -90, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? -90 : 90, opacity: 0 }),
}

export function Lightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: PhotoItem[]
  index: number
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const photo = photos[index]
  const [direction, setDirection] = useState(0)

  // drag-to-dismiss: the image can be flicked down/up to close,
  // with backdrop fading and image scaling while dragging.
  const dragY = useMotionValue(0)
  const backdropOpacity = useTransform(dragY, [-320, 0, 320], [0.25, 1, 0.25])
  const imgScale = useTransform(dragY, [-260, 0, 260], [0.86, 1, 0.86])
  const imgOpacity = useTransform(dragY, [-320, -80, 0, 80, 320], [0, 1, 1, 1, 0])
  const hintOpacity = useTransform(dragY, [40, 140], [0, 1])
  const hintRef = useRef<HTMLDivElement>(null)

  const go = useCallback(
    (dir: 1 | -1) => {
      if (!photo) return
      const next = index + dir
      if (next >= 0 && next < photos.length) {
        setDirection(dir)
        dragY.set(0)
        onNavigate(next)
      }
    },
    [index, photos.length, onNavigate, photo, dragY],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowRight") go(1)
      if (e.key === "ArrowLeft") go(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, onClose])

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  if (!photo) return null

  return (
    <motion.div
      className="fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      <motion.div
        className="absolute inset-0 bg-black/92 backdrop-blur-sm"
        style={{ opacity: backdropOpacity }}
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center justify-between px-4 py-3 text-white/80">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={photo.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="min-w-0 text-sm"
          >
            <span className="font-medium text-white">{photo.filename}</span>
            {photo.taken_at && <span className="ml-3 text-white/60">{formatThaiDateTime(photo.taken_at)}</span>}
            <span className="ml-3 whitespace-nowrap text-white/50">
              {photo.width}×{photo.height} · {formatBytes(photo.bytes)}
            </span>
          </motion.div>
        </AnimatePresence>
        <div className="flex items-center gap-1">
          <motion.a
            href={photoUrl(photo.id, "orig")}
            download={photo.filename}
            className="flex size-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            title="ดาวน์โหลดไฟล์ต้นฉบับ"
            whileHover={{ scale: 1.12 }}
            whileTap={{ scale: 0.9 }}
          >
            <Download className="size-5" />
          </motion.a>
          <motion.button
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            title="ปิด (Esc)"
            whileHover={{ scale: 1.12, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
          >
            <X className="size-5" />
          </motion.button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        {index > 0 && (
          <motion.button
            onClick={() => go(-1)}
            className="absolute left-2 z-10 flex size-11 items-center justify-center rounded-full bg-black/40 text-white/90"
            aria-label="ก่อนหน้า"
            whileHover={{ scale: 1.12, backgroundColor: "rgba(0,0,0,0.7)" }}
            whileTap={{ scale: 0.9 }}
          >
            <ChevronLeft className="size-6" />
          </motion.button>
        )}

        <AnimatePresence custom={direction} mode="popLayout" initial={false}>
          <motion.img
            key={photo.id}
            layoutId={`photo-${photo.id}`}
            src={photoUrl(photo.id, "web")}
            alt={photo.filename}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ x: { type: "spring", stiffness: 300, damping: 32 } }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.65}
            style={{ y: dragY, scale: imgScale, opacity: imgOpacity }}
            onDragEnd={(_, info) => {
              if (Math.abs(info.offset.y) > 110 || Math.abs(info.velocity.y) > 550) {
                onClose()
              }
            }}
            className="max-h-full max-w-full touch-none rounded-lg object-contain shadow-2xl select-none"
          />
        </AnimatePresence>

        {index < photos.length - 1 && (
          <motion.button
            onClick={() => go(1)}
            className="absolute right-2 z-10 flex size-11 items-center justify-center rounded-full bg-black/40 text-white/90"
            aria-label="ถัดไป"
            whileHover={{ scale: 1.12, backgroundColor: "rgba(0,0,0,0.7)" }}
            whileTap={{ scale: 0.9 }}
          >
            <ChevronRight className="size-6" />
          </motion.button>
        )}

        <motion.div
          ref={hintRef}
          style={{ opacity: hintOpacity }}
          className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-4 py-1.5 text-xs text-white backdrop-blur"
        >
          ปล่อยเพื่อปิด
        </motion.div>
      </div>

      <div className="py-3 text-center text-xs text-white/50">
        {index + 1} / {photos.length} · กด ← → เพื่อเลื่อนดู หรือลากรูปลงเพื่อปิด
      </div>
      </div>
    </motion.div>
  )
}
