# รายงาน Passive Reverse Engineering: memzo.ai (Memzo)

**วันที่วิเคราะห์:** 2026-10-18
**ขอบเขต:** Static analysis ของไฟล์ public ที่ดาวน์โหลดมาเท่านั้น (HTML/JS ของหน้าเว็บสาธารณะ) — ไม่มีการโจมตี ไม่มีการล็อกอิน ไม่มีการเรียก API จริง
**คู่แข่งทางการค้า:** Memzo (Oneglint Media Solutions Pvt Ltd, Hyderabad อินเดีย) — แพลตฟอร์มแชร์รูปงานอีเวนต์ด้วย Face Recognition

## วิธีวิเคราะห์

- ดาวน์โหลด `index.html`, `pricing`, `faq`, `terms`, `privacy-policy`, `share-wedding-photos`, `adminapp/login.php` (redirect จาก `/create-event`) และ JS ฝั่ง product (`app.js`, `authentication-main.js`, `memzo-passkey.js`, `show-password.js`)
- รัน `npx -y rea-agents@6.3.0 analyze-javascript-application` **สำเร็จ** (exit 0): parse JS 5 ไฟล์, AST nodes 7,500, findings 165, semantic relations 3,846 → `analysis.json`
- สิ่งที่พบสำคัญ: **เว็บเป็น PHP server-rendered (ไม่มี SPA bundle ใหญ่)** — frontend เป็น jQuery + Bootstrap theme สำเร็จรูป (ThemeTags/Ultraland, ดู `assets/app.js`) ข้อมูล product จริงจึงอยู่ใน HTML inline script + ข้อความ marketing/FAQ มากกว่าใน bundle ส่วนวิเคราะห์เชิงลึกใช้ grep ประกอบ

---

## (ก) ฟีเจอร์ที่เห็นจากไฟล์ public

**ฝั่งแขก (guest):**
- เปิดลิงก์อีเวนต์ → กดไอคอนกล้อง → ถ่าย selfie → เจอรูปตัวเองในไม่กี่วินาที (FAQ: "Guests open the event page, click a selfie and instantly find all their photos")
- **Liveliness detection** — กันใช้รูปมาแทนหน้า (หน้า index: "live selfie and liveliness feature")
- อีเวนต์เป็น invite-only + ป้องกันด้วยรหัสผ่าน (page-share-wedding-photos)
- ดู / ซื้อ / ดาวน์โหลด / แชร์รูปได้จากหน้าเดียว ไม่ต้องติดตั้งแอป (works on any browser)
- ยืนยันตัวตนผ่าน **OTP ทาง WhatsApp/SMS** (FAQ กล่าวถึง DND / WhatsApp privacy settings บล็อก OTP) + มีระบบ flash-call สำรอง

**ฝั่งช่างภาพ/ผู้จัด (organizer):**
- สร้างอีเวนต์ 3 ขั้นตอน (`/create-event` → บังคับ login)
- อัปโหลดตรงจากเครื่อง **หรือ** วาง Google Drive link ให้ระบบดึงผ่าน Drive API (แนะนำ "one go", อัปโหลดเป็น batch มีปัญหารูปซ้ำ)
- ระบบ **ข้ามรูปซ้ำอัตโนมัติ** ตอนอัปโหลด
- เลือกรูป highlight, เพิ่ม/ลบรูป, คุมสิทธิ์ผู้เข้าถึงจาก dashboard
- **Event engagement analytics** (ดูว่ามีคนเข้างานกี่คน)
- **ขายรูป** ให้แขกได้ (commission 0%), รับเงินผ่าน Owner Revenue (ลิงก์บัญชีธนาคาร / ขอ manual transfer ได้ 7 วันหลังขาย)
- Add-on **บริการสั่งพิมพ์/ของที่ระลึก** — ต้องอีเมลขอเปิด
- Branding/สปอนเซอร์, white-label URL (แพ็กเกจสูง), website integration (ติดต่ออีเมลเท่านั้น)
- โมบายล์แอปคู่แบรนด์ "Snapwrap" (App Store / Play Store)

**ตัวเลขที่เว็บอ้าง:** FR accuracy 99.3%, 10,000+ events, 90+ ประเทศ (`data-counter` ใน page-share-wedding-photos / index)

---

## (ข) API / design ที่ตรวจได้ (พร้อม evidence)

**สถาปัตยกรรม:** PHP server-rendered + jQuery/Bootstrap — ไม่ใช่ SPA
- `page-adminapp-login.html`: `var_adminapp_controllers_path = "https://live.memzo.ai/adminapp/src/controllers/"`
- Marketing ที่ `memzo.ai`, แอปจริงที่ `live.memzo.ai`

