import { motion, type Variants } from "motion/react"
import { CheckCircle2, Gauge } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/Logo"

const reveal: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
}
const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09 } } }

// ---- ผลทดสอบระบบจริง (19 ต.ค. 2026 — รันบน production เดียวกับที่ให้บริการ) ----
const TESTS = [
  {
    area: "กล้องส่งรูปผ่าน FTP",
    method: "container จำลองกล้อง (Alpine + lftp — FTP client ตัวจริง: login → PASV → STOR) ยิง 9 ช็อตเข้าแอพผ่าน :2121",
    results: ["ส่งสำเร็จ 9/9 ไฟล์", "ประมวลผลพร้อม + index ใบหน้า 9/9", "แสดงบนแกลเลอรีผ่าน production จริง (12 รูปรวม)", "ไฟล์ซ้ำถูกกันอัตโนมัติ (dedup ด้วย hash)"],
  },
  {
    area: "อัปโหลดจากมือถือ (/upload/{token})",
    method: "เบราว์เซอร์จริงเปิดหน้าอัปโหลดจาก QR แล้วส่งรูปเข้าอัลบั้ม",
    results: ["ส่งสำเร็จ ขึ้นสถานะ 'ส่งแล้ว ✓'", "รูปขึ้นแกลเลอรีทันที", "ไฟล์ซ้ำแจ้ง 'มีในอัลบั้มแล้ว' ไม่ซ้ำซ้อน"],
  },
  {
    area: "ถูกใจ (like) และการย้อนดู",
    method: "กดหัวใจบนกริด + ใน lightbox แล้ว reload หน้า ตรวจไฟล์ JSON บนเครื่องช่างภาพ",
    results: ["บันทึกเป็น likes/{slug}/likes.json แยกทีละงาน", "โหลดรายการถูกใจกลับมาหลัง reload ถูกต้อง", "ใช้งานได้ผ่าน tunnel ของ hub จริง"],
  },
  {
    area: "ค้นหารูปด้วยเซลฟี่ — เปรียบเทียบโมเดล 2 รุ่น",
    method: "A/B บนรูปงานจริง 40 รูป (เครื่องช่างภาพ) ใช้รูปเดียวกันเป็นเซลฟี่ค้นหา",
    results: [
      "ตัวจำใบหน้าเดิม (w600k_r50): คนเดียวกันได้ 0.77–0.80",
      "รุ่นใหม่ (glintr100): คนเดียวกันสูงขึ้นเป็น 0.82–0.84",
      "รูปคนละคนถูกดันต่ำลง 0.66 → 0.54 (แยกชัดกว่า)",
      "ความเร็วช้าลง ~15% — ยอมแลกเพื่อความแม่น (เครื่องใช้ glintr100 แล้ว)",
    ],
  },
  {
    area: "การ์ดแชร์ลิงก์ (LINE / แอปอื่น)",
    method: "จำลองบอทของแอปแชร์ (user-agent facebookexternalhit, Accept: */*) ดึงหน้างานจาก production",
    results: ["ได้ชื่ออัลบั้ม + ภาพปกครบ (og:title / og:image)", "cover.jpg ตอบ 200 image/jpeg", "เปลี่ยนปกแล้วการ์ดเปลี่ยนตามทันที (ไม่ติดแคช)"],
  },
  {
    area: "ความเป็นส่วนตัว — hub ไม่มีรูปผ่านมือ",
    method: "ตรวจตลอดการทดสอบทุกเส้นทาง: แขกดูรูปผ่าน tunnel ตรงเข้าเครื่องช่างภาพ",
    results: ["ไม่มีไฟล์ภาพถูกบันทึกบน hub แม้แต่ไฟล์เดียว", "like / ข้อมูลทั้งหมดอยู่บนเครื่องช่างภาพ"],
  },
]

export default function Tests() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-5xl items-center justify-between px-5">
          <Link to="/">
            <Logo size={34} />
          </Link>
          <Button asChild size="sm" variant="outline" className="rounded-md border-[var(--rule-strong)]">
            <Link to="/">กลับหน้าแรก</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-16">
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.span variants={reveal} className="inline-flex items-center gap-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-gold">
            <span className="h-px w-8 bg-gold/60" /> Test Report · 19 ต.ค. 2026 <span className="h-px w-8 bg-gold/60" />
          </motion.span>
          <motion.h1 variants={reveal} className="mt-6 font-display text-4xl font-light tracking-tight sm:text-5xl">
            ผลทดสอบระบบ <span className="text-gold">รันจริง โปร่งใส</span>
          </motion.h1>
          <motion.p variants={reveal} className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            ทุกเคสทดสอบรันบนระบบ production เดียวกับที่ให้บริการอยู่ ไม่มีเครื่องจัดพิเศษ —
            กล้องจำลองเป็น container ที่ใช้ FTP client ตัวจริง เบราว์เซอร์จริง และบอทแชร์ลิงก์จริง
          </motion.p>

          <motion.div variants={reveal} className="mt-12 space-y-4">
            {TESTS.map((t, i) => (
              <div key={t.area} className="rounded-md border border-[var(--rule)] bg-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-lg font-medium">
                    <span className="mr-3 font-mono text-xs text-gold">{String(i + 1).padStart(2, "0")}</span>
                    {t.area}
                  </h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rule-strong)] bg-primary/10 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-patina">
                    <CheckCircle2 className="size-3.5" /> ผ่านทั้งหมด
                  </span>
                </div>
                <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">วิธีทดสอบ: {t.method}</p>
                <ul className="mt-4 space-y-2 border-t border-[var(--rule)] pt-4">
                  {t.results.map((r) => (
                    <li key={r} className="flex gap-2.5 text-[13.5px] leading-relaxed text-foreground/90">
                      <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-patina" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </motion.div>

          <motion.p variants={reveal} className="mt-8 text-[12.5px] leading-relaxed text-muted-foreground">
            ผล load test ความสามารถรับโหลด (3,360 req/s ที่เครื่อง · 735 req/s ผ่านอินเทอร์เน็ตจริง · p95 125ms) อยู่ที่หน้า{" "}
            <Link to="/perf" className="font-medium text-gold underline-offset-4 hover:underline">
              ผลการวัดประสิทธิภาพ
            </Link>{" "}
            — ตัวเลขตัวเดียวกันที่เราใช้ตัดสินใจออกแบบระบบจริง
          </motion.p>

          <motion.div variants={reveal} className="mt-12 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="outline" className="rounded-md border-[var(--rule-strong)]">
              <Link to="/perf">
                <Gauge className="mr-2 size-4" /> ดูผลการวัดประสิทธิภาพ
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </main>
    </div>
  )
}
