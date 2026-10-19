# Mini Kota — Kota Biasa vs Kota Cerdas

Simulasi edukasi lalu lintas kota dalam 3D (three.js). Satu peta dijalankan dua kali,
berdampingan dan pada waktu yang sama:

- **Kota biasa**: lampu lalu lintas waktu tetap, truk sampah datang terjadwal.
- **Kota cerdas**: lampu adaptif yang membaca CCTV di simpang, truk sampah dipanggil sensor
  tempat sampah, dan jaringan perangkat (LAN, fiber optik, LoRaWAN) ke pusat data.

Hasilnya dibandingkan: waktu antre di jalan dan di pintu masuk kota, BBM terbuang saat idle,
perjalanan selesai, waktu tempuh, perjalanan truk sampah, dan lama tempat sampah penuh.

Peta bisa dibuat sendiri di **editor peta** (gambar jalan, rapikan otomatis, pasang aset,
atur lampu) atau diimpor dari **OpenStreetMap**.

## Menjalankan

```sh
npm install
npm run dev
```

Buka alamat yang ditampilkan terminal (biasanya http://localhost:5173). Jangan membuka
`index.html` langsung dari filesystem. Build produksi: `npm run build`; pratinjau:
`npm run preview`.

| Halaman | Isi |
|---|---|
| `index.html` | Simulasi: tab Perbandingan, Kota biasa, Kota cerdas (dengan perangkat dan jaringannya), Perangkat, Editor peta; panel data center; Jelajahi Kota (mengemudi) |
| `editor-peta.html` | Editor peta lengkap dengan simulasi lalu lintas satu kota |
| `penjelasan.html` | Panduan pengaturan, cara kerja, dan asumsi |
| `desain-teknis.html` | Usulan arsitektur data (gateway, Kafka, Spark, latensi, kapasitas) |
| `diagram-3d.html` | Diagram 3D alur perangkat |
| `aset.html` | Pratinjau semua model 3D |

Navigasi peta cukup dengan mouse: klik kanan + seret putar dan miringkan, klik kiri/tengah +
seret geser, roda zoom ke arah kursor, dobel klik kanan terbang ke titik.

## Struktur kode

| Folder | Isi |
|---|---|
| `src/map/` | Format peta, geometri jalan, editor (sunting, rapikan, penempatan aset), isi aset otomatis, jaringan perangkat, impor OSM, kamera, peta Mini Kota (`mini-kota-data.js`, `default-map.js`) |
| `src/traffic/` | Mesin lalu lintas: graf lajur, kendaraan (IDM, rute, pindah lajur), lampu tetap/adaptif, simpang gabungan, bundaran, angkot, truk sampah, pejalan kaki; tampilan 3D |
| `src/app/` | Aplikasi utama: satu `City` per kota, data center, tab Perangkat, Jelajahi Kota |
| `src/devices.js` | Katalog perangkat untuk desain teknis dan diagram |
| `assets/` | Skrip Blender pembuat model 3D (`npm run assets`); hasilnya di `public/models/` |
| `docs/` | Rancangan editor peta dan gambar per tahap |

## Pengujian

```sh
npm test                    # tes unit (Node)
npm run build && npx vite preview --port 5180 &
npm run test:browser        # semua tes browser (Playwright, tests/*-smoke.mjs)
```

## Riwayat

Branch `v.0` menyimpan versi sebelum migrasi: simulasi lama dengan model penduduk (rumah
tangga, jadwal sif, komuter, parkir) di peta gambar asli, berdampingan dengan editor peta
baru. Di `main` aplikasi seluruhnya memakai peta dan mesin lalu lintas baru. Rancangan dan
hasil uji per tahap ada di `docs/rancangan-editor-peta.md`.
