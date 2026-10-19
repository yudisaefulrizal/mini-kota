# Mini Kota — Kehidupan & Mobilitas

Simulasi edukasi kota yang berjalan terus dengan tiga belas gerbang antarkota. Mulai 05.30 hari pertama, kemudian menyusun aktivitas baru lintas hari tanpa batas akhir dua hari. Gambar asli `map-mini-kota.png` digunakan kembali sebagai dasar peta, dengan bangunan dan kendaraan 3D. Rute utama ditelusuri mengikuti jalan gambar, termasuk tikungan sisi sungai dan bundaran. Gambar asli tidak diubah.

## Perbandingan biasa dan cerdas

Dua kota independen ditampilkan berdampingan (bertumpuk pada layar kecil). Satu kontrol mengatur jeda, percepatan, tambah satu jam, pengaturan, kamera, dan mulai ulang. Kedua kota memakai seed, kondisi awal, jadwal awal, dan arus melintas yang sama; waktu simulasi selalu maju bersama. Hasil kegiatan lanjutan dapat berbeda karena waktu kedatangan dan ketersediaan kendaraan berubah.

Kota biasa menggunakan lampu tetap dan rute terpendek menurut jarak. Kota cerdas menggunakan heuristik deterministik pada `src/smart-simulation.js`:

- Lampu membaca kendaraan hingga 100 meter sebelum simpang (kendaraan berhenti berbobot 2, bergerak berbobot 1). Hijau minimal 10 detik dan maksimal `min(90, 2 × green)` detik. Setelah minimum, arah lawan bisa dilayani jika arah aktif kosong atau permintaan lawan lebih dari 1,25 kali arah aktif. Tanpa permintaan, lampu beralih setelah durasi dasar. Pergantian selalu melewati kuning 3 detik dan merah bersama 1 detik.
- Biaya rute adalah panjang ruas / 8,33 + 1,5 detik per kendaraan bergerak + 5 detik per kendaraan berhenti. Ini asumsi skenario, bukan estimasi lapangan terkalibrasi. Biaya diperbarui setiap 5 detik. Rute digunakan saat berangkat; perjalanan aktif dievaluasi ulang sebelum jarak 45 meter ke simpang. Belokan yang telah diklaim tetap dipertahankan. Perubahan hanya jika biaya baru + 5 detik kurang dari 85% biaya lama, dan tidak langsung berbalik ke ruas sebelumnya.

Panel membandingkan total waktu antre, BBM idle, kendaraan di jalan, perjalanan selesai, dan waktu perjalanan. BBM idle diakumulasi per kendaraan saat kecepatan di jalan di bawah 0,3 m/detik: `detik antre / 3600 × liter per jam`. Nilai awal 0,8 liter/jam dapat diubah dan berlaku untuk akumulasi berikutnya. Model ini belum menghitung BBM saat kendaraan bergerak atau mengambil rute memutar, dan sistem cerdas tidak dijamin lebih baik.

`src/comparison.js` menjaga dua model tetap terpisah dan waktunya sinkron. Renderer menggunakan dua area gambar dengan kamera bersama. Statistik rinci di bawah panel perbandingan adalah milik kota biasa. Pemeriksaan browser perbandingan: `TEST_URL=http://localhost:5173 node tests/comparison-smoke.mjs` setelah server dinyalakan. Data kedua kota dapat diperiksa melalui `window.cityComparison.state`; `window.citySimulation.state` tetap menunjuk kota biasa.

## Data center dan kebutuhan perangkat

Data center memakai lahan yang sebelumnya belum berfungsi di bawah Kawasan Bisnis, dekat sungai (x 1050–1155, z 450–555). Aksesnya tersambung ke jalan barat pada (1015, 500). Bangunan ada di kedua kota agar topologi tetap sama. Klik bangunan untuk menuju panel, atau tombol **Lihat di peta** untuk memusatkan kamera. Data center belum menambahkan pekerja atau arus perjalanan baru.

