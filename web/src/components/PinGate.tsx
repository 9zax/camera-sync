import { useState } from "react"
import { Link } from "react-router-dom"
import { motion, useAnimate } from "motion/react"
import { Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"

export function PinGate({
  slug,
  title,
  onUnlocked,
}: {
  slug: string
  title: string
  onUnlocked: () => void
}) {
  const [pin, setPin] = useState("")
  const [loading, setLoading] = useState(false)
  const [scope, animate] = useAnimate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin.trim()) return
    setLoading(true)
    try {
      await api.post(`/api/g/${encodeURIComponent(slug)}/unlock`, { pin })
      toast.success("ปลดล็อกสำเร็จ")
      onUnlocked()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PIN ไม่ถูกต้อง")
      void animate(
        scope.current,
        { x: [0, -14, 14, -9, 9, -4, 0] },
        { duration: 0.5, ease: "easeInOut" },
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <motion.div
        ref={scope}
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        className="w-full max-w-sm"
      >
        <Card>
          <CardContent className="pt-8 text-center">
            <motion.span
              className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10"
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Lock className="size-6 text-primary" />
            </motion.span>
            <h1 className="font-display text-xl font-semibold">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              งานนี้ตั้งรหัส PIN กันคนนอก — ใส่รหัสที่ได้จากคู่สมรสหรือโต๊ะลงทะเบียน
            </p>
            <form onSubmit={submit} className="mt-6 space-y-3">
              <Input
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder="PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="h-12 text-center text-lg tracking-[0.4em]"
              />
              <Button type="submit" disabled={loading} className="h-11 w-full rounded-full">
                {loading ? <Loader2 className="size-4 animate-spin" /> : "เข้าชมแกลเลอรี"}
              </Button>
            </form>
            <Separator className="my-6" />
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              ← CameraSync
            </Link>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
