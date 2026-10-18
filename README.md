# CameraSync — Wedding Photo Drive

**Drive รูปงานแต่งหนึ่งงานหนึ่งแหล่ง**: sync จากเครื่องช่างภาพแบบใกล้เรียลไทม์ → แขกสแกน QR ดูรูปสดระหว่างงาน → ถ่ายเซลฟี่เพื่อค้นหารูปของตัวเอง (AI face search)

## หลักการออกแบบ (ข้อด้อยของทุกระบบ คือจุดแข็งของเรา)

1. **ดิสก์เครื่องช่างภาพคือที่เก็บหลัก** — รูป ฐานข้อมูล และโมเดลอยู่บนเครื่อง/สตูดิโอของคุณเอง ไม่หมดอายุ ไม่ถูกย่อความละเอียด ไม่ต้องเช่าพื้นที่คลาวด์รายเดือน (ต่างจาก Memzo 3¢/รูป + resize เหลือ 4K, Wedibox/GuestPix ฟรี 50 รูป + หมดอายุ 12 เดือน — หลักฐานจาก reverse engineering จริง: [docs/COMPETITIVE-EDGE.md](docs/COMPETITIVE-EDGE.md))
2. **เปิดไว้ตลอด (always-on)** — รันแบบ desktop app / Docker / systemd เปิดทิ้งไว้ทั้งงาน relay ต่อใหม่อัตโนมัติ
3. **ครั้งแรกที่รัน = ผู้ใช้ตั้ง user/pass ของตัวเอง** ผ่านหน้าเว็บ (ไม่มีบัญชี default)
4. **แขกไม่ต้องติดแอป ไม่ต้องสมัคร ไม่มี OTP** — สแกน QR แล้วดูเลย ทำงานบน LAN ของงานได้แม้ไม่มีอินเทอร์เน็ต

## สถาปัตยกรรม

```
                        ┌────────────────────────────────────────────┐
                        │ เครื่องช่างภาพ (disk ของตัวเอง, เปิดตลอด)     │
  tether folder ──▶ ┌───┴──────────┐                                  │
  (LR/C1 capture)   │ wedsync-server│◀── wedsync agent (watch/push)    │
                    │ :8080         │◀── wedsync tunnel ───────────────┼──▶ relay/VPS (:9000)
                    │ SQLite+รูป    │                                  │      │ /t/{id}/…
                    │ face AI ในเครื่อง                                 │      ▼
                    └───┬──────────┘                                  │   แขกนอกวงเน็ต
                        │ Wi-Fi งาน (LAN)                             │
                        ▼                                             │
                     แขกในงานสแกน QR ◀────────────────────────────────┘
```

| ส่วน | เทคโนโลยี |
|---|---|
| Backend | Rust · Axum · SQLite (sqlx) · tokio |
| Image pipeline | thumb 480 / web 2048 / original + EXIF orientation |
| Face AI | InsightFace buffalo_l (SCRFD + ArcFace) ผ่าน onnxruntime — เซลฟี่ประมวลผลใน RAM **ไม่ถูกเก็บ** |
| Tunnel ในตัว | relay (axum WebSocket) + agent dial-out + สลับ prefix ด้วย cookie → SPA เดินผ่าน tunnel ได้ครบ |
| Frontend | React · Vite · Tailwind v4 · shadcn/ui · **motion.dev** (scroll-linked, layout, AnimatePresence, gestures, springs) |
| Sync agent | `wedsync` — watch/push (dedup ด้วย blake3) + tunnel client |

## เริ่มต้นใช้งาน

### ทางเลือก A — Docker Compose (แนะนำสำหรับ "เปิดไว้ตลอด")

```bash
docker compose build
docker compose run --rm models   # โหลดโมเดล face search ครั้งเดียว (~280MB)
docker compose up -d             # restart: unless-stopped = เปิดตลอด
# เปิด http://localhost:8080/admin → ตั้ง user/pass ของตัวเอง → สร้างงานแรก
```

### ทางเลือก B — รันบนเครื่องตรง ๆ (desktop/สตูดิโอ)

```bash
cargo build --release
cd web && npm install && npm run build && cd ..
./target/release/wedsync-server fetch-models            # ครั้งเดียว (ข้ามได้)
./target/release/wedsync-server serve --port 8080 \
     --import-dir ~/Pictures/WeddingInbox               # server อ่านโฟลเดอร์เครื่องเอง!
```

`--import-dir` = ชี้ tether folder ของ Lightroom/Capture One ได้เลย รูปใหม่ทุกใบถูก ingest อัตโนมัติ (ไม่ต้องอัปโหลด — ไฟล์อยู่บนดิสก์เดียวกันแล้ว) ไม่ระบุ `--event` จะสร้างงานใหม่ชื่อตามโฟลเดอร์ให้อัตโนมัติ