Panel menghitung perangkat untuk satu kota cerdas berdasarkan graf: satu detektor per ruas terarah, dibagi menjadi pendekat lampu, ruas gerbang, dan ruas lainnya tanpa penghitungan ganda; satu penghitung akses per kawasan; satu sensor isi per tempat sampah. Pengendali simpang dan kepala lampu merupakan perangkat terpisah, bukan sensor. Inventaris ini adalah rencana, bukan hardware tersambung. Usulan perangkat: kamera CCTV IP dengan analitik video untuk antrean dan kepadatan ruas, kamera dengan penghitungan garis virtual untuk arus gerbang dan akses kawasan, serta sensor jarak ultrasonik untuk tingkat isi tempat sampah. Ultrasonik tidak mengukur kg; massa sampah tetap berasal dari model. Jenis perangkat dan cara deteksi ditampilkan pada panel dan halaman penjelasan. Jumlah perangkat mengikuti titik pantau model, belum survei kamera fisik; pemrosesan video belum masuk estimasi komputasi.

`src/data-center.js` memisahkan inventaris dan estimasi kapasitas dari model lalu lintas. Input perencanaan mencakup interval sensor lalu lintas, ukuran pesan, retensi, biaya CPU per pesan/evaluasi lampu, biaya evaluasi rute, dan kendaraan serentak pada puncak. Estimasi CPU/RAM memakai maksimum kendaraan aktual dan rencana puncak. Penyimpanan memasukkan dua salinan dan cadangan 30%; node komputasi diasumsikan 8 vCPU/16 GB, dengan satu node cadangan. Semua rumus ditampilkan di panel. Angka CPU adalah asumsi, bukan benchmark; video, GPU, listrik, dan pendinginan tidak termasuk. Perubahan asumsi kapasitas tidak mengubah perilaku lalu lintas dan tetap tersimpan saat kota diulang. Data tersedia di `window.cityComparison.state.dataCenter`.

## Input otomatis dan perpindahan penduduk

Formulir menerapkan angka valid otomatis setelah jeda mengetik 350 ms, tanpa tombol Terapkan dan tanpa menghapus progres. Persentase kepemilikan mobil dan peluang tujuan masing-masing harus berjumlah 100%; selama isian belum valid, pengaturan valid terakhir dipertahankan. Mulai ulang tersedia sebagai tindakan terpisah dan opsional.

Jumlah per kelompok adalah target, bukan perubahan instan jumlah aktual. Panel membedakan aktual, target, sedang masuk, serta menunggu/sedang keluar. Pendatang dibawa kendaraan pindahan bersama melalui gerbang menuju permukiman; baru setelah tiba dan selesai masuk akses kawasan mereka menjadi penduduk aktual. Penduduk keluar menunggu rangkaian perjalanan aktifnya selesai, dijemput di permukiman, dan baru dikeluarkan dari populasi saat kendaraannya melintasi gerbang. Pengurangan kelompok tidak mengubah orang tersebut menjadi kelompok lain.

Kendaraan pindahan biru memakai jalan, antrean, lampu, dan parkir yang sama, dengan kelompok maksimal 10 orang dan pengemudi layanan abstrak. Jumlah penumpang tidak disamakan dengan kepemilikan mobil. Perpindahan diproses dalam kelompok kecil setiap 10 detik simulasi, maksimal 64 permintaan aktif. Permintaan yang belum berangkat/menjemput dapat dibatalkan ketika target berubah; perjalanan yang telanjur berjalan diselesaikan, kemudian kota menyesuaikan lagi ke target terbaru. Karena itu jumlah aktual dapat sementara melampaui target.

Rata-rata anggota rumah tangga memengaruhi pengelompokan pendatang dan pengelompokan ulang rumah tangga yang sudah bebas dari perjalanan, dalam kawasan permukiman yang sama. Mobil rumah tangga menyesuaikan saat aman: tambahan mobil dikirim dari gerbang, kelebihan mobil keluar kota setelah kembali ke rumah. Tidak ada mobil aktif yang dihapus di tengah jalan. Ukuran rumah tangga dan kepemilikan adalah model sintetis, bukan silsilah keluarga atau transaksi kendaraan riil.