**Auth endpoints (จาก inline script ใน `page-adminapp-login.html`):**

| Endpoint (ท้าย `adminapp/src/controllers/`) | หน้าที่ |
|---|---|
| `login_with_password.php` | ล็อกอินรหัสผ่าน |
| `login_send_otp.php` / `login_with_otp.php` | OTP login |
| `login_signup_send_otp.php` / `login_signup_verify_otp.php` | สมัคร + ยืนยัน OTP |
| `login_signup_send_flash_call_otp.php` / `login_signup_verify_flash_call_otp.php` | ยืนยันผ่าน flash-call |
| `login_reset_password_verify.php`, `login_remember_me.php` | ลืมรหัสผ่าน / จำฉันไว้ |
| `login_passkey_{finish,register_options,register_verify,status}.php` | WebAuthn passkey |
| `/helpers/services/web-auth/index.php?action=login_options\|register_options\|register_verify` | passkey API (`assets/admin-memzo-passkey.js:185,713,747,761`) |
| `/helpers/services/flash-call/index.php` | flash-call service |
| `api_website_getintouch.php` | ฟอร์มติดต่อ (index.html, page-pricing.html) |
| `user_preferences_menu_collapse.php` | บันทึก UI state |

- Captcha: **Cloudflare Turnstile** ทุกหน้า (`challenges.cloudflare.com/turnstile`)
- Login มี Google sign-in + passkey (Touch ID) (`assets/admin-memzo-passkey.js`)

**โครงสร้าง plan/pricing (inline script ใน `page-pricing.html:1730-1900`):**
- แพ็กเกจ: `Basic`, `Pro`, `Pay Per Use`, `Enterprise` — `plan_type` 1=รายเดือน 2=รายปี 3=custom
- ฟิลด์ลิมิตใน schema: **`credits`** (จำนวนรูป/เดือน), **`max_profiles`** ("Guests per Event"), **`max_face_search`** ("Faces search per Event"), **`collaborators_limit`**
- CTA: "Start 14-day Free Trial" พร้อมข้อความ **"Credit card required to try"**; ปุ่มพาไป `live.memzo.ai/app/login?plan_id=<base64>`

**Tech stack / บุคคลที่สาม (page-privacy-policy.html, page-terms.html):**
- เก็บรูปบน **AWS S3** + **facial vector storage บน AWS**, CDN ผ่าน **DigitalOcean**
- ชำระเงิน **Razorpay / Stripe**; OTP/WhatsApp ผ่าน **Wati, Sinch, Twilio, MSG91**; อีเมล **SendGrid**
- Tracking: **Google Analytics, Microsoft Clarity, Instana EUM**, แช็ต **Tidio**
- Google Maps API key ฝังใน index.html (`AIzaSyDk2...`)

---

## (ค) ข้อด้อย / ข้อจำกัดของ Memzo

1. **คิดเงินต่อรูป 3¢ (USD 0.03)** — งานแต่ง 3,000 รูป = $90, 10,000 รูป = $300; ต้องเติมเครดิต wallet ก่อนอัปโหลด และ **ไม่จ่าย = ไม่เปิด face recognition** ("activate full access" หลังจ่ายเท่านั้น) — แขกหาเฉพาะ "First 300 photos free / 1 GB"
2. **รูป + biometric vectors เก็บบนคลาวด์ของเขา** (AWS + DigitalOcean CDN) พร้อม GA/Clarity tracking — ช่างภาพที่อ่อนไหวเรื่องข้อมูลลูกค้าไม่มีทางเลือก self-host
3. **อายุข้อมูลจำกัด 2 ปี** (หรือหมดอายุตาม subscription) แล้วลบ; มีเงื่อนไข "จ่ายแล้วไม่คืนเงิน" สำหรับ digital unlocks (page-terms.html)
4. **ไฟล์ต้นฉบับไม่ถูกเก็บ** — รูปถูก **resize เหลือ 4K (3840×2160)** ทุกรูป: ช่างภาพที่ถ่าย 8K/RAW workflow เสีย resolution ถาวร
5. **อัปโหลดไม่สด** — ทางเดียวคือ browser upload หรือวาง Google Drive link (docs แนะนำทำ "ในครั้งเดียว", batch ซ้ำซ้อนได้): แขกดูระหว่างงานสดไม่ได้ ต้องรออัปโหลดเสร็จ + จ่ายเครดิตก่อน
6. **แขกคนละระดับประเทศต้อง OTP/WhatsApp** — ในงานแต่งที่สัญญาณแย่/แขกต่างชาติ OTP ไม่เข้า (FAQ ต้องวิธีแก้ DND); organizer เจอ Turnstile + login wall ตั้งแต่คลิก create-event
7. **แผน subscription มีลิมิตแอบแฝง** — schema มี `max_profiles` (จำกัดแขก/อีเวนต์) และ `max_face_search` (จำกัดจำนวนค้นหา/อีเวนต์) ขัดกับโฆษณา "Unlimited Guests"
8. **ไม่มี QR code ใน public surface** — แชร์ผ่านลิงก์/เว็บ integrate เท่านั้น
9. **FR ไม่รองรับวิดีโอ** — วิดีโอแค่ embed ลิงก์สาธารณะ (Drive/YouTube/Vimeo)
10. **Watermark/branding เป็นเรื่องแพ็กเกจ** — terms ห้าม "circumvent watermark protection controls"; แบรนด์เต็มรูปแบบ/white-label เฉพาะ Pro/Enterprise; งานแต่งจึงมีแบรนด์ Memzo ติดมาด้วย
11. **ระบบขายรูป:** เงินต้องรอ settlement 7 วัน (manual ในหลายประเทศ), แลกเงินตาม currency ที่เขาซัพพอร์ต
12. **พึ่งพา vendor 3rd-party เยอะ** (Twilio/Wati/SendGrid/Stripe/Razorpay) — single point of failure และต้นทุนแฝง

