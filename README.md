# 9Router Custom

Aplikasi router & proxy aggregator model AI (OpenAI, Claude, Gemini, AutoClaw, dll) yang dilengkapi dengan dashboard Next.js dan backend SSE.

---

## 📋 Prasyarat
- **Node.js**: versi 18.x atau yang lebih baru (disarankan Node.js v20+)
- **Package Manager**: `npm` atau `bun`

---

## 🚀 1. Instalasi (Install)

Clone atau buka folder proyek, lalu install seluruh dependensi:

```bash
npm install --legacy-peer-deps
```

*(Jika menggunakan Bun)*:
```bash
bun install
```

---

## 🛠️ 2. Mode Pengembangan (Development)

Untuk menjalankan server dev dengan fitur hot-reload:

```bash
npm run dev
```
Dashboard akan berjalan di: **http://localhost:20127**

---

## 📦 3. Build Production (Build)

Sebelum menjalankan server production standalone, lakukan proses build terlebih dahulu:

```bash
npm run build
```

> **Catatan:** Perintah build di atas otomatis menghasilkan bundle `.next/standalone/` dan menyalin asset statis melalui script `postbuild`.

---

## ⚡ 4. Menjalankan Server Production (Run)

### A. Menjalankan Standalone di Port 20128 (Rekomendasi)

**Windows (PowerShell):**
```powershell
$env:PORT=20128; node .next/standalone/server.js
```

**Windows (Command Prompt / CMD atau double-click `run-20128.bat`):**
```cmd
run-20128.bat
```

**Linux / macOS (Bash):**
```bash
PORT=20128 node .next/standalone/server.js
```

Akses dashboard di browser: **http://localhost:20128**

---

### B. Menjalankan Standalone di Port Default (20127)

```bash
npm start
```
Akses di: **http://localhost:20127**

---

## 🌐 5. Deploy di Server / Background (PM2)

Jika ingin aplikasi berjalan terus di latar belakang (background) di server atau VPS:

```bash
# Install PM2 jika belum ada
npm install -g pm2

# Jalankan server standalone dengan PM2 di port 20128
pm2 start .next/standalone/server.js --name "9router" --env PORT=20128

# Simpan konfigurasi agar auto-restart saat OS reboot
pm2 save
pm2 startup
```

---

## 🔒 Lokasi Data & Konfigurasi

Semua token, akun provider, dan database tersimpan di direktori pengguna (tidak masuk ke dalam repositori Git):
- **Windows:** `%APPDATA%\9router` (`C:\Users\<User>\AppData\Roaming\9router`)
- **Linux / macOS:** `~/.9router`