Pada kota biasa, durasi lampu baru berlaku pada batas siklus masing-masing simpang, sehingga fase yang sedang berlangsung tidak dipotong. Arus melintas dan pembagian gerbang memengaruhi kedatangan baru; kendaraan yang sudah masuk dipertahankan. Jadwal, peluang tujuan, penggunaan mobil, serta parameter komuter dipakai pada rencana baru. Rangkaian perjalanan yang sudah disusun tetap diselesaikan. Hari berikutnya menyusun rencana ketika orang dan kendaraan sudah tersedia; sif malam dan antar-jemput sekolah tetap dijaga. Penghuni baru yang melewatkan jam aktivitas utamanya dijadwalkan untuk kesempatan berikutnya.

Gerbang adalah titik tempat sebuah ruas jalan meninggalkan wilayah kota. Setiap gerbang berangkat dari persimpangan yang memang ada menuju tepi peta. Gerbang dinomori mengikuti peta acuan bertanda, sehingga urutannya berlubang (tidak ada 4): 1, 2, 3 di utara; 5, 6, 12, 14 di timur; 7 dan 9 di selatan; 8, 10, 11, 13 di barat. Gerbang 5, 12, dan 14 berpangkal pada satu persimpangan tepi sungai yang sama, sedangkan 8 dan 13 pada satu persimpangan di barat daya — satu simpang dapat melayani beberapa tujuan sekaligus, seperti di lapangan. Gerbang tidak digambar sebagai bangunan; pada peta hanya tampak penanda bernomor tepat di titik gerbangnya.

## Parkir angka dan kendaraan melintas

Parkir ditampilkan sebagai angka **P jumlah mobil terparkir** di dekat kawasan dan panel parkir. Tidak ada petak parkir atau mobil terparkir yang digambar. Mobil terlihat hanya saat berkendara: setelah diterima di akses kawasan mobil disembunyikan, tetapi identitas dan jadwal pulangnya tetap dipertahankan. Proses akses masuk/keluar membutuhkan 12 detik abstrak dan dilayani satu kendaraan pada satu waktu, sehingga kendaraan berikutnya tetap terlihat mengantre di jalan. Parkir sendiri tidak dibatasi kapasitas — batas petak per kawasan adalah persoalan pengelola gedung, bukan mobilitas kota. Simulasi tidak menghapus kendaraan ketika masuk parkir.

Panel **Kendaraan melintas acak** mengatur arus dasar 0–5.000 kendaraan/jam (gabungan seluruh gerbang), awal 20. Kedatangan menggunakan interval eksponensial/Poisson per blok jam: pengali 1,6 pada 07–09 dan 16–19, pengali 0,35 sebelum 06 dan mulai 21, selainnya 1. Berbeda dari komuter, pelintas tidak punya rumah atau tujuan di kota, sehingga gerbangnya tidak ditentukan apa pun selain peluang. Karena itu gerbang masuk dan gerbang keluar diundi dari dua set share yang terpisah, masing-masing satu angka per gerbang (awal rata 10, dinormalisasi otomatis sehingga tidak perlu berjumlah 100). Gerbang keluar selalu berbeda dari gerbang masuk, jadi tiap set harus punya sedikitnya dua gerbang bernilai lebih dari 0. Share komuter terpisah dan tidak terpengaruh. Ini arus kedatangan, bukan target jumlah mobil di jalan. Nilai 0 menonaktifkan.

Kendaraan melintas mengikuti rute, lampu, prioritas bundaran, serta antrean yang sama, tetapi tidak memakai parkir dan tidak menambah penduduk/pekerja. Kedatangan dibangkitkan bertahap dengan aliran acak terpisah dan tetap berlanjut pada hari berikutnya. Statistik kedatangan dan selesai bersifat kumulatif sejak mulai. Slot kendaraan pelintas dan layanan pindahan boleh digunakan kembali hanya setelah perjalanan selesai di luar wilayah; kendaraan yang masih di jalan tidak dipakai ulang.