---

## (ง) 5 จุดที่แอปเรา (self-hosted wedding drive) ทำได้ดีกว่า

1. **ครอบครองข้อมูล 100%** — ไฟล์อยู่เครื่องช่างภาพ/NAS ของลูกค้าเอง ไม่มีรูปหรือ face vector ขึ้นคลาวด์คนอื่น ไม่มี GA/Clarity tracking ในหน้าแขก (Memzo: AWS + DO CDN + analytics หลายตัว)
2. **ไม่มีค่าใช้จ่ายต่อรูป/ไม่มี wallet ไม่มี credit card** — งาน 50,000 รูปก็ราคาเดิม ไม่มีจุด "ไม่จ่ายไม่เปิด FR" ให้แขกเจอ (Memzo: $0.03 × จำนวนรูป, บังคับ activate หลังชำระ)
3. **Live sync จากเครื่องช่างภาพระหว่างงาน** — แขกสแกน QR ตอนเข้างานแล้วดูรูปใหม่ได้ตลอดคืน (Memzo: batch upload หลังงานเท่านั้น, Drive import แนะนำ one-go)
4. **ไฟล์ original เต็ม resolution + ไม่มีลายน้ำ + ไม่หมดอายุ** — เก็บ RAW/8K ต้นฉบับถาวรตามที่ลูกค้าต้องการ (Memzo: resize เป็น 4K, ลบทิ้งใน 2 ปี, watermark/branding ติดแพ็กเกจ)
5. **แขกแค่สแกน QR + ถ่าย selfie จบ** — ไม่ต้องสมัคร ไม่ต้อง OTP/WhatsApp ไม่ต้องเจอ captcha (Memzo: guest flow พันกับ OTP + Turnstile, สร้างงานต้อง login ก่อน)

---

## สรุป 5 ข้อ (stdout)

- **โมเดลราคา:** Memzo คิด 3¢/รูป + wallet เครดิต, ฟรีแค่ 300 รูป/1GB, ไม่จ่าย = ไม่เปิด face recognition — แอปเราไม่มีต้นทุนต่อรูป
- **ข้อมูล:** รูป + face vectors ของ Memzo เก็บบน AWS/DO CDN ของเขา, อายุ 2 ปี, resize เหลือ 4K ทิ้งต้นฉบับ — แอปเราไฟล์อยู่เครื่องตัวเอง ครบ resolution ถาวร
- **ประสบการณ์แขก:** Memzo เป็นลิงก์ + OTP WhatsApp + liveliness — แอปเราแค่สแกน QR ถ่าย selfie จบ ใช้ได้แม้เน็ตงานแย่
- **ความสด:** Memzo อัปโหลด batch หลังงาน (browser/Drive link) — แอปเรา sync สดจากเครื่องช่างภาพ แขกดูระหว่างงานได้
- **หน้าต่างแข่งขัน:** จุดอ่อนที่เอามาใช้ได้เลย = ราคาต่อรูป, ลายน้ำ/branding ตามแพ็กเกจ, login wall, ไม่มี QR, FR ไม่เห็นวิดีโอ, ลิมิตแอบแฝง (max_face_search/max_profiles) ในแผน subscription
