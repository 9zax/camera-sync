# Wedibox — Passive Reverse Engineering Report

- เป้าหมาย: https://wedibox.com (marketing) + https://www.wedibox.com/w/ (แอปหลัก Angular)
- วิธี: โหลดไฟล์ public (HTML + JS bundles) มาวิเคราะห์ static ล้วน (grep + `rea-agents@6.3.0 analyze-javascript-application`) — **ไม่ได้ login / ยิง API / โจมตีใด ๆ**
- วันที่วิเคราะห์: 2026-10-18
- ไฟล์หลักที่ใช้เป็นหลักฐาน:
  - `assets/main.b6127dc6e4891ad2.js` (1.5MB, Angular app — obfuscated ด้วย javascript-obfuscator)
  - `assets/vendor.68182832458c8911.js` (7.8MB, รวม Stripe.js)
  - `assets/scripts.79f974a3208dd13f.js`, `assets/runtime.*.js`, `assets/polyfills.*.js`
  - `index.html` (marketing + JSON-LD pricing), `w_index.html` (app shell)
  - `analysis.json` (REA graph: 13 JS, 84,728 semantic nodes, 24,471 call-flow, 56 findings)

---

## (ก) ฟีเจอร์ที่เห็นจาก bundle

**ฝั่งแขก (guest, ไม่ต้องติดแอป):**
- อัปโหลดรูป/วิดีโอผ่าน QR / share link (`qr-code`, `qr-download-source`, `downloadQrcode`)
- Guestbook แบบข้อความ + เสียง + วิดีโอ (`/event/guestbook`, `voicemail/set-message`, `s3.service.uploadAudioMessage`)
- ดู "คอนเทนต์ของฉัน" (`/event/my-content`, `pageTitles.collection`)
- RSVP + plus-one + เลือกอาหาร (`/rsvp/`, `/responses/`, เมนู All-In-One "RSVP, meals, plus ones")
- Live slideshow ฉากงาน (`/live/`, `/event/slideshow`)
- Shared playlist เพลง (`/event/playlist`)
- Seating chart live (`/event/seating/`, `/seat/`, มี Google Maps Places หาสถานที่)

**ฝั่งเจ้าภาพ/ช่างภาพ:**
- สร้าง event + หน้าเว็บงานแต่ง (`/event/setup`, `/event/details/`, wedding website)
- จัดอัลบั้ม/คอนเทนต์ (`albums`, `/event/album/`)
- Guest list + ส่ง invite (import/bulk) (`/invites`, `/invites/import`, `/invites/bulk-delete`)
- Co-organizer / คนช่วยดูแล (`addCoOrganizer`, `completeCoOrganizer`, `trackCoOrganizerInvited`)
- Live slideshow, embed widget สำหรับเว็บตัวเอง (`/event/embed-details`, `pageTitles.embedWidget`)
- QR customizer สี/ดีไซน์ (`qr-modal__color-field`, `/event/customizer`)
- สั่ง **สิ่งพิมพ์จริง (physical prints)** ผ่าน Stripe checkout (`prints.checkout.securedByStripe`, `orderPrints`, `shippingElement`, `/prints/select`, `/w/prints/success`)
- Scavenger hunt challenge (แพ็กเกจ Free)
- Referral program (`/referral`, `pageTitles.referral`)
- Partner/ช่างภาพอิสระ portal (`/w/partners/login`)

**สิ่งที่ "ไม่มี" ใน bundle (สำคัญกับเรา):**
- **ไม่มี face/selfie search เลย** — grep `face|selfie|recognition|rekognition|cluster|similar` ใน `main.*.js` ได้แค่ CSS `backface-visibility` และ `@font-face` (`prepareFace`, `wedibox-face-` คือ **font face** ของดีไซน์การ์ด ไม่ใช่ใบหน้า)
- แขกระบุตัวด้วยชื่อล้วน (`wedibox_guest_name` ใน localStorage/cookie) — หา "รูปที่มีฉัน" ไม่ได้
- ไม่มี sync จากกล้อง/เครื่องช่างภาพ — ทุกอย่างมาจากที่แขกอัปโหลดเองเท่านั้น

## (ข) API / design ที่ตรวจได้ (พร้อม evidence)