## Komuter antarkota

Panel **Komuter & gerbang kota** mengatur pekerja lokal yang bekerja di luar (awal 25%), mahasiswa yang kuliah di luar (15%), persentase lowongan yang diisi pekerja luar (100%), penggunaan mobil pekerja luar (60%), pembagian komuter antar tiga belas gerbang (satu share per gerbang, awal rata 10 — dinormalisasi otomatis, tidak perlu berjumlah 100), serta waktu perjalanan luar satu arah (30 menit).

Jumlah pekerjaan kota berasal dari jumlah penduduk berstatus pekerja, dibagi 60% industri, 25% bisnis, dan 15% toko dengan pembulatan yang menjaga total. Pekerja lokal yang bekerja di luar meninggalkan lowongan pada tempat kerja asalnya. Pekerja luar hanya mengisi lowongan tersebut sesuai pengaturan; sisanya tercatat kosong. Ini asumsi keseimbangan sederhana, bukan model pasar tenaga kerja atau kapasitas pekerjaan independen. Penduduk lokal tidak ditambah dengan pekerja luar. Mahasiswa luar tidak ditambahkan pada tahap ini.

Mobil penduduk keluar di gerbang, tetap tercatat dengan ID yang sama dalam status `outside`, menempuh durasi perjalanan luar, beraktivitas sampai jam pulang, lalu menempuh perjalanan luar kembali sebelum masuk gerbang. Mobil komuter luar sudah tercatat sejak awal hari, masuk sesuai jadwal, parkir di tempat kerja, dan keluar setelah jam kerja. Antrean masuk gerbang menunggu ruang jalan; bukan pemunculan kendaraan acak. Wilayah luar tidak digambar dan kemacetannya tidak dimodelkan.

Skenario awal: 400 penduduk, 70 mobil milik penduduk, 45 pekerja luar (27 memakai mobil), dan 51 penduduk bekerja/kuliah di luar. Armada penduduk/komuter 97 mobil, ditambah jadwal kendaraan melintas. Pada 05.30 sebagian mobil sif malam sudah berada di tempat kerja, termasuk pekerja luar yang sudah masuk dan pekerja lokal di luar kota. Jumlah mobil awal dalam wilayah dicatat terpisah dari jumlah mobil milik penduduk. Angka di luar wilayah mencakup pelintas yang belum masuk atau sudah selesai. Jumlah gerbang adalah **lintasan mobil sejak 05.30**, bukan jumlah orang unik; perjalanan sebelum awal simulasi tidak dihitung ulang. Angkutan umum luar tetap abstrak.

Pengunjung luar yang singgah non-pekerja dan bus angkutan umum reguler belum ditambahkan; kendaraan pindahan bersama adalah layanan khusus. Untuk menonaktifkan komuter baru, set pekerja dan mahasiswa ke luar menjadi 0%; perjalanan aktif tetap selesai. Kendaraan melintas dinonaktifkan terpisah melalui arus dasar 0.

## Menjalankan

```sh
npm install
npm run dev
```

Buka alamat yang ditampilkan terminal, biasanya http://localhost:5173. Jangan membuka `index.html` langsung dari filesystem. Build produksi: `npm run build`; pratinjau build: `npm run preview`.

## Editor peta

Tab **Editor peta** (atau halaman `editor-peta.html`) untuk melukis jalan sendiri: persimpangan
dirapikan otomatis, aset dan sensor diseret dari toolbox, lampu dan pola fase diatur per simpang,
peta disimpan sebagai `.json`, lalu disimulasikan dengan tombol **▶ Simulasikan**. Peta
default adalah *Mini Kota lengkap* (gedung, pohon, lampu, CCTV, halte, sensor sampah). Di
simulasi, CCTV menggerakkan lampu adaptif, angkot singgah di halte, sensor tempat sampah
memanggil truk sampah, dan pejalan kaki menyeberang di zebra cross. Peta nyata
bisa diimpor dari file `.osm` hasil *Export* di openstreetmap.org (data © OpenStreetMap
contributors, ODbL). Rancangan lengkap: `docs/rancangan-editor-peta.md`; aset 3D: `assets/README.md`.

