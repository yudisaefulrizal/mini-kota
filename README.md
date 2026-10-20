# Smart City Digital Twin

Coba langsung: https://smart-city.nuscode.id/

Rancangan digital twin untuk kota cerdas: replika virtual kota yang terhubung dengan data sensor
untuk dipantau, dipelajari, dan dioptimalkan.

## Fitur

Tersedia:

- Kota konvensional dan kota cerdas berdampingan pada peta yang sama dalam 3D, dibandingkan dari
  waktu antre, BBM terbuang saat idle, waktu tempuh, dan indikator lainnya.
- Lampu lalu lintas adaptif yang membaca kamera detektor antrean.
- Pembelajaran dari data histori: model lalu lintas dilatih dan langsung diterapkan.
- Pengelolaan sampah: truk dipanggil sensor tempat sampah dengan rute otomatis.
- Jaringan perangkat, pusat data, dan diagram 3D alur perangkat.
- Editor peta, termasuk impor dari OpenStreetMap.
- Jelajahi kota dengan mengemudi.

Akan dikembangkan:

- Peringatan banjir.
- Informasi penutupan jalan.
- Pengalihan lalu lintas otomatis.
- Pengendalian polusi.
- Penurunan angka kecelakaan.

## Menjalankan

```sh
npm install
npm run dev
```

Buka alamat yang ditampilkan terminal (http://localhost:8071). Jangan membuka
`index.html` langsung dari filesystem. Build produksi: `npm run build`; pratinjau:
`npm run preview`. Terbitkan ke GitHub Pages: `npm run deploy` (build lalu push `dist/` ke cabang
`gh-pages`).

| Halaman | Isi |
|---|---|
| `index.html` | Simulasi: tab Perbandingan, Kota biasa, Kota cerdas (dengan perangkat dan jaringannya), Perangkat (dengan data center), Analisis (siklus belajar), Editor peta; Jelajahi Kota (mengemudi) |
| `editor-peta.html` | Editor peta lengkap dengan simulasi lalu lintas satu kota |
| `penjelasan.html` | Panduan pengaturan, cara kerja, dan asumsi |
| `desain-teknis.html` | Usulan arsitektur data skala besar (gateway, Kafka, Spark, ClickHouse, MinIO + Iceberg, Grafana, Airflow, Kubernetes, alur balik model) |
| `diagram-3d.html` | Diagram 3D alur perangkat |
| `aset.html` | Pratinjau semua model 3D |

Semua halaman punya **mode gelap**: tampilan bawaan terang, ganti lewat tombol *Tema*
(pilihan diingat browser).

Navigasi peta cukup dengan mouse: klik kanan + seret putar dan miringkan, klik kiri/tengah +
seret geser, roda zoom ke arah kursor, dobel klik kanan terbang ke titik.

## Struktur kode

| Folder | Isi |
|---|---|
| `src/map/` | Format peta, geometri jalan, editor (sunting, rapikan, penempatan aset), isi aset otomatis, jaringan perangkat, impor OSM, kamera, peta Mini Kota (`mini-kota-data.js`, `default-map.js`) |
| `src/analysis/` | Siklus belajar kota cerdas: histori per 5 detik (IndexedDB), label Masehi dan Hijriah, empat model lalu lintas (Gradient Boosted Trees, korelasi silang, Bayesian optimization), langsung diterapkan; pelatihan di worker |
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