| สิ่งที่พบ | Evidence |
|---|---|
| API หลัก `https://api-v2.wedibox.com/v2/` (+ legacy `https://api-v2.wedibox.com/`) | `main.b6127dc6e4891ad2.js` string pool |
| API Gateway เก่า `rqrx6vyti6.execute-api.us-east-1.amazonaws.com` | `main.*.js` (บริบท `openCheckout`) |
| อัปโหลดตรงเข้า AWS S3 แบบ presigned URL จากเบราว์เซอร์ | i18n keys `s3.service.getPresignedURL`, `s3.errors.failedGetPresignedUrl`, `s3.errors.imageSizeLimit`, `s3.errors.invalidFileType` |
| สื่อการตลาดบน S3 `wedibox-app-misc.s3.us-east-1.amazonaws.com` | `main.*.js` (รูป demo .webp) |
| ชำระเงิน Stripe (Payment Element) | `vendor.*.js` (Stripe.js 204 hits), `payment-element-prints-checkout`, `prints.checkout.cancel` |
| Login ด้วย Google Identity Services + email/password | `accounts.google.com/gsi/client` ใน `w_index.html`, `initializeGoogleSignIn`, `/auth/login`, `resetPassword`, `auth.passwordValidator.*` |
| Analytics/Tracking: Google Tag Manager + Microsoft Clarity + ipapi.co (ดึงประเทศ) | `googletagmanager.com/gtm.js`, `CLARITY_PROJECT_ID`, `https://ipapi.co/json/?fields=country_code` ใน `main.*.js` |
| Google Maps API key ฝังในหน้าเว็บ (`AIzaSyCy1H-...`) | `w_index.html` + `analysis.json` endpoint node |
| Frontend routes เต็ม ๆ (Angular lazy routes) | `/event/*`, `/invites*`, `/prints/*`, `/live/`, `/referral`, `/support/help`, ฯลฯ ใน `main.*.js` |
| มีระบบ trial + หมดอายุ | `isTrial`, `isTrialExpired` ใน `main.*.js` |
| โค้ด frontend ถูก obfuscate (javascript-obfuscator string-pool) | ทุกไฟล์ `/w/*.js` — `_0x` + hex-escaped strings |
| แอปเป็น Angular (runtime/polyfills/vendor pattern), marketing เป็น Astro | `w_index.html`, `index.html` |

**ราคา/แพ็กเกจ (จาก JSON-LD สาธารณะใน `index.html` + ข้อความใน `main.*.js`):**

| แพ็กเกจ | ราคา (one-time) | เงื่อนไขสำคัญ |
|---|---|---|
| Free | $0 | **อัปโหลดได้ 50 รูป** ("50 photo uploads" ใน bundle), QR + link, scavenger hunt, co-organizer |
| Embed | $29 | หน้าต่างอัปโหลด **3 เดือน**, widget, "No Wedibox branding on the widget" |
| Wedding | $49 | หน้าต่างอัปโหลด **6 เดือน**, พื้นที่เก็บ **1 ปี**, ZIP คุณภาพต้นฉบับ, custom wedibox.com URL |
| All-In-One | $79 | อัปโหลด **1 ปี**, เก็บ **2 ปี**, RSVP/เพลง/ป้ายจัดโต๊ะ |

(FAQ ยืนยัน: "$49, one time... no monthly subscriptions or per-guest fees" + ใน bundle: "6-month upload window", "At least a full year of storage", "14-day money-back guarantee")

## (ค) ข้อด้อย / ข้อจำกัดของผลิตภัณฑ์

