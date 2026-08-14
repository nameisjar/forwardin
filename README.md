# Autosender Backend

Backend API untuk Autosender, dibangun menggunakan Express, TypeScript, Prisma,
PostgreSQL, Socket.IO, dan Baileys. Service ini menangani autentikasi, perangkat
WhatsApp, kontak dan grup, Inbox, broadcast, reminder, feedback, riwayat pesan,
serta pembuatan PDF.

README ini ditujukan sebagai panduan instalasi ulang untuk development maupun
production. Jangan menaruh password, token, atau encryption key asli di README
dan repository.

## Daftar isi

- [Persyaratan](#persyaratan)
- [Instalasi development](#instalasi-development)
- [Konfigurasi environment](#konfigurasi-environment)
- [Menyiapkan PostgreSQL](#menyiapkan-postgresql)
- [Prisma dan database](#prisma-dan-database)
- [Menjalankan backend](#menjalankan-backend)
- [Enkripsi session dan pesan](#enkripsi-session-dan-pesan)
- [Migrasi pesan lama](#migrasi-pesan-lama)
- [Testing dan pemeriksaan kode](#testing-dan-pemeriksaan-kode)
- [Deployment production](#deployment-production)
- [Data yang harus dipersistenkan](#data-yang-harus-dipersistenkan)
- [Troubleshooting](#troubleshooting)

## Persyaratan

- Node.js 22 LTS. Proyek saat ini diuji menggunakan Node.js 22.
- npm dan `package-lock.json`.
- PostgreSQL, atau Docker + Docker Compose untuk menjalankan PostgreSQL lokal.
- Git.
- Dependency sistem Chromium/Puppeteer jika fitur PDF dijalankan pada Linux.

Periksa versi:

```bash
node --version
npm --version
docker --version
```

## Instalasi development

Jalankan dari folder backend ini, yaitu folder yang memiliki `package.json`,
`prisma`, `scripts`, dan `src`.

### Linux/macOS

```bash
git clone <URL_REPOSITORY>
cd <FOLDER_REPOSITORY>/forwardin
npm ci
cp .env.example .env
```

### Windows PowerShell

```powershell
git clone <URL_REPOSITORY>
Set-Location <FOLDER_REPOSITORY>\forwardin
npm.cmd ci
Copy-Item .env.example .env
```

Setelah itu, isi `.env`, hidupkan PostgreSQL, jalankan migration Prisma, lalu
build backend sebagaimana dijelaskan di bagian berikutnya.

## Konfigurasi environment

Gunakan `.env.example` sebagai sumber nama variabel. File `.env*` selain
`.env.example` sudah diabaikan Git. Jangan commit `.env`.

Contoh minimum untuk development lokal:

```env
HOST=localhost
PORT=3000
BASE_URL=http://localhost:3000
NODE_ENV=development

POSTGRES_DB=autosender
POSTGRES_USER=autosender
POSTGRES_PASSWORD=<PASSWORD_DATABASE_LOKAL>
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}

JWT_SECRET_KEY=<RANDOM_SECRET>

SESSION_ENCRYPTION_KEY=<RANDOM_64_HEX>
SESSION_ENCRYPTION_ENABLED=true

MESSAGE_ENCRYPTION_KEY=<RANDOM_64_HEX_YANG_BERBEDA>
MESSAGE_ENCRYPTION_KEY_ID=primary
MESSAGE_ENCRYPTION_ENABLED=true
MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON=

SUPER_ADMIN_ID=1
ADMIN_ID=2
CS_ID=3

CLIENT_URL1=http://localhost:5173
CLIENT_URL2=
URL_PROD=http://localhost:5173
```

`SESSION_ENCRYPTION_KEY` dan `MESSAGE_ENCRYPTION_KEY` harus berbeda. Buat key
32-byte dalam format 64 karakter hexadecimal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Jalankan perintah tersebut secara terpisah untuk setiap key. Buat juga
`JWT_SECRET_KEY` acak dan kuat.

### Variabel utama

| Variabel | Keterangan |
| --- | --- |
| `HOST`, `PORT` | Host dan port HTTP backend. Default aplikasi adalah `0.0.0.0:3000` jika tidak diisi. |
| `BASE_URL` | URL publik backend. Gunakan HTTPS di production. |
| `DATABASE_URL` | Connection string PostgreSQL yang digunakan Prisma. |
| `JWT_SECRET_KEY` | Secret untuk token autentikasi. |
| `CLIENT_URL1`, `CLIENT_URL2` | Origin frontend yang diizinkan oleh CORS, tanpa trailing slash. |
| `SESSION_ENCRYPTION_KEY` | Key AES untuk credential session WhatsApp. |
| `MESSAGE_ENCRYPTION_KEY` | Key AES terpisah untuk isi pesan. Wajib di production. |
| `MESSAGE_ENCRYPTION_KEY_ID` | Identitas key aktif, awalnya `primary`. |
| `MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON` | Daftar key lama saat rotasi agar ciphertext lama tetap dapat dibaca. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Opsional, diperlukan untuk integrasi Google. |
| `NODEMAILER_EMAIL`, `NODEMAILER_PASSWORD` | Opsional, diperlukan untuk pengiriman email. Gunakan app password. |
| `MIDTRANS_KEY` | Opsional, diperlukan jika integrasi pembayaran dipakai. |

Variabel delay broadcast dan rate limit sudah memiliki contoh di `.env.example`.
Pertahankan nilai awal terlebih dahulu dan ubah hanya setelah memahami efeknya.

> Semua variabel `VITE_*` adalah milik frontend dan tidak boleh dipakai untuk
> menyimpan secret backend.

## Menyiapkan PostgreSQL

### Opsi A — Docker Compose

`docker-compose.yml` di proyek ini hanya menjalankan PostgreSQL. Backend tetap
dijalankan dari host/VPS.

```bash
docker compose up -d postgres
docker compose ps
```

Windows PowerShell menggunakan perintah yang sama jika Docker Desktop sudah
aktif:

```powershell
docker compose up -d postgres
docker compose ps
```

Data PostgreSQL disimpan dalam volume `postgres-data`. Jangan menghapus volume
tersebut tanpa backup.

Untuk menghentikan container tanpa menghapus data:

```bash
docker compose stop postgres
```

### Opsi B — PostgreSQL eksternal

Buat database dan user PostgreSQL, lalu isi `DATABASE_URL` dengan credential
tersebut. Pastikan server backend dapat mengakses host dan port database.
Gunakan koneksi TLS jika database berada di jaringan lain.

## Prisma dan database

Generate Prisma Client:

```bash
npx prisma generate
```

Untuk database development:

```bash
npx prisma migrate dev
```

Untuk database production atau database baru yang harus mengikuti seluruh
migration yang sudah tersimpan:

```bash
npx prisma migrate deploy
```

Periksa status migration:

```bash
npx prisma migrate status
```

Windows dapat menggunakan `npx.cmd` apabila PowerShell memblokir `npx.ps1`:

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate deploy
```

Migration `20260814150000_add_conversation_summary` membuat dan mengisi tabel
ringkasan Inbox `Conversation` secara otomatis. Trigger database kemudian menjaga
jumlah pesan, unread count, serta pesan terakhir tetap sinkron untuk semua jalur
pengiriman dan penerimaan.

Jika ringkasan perlu diperiksa atau dibangun ulang setelah pemulihan database,
jalankan rekonsiliasi berikut setelah migration selesai:

```bash
npm run rebuild:conversations
```

Perintah tersebut aman dijalankan ulang dan tidak mengubah isi
`IncomingMessage` maupun `OutgoingMessage`.

### Seeder

Seeder utama saat ini menghapus data subscription plan, privilege, dan user,
kemudian membuat akun contoh dengan password yang diketahui. Oleh karena itu:

> Jangan menjalankan `npx prisma db seed` pada production atau database yang
> sudah berisi data.

Seeder hanya boleh digunakan untuk database development kosong:

```bash
npx prisma db seed
```

Setelah seed lokal, segera ganti password akun contoh jika database tersebut
akan digunakan lebih lama.

## Menjalankan backend

### Development

Script `dev` menjalankan entry point dari `dist`. Karena itu build TypeScript
terlebih dahulu:

```bash
npm run build
npm run dev
```

Setelah mengubah source TypeScript, jalankan `npm run build` kembali. Untuk
menjalankan hasil build tanpa Nodemon:

```bash
npm start
```

Windows PowerShell:

```powershell
npm.cmd run build
npm.cmd run dev
```

Backend normalnya tersedia di `http://localhost:3000`. Periksa health endpoint:

```bash
curl http://localhost:3000/health
```

Respons sehat memiliki `status: "ok"`.

## Enkripsi session dan pesan

### Aturan penting

- Jangan pernah mengganti atau kehilangan `SESSION_ENCRYPTION_KEY` pada instalasi lama.
- Jangan pernah mengganti `MESSAGE_ENCRYPTION_KEY` tanpa prosedur rotasi.
- Simpan backup kedua key di secret manager atau password manager terpisah dari database.
- Kehilangan key berarti data yang memakai key tersebut tidak dapat didekripsi.
- Production akan menolak menyala jika enkripsi pesan tidak dikonfigurasi dengan benar.

Pesan baru menggunakan format berversi dan key ID. Saat melakukan rotasi key
pesan, gunakan ID baru dan simpan key sebelumnya:

```env
MESSAGE_ENCRYPTION_KEY=<KEY_BARU>
MESSAGE_ENCRYPTION_KEY_ID=v2
MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON={"primary":"<KEY_LAMA>"}
```

Setelah semua data berhasil dienkripsi ulang dengan key baru dan backup lama
tidak lagi membutuhkan key sebelumnya, barulah key lama dapat dipensiunkan.

## Migrasi pesan lama

Migration ini mengubah isi pesan plaintext atau ciphertext legacy `enc:v1`
menjadi format pesan terbaru. Lakukan setelah membuat backup database.

Urutan yang disarankan:

1. Pastikan `SESSION_ENCRYPTION_KEY` lama masih benar.
2. Isi `MESSAGE_ENCRYPTION_KEY`, `MESSAGE_ENCRYPTION_KEY_ID`, dan
   `MESSAGE_ENCRYPTION_ENABLED=true`.
3. Hentikan sementara backend dan worker agar tidak ada pesan baru selama migrasi.
4. Jalankan dry-run.
5. Jalankan migrasi sebenarnya jika dry-run tidak memiliki error.
6. Nyalakan kembali backend dan periksa `/health` serta Inbox.

Linux/macOS:

```bash
./node_modules/.bin/ts-node scripts/migrate-encrypt-messages.ts --dry-run --batch=250
./node_modules/.bin/ts-node scripts/migrate-encrypt-messages.ts --batch=250
```

Windows PowerShell:

```powershell
node_modules\.bin\ts-node.cmd scripts\migrate-encrypt-messages.ts --dry-run --batch=250
node_modules\.bin\ts-node.cmd scripts\migrate-encrypt-messages.ts --batch=250
```

Jangan menjalankan perintah kedua apabila dry-run menampilkan error dekripsi.
Jangan membuat key baru untuk mengatasi error tersebut; periksa kembali key lama
dan backup database.

## Testing dan pemeriksaan kode

Build TypeScript:

```bash
npm run build
```

Tes dijalankan terhadap file JavaScript hasil build, sehingga build harus sukses
lebih dahulu:

```bash
npm run build
npm test
```

Perintah kualitas kode:

```bash
npm run lint:check
npm run format:check
```

Beberapa integration test membutuhkan database test yang bersih dan konfigurasi
environment yang lengkap. Jangan arahkan test ke database production.

## Deployment production

Urutan umum pada VPS/server:

```bash
cd /lokasi/aplikasi/forwardin
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm start
```

Gunakan process manager seperti systemd atau PM2 agar service otomatis hidup
kembali. Jalankan hanya satu instance scheduler kecuali arsitektur job sudah
diubah untuk mendukung beberapa replica.

Checklist production:

- `NODE_ENV=production`.
- `BASE_URL` menggunakan HTTPS dan domain backend yang benar.
- `CLIENT_URL1`/`CLIENT_URL2` berisi origin frontend yang tepat.
- `DATABASE_URL` mengarah ke database production dan menggunakan TLS bila diperlukan.
- `JWT_SECRET_KEY`, session key, dan message key merupakan secret acak yang berbeda.
- Database dan encryption key sudah dibackup.
- `npx prisma migrate deploy` berhasil.
- `npm run build` berhasil.
- Reverse proxy meneruskan HTTP dan WebSocket/Socket.IO.
- Firewall hanya membuka port yang diperlukan.
- Endpoint `/health` memberikan respons sehat.
- Isi `.env`, token, dan key tidak tercatat dalam log atau repository.

Jika production memakai reverse proxy, backend dapat tetap mendengarkan pada
port internal 3000. Terminasi TLS dilakukan oleh Nginx, Caddy, Cloudflare, atau
load balancer, dan trafik ke backend tetap harus dibatasi.

## Data yang harus dipersistenkan

Pastikan backup dan deployment mempertahankan:

- Database PostgreSQL.
- Encryption key dan secret production.
- Folder media yang dipakai untuk lampiran Inbox/broadcast.
- Asset/template yang diperlukan saat build dan pembuatan PDF.

Folder `dist` dapat dibuat ulang menggunakan `npm run build`, sedangkan
`node_modules` dapat dibuat ulang menggunakan `npm ci`.

## Troubleshooting

### Backend tidak bisa terhubung ke PostgreSQL

- Periksa `DATABASE_URL`, host, port, user, password, dan nama database.
- Jalankan `docker compose ps` jika memakai Docker.
- Jalankan `npx prisma migrate status` untuk menguji akses Prisma.

### PowerShell menolak `npm.ps1` atau `npx.ps1`

Gunakan executable `.cmd`:

```powershell
npm.cmd run build
npx.cmd prisma migrate deploy
```

### Frontend terkena CORS

- Pastikan `CLIENT_URL1` sama persis dengan origin frontend.
- Jangan menambahkan trailing slash.
- Restart backend setelah mengubah `.env`.

### Pesan atau session gagal didekripsi

- Jangan mengganti key lagi.
- Pastikan key production lama tersedia dan tidak memiliki spasi tambahan.
- Periksa `MESSAGE_ENCRYPTION_KEY_ID` dan
  `MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON` saat rotasi.
- Pulihkan backup jika key yang benar tidak dapat ditemukan.

### Device WhatsApp meminta pairing ulang

- Pastikan database session dan `SESSION_ENCRYPTION_KEY` masih sama.
- Periksa status device serta log disconnect.
- Lakukan pairing ulang dari menu Device jika session memang sudah logout.

### PDF/Puppeteer gagal di Linux

Pastikan dependency sistem Chromium tersedia, memory server mencukupi, dan
filesystem tempat temporary file dapat ditulis oleh user service.

### Port 3000 sudah digunakan

Ubah `PORT` atau hentikan proses lama. Pastikan tidak ada dua backend yang
mengelola session WhatsApp yang sama secara bersamaan.
