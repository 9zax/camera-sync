import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useAnimate } from "motion/react"
import { Camera, RefreshCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Front-camera capture sheet with a shutter flash; falls back when denied. */
export function CameraSheet({
  open,
  onClose,
  onCapture,
}: {
  open: boolean
  onClose: () => void
  onCapture: (blob: Blob) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [facing, setFacing] = useState<"user" | "environment">("user")
  const [flashScope, animate] = useAnimate()

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let cancelled = false
    setError(null)
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play()
        }
      })
      .catch(() => {
        setError("เปิดกล้องไม่ได้ — อนุญาตการเข้าถึงกล้องในเบราว์เซอร์ หรือใช้ปุ่มอัปโหลดรูปแทน")
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open, facing])

  if (!open) return null

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const size = Math.min(video.videoWidth, video.videoHeight)
    const canvas = document.createElement("canvas")
    canvas.width = 720
    canvas.height = 720
    const ctx = canvas.getContext("2d")!
    if (facing === "user") {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1) // mirror selfie like the preview
    }
    ctx.drawImage(
      video,
      (video.videoWidth - size) / 2,
      (video.videoHeight - size) / 2,
      size,
      size,
      0,
      0,
      720,
      720,
    )
    // shutter flash
    void animate(flashScope.current, { opacity: [0, 0.95, 0] }, { duration: 0.35 })
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(blob)
          onClose()
        }
      },
      "image/jpeg",
      0.92,
    )
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      <motion.div
        className="flex items-center justify-between px-4 py-3 text-white"
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        <span className="text-sm font-medium">ถ่ายเซลฟี่เพื่อค้นหา</span>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            title="สลับกล้อง"
          >
            <motion.span whileTap={{ rotate: -180 }} transition={{ duration: 0.35 }}>
              <RefreshCcw className="size-5" />
            </motion.span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white/80 hover:bg-white/10 hover:text-white"
            onClick={onClose}
            title="ปิด"
          >
            <X className="size-5" />
          </Button>
        </div>
      </motion.div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {error ? (
          <p className="max-w-xs px-6 text-center text-sm text-white/70">{error}</p>
        ) : (
          <motion.video
            ref={videoRef}
            playsInline
            muted
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            className="max-h-full max-w-full rounded-xl"
            style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
          />
        )}
        {/* shutter flash overlay */}
        <div ref={flashScope} className="pointer-events-none absolute inset-0 bg-white opacity-0" />
      </div>

      {!error && (
        <motion.div
          className="flex items-center justify-center py-8"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.12, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="relative">
            <motion.span
              className="absolute inset-0 rounded-full bg-white/30"
              animate={{ scale: [1, 1.55], opacity: [0.7, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.6, ease: "easeOut" }}
            />
            <motion.button
              onClick={capture}
              className="relative flex items-center justify-center rounded-full bg-white text-primary shadow-xl"
              style={{ width: 72, height: 72 }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.85 }}
              aria-label="ถ่ายรูป"
            >
              <Camera className="size-7" />
            </motion.button>
          </span>
        </motion.div>
      )}
    </motion.div>
  )
}
