import { motion, type Variants } from "motion/react"
import { Gauge, ShieldCheck, Users, Zap } from "lucide-react"
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
  {
    label: "เครื่องช่างภาพโดยตรง",
    value: "3,360",
    unit: "คำขอ/วินาที",
    note: "จุดสูงสุดที่ 32 การเชื่อมต่อพร้อมกัน · error 0%",
    plain:
      "ตัวเลขนี้คือความสามารถสูงสุดของเครื่องช่างภาพในการตอบคำขอ — ทุกครั้งที่แขกเปิดหน้าเว็บ ดึงรายการรูป หรือโหลดรูปภาพ 1 ภาพ นับเป็น 1 “คำขอ” — เครื่องเดียวจัดการได้ถึงวินาทีละ 3,360 คำขอ",
    life: "เทียบให้เห็นภาพ: แขก 150–200 คนเปิดมือถือเลื่อนดูรูปพร้อมกันในจังหวะเดียวกัน ระบบยังถือว่า “ว่าง” — ความเร็วเริ่มลดลงเมื่อกดพร้อมกันเกินระดับหลายร้อยคน ซึ่งในงานแต่งจริงแทบไม่เกิด",
  },
  {
    label: "ผ่าน hub ของจริง (อินเทอร์เน็ตบ้าน)",
    value: "735",
    unit: "คำขอ/วินาที",
    note: "ที่ 64 การเชื่อมต่อพร้อมกัน · p95 = 125ms · error 0%",
    plain:
      "รอบนี้ยิงจากอินเทอร์เน็ตจริงเข้ามาทาง sync.khunaistory.com เหมือนแขกคนหนึ่ง — รูปวิ่งจากเน็ตบ้านของช่างภาพออกสู่โลกจริง ตัวเลขต่ำกว่ารอบแรกเพราะคอขวดคือ “ความเร็วอัปโหลดของสายเน็ตบ้าน” (~21Mbps) ไม่ใช่ตัวซอฟต์แวร์",
    life: "แปลง่าย ๆ: ท่อน้ำ (เน็ตบ้าน) เล็กกว่าถังน้ำ (เครื่องช่างภาพ) — ถ้าวันหนึ่งอัปเกรดเน็ต ตัวเลขนี้ขยับขึ้นเองโดยไม่ต้องแก้อะไรเลย",
  },
  {
    label: "เวลาตอบสนอง กลาง ๆ (p50)",
    value: "72",
    unit: "มิลลิวินาที",
    note: "วัดผ่าน HTTPS จริงจากอินเทอร์เน็ต",
    plain:
      "p50 คือ “คนกลาง” — ครึ่งหนึ่งของทุกคำขอได้คำตอบเร็วกว่านี้ อีกครึ่งช้ากว่านี้เล็กน้อย 72 มิลลิวินาที คือประมาณ 1 ใน 3 ของการกระพริบตาหนึ่งครั้ง",
    life: "สัมผัสของแขก: ลัดเด้งปุ๊บ เนื้อหาขึ้นเกือบทันที ไม่มีอาการ “กดแล้วหน้าค้างรอโหลด”",
  },
  {
    label: "อัตราส่งภาพ",
    value: "2.7",
    unit: "MB/วินาที",
    note: "ข้อจำกัดคือความเร็วอัปโหลดของเน็ตบ้าน (~21Mbps) ไม่ใช่ซอฟต์แวร์",
    plain:
      "ปริมาณ “ข้อมูลภาพ” ที่ไหลออกสู่แขกได้ต่อวินาทีผ่านอินเทอร์เน็ตจริง — รูปย่อขนาด ~30–60KB ให้คำนวณคร่าว ๆ ได้ว่าหนึ่งวินาทีส่งรูปย่อได้ราว 40–80 ภาพพร้อมกัน",
    life: "ในงานจริง: แขกหลายสิบคนเปิดแกลเลอรีพร้อมกัน รูปปรากฏเรียงกันเป็นแถวได้ลื่น ๆ ไม่ต้องรอทีละรูป",
  },
]

// ---- ศัพท์ที่เจอบนหน้านี้ อธิบายแบบไม่ต้องเป็นเทคนิค ----
const GLOSSARY = [
  {
    term: "คำขอ/วินาที (requests per second)",
    body:
      "ทุกครั้งที่มีคนเปิดหน้าเว็บ ดึงรายการรูป หรือโหลดรูป 1 ภาพ = ส่ง “คำขอ” มาที่เครื่องช่างภาพ 1 ครั้ง ตัวเลขยิ่งสูง = เลี้ยงคนพร้อมกันได้ยิ่งมาก",
  },
  {
    term: "การเชื่อมต่อพร้อมกัน (concurrent)",
    body:
      "จำนวนคนที่ “กำลังใช้อยู่ในจังหวะเดียวกัน” (กด เลื่อน โหลดรูป) — “จุดสูงสุดที่ 32” แปลว่าความเร็วถึงจุดสูงสุดตอนมี 32 คนใช้พร้อมกัน และที่ 64 คน (ผ่านเน็ตจริง) ระบบก็ยังไม่มีสะดุด ส่วน “แขกทั้งงาน” ไม่ได้กดพร้อมกันตลอดเวลา คนส่วนใหญ่อ่านรูปเงียบ ๆ",
  },
  {
    term: "error 0%",
    body:
      "จากคำขอหลายหมื่นครั้งตลอดการทดสอบ ไม่มีแม้แต่คำขอเดียวที่ล้มเหลว — แปลว่าไม่มีใครเจอหน้าค้าง รูปโหลดไม่ขึ้น หรือลิงก์ใช้ไม่ได้แม้แต่ครั้งเดียว",
  },
  {
    term: "p50 / p95",
    body:
      "เรียงเวลาตอบของทุกคำขอจากเร็วไปช้า p50 คือคนตรงกลาง p95 คือ “คนที่ช้ากว่า 95% ของทุกคน” — ถ้าแม้แต่ p95 ยังเร็ว แปลว่าเกือบทุกคนได้ประสบการณ์ดี ไม่ใช่แค่ค่าเฉลี่ยที่สวยแต่มีคนโชคร้ายรอนาน",
  },
  {
    term: "MB/วินาที (อัตราส่งข้อมูล)",
    body:
      "ปริมาณภาพที่ส่งออกได้ต่อวินาที เหมือนขนาดท่อน้ำ — ท่อของเราคือสายเน็ตบ้านของช่างภาพ ถ้าเน็ตเร็วขึ้นท่อก็กว้างขึ้นทันที",
  },
]