## Menggunakan simulasi

1. Isi target penduduk lokal per aktivitas utama: siswa, mahasiswa, pekerja, pengurus rumah tangga, dan lainnya. Total target dan persentase dihitung otomatis; setiap orang masuk tepat satu kelompok. Atur asumsi rata-rata anggota untuk memperkirakan rumah tangga. Persentase kepemilikan mobil tetap harus berjumlah 100%.
2. Perubahan valid diterapkan otomatis tanpa reset. Amati jumlah aktual yang berangsur menuju target. Saat dijeda, target dapat diperbarui tetapi kendaraan baru bergerak setelah simulasi dilanjutkan. Ubah target kembali untuk membatalkan perpindahan yang belum dijalankan.
3. Mobil berada di rumah atau tempat kerja sif malam sebelumnya. Waktu berjalan pada 60×: satu detik nyata memproses satu menit kota. Tunggu jam keberangkatan atau gunakan **+1 jam**; tombol ini tetap menghitung semua langkah pergerakan, bukan memindahkan waktu tanpa simulasi.
4. Amati jumlah mobil di jalan, antrean, parkir, perjalanan selesai, keterlambatan, dan moda perjalanan. Gunakan 1× untuk mengamati gerakan secara rinci.
5. Jeda, putar/zoom kamera, atau pilih tampak atas. Kota berjalan terus setelah tengah malam. **Mulai ulang simulasi** menghapus progres dan membentuk kota awal sesuai target valid terakhir, mulai 05.30.

Jam formulir sekolah dan kunjungan belanja menggunakan desimal: `7.5` berarti 07.30; `7.25` berarti 07.15, dalam batas 06.00–22.00.

## Tiga sif dan peluang tujuan

Pusat Kota juga menjadi kandidat tujuan tambahan, dengan akses dari jalan utara bundaran dan pencatatan parkir tersendiri. Asumsi jam kunjungan 08.00–22.00 dengan durasi 30–90 menit. Tujuan ini tersedia untuk mobil maupun non-mobil dan tetap termasuk dalam batas 1–3 tujuan, tanpa menambah penduduk atau pekerjaan baru.

Jadwal kerja tetap: 07–15, 15–23, 23–07 besok. Jadwal kuliah tetap: 07–11, 13–17, 18–22. Pekerja dan mahasiswa dibagi hampir merata ke tiga kelompok dengan seed tetap. Pekerja luar mewarisi sif pekerjaan yang diisi. Sif kerja toko mencakup pekerjaan di luar jam kunjungan belanja. Jadwal dan pembagian ini adalah asumsi skenario, bukan hasil survei.

Peluang 1/2/3 tujuan awal 70/25/5%, total wajib 100%. Diundi sekali per orang yang bepergian (termasuk pekerja luar), maksimum tiga tempat berbeda selain rumah. Aktivitas utama wajib; tujuan tambahan berupa belanja, taman (06–20), atau kuliah malam (18–22) untuk pekerja. Belanja berlangsung 30–90 menit, taman 30–60 menit. Kunjungan dapat berada sebelum atau sesudah aktivitas utama, hanya jika waktu tempuh dan jam buka memungkinkan. Jumlah rencana dapat lebih kecil dari hasil undian. Mobil yang terlambat dapat membatalkan kunjungan tambahan sebelum berangkat agar tidak melewati jam buka atau mengganggu tujuan berikutnya. Mobil tidak berpindah lokasi saat membatalkan kunjungan. Kemacetan setelah keberangkatan masih dapat menyebabkan keterlambatan.

