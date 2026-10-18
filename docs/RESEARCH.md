# Market Research — Wedding Photo Drive + QR Gallery + Face Search

> Research date: 2026-10-18 · สำหรับโปรเจกต์ **CameraSync** (working title)

## 1. โจทย์ผลิตภัณฑ์

สร้าง "drive ออนไลน์" สำหรับงานแต่ง 1 งาน:

1. ช่างภาพถ่ายในงาน → ระบบ **sync อัตโนมัติจากเครื่องช่างภาพ** (watch folder / memory card relay) ขึ้นออนไลน์แบบใกล้เรียลไทม์
2. แขก **สแกน QR** ที่โต๊ะ/ที่จอ ในงาน เพื่อเปิดแกลเลอรีดูภาพสด ๆ ระหว่างงาน
3. แขก **ถ่ายเซลฟี่ / เลือกรูปตัวเอง เพื่อค้นหารูปของตัวเองในงาน** (face search) แล้วดาวน์โหลดได้

## 2. ภูมิทัศน์ตลาดที่พบ

### กลุ่ม A — QR gallery ให้ "แขกอัปโหลด" (guest upload)

| ผลิตภัณฑ์ | โมเดลราคา | จุดเด่น | ข้อจำกัดเทียบกับโจทย์เรา |
|---|---|---|---|
| [GuestPix](https://guestpix.com) | $49–89 จ่า่ยครั้งเดียว/งาน | QR ให้แขกอัปโหลดรูป+วิดีโอ ไม่ต้องติดแอป | เป็นรูป "จากแขก" ไม่ใช่รูปช่างภาพ |
| [Wedibox](https://www.wedibox.com) | เริ่มฟรี 50 รูป → $29–79 ครั้งเดียว/งาน | QR + guestbook + RSVP รวมชุด | เหมือนกัน — ไม่มีรูปฝั่งช่างภาพ, ไม่มี face search |
| [GuestCam](https://guestcam.co/photo-sharing/weddings), [GuestLense](https://www.guestlense.com), [Fotify](https://fotify.app/wedding-photo-sharing-app) | รายเดือน/รายงาน | live photo wall, ตั้งค่าเร็ว | เหมือนกัน |

### กลุ่ม B — Client gallery ฝั่งช่างภาพ (delivery)

| ผลิตภัณฑ์ | โมเดลราคา | จุดเด่น | ข้อจำกัด |
|---|---|---|---|
| [Pixieset](https://pixieset.com) ([pricing](https://www.pixieset.com/pricing/)) | $8–10/เดือนขึ้นไป | Quick Share QR ให้แขกส่งรูปเข้า gallery, มี store ขายรูป | QR ใช้เก็บรูปแขก ไม่ใช่เปิดดูรูปช่างภาพสด, ไม่มี face search, ข้อมูลอยู่บนคลาวด์เขา |
| [Picflow](https://picflow.com) ([QR](https://picflow.com/updates/qr-code), [เทียบกับ Pixieset](https://picflow.com/compare/pixieset-alternative)) | บอกราคาแบบ trial + รายเดือน | QR พาแขกเข้า gallery, proofing/feedback แน่น | ไม่มี sync แบบเรียลไทม์ระหว่างงาน, ไม่มี face search |
| ShootProof, Pic-Time, SmugMug, Zenfolio | รายเดือน | delivery + ขาย print | ไม่ตอบโจทย์ "สดในงาน + หารูปตัวเอง" |

### กลุ่ม C — Face search "หารูปตัวเอง" (ตรงโจทย์ที่สุด)

| ผลิตภัณฑ์ | ลักษณะ | ข้อสังเกต |
|---|---|---|
| [Waldo Photos](https://waldophotos.com/qr-code-for-wedding-pictures) | QR + facial recognition ส่งรูปถึงแขกอัตโนมัติ | ครบที่สุดเชิงฟีเจอร์ แต่เป็น SaaS ปิด, ราคาต่องาน/ต่อคน, ข้อมูลลูกค้าอยู่กับเขา |
| [Memzo](https://memzo.ai) | แขกกดเซลฟี่ → เจอรูปตัวเองทันที สร้างงานฟรี จ่า่ยถ้าพอใจ | ตรง concept "selfie → my photos" เป๊ะ |
| SiKram (ไทย) | แขกสแกน QR + AI ค้นหาใบหน้า ดาวน์โหลดผ่าน LINE | ตลาดไทยมีความต้องการจริง (โพสต์ในกลุ่ม wedding ไทย: "สแกนหน้า 5 วิ ได้รูปตัวเองทันที") |

### กลุ่ม D — OSS prior art (เทคนิค)

- **[Immich](https://immich.app)** / **[PhotoPrism](https://photoprism.app)** — self-hosted photo library พร้อม face recognition (machine-learning tagging) แสดงว่า stack เปิดทำ face pipeline ได้จริง แต่เป็น "คลังรูปส่วนตัว" ไม่ใช่ "งาน event + แขก scan + sync สด"
- **InsightFace** (SCRFD detection + ArcFace embedding) — โมเดล open ที่เป็นมาตรฐาน de-facto ของกลุ่ม C ทั้งหมด

## 3. ช่องว่างที่ CameraSync จะยืน (positioning)

ไม่มีผลิตภัณฑ์ไหนในตลาดรวมทั้ง 3 อย่างนี้เข้าด้วยกันแบบ **self-hosted**:

1. **Live sync จากเครื่องช่างภาพ** (watch-folder agent → server) — รูปขึ้นระหว่างงาน ไม่ต้องรอ culling เสร็จ
2. **QR ให้แขกดู** แกลเลอรีสาธารณะของงาน (เข้าได้ทันที ไม่ต้องล็อกอิน ป้องกันด้วย PIN ได้)
3. **Face search** เซลฟี่ → รูปของตัวเอง (embedding ฝั่งเซิร์ฟเวอร์ เซลฟี่ไม่ถูกเก็บ)
4. **Self-hosted / เป็นเจ้าของข้อมูล** — เหมาะกับสตูดิโอที่ไม่อยากส่งรูปคู่สมรสขึ้นคลาวด์บุคคลที่สาม, ไม่มีค่าใช้จ่ายต่อรูป/ต่องาน, รันบนเครื่องในงาน (LAN) ก็ได้

กลุ่มเป้าหมาย: สตูดิโอ/ช่างภาพงานแต่ง ที่อยากให้บริการระดับ Waldo/Memzo ในชื่อของตัวเอง โดยคุมข้อมูลเอง

## 4. ข้อกำหนดที่ได้จากงานวิจัยตลาด → สเปก v0.1 นี้

| ฟีเจอร์ | ที่มา |
|---|---|
| Event = drive 1 งาน (slug สั้น แชร์ง่าย, PIN ได้) | ทุกกลุ่ม A |
| Upload หลายช่องทาง: แดชบอร์ดลากวาง + CLI agent watch folder (dedup ด้วย hash, resume) | ต่างจากตลาดที่ต้องอัปมือ/ผ่านแอปเขา |
| Thumbnail/web/original 3 ขนาด, คนละไฟล์ content-addressed | มาตรฐานกลุ่ม B |
| แกลเลอรีสาธารณะ + auto-refresh "สด" | Fotify "live wall" |
| QR PNG ให้ปรินท์/โชว์จอ | ทุกเจ้า |
| Face search: selfie → คะแนนความเหมือน → ดาวน์โหลด (รวม zip) | Memzo/SiKram/Waldo |
| ดาวน์โหลดไฟล์ต้นฉบับทั้งงาน (zip) สำหรับคู่สมรส | client gallery |
| ธีมหรู อ่านง่ายบนมือถือ (แขกเปิดจากมือถือ 90%+) | สังเกตจาก UX ทุกเจ้า |

## 5. Roadmap นอกเหนือ v0.1

- RAW tether (Lightroom/watchfolder → auto-convert), HEIC decode
- วิดีโอ (HLS preview), ลายน้ำรูป preview
- Guest upload แบบกลุ่ม A (แยกสตรีม "รูปแขก")
- Face grouping UI สำหรับช่างภาพ culling, ลบใบหน้า/ขออนุญาต (consent mode ตาม GDPR/พ.ร.บ. PDPA)
- สตรีมมิ่งคิว: `injest` → queue → fan-out workers, S3/R2 backend แทนดิสก์

## 6. แหล่งอ้างอิงหลัก

- GuestPix — <https://guestpix.com>
- Wedibox — <https://www.wedibox.com>
- GuestCam — <https://guestcam.co/photo-sharing/weddings>
- Fotify — <https://fotify.app/wedding-photo-sharing-app>
- Pixieset Quick Share — <https://blog.pixieset.com/blog/collection-quick-share/> , pricing <https://www.pixieset.com/pricing/>
- Picflow QR — <https://picflow.com/updates/qr-code> , comparison <https://picflow.com/compare/pixieset-alternative>
- Waldo Photos — <https://waldophotos.com/qr-code-for-wedding-pictures>
- Memzo — <https://memzo.ai>
- SiKram (ไทย) — <https://www.facebook.com/sikram.co/videos/367048509423879>
- โพสต์กลุ่ม wedding ไทยเรื่อง Face AI — <https://www.facebook.com/groups/855754684627739/posts/3124930524376799>
- Immich — <https://immich.app> , PhotoPrism — <https://photoprism.app>
- InsightFace — <https://github.com/deepinsight/insightface>
