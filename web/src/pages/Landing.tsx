import { useRef } from "react"
import { Link } from "react-router-dom"
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react"
import {
  Aperture,
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
  UserX,
  Wallet,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
}

const steps = [
  {
    icon: CloudUpload,
    title: "ถ่ายเสร็จ รูปขึ้นเอง",
    desc: "ช่างภาพถ่ายไป ระบบส่งรูปขึ้นแกลเลอรีให้เองทันที ไม่ต้องรอเลือกไฟล์ ไม่ต้องรอส่งมอบงาน",
  },
  {
    icon: QrCode,
    title: "แขกสแกน QR ดูได้เลย",
    desc: "วาง QR ไว้บนโต๊ะหรือจอในงาน แขกเปิดดูภาพจากมือถือได้ทันที ไม่ต้องติดแอป ไม่ต้องสมัครสมาชิก",
  },
  {
    icon: ScanFace,
    title: "ถ่ายเซลฟี่ เจอรูปตัวเอง",
    desc: "แขกถ่ายเซลฟี่หนึ่งใบ ระบบหารูปทั้งหมดที่ตัวเองอยู่ในเฟรม ดาวน์โหลดได้ในไม่กี่วินาที",
  },
]

const features = [
  { icon: Zap, title: "รูปขึ้นสดระหว่างงาน", desc: "ช็อตใหม่โผล่บนมือถือแขกหลังกดชัตเตอร์ไม่กี่นาที บรรยากาศงานยังร้อนอยู่เลย" },
  { icon: ScanFace, title: "หารูปตัวเองได้ใน 5 วินาที", desc: "ไม่ต้องเลื่อนไล่ดูทีละรูป — ถ่ายเซลฟี่แล้วระบบรวมรูปที่มีคุณมาให้ครบในที่เดียว พร้อมดาวน์โหลดทั้งชุด" },
  { icon: UserX, title: "แขกไม่ต้องติดแอป ไม่ต้องสมัคร", desc: "สแกนแล้วดูได้เลย ไม่มีขั้นตอนสมัครสมาชิก ไม่มีการขอเบอร์หรืออีเมล จึงไม่มีใครทิ้งงานไว้กลางทาง" },
  { icon: HardDriveDownload, title: "ไฟล์เต็มความละเอียด ไม่มีลายน้ำ", desc: "แขกดาวน์โหลดรูปคุณภาพเต็ม ไม่มีลายน้ำบังคะแนนสวย ๆ ไม่จำกัดจำนวนรูปที่โหลด" },
  { icon: ShieldCheck, title: "รูปเซลฟี่ไม่ถูกเก็บ", desc: "ใช้เฉพาะตอนค้นหาแล้วลบทิ้งทันที และปิดการค้นหาด้วยใบหน้าของแต่ละงานได้ในคลิกเดียว" },
  { icon: Lock, title: "ล็อกงานด้วย PIN ได้", desc: "อยากให้เฉพาะแขกในงานเห็น ตั้ง PIN สั้น ๆ กันคนนอกเข้า ปลอดภัยแต่ยังเข้าง่ายสำหรับแขก" },
  { icon: Wallet, title: "ใช้กี่งานก็ราคาเดิม", desc: "เป็นระบบของสตูดิโอคุณเอง ไม่มีค่าใช้จ่ายต่อรูป ต่อแขก หรือต่องาน งานเดือนละสิบงานก็เท่าเดิม" },
  { icon: Images, title: "ครบทั้งงานใน drive เดียว", desc: "หนึ่งงาน = หนึ่งลิงก์ แชร์ง่าย ปรินท์ QR ติดโต๊ะได้ และดาวน์โหลดไฟล์ทั้งงานเป็น zip ได้ทันที" },
]