Mobil yang sama mengikuti seluruh rangkaian, parkir sampai aktivitas selesai, lalu kembali ke rumah/gerbang asal. Pejalan kaki mengikuti jaringan trotoar dengan animasi; angkutan umum memakai rangkaian waktu tempuh tanpa animasi. Antar-jemput sekolah tetap khusus: rumah → sekolah → rumah → sekolah → rumah; pengantar dan mobilnya tidak mendapat kunjungan tambahan. Pekerja yang kuliah tambahan tetap dihitung satu penduduk dalam kelompok pekerja.

Pekerja sif malam sebelumnya diinisialisasi berada di tempat kerja pada 05.30, pulang setelah 07.00, lalu menjalani rencana hari pertama termasuk sif 23.00–07.00 hari kedua. Kunjungan tambahan dihitung per rencana harian, bukan untuk perjalanan pulang sisa sif sebelumnya. Pada hari berikutnya, orang yang sudah selesai bepergian mendapat rencana baru; orang yang masih bekerja atau di perjalanan tidak dijadwalkan ganda.

## Model yang diterapkan

- Input utama adalah target orang per kelompok aktivitas utama (bilangan bulat, boleh nol per kelompok), total target 1–20.000 orang. Nilai awal 80 siswa + 40 mahasiswa + 180 pekerja + 60 pengurus rumah tangga + 40 lainnya = 400 penduduk merupakan asumsi skenario, bukan angka survei. Jumlah aktual berubah hanya melalui perpindahan masuk/keluar; persentase isian adalah informasi target. Pekerja dari luar tidak masuk jumlah penduduk lokal.
- Rumah tangga diperkirakan dengan pembulatan(penduduk ÷ rata-rata anggota), minimal satu. Rata-rata awal 4 menghasilkan 100 rumah tangga. Anggota sintetis dibagi merata dengan pembulatan ke bawah/atas; rata-rata aktual dapat sedikit berbeda dari input. Ini bukan distribusi ukuran keluarga dari survei. Kepemilikan nol/satu/dua mobil dihitung per rumah tangga hasil estimasi, sehingga perubahan jumlah orang atau rata-rata anggota dapat mengubah armada lokal. Persentase penggunaan menentukan peluang mobil tersedia untuk kegiatan hari itu.
- Mobil dimiliki satu rumah tangga. Satu mobil memiliki satu rangkaian perjalanan yang berurutan; mobil tidak dipakai bersamaan oleh orang berbeda.
- Pekerja ditempatkan pada industri (60%), bisnis (25%), atau toko (15%), kemudian sebagian dialihkan menjadi komuter luar. Mahasiswa pergi ke kampus lokal atau luar. Sebagian pengurus rumah tangga dan kelompok lainnya berbelanja.
- Jika tersedia pengurus rumah tangga dan mobil, siswa dapat diantar: rumah → sekolah → rumah → sekolah saat pulang → rumah. Mobil dikemudikan pengurus rumah tangga, bukan siswa. Mobil dan pengantar ini tidak diberi tugas lain pada hari yang sama.
- Penduduk lain yang bepergian tanpa mobil berjalan kaki jika jarak jaringan ≤800 m, atau menggunakan angkutan umum abstrak. Durasi jalan kaki memakai 1,2 m/detik; angkutan umum 5 m/detik ditambah 10 menit tunggu. Pejalan kaki divisualisasikan di trotoar dua sisi, akses kawasan, dan zebra cross. Durasi berjalan mengikuti panjang rute trotoar. Angkutan umum tetap tanpa animasi. Penyeberangan belum memengaruhi kendaraan atau mengikuti lampu lalu lintas.
- Waktu berangkat memperhitungkan perkiraan jarak/waktu dan variasi datang awal. Penggunaan acak memiliki seed tetap agar skenario dapat diulang.
- Pencarian rute terpendek berjalan di graf jalan dua arah dengan lajur kiri. Satu unit peta mewakili satu meter; mobil dibatasi 8,33 m/detik (~30 km/jam), dengan percepatan dan pengereman.
- Antrean berbagi ruas yang sama walau tujuan berbeda. Persimpangan menggunakan reservasi lintasan: gerakan yang berpotongan, terlalu dekat, atau bergabung ke lajur yang sama harus bergantian; lintasan terpisah dapat berjalan bersamaan. Lajur kiri dipertahankan dengan kurva belok dan pemeriksaan ruang keluar. Lampu berlaku pada simpang jalan umum, bukan akses kawasan. Reservasi dilepas setelah kendaraan meninggalkan simpang, termasuk pada akses pendek.
- Parkir tidak dibatasi kapasitas; kawasan tidak pernah penuh. Petak hanya dipesan saat kendaraan mendapat akses masuk, sehingga mobil yang masih di jalan belum dihitung terparkir. Visual parkir hanya angka, dan mobil muncul kembali di akses kawasan saat mendapat izin keluar.
- Akses kawasan melayani satu kendaraan pada satu waktu, sehingga antrean tetap bisa muncul di mulut kawasan. Mobil tidak dihapus, muncul ulang di tepi, atau dipindah paksa agar antrean selesai.
- Total mobil selalu sama dengan mobil di rumah + parkir tujuan + akses parkir + jalan + wilayah luar. Mobil dalam wilayah = mobil dalam wilayah pada 05.30 + lintasan masuk − lintasan keluar. Angka moda utama menghitung penduduk lokal unik; moda pekerja luar dilaporkan terpisah. Perjalanan selesai menghitung setiap leg mobil, termasuk antar-jemput dan pulang.

