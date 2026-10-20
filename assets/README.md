# Aset 3D Mini Kota

Semua aset 3D dibuat dengan **skrip Python Blender**. Skrip adalah sumber utama: file
`.glb`, file `.blend`, gambar pratinjau, dan manifest dihasilkan ulang darinya.

Jalan **tidak** dimodelkan di sini. Jalan dibentuk oleh kode dari data peta (profil lajur).

## Struktur folder

```
assets/
├── README.md               dokumen ini
├── build.mjs               membangun semua aset (npm run assets)
├── blender/                SUMBER — skrip per kategori
│   ├── lib/
│   │   ├── common.py       pembuat bentuk, ekspor, pratinjau, manifest
│   │   └── parts.py        palet warna bersama, tiang, braket
│   ├── traffic/            lampu lalu lintas, rambu
│   ├── devices/            CCTV, kabinet pengendali, gateway, sensor sampah
│   ├── vehicles/           mobil, minibus, truk sampah
│   ├── buildings/          rumah, ruko, kantor, sekolah, kampus, mal, pabrik, data center, TPS3R
│   ├── nature/             pohon, semak
│   ├── street/             lampu PJU, halte, bangku
│   └── people/             pejalan kaki
├── sources/<kategori>/     HASIL — file .blend untuk dibuka di Blender
└── previews/<kategori>/    HASIL — gambar pratinjau; _<skrip>.png = semua aset satu skrip

public/models/
├── manifest.json           HASIL — daftar aset untuk aplikasi
└── <kategori>/<id>.glb     HASIL — model yang dimuat aplikasi
```

Folder berlabel HASIL jangan diedit manual; jalankan ulang skripnya. `sources/` dan `previews/` tidak
disimpan di git (dibuat ulang oleh `npm run assets`); `public/models/` disimpan karena dipakai aplikasi.

## Membangun

```bash
npm run assets                       # semua aset
npm run assets -- vehicles           # satu kategori
npm run assets -- vehicles car       # aset tertentu dalam satu kategori
BLENDER=/path/ke/blender npm run assets
```

Periksa hasilnya di halaman **`/aset.html`** (`npm run dev`): pilih aset, putar, nyalakan
lampu, ganti warna, dan cek ukuran, jumlah segitiga, serta kelengkapan bagian bernama.

## Konvensi wajib

| Aturan | Nilai |
|---|---|
| Satuan | meter, ukuran asli |
| Titik asal | di tanah, di dasar objek (tengah tapak) |
| Arah depan | Blender **−Y** → **+Z** di three.js (ekspor glTF "+Y Up") |
| Sisi kiri aset | +X (kiri pengemudi kendaraan; sein kiri di sisi +X) |
| Tiang di simpang | berdiri di tepi kiri jalan; lengan menjulur ke **+X** di atas lajur |
| Nama file / id | kebab-case, sama dengan `id` di manifest |
| Material | dari `parts.PALETTE` bila ada; sedikit material per aset |
| Anggaran segitiga | perabot/perangkat < 2.500 · kendaraan < 1.500 · gedung < 3.000 · orang < 400 |

### Bagian bernama (dikendalikan aplikasi)

Nama lampu berlaku sebagai **awalan**: semua objek yang namanya diawali nama itu dinyalakan
bersama (contoh `lamp_red` dan `lamp_red_2` pada lampu dua kepala).

| Aset | Bagian |
|---|---|
| Lampu lalu lintas | `lamp_red`, `lamp_yellow`, `lamp_green`, `lamp_arrow_right`, `lamp_arrow_left`, `timer_display` |
| Lampu pejalan kaki | `lamp_ped_red`, `lamp_ped_green`, `timer_display` |
| Kendaraan | `headlight`, `brake_light`, `indicator_left`, `indicator_right` (truk sampah juga `beacon`) |
| Orang | `leg_l`, `leg_r` (titik asal di pinggul), `arm_l`, `arm_r` (di bahu); pose disimpan sebagai rotasi X bagian itu, sudut positif = mengayun ke belakang |
| Gateway / sensor | `led`, `sensor`, `sensor_led` |
| Lampu PJU | `lamp` |

### Material yang boleh diwarnai ulang (`tint`)

| Material | Dipakai di |
|---|---|
| `paint` | cat kendaraan |
| `dinding` | dinding gedung |
| `baju`, `celana` | pakaian pejalan kaki |

## Menambah aset baru

1. Tambahkan fungsi `build_<nama>()` di skrip kategorinya, atau buat skrip baru di folder
   kategori. Kategori baru juga perlu ditambahkan ke `CATEGORIES` di `lib/common.py`.
2. Daftarkan di `ASSETS` dengan `c.Asset(id, nama, fungsi, kamera_pratinjau, parts=…, lights=…, tint=…)`.
3. Jalankan `npm run assets -- <kategori> <id>` lalu periksa di `/aset.html`.
   Ekspor gagal bila ada bagian bernama yang hilang.

## Mengubah di Blender secara manual

File `.blend` di `assets/sources/` boleh dibuka dan dipelajari, tetapi **akan ditimpa** saat
skrip dijalankan ulang. Untuk perubahan manual yang ingin dipertahankan, simpan sebagai file
baru di luar `assets/sources/`, ekspor `.glb` dengan aturan di atas, lalu tambahkan entrinya
ke manifest melalui skrip.