export default function Landing() {
  const heroRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll()
  const { scrollY } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.4 })

  // hero parallax: content drifts up & fades as you scroll past
  const heroY = useTransform(scrollY, [0, 600], [0, 130])
  const heroOpacity = useTransform(scrollY, [0, 480], [1, 0])
  const glowScale = useTransform(scrollY, [0, 600], [1, 1.25])

  return (
    <div className="min-h-dvh">
      {/* scroll progress */}
      <motion.div
        className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-primary"
        style={{ scaleX: progress }}
        aria-hidden
      />

      {/* nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Aperture className="size-5" />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight">CameraSync</span>
          </Link>
          <div className="flex items-center gap-2">
            <a href="#how" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block">
              ขั้นตอนการใช้งาน
            </a>
            <a href="#features" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block">
              ฟีเจอร์
            </a>
            <Button asChild variant="default" size="sm" className="rounded-full">
              <Link to="/admin">
                เข้าสู่ระบบช่างภาพ <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* hero */}
      <section ref={heroRef} className="relative overflow-hidden">
        <motion.div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.52_0.082_25/0.12),transparent)]"
          style={{ scale: glowScale }}
          aria-hidden
        />
        <motion.div className="relative mx-auto max-w-4xl px-5 pb-20 pt-20 text-center sm:pt-28" style={{ y: heroY, opacity: heroOpacity }}>
          <motion.div variants={container} initial="hidden" animate="show">
            <motion.div variants={item}>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-card px-3.5 py-1.5 text-xs font-medium shadow-sm">
                <span className="size-1.5 animate-live-dot rounded-full bg-primary" />
                แกลเลอรีสดระหว่างงาน • สแกน QR • ค้นหารูปด้วยเซลฟี่
              </span>
            </motion.div>
            <motion.h1 variants={item} className="font-display text-4xl font-semibold leading-[1.15] tracking-tight sm:text-6xl">
              ภาพงานแต่งของคุณ
              <br />
              <span className="text-primary">ออนไลน์ทันทีที่กดชัตเตอร์</span>
            </motion.h1>
            <motion.p variants={item} className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              ระบบส่งรูปจากกล้องขึ้นแกลเลอรีให้เองระหว่างงาน แขกสแกน QR ดูรูปสด ๆ
              และถ่ายเซลฟี่เพื่อหารูปของตัวเองได้ทันที — ครบจบในลิงก์เดียว
            </motion.p>
            <motion.div variants={item} className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="rounded-full px-7 text-base">
                <Link to="/admin">
                  <Camera className="mr-2 size-5" /> เริ่มงานแรกของคุณ
                </Link>
              </Button>
              <motion.a href="#how" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Button size="lg" variant="outline" className="rounded-full px-7 text-base">
                  ดูวิธีทำงาน
                </Button>
              </motion.a>
            </motion.div>
            <motion.div variants={item} className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><Zap className="size-4 text-primary" /> รูปขึ้นระหว่างงาน</span>
              <span className="flex items-center gap-2"><UserX className="size-4 text-primary" /> แขกไม่ต้องติดแอป</span>
              <span className="flex items-center gap-2"><ScanFace className="size-4 text-primary" /> เจอรูปตัวเองใน 5 วินาที</span>
              <span className="flex items-center gap-2"><Heart className="size-4 text-primary" /> ไฟล์เต็มคุณภาพ ไม่มีลายน้ำ</span>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* how it works */}
      <section id="how" className="border-t border-border/60 bg-secondary/40 py-20">
        <div className="mx-auto max-w-6xl px-5">
          <motion.div
            className="mb-12 text-center"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="font-display text-3xl font-semibold tracking-tight">ทำงานอย่างไร</h2>
            <p className="mt-3 text-muted-foreground">สามขั้นตอน ตั้งแต่กดชัตเตอร์จนถึงมือแขก</p>
          </motion.div>
          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.55, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -6 }}
                className="group rounded-2xl border border-border/70 bg-card p-7 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <s.icon className="size-5" />
                  </span>
                  <span className="font-display text-4xl font-semibold text-primary/15">0{i + 1}</span>
                </div>
                <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* features */}
      <section id="features" className="py-20">
        <div className="mx-auto max-w-6xl px-5">
          <motion.div
            className="mb-12 text-center"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              ทุกอย่างที่งานแต่งยุคนี้ต้องมี
            </h2>
            <p className="mt-3 text-muted-foreground">ออกแบบจากปัญหาจริงของช่างภาพและแขกในงาน</p>
          </motion.div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: (i % 4) * 0.07, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -5 }}
                className="rounded-2xl border border-border/70 bg-card p-6"
              >
                <motion.span
                  className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  whileHover={{ rotate: -6, scale: 1.08 }}
                  transition={{ type: "spring", stiffness: 300, damping: 15 }}
                >
                  <f.icon className="size-5" />
                </motion.span>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 bg-secondary/40 py-16 text-center">
        <motion.div
          className="mx-auto max-w-2xl px-5"
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="font-display text-3xl font-semibold">เปิดใช้กับงานถัดไปของคุณวันนี้</h2>
          <p className="mt-3 text-muted-foreground">
            ตั้งค่าครั้งเดียว ใช้ได้ทุกงาน ทุกแขก ทุกฤดูกาลแต่งงาน
          </p>
          <Button asChild size="lg" className="mt-7 rounded-full px-8">
            <Link to="/admin">
              เริ่มใช้งาน <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </motion.div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-sm text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <Aperture className="size-4 text-primary" /> CameraSync — แกลเลอรีงานแต่งสด + ค้นหารูปด้วยเซลฟี่
        </p>
      </footer>
    </div>
  )
}
