import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { Loader2, MessageSquareHeart, Quote, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { listWishes, postWish, type WishList } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import type { EventTemplate } from "@/lib/eventTemplates"

const MAX_MESSAGE = 500
const MAX_NAME = 40

function storedName(slug: string): string {
  try {
    return localStorage.getItem(`cs-guest-name:${slug}`) ?? ""
  } catch {
    return ""
  }
}

export function Guestbook({ slug, guestId, tpl }: { slug: string; guestId: string; tpl?: EventTemplate }) {
  const qc = useQueryClient()
  const [name, setName] = useState(() => storedName(slug))
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)

  const wishesQuery = useQuery({
    queryKey: ["wishes", slug],
    queryFn: () => listWishes(slug),
    refetchInterval: 20_000,
  })
  const wishes = wishesQuery.data?.items ?? []

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const guestName = name.trim()
    const text = message.trim()
    if (!guestName || !text || sending) return
    setSending(true)
    try {
      const res = await postWish(slug, guestId, guestName, text)
      try {
        localStorage.setItem(`cs-guest-name:${slug}`, guestName)
      } catch {
        /* private mode */
      }
      qc.setQueryData<WishList>(["wishes", slug], (old) => ({
        items: [res.item, ...(old?.items ?? [])],
        total: (old?.total ?? 0) + 1,
      }))
      setMessage("")
      toast.success("ส่งคำอวยพรแล้ว — ขอบคุณนะ")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งคำอวยพรไม่สำเร็จ")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Card className="overflow-hidden border-[var(--rule)] bg-card/70">
          <CardContent className="pt-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
                  <MessageSquareHeart className="size-5 text-primary" />
                  {tpl?.wishTab ?? "สมุดอวยพร"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tpl ? `${tpl.wishPrompt} — ข้อความจะขึ้นบนจอในงานและเก็บไว้กับอัลบั้มนี้` : "ข้อความจะขึ้นบนจอในงานและเก็บไว้กับอัลบั้มนี้"}
                </p>
              </div>
              {wishesQuery.data && (
                <span className="shrink-0 rounded-full border border-border/70 bg-secondary/60 px-3 py-1 font-mono text-xs tabular-nums text-muted-foreground">
                  {wishesQuery.data.total.toLocaleString("th-TH")} ข้อความ
                </span>
              )}
            </div>

            <form onSubmit={send} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
                <div className="space-y-2">
                  <Label htmlFor="wish-name">ชื่อของคุณ</Label>
                  <Input
                    id="wish-name"
                    value={name}
                    maxLength={MAX_NAME}
                    placeholder="เช่น คุณยายสมศรี"
                    onChange={(e) => setName(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wish-message">คำอวยพร</Label>
                  <textarea
                    id="wish-message"
                    value={message}
                    maxLength={MAX_MESSAGE}
                    rows={3}
                    placeholder="ขอให้รักกันตลอดไป…"
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2.5 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {message.length}/{MAX_MESSAGE}
                </span>
                <Button
                  type="submit"
                  disabled={sending || !name.trim() || !message.trim()}
                  className="rounded-full px-5"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  ส่งคำอวยพร
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <div className="mt-8">
        {wishesQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : wishes.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center rounded-3xl border border-dashed border-border py-14 text-center"
          >
            <Quote className="mb-3 size-7 text-primary/70" />
            <h3 className="font-display text-lg font-semibold">ยังไม่มีคำอวยพร</h3>
            <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
              {tpl ? `เป็นคนแรกที่ ${tpl.wishPrompt}` : "เป็นคนแรกที่เขียนข้อความแรกให้วันนี้"}
            </p>
          </motion.div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {wishes.map((w, i) => (
                <motion.figure
                  key={w.id}
                  layout
                  initial={{ opacity: 0, y: 18, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{
                    type: "spring",
                    stiffness: 260,
                    damping: 26,
                    delay: Math.min(i * 0.035, 0.35),
                  }}
                  className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-5"
                >
                  <Quote className="absolute -right-2 -top-2 size-16 text-primary/[0.07]" aria-hidden />
                  <blockquote className="relative whitespace-pre-wrap font-display text-[17px] leading-relaxed text-foreground">
                    {w.message}
                  </blockquote>
                  <figcaption className="relative mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-gold" />
                    <span className="font-medium text-foreground/80">{w.guest_name}</span>
                    <span aria-hidden>·</span>
                    <span>{timeAgo(w.created_at)}</span>
                  </figcaption>
                </motion.figure>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