## Batas interpretasi

Lampu ditampilkan per pendekatan masuk di sisi kiri jalan, menghadap kendaraan, dengan garis berhenti pada lajur masuk. Orientasi mengikuti segmen terakhir sebelum simpang. Dua kelompok fase ditentukan relatif terhadap pasangan pendekatan yang paling berlawanan arah; cabang diagonal tidak otomatis dikelompokkan berdasarkan sumbu peta. Ini masih pengaturan dua fase sederhana, belum rancangan sinyal lapangan atau optimasi berbasis volume lalu lintas.

Ini bukan model transportasi yang sudah dikalibrasi. Jaringan dan jarak adalah asumsi kota mini, bukan ukuran dari foto lapangan. Rumah tangga adalah pengelompokan sintetis, bukan rekonstruksi keluarga/umur nyata. Kepemilikan dan pilihan penggunaan mobil belum didasarkan pada data survei.

Akses parkir dilayani bergantian secara abstrak; manuver parkir tidak divisualisasikan. Simbol mobil diperbesar untuk keterbacaan. Konflik simpang diperiksa dengan sampel kurva dan jarak aman konservatif 9 meter; belum memperhitungkan bentuk badan kendaraan atau waktu kedatangan untuk berbagi lintasan yang sama. Bundaran satu arah searah jarum jam memberi prioritas kepada kendaraan yang mendekat dari dalam lingkaran; ini belum model gap-acceptance terkalibrasi. Belum ada perpindahan lajur, salip, atau optimasi lampu. Rute tetap dipilih berdasarkan jarak, belum pengalihan otomatis saat macet. Belum ada motor, bus fisik, halte berkapasitas, interaksi kendaraan dengan penyeberang, kecelakaan, dan akhir pekan.

Angka keterlambatan saat ini menghitung kedatangan mobil yang memiliki jam masuk, bukan semua orang yang terlambat. Rata-rata waktu perjalanan mencakup menunggu di jalan, akses parkir, dan waktu tempuh luar untuk komuter. Kedatangan di tujuan luar dihitung setelah durasi perjalanan luar selesai, bukan saat baru keluar gerbang. Aktivitas luar sebelum 05.30 untuk komuter masuk dianggap sudah berjalan; penduduk lokal tidak mulai berangkat sebelum simulasi dimulai sehingga jadwal terlalu pagi/jauh dapat menyebabkan keterlambatan.

