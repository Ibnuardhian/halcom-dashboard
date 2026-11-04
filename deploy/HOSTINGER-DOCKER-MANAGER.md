# Deploy lewat Docker Manager Hostinger (jalur sementara)

Tujuan: aplikasi bisa dibuka lewat domain dengan HTTPS. Image dibangun di VPS dari repositori GitHub, tanpa GHCR dan tanpa GitHub Actions.
Jalur penuh (backup sebelum migrasi, health check, rollback) tetap di [HOSTINGER.md](HOSTINGER.md).

## Sebelum mulai

1. A record domain sudah menunjuk ke IP VPS. Port 80 dan 443 terbuka (`ufw allow 80,443/tcp`) dan tidak dipakai Caddy atau nginx lain di host.
2. Token GitHub baca-saja: GitHub → Settings → Developer settings → Fine-grained tokens. Hanya repositori `halcom-solutions/halcom-dashboard`, izin **Contents: Read-only**, masa berlaku pendek.
   (Untuk repositori organization, owner org mungkin harus menyetujui token.)
3. Branch yang berisi berkas ini harus sudah di GitHub (`development`).

## Di hPanel → VPS → Docker Manager → Compose

Isi YAML dengan `deploy/compose.hostinger.yaml` (tempel isinya, atau URL raw-nya), lalu isi variabel:

| Variabel | Isi |
|---|---|
| `DOMAIN` | mis. `halcom.example.com` (tanpa `https://`) |
| `GIT_TOKEN` | token baca-saja di atas |
| `GIT_REF` | `development` (bawaan `main`) |
| `POSTGRES_USER` | `halcom` |
| `POSTGRES_PASSWORD` | acak, hanya `A-Za-z0-9-_.~` (`openssl rand -hex 24`) |
| `POSTGRES_DB` | `halcom` |
| `EMAIL_TO_*`, `EMAIL_CC_*` | opsional |

Deploy. Build pertama beberapa menit. Urutan: `db` sehat → `migrate` jalan sekali → `app` → `caddy`.
Caddy menerbitkan sertifikat saat pertama diakses; kalau DNS belum benar, lihat lognya (`caddy`).

## Akun pertama

Database baru kosong dan image produksi tidak memuat `db:bootstrap-superadmin`. Pulihkan dump dari Neon (lihat HOSTINGER.md) atau minta target image `tools`.

## Batas jalur ini

- Tidak ada backup otomatis sebelum migrasi dan tidak ada rollback. Ambil dump manual sebelum memperbarui:
  `docker exec <container db> pg_dump -U halcom -Fc halcom > pra-update.dump`.
- Memperbarui: di Docker Manager bangun ulang proyek (build tanpa cache bila perlu). Migrasi baru ikut jalan lewat `migrate`.
- `GIT_TOKEN` terlihat di pengaturan proyek dan riwayat build. Cabut tokennya bila pindah ke jalur GHCR.
- Jangan jalankan jalur ini bersamaan dengan `compose.prod.yaml` di VPS yang sama (nama proyek dan port sama).