**macOS desktop app:** `./scripts/make-mac-app.sh` สร้าง `CameraSync.app` ไว้ ~/Applications — double-click = เปิด server + import folder + เปิดหน้า admin (เพิ่มใน Login Items เพื่อเปิดอัตโนมัติทุกเช้า) · Linux: [scripts/camerasync.service](scripts/camerasync.service) (systemd)

### Sync จากอีกเครื่อง (ถ้ารูปอยู่คนละเครื่องกับ server)

```bash
./target/release/wedsync --server http://<server>:8080 --event <id> --token <upload-token> watch /path/to/folder
```

## ให้คนนอกเข้าถึงโดย "ไม่เช่าดิสก์": Tunnel ในตัว หรือ VPN

รูปยังอยู่เครื่องคุณทั้งหมด มีแค่ HTTP วิ่งออกไป:

```bash
# ที่ VPS ตัวเล็ก (มีแค่ relay ไม่มีรูป):
docker compose --profile relay up -d relay        # หรือ: wedsync-server relay --port 9000

# ที่เครื่องช่างภาพ (หลัง NAT ก็ได้ — dial-out อย่างเดียว ต่อใหม่อัตโนมัติ):
./target/release/wedsync tunnel --server http://localhost:8080 \
     --relay ws://<vps>:9000 --id ploy-n-mek

# แขกเข้า: https://<vps>:9000/t/ploy-n-mek/  (QR ที่หน้า admin จะใส่ prefix ให้เอง)
```

ทางเลือก: ใช้ VPN ส่วนตัว (Tailscale/ZeroTier) — ติดตั้งทั้งเครื่องช่างภาพกับแขกไม่ได้ใช่ไหม? งั้นใช้กับทีมงาน/admin ได้ ส่วนแขกทั่วไปแนะนำ tunnel ข้างบน

## การใช้งานหน้าเว็บ

| หน้า | ผู้ใช้ | ทำอะไร |
|---|---|---|
| `/` | — | หน้า features (เน้นฟีเจอร์ล้วน) |
| `/e/{slug}` | แขก | แกลเลอรีสด + lightbox (ลากลงปิดได้) + แท็บ "หารูปตัวเอง" (กล้องเซลฟี่/อัปโหลด → ผลพร้อม % → ดาวน์โหลด .zip) |
| `/admin` | ช่างภาพ | ตั้ง user/pass รอบแรก / สร้างงาน / ติดตามสถานะประมวลผลสด |
| `/admin/events/{id}` | ช่างภาพ | Dropzone, คำสั่ง agent พร้อม copy, QR (tunnel-aware), ตั้งค่า PIN/slug/face search, zip ทั้งงาน |

## API สำคัญ

```
POST /api/auth/setup|login|logout      GET /api/auth/me|status
POST /api/agent/login                  GET|POST /api/events … PATCH/DELETE /api/events/{id}
POST /api/events/{id}/token|photos     GET /api/events/{id}/qr.png|download.zip
GET  /api/photos/{id}/file?variant=…   DELETE /api/photos/{id}
GET  /api/g/{slug}/info|photos|summary POST /api/g/{slug}/unlock
POST /api/g/{slug}/faces/search        (multipart selfie — ไม่ถูกเก็บ)
POST /api/g/{slug}/faces/download      (zip รูปที่เจอ)
relay: ws://…/r/connect/{id} + http…/t/{id}/…
```

## การตั้งค่า (env)

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `WEDSYNC_DATA` | `./data` | DB + รูป + โมเดล (อยู่ดิสก์เครื่องคุณ) |
| `PORT` | `8080` / relay `9000` | พอร์ต |
| `WEB_DIST` | `web/dist` | SPA build |
| `FACE_THRESHOLD` | `0.35` | ความเข้มงวดการจับคู่ใบหน้า |
| `WEDSYNC_IMPORT_DIR` | – | โฟลเดอร์ให้ server อ่านรูปเอง (env แบบของ --import-dir) |

## งานวิจัยและแผน

- [docs/RESEARCH.md](docs/RESEARCH.md) — ภูมิทัศน์ตลาด (Pixieset/Wedibox/Waldo/Memzo/SiKram…)
- [docs/COMPETITIVE-EDGE.md](docs/COMPETITIVE-EDGE.md) — ตาราง "ข้อด้อยของเขา → จุดแข็งของเรา" + roadmap ยืมจุดแข็งกลับ (guestbook, guest upload, LINE push)
- [docs/rea/](docs/rea/) — รายงาน reverse engineering จริงของ memzo.ai / wedibox.com / guestpix.com

## โครงสร้างโค้ด

```
crates/server/          # wedsync-server — API + pipeline + face engine + relay + importer
crates/agent/           # wedsync — watch/push + tunnel client
web/                    # React SPA (motion.dev + Tailwind v4 + shadcn/ui)
scripts/                # make-mac-app.sh, camerasync.service (systemd)
docker-compose.yml      # always-on deployment + relay profile
```