// ---- ตัวเลขทั้งหมด แปลเป็นภาษางานแต่ง ----
const WEDDING = [
  "แขก 150–200 คนเปิดแกลเลอรีพร้อมกันตอนเลี้ยงโต๊ะจีนเสิร์ตอาหาร ระบบยังไม่ทำงานหนัก",
  "กดลิงก์จาก QR แล้วเห็นรูปเกือบทันที (ครึ่งหนึ่งของการกระพริบตา) แม้เน็ตในงานคนเยอะ",
  "คนที่เน็ตช้าที่สุดในห้อง ก็ได้รูปภายใน ~0.1 วินาที (นั่นคือค่า p95 ผ่านอินเทอร์เน็ตจริง)",
  "รูปใหม่จากกล้องถึงมือแขก ~30 วินาทีหลังกดชัตเตอร์ — เพราะไม่ต้องอัปโหลดขึ้นคลาวด์แล้วรอคิว",
  "ไม่ว่างานจะ 500 หรือ 5,000 รูป ค่าใช้จ่ายเท่าเดิม เพราะรูปอยู่ในเครื่องช่างภาพ ไม่เช่าพื้นที่คลาวด์เพิ่ม",
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
            ทุกการ์ดมีคำแปลภาษาคนทั่วไปกำกับไว้ให้อ่านจบเข้าใจได้เลย
          </motion.p>

          {/* our measured numbers */}
          <motion.div variants={reveal} className="mt-12 grid gap-4 sm:grid-cols-2">
            {OURS.map((m) => (
              <div key={m.label} className="rounded-md border border-[var(--rule)] bg-card p-6">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">{m.label}</p>
                <p className="mt-3 font-display text-4xl font-light text-gold">
                  {m.value} <span className="text-base text-muted-foreground">{m.unit}</span>
                </p>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">{m.note}</p>
                <div className="mt-4 space-y-2.5 border-t border-[var(--rule)] pt-4 text-[13px] leading-relaxed">
                  <p className="text-foreground/90">{m.plain}</p>
                  <p className="text-muted-foreground">{m.life}</p>
                </div>
              </div>
            ))}
          </motion.div>

          {/* plain-language glossary */}
          <motion.h2 variants={reveal} className="mt-16 font-display text-2xl font-light sm:text-3xl">
            ศัพท์บนหน้านี้ <span className="text-gold">แปลเป็นคนทั่วไปแล้วหมายถึงอะไร</span>
          </motion.h2>
          <motion.p variants={reveal} className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            ไม่ต้องเป็นคนเทคนิคก็อ่านทำความเข้าใจตัวเลขข้างบนได้ทั้งหมด
          </motion.p>
          <motion.div variants={reveal} className="mt-6 grid gap-4 sm:grid-cols-2">
            {GLOSSARY.map((g) => (
              <div key={g.term} className="rounded-md border border-[var(--rule)] bg-card/50 p-5">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-gold">{g.term}</p>
                <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{g.body}</p>
              </div>
            ))}
          </motion.div>

          {/* wedding translation */}
          <motion.h2 variants={reveal} className="mt-16 font-display text-2xl font-light sm:text-3xl">
            แปลเป็นภาษางานแต่ง <span className="text-gold">แล้วมันแปลว่าอะไร</span>
          </motion.h2>
          <motion.div variants={reveal} className="mt-6 rounded-md border border-[var(--rule)] bg-card p-6 sm:p-8">
            <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
              <Users className="size-4 text-patina" /> ถ้าเอาไปใช้ในงานจริง
            </p>
            <ul className="mt-5 space-y-4">
              {WEDDING.map((w) => (
                <li key={w} className="flex gap-3 text-[14px] leading-relaxed text-foreground/90">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" />
                  {w}
                </li>
              ))}
            </ul>
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

          <motion.p variants={reveal} className="mt-6 text-[13px] text-muted-foreground">
            ผลทดสอบการใช้งานจริงของฟีเจอร์ (กล้อง FTP · มือถือ · like · การ์ดแชร์) อยู่ที่หน้า{" "}
            <Link to="/tests" className="font-medium text-gold underline-offset-4 hover:underline">ผลทดสอบระบบ</Link>
          </motion.p>

          <motion.p variants={reveal} className="mt-10 flex items-center gap-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="size-4 text-patina" />
            ตัวเลขทุกตัววัดจากระบบ production เดียวกับที่ให้บริการอยู่ — ไม่มีเครื่องจัดพิเศษ
          </motion.p>
        </motion.div>
      </main>
    </div>
  )
}
