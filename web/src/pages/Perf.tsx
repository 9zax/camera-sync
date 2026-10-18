import { motion, type Variants } from "motion/react"
import { Gauge, ShieldCheck, Zap } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/Logo"

const reveal: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
}
const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09 } } }

// ---- ผล load test จริงที่วัดไว้ (18 ต.ค. 2026, Apple Silicon, ผ่าน https จริง) ----
const OURS = [
  { label: "เครื่องช่างภาพโดยตรง", value: "3,360", unit: "คำขอ/วินาที", note: "จุดสูงสุดที่ 32 การเชื่อมต่อพร้อมกัน · error 0%" },
  { label: "ผ่าน hub ของจริง (อินเทอร์เน็ตบ้าน)", value: "735", unit: "คำขอ/วินาที", note: "ที่ 64 การเชื่อมต่อพร้อมกัน · p95 = 125ms · error 0%" },
  { label: "เวลาตอบสนอง กลาง ๆ (p50)", value: "72", unit: "มิลลิวินาที", note: "วัดผ่าน HTTPS จริงจากอินเทอร์เน็ต" },
  { label: "อัตราส่งภาพ", value: "2.7", unit: "MB/วินาที", note: "ข้อจำกัดคือความเร็วอัปโหลดของเน็ตบ้าน (~21Mbps) ไม่ใช่ซอฟต์แวร์" },
]

// ---- เทียบกับระบบแบบอัปโหลดเก็บบนคลาวด์ทั่วไป (ค่าประมาณจากการใช้งานจริง) ----
const COMPARE = [
  { aspect: "รูปใหม่ถึงมือลูกค้า", us: "~30 วินาทีหลังกดชัตเตอร์", them: "หลักชั่วโมง–วันถัดไป (ต้องอัปโหลด-เข้าคิวประมวลผลบนคลาวด์)" },
  { aspect: "ค่าใช้จ่ายเมื่องานเยอะ", us: "เท่าเดิมทุกงาน รูปอยู่เครื่องเราเอง", them: "มักคิดตามพื้นที่คลาวด์ / จำนวนรูป / ต่องาน" },
  { aspect: "ความเป็นส่วนตัวของรูป", us: "รูปไม่เคยออกจากเครื่องช่างภาพ (hub เป็นทางผ่านเท่านั้น)", them: "รูปทุกไฟล์เก็บบนเซิร์ฟเวอร์บุคคลที่สาม" },
  { aspect: "ไฟล์ที่ลูกค้าโหลด", us: "ไฟล์เต็มคุณภาพ ไม่มีลายน้ำ ไม่จำกัดจำนวน", them: "บางระบบบีบอัด ใส่ลายน้ำ หรือจำกัดดาวน์โหลด" },
  { aspect: "ล่มเมื่อไหร่เห็นเมื่อนั้น", us: "แอดมินระบบเห็นสถานะช่างภาพทุกคนแบบเรียลไทม์", them: "ไม่มีมุมมองสถานะแบบเรียลไทม์ให้ผู้ดูแล" },
]

const METHOD = [
  "ยิงคำขอผสมเหมือนลูกค้าใช้จริง: ข้อมูลงาน + ลิสต์รูป 50 ภาพ + ภาพย่อ",
  "ไล่ระดับความพร้อมกัน 1 → 256 ทีละ 8 วินาที วัดค่ากลาง/p95/p99",
  "รอบผ่าน hub ยิงจากอินเทอร์เน็ตจริงไปที่ sync.khunaistory.com ผ่าน HTTPS + tunnel",
  "เครื่องทดสอบ: Apple Silicon (โปรไฟล์เดียวกับแอปที่แจกจริง) · โมเดล AI โหลดค้างไว้ตลอด",
]

