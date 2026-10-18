# รายงาน Passive Reverse Engineering: GUESTPIX™ (guestpix.com)

**วันที่:** 2026-10-18 · **ขอบเขต:** static analysis ไฟล์ public เท่านั้น (ดาวน์โหลด HTML + JS bundle มาวิเคราะห์, ไม่โจมตี/ไม่ล็อกอิน/ไม่ยิง API)

## วิธีการ (Methodology)

| ขั้น | ผล |
|---|---|
| ดาวน์โหลด homepage `guestpix.com` | WordPress + Elementor + WooCommerce (เว็บการตลาด/checkout) |
| พบแอปจริง | SPA ที่ `my.guestpix.com` (Vite + Vue, bundle `index-Css1GhTl.js` 2.38 MB) |
| ดาวน์โหลด bundle | `assets/` รวม 8 ไฟล์ ~2.4 MB (main + polyfills + 6 lazy chunks) |
| `npx -y rea-agents@6.3.0 analyze-javascript-application` | **สำเร็จ** → `analysis.json` (167 MB, 394,248 AST nodes, 1,063 findings, parse 2 ไฟล์สำเร็จ) |
| ยืนยันเพิ่มด้วย manual grep | ใช้เสริม (ไม่ใช่ fallback) |

**สถาปัตยกรรมที่เห็น:** เว็บขายของ (WordPress/WooCommerce + Stripe + funnel-builder) แยกจากตัวแอป (SPA ที่ my.guestpix.com) + auth server `id.guestpix.com` (OIDC, client_id `gpx-web`) + upload pipeline ผ่าน **Uppy + Transloadit** + presigned endpoint + Sentry + Cloudflare Turnstile + i18n 10 ภาษา

---

## (ก) ฟีเจอร์ที่เห็นจาก bundle

### ฝั่ง Host (เจ้าภาพ)
- สร้าง/จัดการ event หลายประเภท (`/api/event/types`), event vault, Start Event / **Close Event** (ต้องกดเริ่ม-ปิดงานเอง)
- **Super Albums** — แยกอัลบั้มตามช่วงเวลา, reorder, sort-order, album folders ตอน zip
- **QR code** — generator, ปรับแต่งหน้าตา (`/api/event/${e}/qr/customize`), หน้า print การ์ด QR
- **Moderation** — media ต้องผ่านอนุมัติก่อนแขกเห็น ("...non visibles aux invités pour le moment"), approve/reject, หน้า reported-content
- **Guest list + RSVP** — ฟอร์ม RSVP + additional guests, export attendees
- **Wishlist / Wedding website** (slug กำหนดเอง) / Digital invitation / manage-invitation
- **Slideshow** — เลือกได้ว่าใช้เฉพาะ favourites, live updates
- **Zip download** ทั้งงาน (`/api/event/${e}/generatezip`) + เลือกเฉพาะ favourites ได้
- Documents (ไฟล์แน็บอื่น) ผ่าน `/events/${t}/documents/presigned`
- Freemium flow — FreemiumBadge/Banner/UpgradeCard/UpgradePromptModal, หน้า upgrade + "Extend for 12 months"

### ฝั่ง Guest (แขก)
- เข้าผ่าน **Magic Link (ไม่ต้อง PIN)** หรือ **PIN-protected link** หรือหน้า login ประจำ event; มีหน้า no-access / coming-soon / unlock album
- อัปโหลดรูป+วิดีโอ (Uppy dashboard, ตรวจ duplicate, `maxNumberOfFiles:100` ต่อรอบ)
- ดูแกลเลอรี, กด react, ทำ favourite, **Remind me later**
- **Guestbook** ข้อความ + **Video Guestbook** (อัดผ่านกล้องเบราว์เซอร์ — มีข้อความ "recording stopped, file size nearly exceeding limit")
- Messages/ติดต่อ, หน้า welcome ประจำ event
- หน้าแขกมี branding: **"Event powered by Guestpix"** (`powered_by`)

### สิ่งที่ **ไม่พบ** ใน bundle (สำคัญ)
- ❌ **Face search / selfie / face recognition — 0 hits** (grep `face|selfie|recognition|face search|find yourself` แล้วเจอแค่คำแปลภาษาฝรั่งเศส "Effacer" = ลบ) → แขกต้องเลื่อนหารูปตัวเองเอง
- ❌ ไม่มี real-time sync จากกล้อง/เครื่องช่างภาพ — content มาจากการอัปโหลดของแขก/host เท่านั้น
- ❌ ไม่มี watermark เป็นฟีเจอร์ (0 hits) แต่มี branding ประจำแบรนด์บนหน้าแขก