## Verifikasi

```sh
npm test
# Dengan server dev pada port 5173:
npx playwright install chromium
npm run test:browser
npm run build
```

Pengujian model meliputi graf terhubung dengan tiga belas gerbang yang masing-masing berangkat dari persimpangan dan tidak memotong jalan lain, jumlah penduduk dan kepemilikan, pengulangan jadwal, satu hari penuh, kekekalan armada, share gerbang masuk/keluar pelintas, parkir tanpa kapasitas dengan akses satu per satu, nol mobil, fase lampu, waktu tinggal luar, keseimbangan pekerjaan, dan identitas komuter. Pengujian browser memeriksa validasi formulir, perubahan populasi/armada, pilihan gerbang, jeda, proses satu jam, perjalanan, kamera, reset, dan tampilan mobile.

Kode utama: `src/live-simulation.js` untuk kota real-time, migrasi, arus bertahap, dan penjadwalan berulang; `src/activities.js` untuk perencana tujuan; `src/simulation.js` untuk fisika jalan dan model skenario terbatas yang tetap dipakai pada pengujian; `src/main.js` untuk 3D dan antarmuka. Tes live memeriksa pembatalan target, kedatangan/keberangkatan fisik, kepemilikan, siklus lampu, dan aktivitas beberapa hari. WebGL diperlukan. Google Fonts bersifat opsional dan memiliki font pengganti lokal.

### Antrean gerbang dan uji kepadatan

Panel perbandingan memisahkan antrean di jalan dan di gerbang luar. `gateWaiting` menghitung kendaraan berstatus outside yang memiliki perjalanan aktif, sudah mencapai waktu siap masuk, dan tidak sedang menempuh perjalanan luar. `gateQueueSeconds` menjumlahkan waktu kendaraan siap masuk tertahan akses gerbang; jadwal mendatang, aktivitas luar, dan kendaraan selesai tidak dihitung. `totalQueueSeconds` adalah waktu antre jalan + gerbang, dan dipakai untuk selisih waktu antre kedua kota. Angka lama `queueSeconds` serta BBM idle tetap khusus kendaraan berhenti di jalan, karena kondisi mesin di luar peta tidak dimodelkan. Semua akumulasi bertahan saat konfigurasi berubah dan kembali nol saat reset.

Jalankan `npm run benchmark:traffic -- 4 42` untuk membandingkan arus dasar 500 dan 1000 kendaraan/jam selama 4 jam simulasi sejak 05.30 dengan seed 42. Argumen pertama adalah durasi jam, kedua seed; keluaran JSON per 30 menit mencakup antrean dalam/luar, pelintas selesai, kecepatan, dan kesamaan permintaan. Uji ini terpisah dari unit test karena simulasi padat membutuhkan waktu lama. Ulangi dengan seed lain untuk menilai kestabilan hasil; tidak ada asumsi bahwa sistem cerdas harus selalu menang.

### Jelajahi Kota

Klik **🚗 Jelajahi Kota** pada bagian sudut pandang untuk mengemudikan mobil di peta. Pilih kota Biasa atau Cerdas di pojok kiri atas. Gunakan W/S atau ↑/↓ untuk gas dan mundur, A/D atau ←/→ untuk belok, Spasi untuk rem, dan R untuk kembali ke jalan. Tombol sentuh tersedia di ponsel. Esc atau **Kembali ke Simulasi** menutup mode ini.

Selama menjelajah, kedua kota berjalan pada waktu 1×; pengaturan jeda dan percepatan sebelumnya digunakan kembali setelah keluar. Mobil jelajah tidak masuk statistik. Tabrakan dasar mencakup bangunan, pohon, dan batas peta, belum kendaraan lain atau bentuk sungai pada gambar peta.

Uji mode berkendara dengan server Vite aktif: `node tests/driving.mjs` (atau atur `TEST_URL` sesuai alamat server).