1. **ข้อมูลรูปอยู่บนคลาวด์เขาทั้งหมด (AWS S3 us-east-1)** — เจ้าภาพ/ช่างภาพไม่มีไฟล์อยู่กับตัวเอง อัปโหลดตรงจากเบราว์เซอร์แขกเข้า bucket เขาผ่าน presigned URL
2. **มีวันหมดอายุของข้อมูล** — หน้าต่างอัปโหลด 3–12 เดือน แล้ว gallery ถูกลบหลัง 1–2 ปี ตามแพ็กเกจ (`isTrialExpired`, ราคาห่อหุ้ม "storage" เป็นสินค้า)
3. **Free tier จำกัด 50 รูป + มี branding** — ลบ branding ได้ต้องจ่าย (perk เฉพาะแพ็กเกจ Embed) ส่วน "watermark" แบบภาพไม่พบสตริงใน bundle (ไม่มีระบบใส่ลายน้ำให้แขก แต่ก็ไม่มีระบบส่งไฟล์เต็มให้ช่างภาพด้วย)
4. **จ่ายรายงานต่อ event (one-time ต่องาน $29–79)** — ช่างภาพที่รับหลายงานต่อปี ค่าใช้จ่ายสะสมโดยไม่มีของติดตัวกลับมา
5. **ไม่มี face/selfie search** — แขกหารูปตัวเองไม่ได้ ต้องเลื่อนดูทั้ง gallery (ระบุตัวด้วยชื่ออย่างเดียว) — จุดอ่อนใหญ่สุดสำหรับ use case "แขก scan QR แล้วเจอรูปตัวเอง"
6. **ไม่มีรูปฝั่งช่างภาพ** — ได้รูปเฉพาะที่แขกถ่ายอัปโหลดเอง ภาพมืออาชีพของช่างภาพไม่ไหลเข้าระบบ ไม่มีโหมด sync จากเครื่อง/กล้องช่างภาพแบบสด
7. **บังคับ login สร้างบัญชี (Google/email) สำหรับเจ้าภาพ** และบังคับสร้างบัญชีเพื่อสั่ง prints ("Create a free account to order prints") — ส่วนแขกไม่ต้อง (ไม่มีแอป/ไม่มีบัญชี)
8. **Tracking หนักในหน้างานจริง** — GTM + MS Clarity + ipapi.co ทำงานอยู่ในหน้า gallery ที่แขกเปิด (พิจารณาความเป็นส่วนตัวของแขก)
9. **สั่งสิ่งพิมพ์ต้องจ่ายผ่าน Stripe ต่อชิ้น** — เป็น upsell เพิ่ม ไม่ใช่ export ไฟล์ไปร้านพิมพ์เอง
10. **ปลายทางล็อกกับโครงสร้างเขา** — custom URL คือ subdomain ของ wedibox.com เท่านั้น, embed widget ผูกกับ origin เขา

## (ง) 5 จุดที่แอปเรา (self-hosted wedding drive) ทำได้ดีกว่า

1. **Face/selfie search** — แขก scan QR + ถ่ายเซลฟี่ แล้วเจอรูปตัวเองทันที (Wedibox ไม่มีฟีเจอร์นี้เลย — ยืนยันจาก bundle) ในขณะที่รูปช่างภาพก็ค้นได้ด้วย ไม่ใช่แค่รูปแขก
2. **ไฟล์อยู่เครื่องตัวเอง ไม่หมดอายุ** — self-hosted บนเครื่อง/NAS ของช่างภาพ ไม่มีหน้าต่างอัปโหลด 3–12 เดือน ไม่มีการลบที่ 1–2 ปี ไม่มี S3 คนกลาง
3. **Sync จากเครื่องช่างภาพสด ๆ** — รูปมืออาชีพที่ถ่ายในงานไหลเข้าแกลเลอรีทันทีระหว่างงาน (Wedibox ได้แค่รูปที่แขกอัปโหลดเอง หลังงาน)
4. **ไม่มีลายน้ำ ไม่มี branding ไม่มีค่าใช้จ่ายต่อรูป/ต่องาน** — ดาวน์โหลดคุณภาพต้นฉบับทุกไฟล์ฟรี ไม่ต้องรอ ZIP ตามแพ็กเกจ ไม่มี $29–79 ต่อ event สะสม
5. **ความเป็นส่วนตัวของแขก** — ไม่มี GTM/Clarity/ipapi ในหน้า gallery ของเรา แขกไม่ถูก track ผ่านงานแต่งของคนอื่น

---

*หมายเหตุ: การวิเคราะห์เป็น static บนไฟล์ public เท่านั้น ราคา/เงื่อนไขอ้างอิง JSON-LD และข้อความที่ฝังในหน้าเว็บ ณ วันที่เก็บข้อมูล ไม่ได้ทดสอบ API จริง*
