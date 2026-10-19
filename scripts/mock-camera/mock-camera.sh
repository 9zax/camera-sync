#!/usr/bin/env bash
# จำลองกล้องที่มี FTP ในตัว (Canon/Nikon/Sony/Fuji) — ส่งรูปเข้า CameraSync
# ผ่าน FTP receiver (:2121) เหมือนหน้างานจริง รันเป็น container แยกตัว
#
# ใช้งาน:  ./scripts/mock-camera/mock-camera.sh [จำนวนรอบ] [ห่างกันกี่วินาที]
#   ค่าปกติ: 3 รอบ ทุก 4 วินาที (รอบละ 3 รูป = 9 รูป)
#
# ปลายทางปรับได้ด้วย env (ปกติชี้ที่เครื่องตัวเอง):
#   CAMERA_FTP_HOST (host.docker.internal) · CAMERA_FTP_PORT (2121)
#   CAMERA_FTP_USER (camera) · CAMERA_FTP_PASS (อ่านจาก ~/.camerasync/ftp-creds.json)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROUNDS="${1:-3}"
EVERY="${2:-4}"

HOST="${CAMERA_FTP_HOST:-host.docker.internal}"
PORT="${CAMERA_FTP_PORT:-2121}"
USER="${CAMERA_FTP_USER:-camera}"
PASS="${CAMERA_FTP_PASS:-$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.camerasync/ftp-creds.json')))['pass'])")}"

echo "◎ Mock camera → ftp://$USER@$HOST:$PORT (รอบ $ROUNDS × ทุก $EVERY วิ)"
docker run --rm --pull=missing \
  -v "$HERE/photos":/photos:ro \
  -e HOST="$HOST" -e PORT="$PORT" -e FUSER="$USER" -e FPASS="$PASS" \
  -e ROUNDS="$ROUNDS" -e EVERY="$EVERY" \
  alpine:3.20 sh -eu -c '
    apk add --no-cache lftp >/dev/null 2>&1
    i=0
    while [ "$i" -lt "$ROUNDS" ]; do
      for f in /photos/*.jpg; do
        name="CAM_r$((i+1))_$(date +%H%M%S)_$(basename "$f")"
        printf "  📷 [lftp] STOR %s … " "$name"
        # real FTP client: login → PASV → STOR, like a camera does
        lftp -u "$FUSER","$FPASS" "$HOST:$PORT" \
          -e "set ftp:passive-mode on; set ftp:nop-interval 5; put -O / "$f" -o "$name"; quit" \
          >/dev/null 2>&1 && echo "OK (226)"
      done
      i=$((i+1)); [ "$i" -lt "$ROUNDS" ] && sleep "$EVERY"
    done
    echo "◎ mock camera จบการทำงาน (FTP client: lftp)"
  '