export default function Perf() {
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
            <span className="h-px w-8 bg-gold/60" /> Benchmark · 18 ต.ค. 2026 <span className="h-px w-8 bg-gold/60" />
          </motion.span>
          <motion.h1 variants={reveal} className="mt-6 font-display text-4xl font-light tracking-tight sm:text-5xl">
            ตัวเลขจริงจากระบบเรา <span className="text-gold">วัดเอง โปร่งใส</span>
          </motion.h1>
          <motion.p variants={reveal} className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            เรา load test ระบบของตัวเองด้วยสถานการณ์เหมือนงานแต่งจริง แล้วเก็บผลไว้ที่หน้านี้ —
            เทียบกับระบบแบบเดิมที่ต้องอัปโหลดรูปขึ้นคลาวด์อย่างชัดเจน ไม่มีตัวเลขสวยหลอกตา
          </motion.p>

          {/* our measured numbers */}
          <motion.div variants={reveal} className="mt-12 grid gap-4 sm:grid-cols-2">
            {OURS.map((m) => (
              <div key={m.label} className="rounded-md border border-[var(--rule)] bg-card p-6">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">{m.label}</p>
                <p className="mt-3 font-display text-4xl font-light text-gold">
                  {m.value} <span className="text-base text-muted-foreground">{m.unit}</span>
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{m.note}</p>
              </div>
            ))}
          </motion.div>

          {/* comparison table */}
          <motion.h2 variants={reveal} className="mt-16 font-display text-2xl font-light sm:text-3xl">
            เทียบกันตรง ๆ <span className="text-gold">กับระบบอัปโหลดคลาวด์แบบเดิม</span>
          </motion.h2>
          <motion.div variants={reveal} className="mt-6 overflow-x-auto rounded-md border border-[var(--rule)]">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-[var(--rule)] bg-card">
                  <th className="p-4 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">มุมเทียบ</th>
                  <th className="p-4 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-gold">CameraSync</th>
                  <th className="p-4 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">ระบบอัปโหลดคลาวด์ทั่วไป</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((row, i) => (
                  <tr key={row.aspect} className={i % 2 ? "bg-card/50" : ""}>
                    <td className="p-4 align-top font-medium text-foreground">{row.aspect}</td>
                    <td className="p-4 align-top text-foreground">
                      <span className="mr-1.5 inline-block size-1.5 rounded-full bg-patina align-middle" />
                      {row.us}
                    </td>
                    <td className="p-4 align-top text-muted-foreground">{row.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
          <motion.p variants={reveal} className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            หมายเหตุ: คอลัมน์ขวาเป็นลักษณะทั่วไปของระบบอัปโหลด-คลาวด์สายพันธุ์เดียวกันในตลาด
            ไม่ได้ชี้ตัวผู้ให้บริการใด — ตัวเลขฝั่งเราวัดจากระบบจริงที่ใช้อยู่
          </motion.p>

          {/* method */}
          <motion.h2 variants={reveal} className="mt-16 font-display text-2xl font-light sm:text-3xl">
            วิธีวัด <span className="text-gold">(ทำซ้ำได้)</span>
          </motion.h2>
          <motion.ul variants={reveal} className="mt-5 space-y-3">
            {METHOD.map((m) => (
              <li key={m} className="flex gap-3 text-[13.5px] leading-relaxed text-muted-foreground">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" />
                {m}
              </li>
            ))}
          </motion.ul>

          <motion.div variants={reveal} className="mt-14 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-md px-8 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_48px_oklch(2%_0.004_95/0.4)]">
              <a href="https://sync.khunaistory.com/download/CameraSync.dmg">
                <Zap className="mr-2 size-4" /> ลองกับงานจริงของคุณ
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-md border-[var(--rule-strong)]">
              <Link to="/">
                <Gauge className="mr-2 size-4" /> กลับหน้าแรก
              </Link>
            </Button>
          </motion.div>

          <motion.p variants={reveal} className="mt-10 flex items-center gap-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="size-4 text-patina" />
            ตัวเลขทุกตัววัดจากระบบ production เดียวกับที่ให้บริการอยู่ — ไม่มีเครื่องจัดพิเศษ
          </motion.p>
        </motion.div>
      </main>
    </div>
  )
}
