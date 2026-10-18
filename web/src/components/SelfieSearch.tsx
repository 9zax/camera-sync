import { useEffect, useRef, useState } from "react"
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react"
import { Camera, Images, Loader2, RotateCcw, ScanFace, Search, ShieldCheck, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CameraSheet } from "@/components/CameraSheet"
import { downloadZip, faceSearch, photoUrl, type FaceSearchResult } from "@/lib/api"
import { cn } from "@/lib/utils"

type Stage = "idle" | "ready" | "searching" | "done"

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}
const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.82, y: 16 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 22 },
  },
}

/** Score percentage that springs up from 0 when mounted. */
function ScoreBadge({ value }: { value: number }) {
  const mv = useMotionValue(0)
  const spring = useSpring(mv, { stiffness: 80, damping: 18 })
  const text = useTransform(spring, (v) => `${Math.min(99, Math.round(v * 100))}%`)
  useEffect(() => {
    mv.set(value)
  }, [value, mv])
  return (
    <motion.span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
      {text}
    </motion.span>
  )
}

export function SelfieSearch({ slug }: { slug: string }) {
  const [stage, setStage] = useState<Stage>("idle")
  const [preview, setPreview] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [result, setResult] = useState<FaceSearchResult | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const chooseImage = (b: Blob) => {
    setBlob(b)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(b)
    })
    setResult(null)
    setStage("ready")
  }

  const onFile = (f?: File | null) => {
    if (!f) return
    if (!f.type.startsWith("image/")) {
      toast.error("กรุณาเลือกไฟล์รูปภาพ")
      return
    }
    chooseImage(f)
  }

  const search = async () => {
    if (!blob) return
    setStage("searching")
    try {
      const r = await faceSearch(slug, blob)
      setResult(r)
      setStage("done")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ค้นหาไม่สำเร็จ")
      setStage("ready")
    }
  }

  const reset = () => {
    setStage("idle")
    setBlob(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setResult(null)
  }

  const downloadAll = async () => {
    if (!result || result.count === 0) return
    setDownloading(true)
    try {
      await downloadZip(
        `/api/g/${encodeURIComponent(slug)}/faces/download`,
        { photo_ids: result.results.map((r) => r.photo_id) },
        "my-photos.zip",
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ดาวน์โหลดไม่สำเร็จ")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div
        className="mb-6 text-center"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <motion.span
          className="mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          animate={{ scale: [1, 1.07, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <ScanFace className="size-6" />
        </motion.span>
        <h2 className="font-display text-2xl font-semibold">หารูปของตัวเอง</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          ถ่ายเซลฟี่หรือเลือกรูปที่มีหน้าคุณ แล้วระบบจะหารูปทั้งหมดในงานที่คุณอยู่ในเฟรม
        </p>
      </motion.div>

      <AnimatePresence mode="wait" initial={false}>
        {(stage === "idle" || stage === "ready") && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                onFile(e.dataTransfer.files?.[0])
              }}
              className={cn(
                "rounded-3xl border-2 border-dashed p-8 text-center transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-border",
                preview && "border-solid pb-0 pt-6",
              )}
            >
              {preview ? (
                <div className="mx-auto max-w-xs">
                  <motion.img
                    src={preview}
                    alt="selfie preview"
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 24 }}
                    className="mb-4 aspect-square w-full rounded-2xl object-cover shadow-md"
                  />
                  <div className="flex flex-wrap items-center justify-center gap-2 pb-6">
                    <Button onClick={search} size="lg" className="rounded-full px-7">
                      <Search className="mr-2 size-4" /> ค้นหาเลย
                    </Button>
                    <Button variant="ghost" onClick={reset} className="rounded-full">
                      <RotateCcw className="mr-2 size-4" /> เลือกรูปใหม่
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="py-8">
                  <motion.div
                    animate={dragOver ? { scale: 1.12, y: -4 } : { scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="flex justify-center"
                  >
                    <Upload className="mb-4 size-10 text-muted-foreground/60" />
                  </motion.div>
                  <p className="text-sm text-muted-foreground">ลากรูปมาวางที่นี่ หรือ</p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                    <Button onClick={() => setCameraOpen(true)} className="rounded-full">
                      <Camera className="mr-2 size-4" /> ถ่ายเซลฟี่
                    </Button>
                    <Button variant="outline" onClick={() => fileRef.current?.click()} className="rounded-full">
                      <Images className="mr-2 size-4" /> เลือกจากคลังรูป
                    </Button>
                  </div>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
            <motion.p
              className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <ShieldCheck className="size-3.5" />
              รูปเซลฟี่ใช้เฉพาะการค้นหาเท่านั้น ไม่ถูกบันทึกลงเซิร์ฟเวอร์
            </motion.p>
          </motion.div>
        )}

        {stage === "searching" && (
          <motion.div
            key="searching"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center justify-center rounded-3xl border border-border py-20"
          >
            <div className="relative mb-4">
              <motion.span
                className="absolute inset-0 rounded-full bg-primary/20"
                animate={{ scale: [1, 1.9], opacity: [0.6, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.span
                className="relative flex size-14 items-center justify-center rounded-full bg-primary/10"
                animate={{ rotate: 360 }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
              >
                <ScanFace className="size-7 text-primary" />
              </motion.span>
            </div>
            <p className="font-medium">กำลังค้นหารูปของคุณ…</p>
            <p className="mt-1 text-sm text-muted-foreground">ใช้เวลาไม่กี่วินาที</p>
          </motion.div>
        )}

        {stage === "done" && result && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold">
                  {result.count > 0 ? (
                    <>
                      เจอรูปของคุณ{" "}
                      <AnimatePresence mode="popLayout" initial={false}>
                        <motion.span
                          key={result.count}
                          initial={{ scale: 1.5 }}
                          animate={{ scale: 1 }}
                          className="inline-block text-primary"
                        >
                          {result.count}
                        </motion.span>
                      </AnimatePresence>{" "}
                      รูป 🎉
                    </>
                  ) : (
                    "ยังไม่พบรูปที่คล้ายกัน"
                  )}
                </h3>
                {result.message && <p className="mt-1 text-sm text-muted-foreground">{result.message}</p>}
              </div>
              <div className="flex gap-2">
                {result.count > 0 && (
                  <Button onClick={downloadAll} disabled={downloading} className="rounded-full">
                    {downloading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    ดาวน์โหลด {result.count} รูป (.zip)
                  </Button>
                )}
                <Button variant="outline" onClick={reset} className="rounded-full">
                  <RotateCcw className="mr-2 size-4" /> ค้นหาใหม่
                </Button>
              </div>
            </div>
            {result.count > 0 && (
              <motion.div
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
                variants={stagger}
                initial="hidden"
                animate="show"
              >
                {result.results.map((r) => (
                  <motion.a
                    key={r.photo_id}
                    href={photoUrl(r.photo_id, "web")}
                    target="_blank"
                    rel="noreferrer"
                    variants={popIn}
                    whileHover={{ scale: 1.035, boxShadow: "0 14px 30px -12px rgb(0 0 0 / 0.4)" }}
                    whileTap={{ scale: 0.97 }}
                    className="group relative overflow-hidden rounded-xl shadow-sm"
                  >
                    <img
                      src={photoUrl(r.photo_id, "thumb")}
                      alt="match"
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                    <ScoreBadge value={r.score} />
                  </motion.a>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cameraOpen && (
          <CameraSheet
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onCapture={(b) => chooseImage(b)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