---

## (ข) API / design ที่ตรวจได้ (evidence: `assets/index-Css1GhTl.js` เว้นแต่ระบุอื่น)

### API endpoints (template literals ใน bundle)
| Endpoint (method ตาม context) | การใช้งาน |
|---|---|
| `POST /upload/${t}/presigned` {fileName, contentType, fileSize} | ขอ URL อัปโหลดตรง storage |
| `POST /events/${t}/documents/presigned` | ขอ URL อัปโหลดเอกสาร |
| `GET/POST /api/event`, `/api/event/${id}` | สร้าง/แก้ event |
| `POST /api/event/${e}/start`, `/api/event/${e}/close` | เปิด/ปิดงาน (คุม upload window) |
| `POST /api/event/${e}/generatezip` | สร้าง zip ดาวน์โหลดทั้งงาน |
| `POST /api/event/${e}/qr/customize` | ปรับแต่ง QR |
| `GET /api/event/types`, `GET /api/guest/events` | ประเภท event / รายการ event ของแขก |
| `POST /api/${e}/messages`, `DELETE /api/${n}/messages/${e}` | guestbook/messages |
| `GET /api/system/health` | health check |

### เส้นทางหน้า (SPA routes ที่สกัดได้)
- Host: `/event/dashboard`, `/event/:id/albums|guests|users|edit|customize|slideshow|summary|print|zipdownload|qrcodegenerator|advancedsettings/:id`, `/event/${id}/manage-media|guest-list|rsvp-list|wishlist|website|reported-content|manage-invitation|template/apply|upgrade`
- Guest: `/guest/:id/gallery|guestbook|messages|welcome|login|qr/:id|remindmelater/:id`, `/guest/access/:id/:token`, `/guest/unlock/:id/album/:albumId`, `/guest/noaccess`

### Auth & infra
- OIDC: `authority: https://id.guestpix.com`, `client_id: gpx-web`, `signinRedirect/signinSilent/logout` + chunk `silent-renew-*.js` → **host ต้องสมัคร+ล็อกอินบัญชีเต็มรูปแบบ**
- Cloudflare Turnstile (captcha) ทั้งเว็บขายและฟอร์ม
- Sentry (error tracking), vendor chunks: axios, TanStack Query, Uppy, Lottie, oidc-client
- ชำระเงินผ่าน WordPress/WooCommerce + Stripe ฝั่งเว็บการตลาด (`funnelkit-stripe-woo-payment-gateway`, `js.stripe.com/v3`) — evidence: `index.html`

### ลิมิต/ค่าที่ hardcode หรืออยู่ใน copy
| ลิมิต | ค่า | Evidence |
|---|---|---|
| ไฟล์ต่อการเลือกอัปโหลด 1 รอบ | `maxNumberOfFiles:100` | index-Css1GhTl.js |
| รูปสูงสุดตามแพ็กเกจ | `max_photos: "max {limit} photo uploads"` + ปุ่ม Upgrade | index-Css1GhTl.js |
| Free plan | **50 รูป, หน้าต่างอัปโหลด 30 วัน, unlimited guests** | pricing.html |
| แพ็กเกจเสียเงิน | upload+hosting 3 เดือน / 12 เดือน / 24 เดือน ("3 Mth. Upload & 12 Mth. Hosting" ฯลฯ) | pricing.html |
| Hosting | one-time payment, **gallery อยู่ 12 เดือนนับจากวัน event**, ต่ออายุ "Renew for another 12 months" | pricing.html + bundle (`date_hint`, `extend_time`, `keep_content_question`) |
| Fair Use | "Unlimited*" จริงๆ ใช้ได้ **1000 guests/event** | pricing.html |
| อื่นๆ | documents limit, information items limit, note ≤ 5000 chars, video guestbook มี cap ขนาดไฟล์ ("file size nearly exceeding the limit") | index-Css1GhTl.js |

---

## (ค) ข้อด้อย / ข้อจำกัดของ GUESTPIX

