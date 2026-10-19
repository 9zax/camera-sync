import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { motion } from "motion/react"
import { Camera, CheckCircle2, CloudUpload, Images, Loader2, XCircle } from "lucide-react"
import { Logo } from "@/components/Logo"
import { api, ApiError } from "@/lib/api"

interface TokenInfo {
  slug: string
  title: string
}

/** Upload photos straight into one album with just the event's upload token
 * (from the photographer's desktop app QR). No login — the token is the key. */
export default function MobileUpload() {
  const { token = "" } = useParams<{ token: string }>()
  const infoQuery = useQuery({
    queryKey: ["upload-token", token],
    queryFn: () => api.get<TokenInfo>(`/api/u/${encodeURIComponent(token)}/info`),
    retry: false,
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<{ name: string; state: "wait" | "up" | "ok" | "dup" | "err" }[]>([])
  const [busy, setBusy] = useState(false)

  const send = async (files: FileList | null) => {
    if (!files?.length || busy) return
    setBusy(true)
    setItems([...files].map((f) => ({ name: f.name, state: "wait" as const })))
    // one request per file so a single failure doesn't kill the batch
    for (let i = 0; i < files.length; i++) {
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, state: "up" } : it)))
      const fd = new FormData()
      fd.append("file", files[i], files[i].name)
      try {
        const res = await fetch(`/api/u/${encodeURIComponent(token)}/photos`, {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "ส่งไม่สำเร็จ")
        const data = (await res.json()) as { uploaded: number; duplicated: number }
        setItems((prev) =>
          prev.map((it, j) => (j === i ? { ...it, state: data.uploaded ? "ok" : "dup" } : it)),
        )
      } catch {
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, state: "err" } : it)))
      }
    }
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  if (infoQuery.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    )
  }
  if (infoQuery.isError || !infoQuery.data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
          <XCircle className="size-7 text-destructive" />
        </span>
        <h1 className="font-display text-2xl font-semibold">ลิงก์นี้ใช้ไม่ได้</h1>
        <p className="text-sm text-muted-foreground">
          {infoQuery.error instanceof ApiError ? infoQuery.error.message : "ลองสแกน QR ใหม่อีกครั้งนะ"}
        </p>
      </div>
    )
  }

  const info = infoQuery.data
  const done = items.length > 0 && !busy

  return (
    <div className="min-h-dvh pb-16">
      <header className="border-b border-[var(--rule)] bg-background/75 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Link to="/">
            <Logo size={30} />
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">ส่งรูปเข้าอัลบั้ม</span>
        </div>
      </header>

      <main className="mx-auto max-w-md px-5 pt-10">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-gold">CameraSync</p>
          <h1 className="mt-3 text-center font-display text-3xl font-light tracking-tight">
            ส่งรูปเข้า <span className="text-gold">{info.title}</span>
          </h1>
          <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
            เลือกรูปจากมือถือเพื่อส่งขึ้นอัลบั้มของงานนี้ — รูปจะปรากฏในแกลเลอรีให้ทุกคนดูได้ทันที
          </p>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void send(e.target.files)}
          />

          {!items.length && (
            <motion.button
              onClick={() => inputRef.current?.click()}
              whileTap={{ scale: 0.97 }}
              className="mt-10 flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--rule-strong)] bg-secondary/40 px-6 py-14 text-center transition-colors hover:border-gold"
            >
              <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/15">
                <CloudUpload className="size-8 text-primary" />
              </span>
              <span className="font-medium">เลือกรูป / ถ่ายรูป</span>
              <span className="text-xs text-muted-foreground">เลือกได้หลายรูปพร้อมกัน</span>
            </motion.button>
          )}

          {items.length > 0 && (
            <div className="mt-8 space-y-2">
              {items.map((it) => (
                <div
                  key={it.name}
                  className="flex items-center gap-3 rounded-lg border border-[var(--rule)] bg-card px-4 py-3 text-sm"
                >
                  {it.state === "wait" && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
                  {it.state === "up" && <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
                  {it.state === "ok" && <CheckCircle2 className="size-4 shrink-0 text-patina" />}
                  {it.state === "dup" && <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />}
                  {it.state === "err" && <XCircle className="size-4 shrink-0 text-destructive" />}
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {it.state === "wait" && "รอส่ง"}
                    {it.state === "up" && "กำลังส่ง…"}
                    {it.state === "ok" && "ส่งแล้ว ✓"}
                    {it.state === "dup" && "มีในอัลบั้มแล้ว"}
                    {it.state === "err" && "ไม่สำเร็จ"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {done && (
            <div className="mt-8 space-y-3">
              <motion.button
                onClick={() => inputRef.current?.click()}
                whileTap={{ scale: 0.97 }}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--rule-strong)] bg-secondary/60 px-5 py-3 text-sm font-medium"
              >
                <Camera className="size-4" /> ส่งรูปเพิ่ม
              </motion.button>
              <a
                href={`/e/${encodeURIComponent(info.slug)}`}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                <Images className="size-4" /> ดูแกลเลอรีของงาน
              </a>
            </div>
          )}

          <p className="mt-10 text-center text-[11px] leading-relaxed text-muted-foreground">
            รูปจะถูกส่งตรงเข้าเครื่องช่างภาพผ่าน WiFi ของงาน — ไม่มีรูปถูกเก็บบนเซิร์ฟเวอร์ภายนอก
          </p>
        </motion.div>
      </main>
    </div>
  )
}
