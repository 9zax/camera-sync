import { useRef } from "react"
import { Link } from "react-router-dom"
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react"
import {
  ArrowRight,
  Camera,
  CloudUpload,
  HardDriveDownload,
  Heart,
  Images,
  Lock,
  QrCode,
  ScanFace,
  ShieldCheck,
  Sparkles,
  UserX,
  Wallet,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Logo, LogoMark } from "@/components/Logo"
import { ObjectsShowcase } from "@/components/ObjectsShowcase"

/* ---------------------------------- motion --------------------------------- */

const reveal: Variants = {
  hidden: { opacity: 0, y: 34, filter: "blur(8px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.85, ease: [0.16, 1, 0.3, 1] },
  },
}

const stagger = (s = 0.1): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: s } },
})

/* ---------------------------------- copy ----------------------------------- */

const steps = [
  {
    n: "01",
    icon: CloudUpload,
    title: "ช่างภาพถ่ายไป รูปขึ้นเอง",
    desc: "เปิดแอป CameraSync บนเครื่องช่างภาพ ชี้โฟลเดอร์รูปของงาน ระบบอ่านรูปใหม่จากกล้องขึ้นแกลเลอรีเองตลอดงาน — ไม่ต้องเลือกไฟล์ ไม่ต้องอัปโหลดมือ",
  },
  {
    n: "02",
    icon: QrCode,
    title: "แขกสแกน QR ดูได้เลย",
    desc: "วาง QR สวย ๆ บนโต๊ะหรือจอในงาน แขกเปิดลิงก์จากมือถือได้ทันที ไม่ต้องติดแอป ไม่ต้องสมัครสมาชิก ไม่ต้องขอเบอร์ใคร",
  },
  {
    n: "03",
    icon: ScanFace,
    title: "ถ่ายเซลฟี่ เจอรูปตัวเอง",
    desc: "แขกถ่ายเซลฟี่หนึ่งใบ ระบบรวมทุกรูปที่มีเขาอยู่ในเฟรมมาให้ครบ กดดาวน์โหลดทั้งชุดได้ในไม่กี่วินาที",
  },
]

const features = [
  { icon: Zap, title: "รูปขึ้นสดระหว่างงาน", desc: "ช็อตใหม่โผล่บนมือถือแขกหลังกดชัตเตอร์ไม่กี่นาที บรรยากาศงานยังร้อนอยู่เลย" },
  { icon: ScanFace, title: "หารูปตัวเองใน 5 วินาที", desc: "ไม่ต้องเลื่อนไล่ดูทีละรูป — ถ่ายเซลฟี่แล้วระบบรวมรูปที่มีคุณมาให้ครบในที่เดียว" },
  { icon: UserX, title: "แขกไม่ต้องติดแอป ไม่ต้องสมัคร", desc: "สแกนแล้วดูได้เลย ไม่มีขั้นตอนสมัครสมาชิก ไม่มีการขอเบอร์หรืออีเมล ใครก็เข้าชมได้" },
  { icon: HardDriveDownload, title: "ไฟล์เต็มความละเอียด ไม่มีลายน้ำ", desc: "แขกดาวน์โหลดรูปคุณภาพเต็ม ไม่มีลายน้ำบังคะแนนสวย ๆ ไม่จำกัดจำนวนรูป" },
  { icon: ShieldCheck, title: "รูปเซลฟี่ไม่ถูกเก็บ", desc: "ใช้เฉพาะตอนค้นหาแล้วลบทิ้งทันที และปิดการค้นหาด้วยใบหน้าของแต่ละงานได้ในคลิกเดียว" },
  { icon: Lock, title: "ล็อกงานด้วย PIN ได้", desc: "อยากให้เฉพาะแขกในงานเห็น ตั้ง PIN สั้น ๆ กันคนนอก ปลอดภัยแต่ยังเข้าง่ายสำหรับแขก" },
  { icon: Wallet, title: "ใช้กี่งานก็ราคาเดิม", desc: "เป็นระบบของสตูดิโอคุณเอง ไม่มีค่าใช้จ่ายต่อรูป ต่อแขก หรือต่องาน" },
  { icon: Images, title: "ครบทั้งงานใน drive เดียว", desc: "หนึ่งงาน = หนึ่งลิงก์ แชร์ง่าย ปรินท์ QR ติดโต๊ะได้ ดาวน์โหลดทั้งงานเป็น zip ได้ทันที" },
]

const stats = [
  ["~30 วินาที", "รูปใหม่ถึงมือแขก"],
  ["0 แอป", "แขกไม่ต้องติดตั้ง"],
  ["100%", "ไฟล์เต็มคุณภาพ"],
]

