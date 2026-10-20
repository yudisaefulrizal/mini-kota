# Tujuan Analisis

## Diprediksi
1. Arus kendaraan per arah
2. Isi tempat sampah
3. Waktu tempuh antar simpang

## Dioptimalkan
1. Durasi hijau per fase
2. Penahanan hijau untuk rombongan kendaraan dari simpang hulu
3. Waktu pemanggilan truk sampah

## Target
1. Waktu antre total sekecil mungkin
2. Lama tempat sampah penuh sekecil mungkin
3. Jumlah perjalanan truk sekecil mungkin

## Dampak
1. Waktu tempuh lebih singkat
2. BBM berkurang
3. Kota lebih bersih karena sampah tidak meluap
4. Biaya operasional truk berkurang

## Data histori
✅ = sudah bisa disediakan sistem, ⬜ = belum

**Lalu lintas**

1. ✅ Jumlah kendaraan yang melewati garis henti, per kamera
2. ✅ Jumlah kendaraan di zona kamera
3. ✅ Waktu antre total (antrean di jalan + antrean masuk kota)
4. ✅ Fase lampu dan durasi hijaunya
5. ✅ Hijau yang habis sementara masih ada kendaraan menunggu

**Sampah**

6. ✅ Isi tempat sampah
7. ✅ Waktu truk dipanggil dan waktu truk tiba
8. ✅ Jumlah perjalanan truk
9. ✅ Lama tempat sampah penuh

**Setelan**

10. ✅ Versi tiap model yang sedang dipakai

**Label setiap data**

11. ✅ Jam
12. ✅ Tanggal, bulan, tahun Masehi
13. ✅ Tanggal, bulan, tahun Hijriah

## Metode machine learning
| Masalah | Metode | Data |
|---|---|---|
| Prediksi arus kendaraan per arah | Gradient Boosted Trees (regresi) | 1, 2, 11, 12, 13 |
| Prediksi isi tempat sampah | Regresi linear | 6, 11, 12, 13 |
| Prediksi waktu tempuh antar simpang | Korelasi silang | 1, 2 |
| Optimasi durasi hijau per fase | Bayesian optimization | 3, 4, 5, 10, 11, 12, 13 |
| Optimasi penahanan hijau | Bayesian optimization | 3, 10, hasil prediksi waktu tempuh |
| Optimasi waktu pemanggilan truk | Bayesian optimization | 7, 8, 9, 10, hasil prediksi isi tempat sampah |

Bayesian optimization belajar dari pasangan setelan → hasil target di histori (setelan yang pernah dipakai, no. 10).

## Penerapan model
Model dilatih lalu langsung diterapkan ke kota yang berjalan, tanpa uji.

## Input halaman Analisis
1 data = satu catatan tiap 5 detik, berisi semua baris pada waktu itu (lihat Struktur data; 17.280 data = 1 hari)

| Input | Bentuk | Bawaan |
|---|---|---|
| Latih otomatis | Checkbox | Dicentang |
| Periode latih (setiap N data baru) | Kolom angka | 17.280 |
| Rentang data latih (N data terakhir, 0 = semua) | Kolom angka | 0 |
| Latih sekarang | Tombol | — |
| Kembali ke aturan dasar (semua model dilepas, latih otomatis dimatikan) | Tombol | — |
| Hapus histori (histori dan model peta ini, dengan konfirmasi) | Tombol | — |

## Struktur data
Satu baris = satu id pada satu waktu, dicatat tiap 5 detik. Label = jam; tanggal, bulan, tahun Masehi; tanggal, bulan, tahun Hijriah. Versi model = versi tiap model yang sedang dipakai.

**Baris arah** (per kamera)
1. Waktu
2. Label
3. Versi model
4. Id simpang
5. Id kamera
6. Lewat garis henti
7. Kendaraan di zona

**Baris simpang** (per simpang)
1. Waktu
2. Label
3. Versi model
4. Id simpang
5. Fase menyala
6. Lama hijau
7. Hijau habis

**Baris tempat sampah** (per tempat sampah)
1. Waktu
2. Label
3. Versi model
4. Id tempat sampah
5. Isi
6. Truk dipanggil
7. Truk tiba
8. Lama penuh

**Baris kota** (satu per catatan)
1. Waktu
2. Label
3. Versi model
4. Waktu antre total
5. Perjalanan truk

## Penyimpanan data
- Histori disimpan di lokal client masing-masing, di IndexedDB browser
- Hilang bila data situs di browser dihapus
