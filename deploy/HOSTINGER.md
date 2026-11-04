> **Jalur alternatif (GHCR, `compose.prod.yaml`, `deploy.sh`) sudah tidak dipakai.** Server yang berjalan memakai `compose.hostinger.yaml` dan workflow `Deploy to Hostinger` yang mengirim kode lewat SSH; lihat [HOSTINGER-DOCKER-MANAGER.md](HOSTINGER-DOCKER-MANAGER.md). Dokumen ini hanya referensi bila nanti pindah ke GHCR.

# Deploy to the Hostinger VPS (runbook)

Satu VPS, dua container (`app` dan `db`), Caddy di host untuk HTTPS. Image dibangun di GitHub Actions dan ditarik dari GHCR. Keputusan: D-065.
Setelah deploy pertama, jalankan [deployment/SECURITY_CHECKLIST.md](../deployment/SECURITY_CHECKLIST.md).

## Satu kali di VPS

Sebagai root (atau user admin dengan sudo):

1. Folder kerja, milik user `deploy`; folder backup milik uid 1000 (user `node` di dalam image):

   ```bash
   mkdir -p /opt/halcom/backups /opt/halcom/predeploy && chown -R deploy:deploy /opt/halcom && chown 1000:1000 /opt/halcom/backups
   ```

2. Berkas rahasia. Salin `deploy/production.env.example` ke `/opt/halcom/.env`, isi, lalu `chmod 600` dan `chown deploy:deploy`.
   Kata sandi database: `openssl rand -hex 24`. `APP_BASE_URL` berisi alamat HTTPS publik.
3. Pasang Caddy dari repositori apt resmi Caddy, lalu salin `deploy/Caddyfile` ke `/etc/caddy/Caddyfile` (ganti `halcom.example.com` dengan domain Anda) dan `systemctl reload caddy`.
   DNS (A record domain ke IP VPS) harus sudah menunjuk ke VPS, kalau tidak Caddy gagal menerbitkan sertifikat.
4. Firewall hanya 22, 80, 443 (`ufw status`).

## Satu kali di GitHub (repo organization)

**Settings → Environments → New environment: `production`**
- Required reviewers: minimal satu orang selain pembuat run (tim `ops`).
- Secrets di environment ini (bukan secret repo):

| Secret | Isi |
|---|---|
| `VPS_HOST` | alamat IP atau nama host VPS |
| `VPS_USER` | `deploy` |
| `VPS_PORT` | opsional, bawaan 22 |
| `VPS_SSH_KEY` | kunci **privat** khusus CI (bukan kunci pribadi Anda) |
| `VPS_KNOWN_HOSTS` | baris host key VPS yang dipin (lihat di bawah) |

Kunci CI dibuat di komputer Anda, tanpa passphrase karena dipakai mesin:

```bash
ssh-keygen -t ed25519 -f halcom_ci -N "" -C "github-actions-deploy"
```

Isi `halcom_ci.pub` ditambahkan sebagai satu baris di `/home/deploy/.ssh/authorized_keys` di VPS, dan isi `halcom_ci` (privat) menjadi secret `VPS_SSH_KEY`. Setelah itu hapus `halcom_ci` dari komputer.

`VPS_KNOWN_HOSTS`: di VPS jalankan `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` dan catat sidik jarinya. Dari komputer lain:

```bash
ssh-keyscan -t ed25519 ALAMAT_IP_VPS
```

Pastikan sidik jari hasil `ssh-keyscan` sama dengan yang dicatat, lalu tempel barisnya sebagai secret.

**Settings → Actions → General:** izinkan hanya action yang dipilih, dan workflow permissions bawaan "Read".
**Paket GHCR** (setelah build pertama): pastikan paket `halcom-dashboard` dan `halcom-dashboard-migrate` tertaut ke repo dan Actions repo ini boleh membacanya (Package settings → Manage Actions access).

## Deploy

GitHub → **Actions → Deploy to Hostinger → Run workflow** (branch atau SHA, bawaan `main`). Alur:

1. `image`: membangun image `app` dan `migrator` untuk `linux/amd64` dan mengirimnya ke `ghcr.io/<org>/<repo>` dengan tag SHA commit 12 karakter.
2. Persetujuan reviewer di environment `production`.
3. `deploy`: menyalin `compose.prod.yaml` dan `deploy.sh`, login GHCR di VPS memakai token job yang berumur pendek, lalu menjalankan `deploy.sh`.
4. `deploy.sh`: tarik image, nyalakan `db`, **dump sebelum migrasi** (`/opt/halcom/predeploy`, 10 terbaru), `prisma migrate deploy`, nyalakan `app`, tunggu `/api/health`.
   Jika tidak sehat, image sebelumnya dipasang lagi. Migrasi database **tidak** dibatalkan otomatis: pulihkan dari dump `predeploy` bila migrasi penyebabnya.

Deploy pertama berjalan pada database kosong, jadi belum ada akun untuk masuk. **Image produksi tidak memuat skrip `db:bootstrap-superadmin`**
(skrip itu butuh `tsx` dan kode sumber, yang tidak ikut di image `runner` maupun `migrator`). Jalur yang saya sarankan: pulihkan dump dari Neon
(yang sudah berisi akun dan data sungguhan) ke database VPS setelah deploy pertama, lalu masuk dengan akun yang ada:

```bash
cat dump-neon.dump | docker compose -f /opt/halcom/compose.prod.yaml exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Jika ingin database benar-benar baru, butuh target image `tools` tambahan (kode sumber + `tsx`) untuk menjalankan skrip itu; itu belum dibuat.

## Mengecek dan memulihkan

- Status: `docker compose -f /opt/halcom/compose.prod.yaml ps` dan `curl -fsS http://127.0.0.1:3000/api/health` di VPS.
- Log: `docker compose -f /opt/halcom/compose.prod.yaml logs --tail 100 app`.
- Versi yang berjalan: `cat /opt/halcom/.last_good_tag`.
- Kembali ke versi sebelumnya (tanpa migrasi baru): jalankan workflow lagi dengan SHA lama pada input `ref`.
- Pulihkan dump ke database kosong: `pg_restore --clean --if-exists --no-owner -d <db> <berkas.dump>` (di dalam container `db`).

## Belum ada di sini

Backup malam ke Neon, tombol Unduh backup, dan pengaturan tim GitHub (CODEOWNERS, ruleset `main`). Lihat rencana di D-065.