1. **เสียค่าใช้จ่ายต่อ event (one-time per event)** — ฟรีแคน 50 รูป/30 วัน; แพ็กเกจจริงซื้อตามงาน + จ่ายค่า renewal ทุก 12 เดือนถ้าอยากเก็บต่อ ("Renew for another 12 months...") — ทำหลายงานก็คูณหลายเท่า
2. **ไฟล์รูปทั้งหมดอยู่บนคลาวด์ของเขา** (presigned storage + Transloadit) — host ไม่ได้ถือไฟล์เอง, หมดอายุ 12 เดือนจากวัน event, ต้องกด extend/renew ไม่งั้นคอนเทนต์หาย (`keep_content_question: "What do you want to do with your content..."`)
3. **ไม่มี face/selfie search เลย** — แขก 800–2,000 รูปต้องเลื่อนหาเอง (รีวิวใน pricing.html ยอมรับเลขพันกว่ารูปต่องาน)
4. **ไม่ "สด" ฝั่งช่างภาพ** — ไม่มี sync จากเครื่อง/กล้องช่างภาพแบบ realtime; ระบบคือ "รอแขกอัปโหลด" + host อัปโหลดเองภายใน upload window 3–24 เดือนตามแพ็กเกจ; ต้องกด Start Event ก่อนถึงเริ่มได้
5. **ล็อกอิน/บัญชีฝั่ง host + แขกต้องผ่าน link/PIN** — host ต้องสมัครบัญชีผ่าน OIDC เต็มขั้นตอน + captcha; มี Fair Use cap 1,000 แขก/event; "unlimited" จริงๆ มีเงื่อนไข
6. **ลิมิตกระจายทั่วระบบ** — cap รูปตามแพ็กเกจ, 100 ไฟล์/รอบอัปโหลด, limit เอกสาร, limit information items, note 5,000 ตัวอักษร, cap ขนาดวิดีโอ guestbook
7. **Branding บรรทัดแบรนด์เขาบนหน้าแขก** ("Event powered by Guestpix") และหน้าเว็บการตลาดยัด tracking หนักมาก (GA, Meta, TikTok, Pinterest, Bing pixel — ดู cookie consent list ใน index.html)
8. **อัปโหลดพึ่งบริษัทที่สาม (Transloadit)** — pipeline ฝั่งเขา ไม่ใช่ infra เรา

---

## (ง) 5 จุดที่แอปเรา (self-hosted wedding drive) ทำได้ดีกว่า

1. **ไม่มีค่าใช้จ่ายต่องาน/ต่อรูป/ค่า renew 12 เดือน** — self-hosted จ่ายค่าเครื่องเดียว ทำกี่งานก็ได้ ไม่มี freemium 50 รูป ไม่มี Fair Use 1,000 แขก
2. **Sync สดจากเครื่องช่างภาพ** — รูปขึ้นแกลเลอรีระหว่างงานกำลังเล่นอยู่ (realtime) แทนที่จะรอแขกอัปโหลดเองหลังจบงาน/รอ host เข้าไปอัปโหลดเอง
3. **Face/selfie search ให้แขก** — แขกสแกน QR + ถ่ายเซลฟี่แล้วเจอรูปตัวเองทันที ซึ่ง GUESTPIX ไม่มีฟีเจอร์นี้เลย (ยืนยันจาก bundle)
4. **ไฟล์อยู่เครื่องตัวเองตลอดชีพ** — ไม่หมดอายุ 12 เดือน, ไม่ต้องกลับมา renew, ไม่ต้องไว้ใจคลาวด์/Transloadit ของคนอื่นกับรูปลูกค้า
5. **ประสบการณ์แขกสะอาดกว่า** — ไม่มี branding "powered by", ไม่มีลิมิตจำนวนรูป/ขนาด/จำนวนแขก, ไม่มี tracking pixels ของเว็บเขา

---

## สรุป 5 ข้อ (stdout summary)

- GUESTPIX = QR photo sharing + guestbook (ไม่มี face search), เว็บขาย WordPress/WooCommerce แยกจาก SPA ที่ my.guestpix.com
- โมเดลรายได้: one-time ต่อ event + freemium 50 รูป/30 วัน + renew ทุก 12 เดือน + Fair Use 1,000 แขก
- จุดอ่อนใหญ่สุดสำหรับเรา: ไม่มี selfie/face search, ไม่มี realtime sync จากเครื่องช่างภาพ, ไฟล์อยู่คลาวด์เขาและหมดอายุ 12 เดือน
- API surface ที่ตรวจได้: /api/event(+start/close/generatezip/qr), /upload/:id/presigned (Transloadit+Uppy), OIDC id.guestpix.com (gpx-web)
- แอปเราชนะที่: ฟรีตลอดชีพ per install, sync สด, face search, ไฟล์ที่เครื่องตัวเอง, ไม่มี branding/ลิมิต