/* --------------------------------- section --------------------------------- */

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-gold">
      <span className="h-px w-8 bg-gold/60" />
      {children}
      <span className="h-px w-8 bg-gold/60" />
    </span>
  )
}

function Section({
  id,
  children,
  className = "",
}: {
  id?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} className={`mx-auto max-w-6xl px-5 ${className}`}>
      {children}
    </section>
  )
}

/* ---------------------------------- page ----------------------------------- */

export default function Landing() {
  const reduced = useReducedMotion()
  const { scrollYProgress, scrollY } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.4 })

  const heroRef = useRef<HTMLDivElement>(null)
  const heroY = useTransform(scrollY, [0, 600], [0, reduced ? 0 : 120])
  const heroOpacity = useTransform(scrollY, [0, 480], [1, 0])
  const glowScale = useTransform(scrollY, [0, 600], [1, reduced ? 1 : 1.25])

  return (
    <div className="min-h-dvh">
      {/* gold scroll progress */}
      <motion.div
        className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-gradient-to-r from-primary via-gold to-primary"
        style={{ scaleX: progress }}
        aria-hidden
      />

      {/* nav */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-5">
          <Link to="/">
            <Logo size={36} />
          </Link>
          <nav className="flex items-center gap-7">
            <a href="#how" className="group relative hidden text-[13.5px] text-muted-foreground transition-colors hover:text-foreground sm:block">
              ขั้นตอนการใช้งาน
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-gold transition-all duration-300 group-hover:w-full" />
            </a>
            <a href="#features" className="group relative hidden text-[13.5px] text-muted-foreground transition-colors hover:text-foreground sm:block">
              ฟีเจอร์ทั้งหมด
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-gold transition-all duration-300 group-hover:w-full" />
            </a>
            <Button asChild size="sm" className="rounded-md px-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_48px_oklch(2%_0.004_95/0.4)]">
              <Link to="/admin">
                เข้าสู่ระบบช่างภาพ <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* hero */}
      <section ref={heroRef} className="relative overflow-hidden">
        <motion.div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(58%_44%_at_50%_0%,oklch(84%_0.19_80.46/0.07),transparent),radial-gradient(30%_26%_at_85%_18%,oklch(70%_0.12_188/0.06),transparent)]"
          style={{ scale: glowScale }}
          aria-hidden
        />
        {/* faint hairline grid for editorial texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px)] [background-size:25%_100%]"
          aria-hidden
        />
        <motion.div
          className="relative mx-auto max-w-5xl px-5 pb-14 pt-24 text-center sm:pt-32"
          style={{ y: heroY, opacity: heroOpacity }}
        >
          <motion.div variants={stagger(0.12)} initial="hidden" animate="show">
            <motion.div variants={reveal}>
              <Kicker>Live Wedding Gallery</Kicker>
            </motion.div>

            <motion.h1
              variants={reveal}
              className="mt-7 font-display text-[2.9rem] font-light leading-[1.05] tracking-tight text-foreground sm:text-7xl"
            >
              ภาพงานแต่งของคุณ
              <br />
              <span className="relative inline-block text-gold">
                <span>ออนไลน์ทันที</span>
                <motion.span
                  className="absolute -bottom-2 left-0 h-[3px] w-full origin-left rounded-full bg-gradient-to-r from-gold/0 via-gold to-gold/0"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.9, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  aria-hidden
                />
              </span>{" "}
              ที่กดชัตเตอร์
            </motion.h1>

            <motion.p
              variants={reveal}
              className="mx-auto mt-8 max-w-xl text-pretty text-[15.5px] leading-relaxed text-muted-foreground sm:text-lg"
            >
              ระบบส่งรูปจากกล้องขึ้นแกลเลอรีให้เองระหว่างงาน แขกสแกน QR ดูรูปสด ๆ
              และถ่ายเซลฟี่เพื่อหารูปของตัวเองได้ทันที — ครบจบในลิงก์เดียว
            </motion.p>

            <motion.div variants={reveal} className="mt-10 flex flex-wrap items-center justify-center gap-3.5">
              <Button asChild size="lg" className="group rounded-md px-8 text-[15px] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_48px_oklch(2%_0.004_95/0.4)]">
                <Link to="/admin">
                  <Camera className="mr-2 size-[18px]" /> เริ่มงานแรกของคุณ
                </Link>
              </Button>
              <motion.a href="#how" whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
                <Button size="lg" variant="outline" className="rounded-md px-8 text-[15px]">
                  ดูวิธีทำงาน
                </Button>
              </motion.a>
            </motion.div>

            <motion.div
              variants={reveal}
              className="mx-auto mt-14 flex max-w-2xl items-stretch justify-center divide-x divide-border"
            >
              {stats.map(([v, l], i) => (
                <motion.div
                  key={l}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 + i * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="flex-1 px-4 text-center"
                >
                  <div className="font-display text-2xl font-semibold text-foreground sm:text-[1.7rem]">{v}</div>
                  <div className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{l}</div>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* objects showcase — tilted infinite card stream */}
      <ObjectsShowcase />

      {/* how it works */}
      <Section id="how" className="py-24 sm:py-28">
        <motion.div variants={stagger()} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }}>
          <motion.div variants={reveal} className="text-center">
            <Kicker>How it works</Kicker>
            <h2 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-[2.6rem] sm:leading-tight">
              สามขั้นตอน <span className="text-gold">ง่ายกว่าที่คิด</span>
            </h2>
          </motion.div>

          <div className="relative mt-16 grid gap-14 md:grid-cols-3 md:gap-10">
            {/* gold connector (desktop) */}
            <div className="pointer-events-none absolute left-[16%] right-[16%] top-7 hidden h-px bg-gradient-to-r from-gold/10 via-gold/50 to-gold/10 md:block" aria-hidden />
            {steps.map((s) => (
              <motion.div key={s.n} variants={reveal} className="group relative text-center md:text-left">
                <div className="relative z-10 mx-auto flex size-14 items-center justify-center rounded-full border border-gold/40 bg-card shadow-[0_10px_26px_-14px_oklch(0.78_0.09_85/0.5)] transition-transform duration-500 group-hover:-translate-y-1 md:mx-0">
                  <s.icon className="size-6 text-primary" strokeWidth={1.7} />
                </div>
                <div className="mt-6 font-mono text-xs font-medium tracking-[0.3em] text-gold">{s.n}</div>
                <h3 className="mt-2.5 font-display text-xl font-semibold leading-snug">{s.title}</h3>
                <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-muted-foreground md:mx-0">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </Section>

      {/* features — editorial two-column list */}
      <Section id="features" className="pb-24 sm:pb-28">
        <motion.div variants={stagger(0.08)} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          <motion.div variants={reveal} className="text-center">
            <Kicker>Everything included</Kicker>
            <h2 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-[2.6rem] sm:leading-tight">
              ครบทุกอย่าง <span className="text-gold">ในลิงก์เดียว</span>
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-x-16 gap-y-0 md:grid-cols-2">
            {features.map((f) => (
              <motion.div
                key={f.title}
                variants={reveal}
                className="group flex gap-5 border-b border-border/60 py-7 transition-colors hover:bg-accent/25"
              >
                <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary ring-1 ring-[var(--rule-strong)] transition-all duration-500 group-hover:bg-accent">
                  <f.icon className="size-5 text-gold" strokeWidth={1.6} />
                </span>
                <div>
                  <h3 className="font-display text-[17px] font-semibold leading-snug">{f.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </Section>

      {/* CTA band */}
      <section className="relative overflow-hidden border-y border-[var(--rule-strong)] bg-card py-24 sm:py-28">
        <div
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(46%_60%_at_50%_0%,oklch(84%_0.19_80.46/0.10),transparent),radial-gradient(26%_36%_at_82%_88%,oklch(70%_0.12_188/0.10),transparent)]"
          aria-hidden
        />
        <motion.div
          variants={stagger(0.12)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="relative mx-auto max-w-3xl px-5 text-center"
        >
          <motion.div variants={reveal}>
            <span className="inline-flex items-center gap-2 rounded-md border border-[var(--rule)] bg-lacquer-deep px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-patina">
              <Sparkles className="size-3.5 text-gold" /> พร้อมใช้งานกับงานถัดไปของคุณ
            </span>
          </motion.div>
          <motion.h2
            variants={reveal}
            className="mt-7 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            ให้ทุกช็อตของคืนนั้น
            <br />
            <span className="text-gold">ไปถึงมือทุกคน</span> ในคืนเดียวกัน
          </motion.h2>
          <motion.div variants={reveal} className="mt-10">
            <Button asChild size="lg" className="rounded-md bg-gold px-8 text-[15px] font-semibold text-lacquer-deep transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_48px_oklch(2%_0.004_95/0.4)]">
              <Link to="/admin">
                เริ่มใช้งานฟรี <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </section>

      {/* footer */}
      <footer className="border-t border-border/50 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 text-center">
          <Logo size={32} />
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            แกลเลอรีงานแต่งสด + ค้นหารูปด้วยเซลฟี่ — ขับเคลื่อนด้วยใจรัก
            <Heart className="size-3.5 fill-patina text-patina" />
          </p>
          <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground/70">
            <LogoMark size={14} /> CameraSync
          </p>
        </div>
      </footer>
    </div>
  )
}
