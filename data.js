// VARIABLE GLOBAL SHIFT UNTUK TRACKING PERUBAHAN
let currentActiveShift = "";
let isResettingSchedule = false; // FLAG PENGUNCI AGAR TIDAK BENTROK SAAT RESET
let lastPollTime = Date.now(); // KUNCI ANTI-GHOST UNTUK TAB TERTIDUR
let isShiftTransition = false; // MENCEGAH ACTUAL OUTPUT TERTABRAK SAAT GANTI SHIFT

// --- UBAHAN: TARIF KWH MENJADI AKTUAL RP 1500 ---
const tarifKwh = 1500; 
const tarifListrikPerDetik = tarifKwh / 3600; // Rp 0.4166666... per detik
// ---------------------------

// --- FUNGSI STANDARISASI WAKTU WIB MURNI ---
function getWIBTime() {
    let d = new Date();
    let utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 7)); // Paksa ke zona waktu WIB (UTC+7) tanpa peduli settingan PC
}

// --- FUNGSI MUTLAK: TANGGAL PABRIK (FACTORY DATE) ---
// Memastikan Shift 3 (23:00 - 07:00) yang melewati tengah malam
// TETAP dihitung sebagai jadwal produksi hari sebelumnya!
function getFactoryDateIso(dateObj) {
    let d = dateObj ? new Date(dateObj) : getWIBTime();
    let hour = d.getHours();
    let dateToUse = new Date(d.getTime());
    
    if (hour < 7) {
        // Jika masih di bawah jam 07:00 pagi, ini masuk hitungan produksi kemarin
        dateToUse.setDate(dateToUse.getDate() - 1);
    }
    
    let y = dateToUse.getFullYear();
    let m = String(dateToUse.getMonth() + 1).padStart(2, '0');
    let day = String(dateToUse.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
// ----------------------------------------------------

// FUNGSI JAM REALTIME WIB
function updateRealtimeClock() {
    let now = getWIBTime();
    let options = { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
    let timeString = now.toLocaleTimeString('id-ID', options) + " WIB";
    let clockEl = document.getElementById('realtime-clock');
    if(clockEl) clockEl.innerHTML = `<i class="fa-regular fa-clock"></i> ` + timeString;
}

function syncToGoogleSheets(actionName, dataObj) {
    const scriptURL = 'https://script.google.com/macros/s/AKfycbxEX_TzUJ1Qwbw-a9VgM95LJUrRlAqaKuVmkg4Qlwj8wqfoLBdS04J7KjDEh_LO5J3-/exec'; 
    
    const firebaseFolder = actionName === 'addLogbook' ? 'logbook_technician' : 'shift_handover';
    const firebaseUrl = `https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/${firebaseFolder}.json`;

    fetch(firebaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataObj)
    }).then(() => console.log(`[FIREBASE] Sukses kirim data ke ${firebaseFolder}`))
      .catch(err => console.error('[FIREBASE ERROR]', err));

    const payload = { action: actionName, ...dataObj };

    if(scriptURL !== 'URL_WEB_APP_GOOGLE_SCRIPT_ANDA_DI_SINI') {
        fetch(scriptURL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        })
        .then(response => console.log(`[GOOGLE SHEETS] Sukses kirim action: ${actionName}`))
        .catch(error => console.error('[GOOGLE SHEETS ERROR]', error));
    } else {
        console.log("[GOOGLE SHEETS] Melewati proses kirim karena URL Script belum diatur.");
    }
}

let machineData = {};
let currentMachine = "";

let scheduleDataList = [];

// Variabel untuk menyimpan count breakdown maintenance otomatis
let breakdownFreq = {};

// --- TAMBAHAN: Variabel Global untuk Chart Tampilan ---
let tampilanSpeedChartInstance;
let tampilanDtChartInstance;
let tampilanTimeLabels = [];
let tampilanSpeedData = [];
let isLiveView = true; 

// Variabel penampung akumulasi Rata-rata per-Jam
let currentHourLabel = "";
let currentHourSpeedSum = 0;
let currentHourSpeedCount = 0;
// --------------------------------------------------------

// Array Global Untuk Menampung Semua Riwayat Breakdown
let allBreakdownEvents = [];

// --- UBAHAN FITUR: FETCH HISTORI GRAFIK DARI FIREBASE ---
// Kita ambil dari Firebase agar rata-rata per jam tidak hilang saat di-refresh
function fetchHistoryFromLocal(machineId) {
    let tglIso = getFactoryDateIso();
    fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/HOURLY_SPEED_CHART/${machineId}/${tglIso}.json`)
    .then(res => res.json())
    .then(data => {
        if(data) {
            // Mengurutkan jam dari pagi ke malam
            tampilanTimeLabels = Object.keys(data).sort();
            tampilanSpeedData = tampilanTimeLabels.map(l => data[l]);

            // Setup cache jam terakhir untuk dilanjutkan secara real-time
            if (tampilanTimeLabels.length > 0) {
                currentHourLabel = tampilanTimeLabels[tampilanTimeLabels.length - 1];
                currentHourSpeedSum = tampilanSpeedData[tampilanSpeedData.length - 1];
                currentHourSpeedCount = 1; // Anggap count mulai dari 1 lagi untuk average shift ini
            }

            if(tampilanSpeedChartInstance) {
                tampilanSpeedChartInstance.data.labels = tampilanTimeLabels;
                tampilanSpeedChartInstance.data.datasets[0].data = tampilanSpeedData;
                
                if (isLiveView) {
                    tampilanSpeedChartInstance.options.scales.x.min = Math.max(0, tampilanTimeLabels.length - 20);
                    tampilanSpeedChartInstance.options.scales.x.max = tampilanTimeLabels.length - 1;
                }
                tampilanSpeedChartInstance.update('none'); // Update tanpa animasi
            }
        } else {
            // Reset jika tidak ada data untuk hari ini
            tampilanTimeLabels = [];
            tampilanSpeedData = [];
            currentHourLabel = "";
            currentHourSpeedSum = 0;
            currentHourSpeedCount = 0;
            if(tampilanSpeedChartInstance) {
                tampilanSpeedChartInstance.data.labels = tampilanTimeLabels;
                tampilanSpeedChartInstance.data.datasets[0].data = tampilanSpeedData;
                tampilanSpeedChartInstance.update('none');
            }
        }
    }).catch(e => console.warn("Menunggu data grafik dari Firebase..."));
}
// -----------------------------------------------------------

// --- TAMBAHAN FITUR: UNDUH HISTORI SPEED (CSV) DARI INFLUXDB ---
function downloadSpeedHistory() {
    if (!currentMachine) {
        alert("Pilih mesin terlebih dahulu sebelum mengunduh data!");
        return;
    }

    // Meminta seluruh data histori dari API yang sama
    fetch(`https://marvelous-undamaged-flagship.ngrok-free.dev/api/read-sensor/${currentMachine}`)
    .then(res => res.json())
    .then(data => {
        if (!data || data.length === 0) {
            alert(`Tidak ada data histori kecepatan untuk mesin ${currentMachine}. Pastikan InfluxDB and API lokal berjalan.`);
            return;
        }

        // UBAHAN: Siapkan header CSV dengan Shift dan Produk
        let csvContent = "data:text/csv;charset=utf-8,Waktu (Timestamp),Kecepatan Aktual (m/min),Shift Operasional,Nama Produk\r\n";

        // Loop setiap titik data lalu masukkan ke CSV
        data.forEach(item => {
            let dt = new Date(item.time);
            // Format waktu biar mudah dibaca di Excel: YYYY-MM-DD HH:mm:ss
            let formattedTime = dt.getFullYear() + '-' + 
                                String(dt.getMonth() + 1).padStart(2, '0') + '-' + 
                                String(dt.getDate()).padStart(2, '0') + ' ' + 
                                String(dt.getHours()).padStart(2, '0') + ':' + 
                                String(dt.getMinutes()).padStart(2, '0') + ':' + 
                                String(dt.getSeconds()).padStart(2, '0');
            
            // UBAHAN: Sisipkan Shift dan Produk (Gunakan "" agar aman jika ada spasi pada produk)
            let row = `"${formattedTime}","${item.speed}","${item.shift || '-'}","${item.product || '-'}"`;
            csvContent += row + "\r\n";
        });

        // Trigger Download File
        let encodedUri = encodeURI(csvContent);
        let link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        
        let today = new Date();
        let fileName = `Histori_Speed_${currentMachine}_${today.toISOString().slice(0, 10)}.csv`;
        link.setAttribute("download", fileName);
        
        document.body.appendChild(link); 
        link.click();
        document.body.removeChild(link);
        
    }).catch(e => {
        console.error(e);
        alert("Gagal mengunduh data. Pastikan API Lokal InfluxDB menyala (node server.js).");
    });
}
// -----------------------------------------------------------

// --- TAMBAHAN FITUR: RESET KE LIVE VIEW RATAKANAN SISA 20 DETIK ---
function resetLiveView() {
    isLiveView = true;
    let btn = document.getElementById('btnLiveView');
    if (btn) btn.style.display = 'none';
    if (tampilanSpeedChartInstance) {
        tampilanSpeedChartInstance.resetZoom();
        tampilanSpeedChartInstance.options.scales.x.min = Math.max(0, tampilanTimeLabels.length - 20);
        tampilanSpeedChartInstance.options.scales.x.max = tampilanTimeLabels.length - 1;
        tampilanSpeedChartInstance.update('none');
    }
}
// -----------------------------------------------------------

// --- FIREBASE RTDB AUTO BREAKDOWN ---
let realtimeDBData = {};
let autoBreakdownState = {};
let pendingAutoBd = { machineId: null, elapsedSec: 0 }; 

// Fetch Schedules & Breakdowns secara sinkron
function fetchSchedulesFromFirebase() {
    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/schedules.json')
    .then(res => res.json())
    .then(data => {
        if (data) {
            let validSchedules = [];
            let ghostKeys = [];

            // --- PERBAIKAN MUTLAK: Pembersih Objek Hantu (Self-Cleaning) ---
            Object.keys(data).forEach(key => {
                let obj = data[key];
                // Wajib memilik atribut valid, jika tidak berarti ini adalah objek korup / undefined
                if(obj && typeof obj === 'object' && obj.idJadwal && obj.mesin && obj.mesin !== "undefined") {
                    obj.firebaseKey = key; // Simpan ID unik Firebase ke dalam data lokal
                    validSchedules.push(obj);
                } else {
                    // Deteksi jika Firebase mengotori array dengan objek tidak lengkap
                    ghostKeys.push(key);
                }
            });
            
            scheduleDataList = validSchedules;

            // Segera basmi data hantu dari Firebase secara otomatis
            ghostKeys.forEach(gKey => {
                fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/schedules/${gKey}.json`, {
                    method: 'DELETE'
                }).catch(e => {});
            });
            
            // [FITUR BARU] Otomatis set produk pertama kali web di-refresh (jika tidak ada data cache)
            let currentTglIso = getFactoryDateIso();
            
            rawMachineList.forEach(id => {
                let mData = machineData[id];
                if(mData && mData.currentProduct.includes("IDLE")) {
                    let sched = scheduleDataList.find(s => s.mesin === id && s.tglFull === currentTglIso && s.shift === currentActiveShift);
                    if(sched) mData.currentProduct = sched.produk.trim();
                }
            });
        }
        // Setelah load schedule, panggil load breakdown agar bisa dijumlahkan ke schedule
        fetchBreakdownStatesFromFirebase();
    }).catch(e => {
        console.error("Error fetch schedules:", e);
        fetchBreakdownStatesFromFirebase();
    });
}

function fetchBreakdownStatesFromFirebase() {
    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/breakdown_events.json')
    .then(res => res.json())
    .then(data => {
        if (data) {
            // Sorting berdasarkan waktu agar membaca riwayat mesin dengan benar
            let rawEvents = Object.values(data).sort((a,b) => a.timestamp - b.timestamp);
            let latestState = {};
            
            // --- PERBAIKAN: ANTI-DUPLIKAT (MENCEGAH INFLASI DOWNTIME AKIBAT MULTI-DEVICE AUTO-SAVE) ---
            let processedEnds = {};
            let processedStarts = {};
            let filteredEvents = []; // Gunakan array bersih

            // Menyusun ulang status Timer dari event POST Firebase
            rawEvents.forEach(ev => {
                if (ev.type === 'START') {
                    // Abaikan jika HP lain sudah posting START dalam 15 detik terakhir
                    if (processedStarts[ev.machine] && (ev.timestamp - processedStarts[ev.machine] < 15000)) return;
                    processedStarts[ev.machine] = ev.timestamp;
                    
                    filteredEvents.push(ev); // Simpan ke array bersih
                    latestState[ev.machine] = { isDown: true, startTime: ev.startTime };
                } else if (ev.type === 'END') {
                    // Abaikan jika HP lain sudah posting END dalam 15 detik terakhir
                    if (processedEnds[ev.machine] && (ev.timestamp - processedEnds[ev.machine] < 15000)) return;
                    processedEnds[ev.machine] = ev.timestamp;

                    filteredEvents.push(ev); // Simpan ke array bersih
                    latestState[ev.machine] = { isDown: false, startTime: null };
                }
            });

            allBreakdownEvents = filteredEvents; // Ganti array global dengan yang sudah bersih

            // Cek jika mesin mati dan web direfresh, timer tetap jalan dari titik mesin mulai mati
            for (let mac in latestState) {
                if (latestState[mac].isDown && machineData[mac]) {
                    
                    // MENCEGAH DOWNTIME HANTU (GHOST START EVENT)
                    let dtStart = new Date(latestState[mac].startTime);
                    if (Date.now() - dtStart.getTime() > 12 * 3600 * 1000) {
                        console.warn(`[GHOST PREVENT] Event START usang untuk ${mac} diabaikan.`);
                        continue;
                    }

                    autoBreakdownState[mac] = { isAutoDown: true, startTime: dtStart };
                    machineData[mac].breakdown.isActive = true;
                    machineData[mac].breakdown.category = "AUTO-PENDING";
                    machineData[mac].breakdown.startTime = dtStart;
                    machineData[mac].breakdown.lockedElapsedSec = null;
                }
            }
            
            updateBreakdownUI();
            refreshDashboardUI();
            updateDowntimeBadge(); // Panggil update badge
        }
        // Panggil state Selektor "Pilih Run" setelah semua data lain siap
        fetchActiveRunsFromFirebase();
    }).catch(e => {
        console.error("Error fetch breakdowns:", e);
        fetchActiveRunsFromFirebase();
    });
}

// Fungsi untuk mengambil state "Pilih Run" dari Firebase
function fetchActiveRunsFromFirebase() {
    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/active_runs.json')
    .then(res => res.json())
    .then(data => {
        if (data) {
            // UBAHAN PERBAIKAN: Membaca Object dari Firebase dan SET SECARA MUTLAK (Mengabaikan status Breakdown)
            // agar Pilihan Radio Button Tidak Berpindah/Reset ke produk No 1 Saat Di-Refresh
            let runs = Object.values(data).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
            runs.forEach(r => {
                if(r && r.machine && machineData[r.machine]) {
                    machineData[r.machine].currentProduct = (r.product || "").trim();
                }
            });
        }
        
        fetchAccumulatedPowerFromFirebase(); // Panggil fungsi tarik DAYA_AKUMULASI yang baru ditambahkan

        // Segarkan semua tabel UI agar radio button otomatis terpilih saat refresh
        refreshDashboardUI();
        if(document.getElementById('page-production').classList.contains('active')) renderProductionTable();
        if(document.getElementById('page-schedule').classList.contains('active')) renderScheduleTable();
        if(document.getElementById('page-tampilan').classList.contains('active')) {
            updateTampilanUI();
            // UBAHAN INTEGRASI INFLUX: Tarik histori jika halaman Tampilan Aktif
            if (currentMachine) fetchHistoryFromLocal(currentMachine); 
        }
    }).catch(e => console.error("Error fetch active runs:", e));
}

// --- FUNGSI PERBAIKAN: TARIK DAYA_AKUMULASI AGAR COST LISTRIK TIDAK HILANG SAAT REFRESH ---
function fetchAccumulatedPowerFromFirebase() {
    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/DAYA_AKUMULASI.json')
    .then(res => res.json())
    .then(data => {
        if(data) {
            let tglIso = getFactoryDateIso();
            let curShift = getCurrentShiftInfo();

            for(let mac in data) {
                let accData = data[mac];
                // Pengecekan memastikan data yang diselamatkan hanya milik shift dan hari yang sama
                if(accData.tglFull === tglIso && accData.shift === curShift) {
                    
                    // 1. Pulihkan memori akumulasi mesin
                    if (machineData[mac]) {
                        machineData[mac].kwhShift = accData.kwh || 0;
                        machineData[mac].costShift = accData.costListrik || 0;
                    }

                    // 2. Pulihkan data di Schedule Array (biar gak nunggu nge-tick/berjalan baru update)
                    scheduleDataList.forEach(s => {
                        if (s.mesin === mac && s.tglFull === tglIso && s.shift === curShift) {
                            s.kwh = accData.kwh || 0;
                            s.costListrik = accData.costListrik || 0;
                        }
                    });
                }
            }
        }
    }).catch(e => console.error("Gagal menarik data akumulasi daya dari Firebase:", e));
}
// -------------------------------------------------------------------------------------


// --- FUNGSI PINTAR UNTUK MENGATUR MUNCULNYA MODAL SESUAI MONITOR YANG DILIHAT ---
function checkPendingModal() {
    if (!currentMachine) return;
    let mData = machineData[currentMachine];
    if (!mData) return;

    let modalEl = document.getElementById('autoBdModal');
    
    // UBAHAN BARU: Cek apakah user sedang berada di halaman menu Downtime (page-kpi-oee) ATAU Tampilan (page-tampilan)
    let isDowntimePage = document.getElementById('page-kpi-oee').classList.contains('active');
    let isTampilanPage = document.getElementById('page-tampilan').classList.contains('active');
    
    // Syarat muncul: HANYA di menu Downtime atau menu Tampilan, Mesin sedang PENDING, dan downtime terkunci (mesin sudah nyala)
    if ((isDowntimePage || isTampilanPage) && mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING" && mData.breakdown.lockedElapsedSec !== null) {
        
        // Mencegah popup me-refresh/berkedip jika sudah tampil untuk mesin yang BENAR
        if (!modalEl.classList.contains('active') || pendingAutoBd.machineId !== currentMachine) {
            pendingAutoBd.machineId = currentMachine;
            pendingAutoBd.elapsedSec = mData.breakdown.lockedElapsedSec;

            let m = Math.floor(pendingAutoBd.elapsedSec / 60);
            let s = pendingAutoBd.elapsedSec % 60;
            
            document.getElementById('autoBdMessage').innerText = `Mesin ${currentMachine} telah kembali beroperasi (Speed > 20).\nTotal Durasi Downtime tercatat: ${m} Menit ${s} Detik.\n\nSilakan tentukan Kategori Breakdown dari tombol di bawah:`;
            modalEl.classList.add('active');
        }
    } else {
        // UBAHAN BARU: Jika pindah ke menu Schedule, atau pindah mesin, tutup popup secara paksa!
        if (modalEl.classList.contains('active')) {
            modalEl.classList.remove('active');
            pendingAutoBd = { machineId: null, elapsedSec: 0 };
        }
    }
}
// --------------------------------------------------------------------------------

// --- FUNGSI BARU: UPDATE BADGE DOWNTIME DI SIDEBAR ---
function updateDowntimeBadge() {
    let pendingCount = 0;
    let currentTglIso = getFactoryDateIso();

    rawMachineList.forEach(id => {
        let mData = machineData[id];
        
        // Cek apakah ada jadwal produksi yang berjalan untuk mesin ini di shift dan hari ini
        let activeSched = scheduleDataList.find(s => 
            s.mesin === id && 
            s.tglFull === currentTglIso && 
            s.shift === currentActiveShift && 
            s.produk.trim() === mData.currentProduct.trim()
        );

        let isIdle = mData.currentProduct.includes("IDLE") || mData.currentProduct.includes("BELUM ADA JADWAL") || mData.currentProduct === "";

        // Menghitung downtime yang aktif (AUTO-PENDING) baik mesin sedang mati maupun sudah nyala (menunggu dipilih)
        // DAN pastikan mesin tersebut memiliki schedule produksi valid
        if (mData && mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING" && activeSched && !isIdle) {
            pendingCount++;
        }
    });

    let dtBadge = document.getElementById('sidebar-dt-badge');
    if (dtBadge) {
        if (pendingCount > 0) {
            dtBadge.style.display = 'inline-block';
            dtBadge.innerText = pendingCount;
        } else {
            dtBadge.style.display = 'none';
        }
    }
}
// ------------------------------------------------------

// --- FUNGSI BARU: SINKRONISASI RESOLUSI DOWNTIME SECARA SILUMAN LINTAS HP ---
function applySilentBreakdownResolution(macId, finalCategory) {
    let mData = machineData[macId];
    if (!mData || !mData.breakdown.isActive) return;

    let elapsedSec = mData.breakdown.lockedElapsedSec !== null ? mData.breakdown.lockedElapsedSec : Math.floor((Date.now() - mData.breakdown.startTime.getTime()) / 1000);

    mData.breakdown.category = finalCategory;
    
    if(finalCategory === 'maintenance') {
        if(breakdownFreq[macId] === undefined) breakdownFreq[macId] = 0;
        breakdownFreq[macId]++;
        let freqLabel = document.getElementById(`bd-count-${macId}`);
        if(freqLabel) freqLabel.innerText = breakdownFreq[macId] + 'x';
    }

    mData.breakdown.isActive = false;
    mData.breakdown.category = null;
    mData.breakdown.lockedElapsedSec = null; 
    
    // [PERBAIKAN] Reset state sensor agar tidak jadi zombie
    if (autoBreakdownState[macId]) {
        autoBreakdownState[macId].isAutoDown = false;
    }

    // Push ke memori lokal allBreakdownEvents agar perhitungan OEE tetap valid tanpa harus fetch ulang
    let dtStart = mData.breakdown.startTime ? new Date(mData.breakdown.startTime) : new Date();
    let correctTglIso = getFactoryDateIso(dtStart);
    let correctShift = getCurrentShiftInfo(dtStart);
    
    allBreakdownEvents.push({
        machine: macId,
        type: 'END',
        category: finalCategory,
        elapsedSec: elapsedSec,
        product: mData.currentProduct,
        date: correctTglIso,
        shift: correctShift,
        timestamp: Date.now()
    });

    mData.breakdown.startTime = null; // Clear setalah push array

    updateBreakdownUI();
    refreshDashboardUI();
    updateTampilanUI();
    
    // Jika popup modal di HP ini sedang menunjuk ke mesin yang sudah diselesaikan HP lain, TUTUP!
    if (pendingAutoBd.machineId === macId) {
        document.getElementById('autoBdModal').classList.remove('active');
        pendingAutoBd = { machineId: null, elapsedSec: 0 };
    }
    updateDowntimeBadge();
}
// --------------------------------------------------------------------------------

// Fungsi Random Number untuk Fallback Speed Aktual
function getRandom(min, max) { return parseFloat((Math.random() * (max - min) + min).toFixed(2)); }

// --- FUNGSI DIRESTORASI UNTUK UPDATE TAMPILAN SPEED ACTUAL ---
function liveUpdateDashboard() {
    if(document.getElementById('page-tampilan').classList.contains('active') === false) return;

    let now = getWIBTime();
    let timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');

    if(currentMachine) {
        let tData = machineData[currentMachine];
        let tIsIdle = tData.currentProduct.includes("IDLE") || tData.currentProduct.includes("BELUM ADA JADWAL") || tData.breakdown.isActive;
        let hasSchedule = !tData.currentProduct.includes("IDLE") && !tData.currentProduct.includes("BELUM ADA JADWAL");

        let idealSpeedVal = 0;
        
        if(hasSchedule && typeof dataProduksi !== 'undefined') {
            let pDetail = dataProduksi.find(item => item["NAMA PRODUK"].trim() === tData.currentProduct.trim());
            if(pDetail && pDetail["IDEAL SPEED"]) idealSpeedVal = parseFloat(pDetail["IDEAL SPEED"]);
        }
        
        let curSpeed = 0;
        
        if (realtimeDBData[currentMachine] && realtimeDBData[currentMachine].speed !== undefined) {
            curSpeed = parseFloat(realtimeDBData[currentMachine].speed);
        } else {
            curSpeed = tIsIdle ? 0 : getRandom(idealSpeedVal * 0.95, idealSpeedVal * 1.05);
            if(!tIsIdle && idealSpeedVal === 0) curSpeed = getRandom(80, 100); 
        }

        // UPDATE ELEMENT HTML KECEPATAN ACTUAL
        let elKecepatan = document.getElementById('tampilan-kecepatan');
        if (elKecepatan) elKecepatan.innerText = curSpeed.toFixed(1) + " m/min";
        
        // --- HANYA HITUNG DAN SIMPAN GRAFIK JIKA MESIN TIDAK IDLE (ADA JADWAL) ---
        if (hasSchedule) {
            let hourStr = now.getHours().toString().padStart(2, '0') + ':00';
            
            if (currentHourLabel !== hourStr) {
                currentHourLabel = hourStr;
                currentHourSpeedSum = curSpeed;
                currentHourSpeedCount = 1;
                
                tampilanTimeLabels.push(hourStr);
                tampilanSpeedData.push(curSpeed);
                
                if (tampilanTimeLabels.length > 24) { // Menyimpan max 24 jam terakhir
                    tampilanTimeLabels.shift();
                    tampilanSpeedData.shift();
                }
            } else {
                currentHourSpeedSum += curSpeed;
                currentHourSpeedCount += 1;
                let avg = currentHourSpeedSum / currentHourSpeedCount;
                if (tampilanSpeedData.length > 0) {
                    tampilanSpeedData[tampilanSpeedData.length - 1] = Number(avg.toFixed(2));
                } else {
                    tampilanTimeLabels.push(hourStr);
                    tampilanSpeedData.push(Number(avg.toFixed(2)));
                }
            }

            // SIMPAN RATA-RATA KE FIREBASE (AGAR TIDAK HILANG SAAT REFRESH)
            let tglIso = getFactoryDateIso();
            let avgToSave = tampilanSpeedData[tampilanSpeedData.length - 1];
            fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/HOURLY_SPEED_CHART/${currentMachine}/${tglIso}/${hourStr}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(avgToSave)
            }).catch(e => {});
            
            // LOGIKA PENETAPAN BATAS WINDOW KANAN 20 DETIK ATAU LOCK TRACKING LIVE VIEW
            if (isLiveView) {
                tampilanSpeedChartInstance.options.scales.x.min = Math.max(0, tampilanTimeLabels.length - 20);
                tampilanSpeedChartInstance.options.scales.x.max = tampilanTimeLabels.length - 1;
                let btn = document.getElementById('btnLiveView');
                if (btn) btn.style.display = 'none';
            } else {
                let btn = document.getElementById('btnLiveView');
                if (btn) btn.style.display = 'inline-flex';
            }

            tampilanSpeedChartInstance.update();
        }
    }
}


// --- FUNGSI MURNI POLLING FETCH - PENGGANTI SSE YANG BERMASALAH ---
function pollRealtimeData() {
    // PROTEKSI BENTROK SAAT GANTI SHIFT ATAU RESET
    if (isResettingSchedule || isShiftTransition) return;

    let nowTime = Date.now();
    let isAsleep = (nowTime - lastPollTime > 10000); 
    lastPollTime = nowTime;

    if (isAsleep) {
        console.warn("[SYSTEM] Tab terdeteksi sempat tertidur (background sleep). Sinkronisasi ulang data mutlak...");
        fetchSchedulesFromFirebase();
        return; 
    }

    // 1. Fetch Speed untuk Auto-Breakdown & Dashboard
    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/speed_mesin.json')
      .then(res => res.json())
      .then(data => {
          if (!data) return;
          
          for (let macId in data) {
              let upperMacId = macId.toUpperCase();
              let machineValue = data[macId];
              let mData = machineData[upperMacId];
              
              if (machineValue !== null && machineValue !== undefined && mData) {
                  let speedNum = 0;
                  
                  if (typeof machineValue === 'object') {
                      if (machineValue.speed !== undefined) speedNum = parseFloat(machineValue.speed);
                      else if (machineValue.target_counter !== undefined) speedNum = parseFloat(machineValue.target_counter);
                  } else {
                      speedNum = parseFloat(machineValue);
                  }
                  
                  if (!isNaN(speedNum)) {
                      realtimeDBData[upperMacId] = { speed: speedNum };
                  }
              }
          }
          processAutoBreakdown(); // Panggil di sini agar speed 0 bisa memicu downtime
      })
      .catch(e => console.warn("Menunggu koneksi RTDB Speed..."));

    // 2. Fetch Actual Output KHUSUS TIMBANGAN (SINKRONISASI MUTLAK ABSOLUT)
    let tglIso = getFactoryDateIso();
    let curShift = getCurrentShiftInfo();

    rawMachineList.forEach(mac => {
        fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/timbangan/${mac.toUpperCase()}.json`)
        .then(res => res.json())
        .then(data => {
            // --- PERBAIKAN MUTLAK: Filter Berdasarkan Validasi Sederhana Tanggal & Shift (Self-Cleaning) ---
            let totalDataFirebase = 0;
            let keysToDelete = [];

            if (data) {
                Object.keys(data).forEach(key => {
                    let item = data[key];
                    let isMatch = false;

                    if (item.dateTime) {
                        // Cukup validasi dtargetSched.actualari tanggal dan jam yang dikirim IoT
                        let dtObj = new Date(item.dateTime.replace(' ', 'T'));
                        if (getFactoryDateIso(dtObj) === tglIso && getCurrentShiftInfo(dtObj) === curShift) {
                            isMatch = true;
                        }
                    } else {
                        // Fallback jika IoT belum ada dateTime
                        let itemShift = item.userName || item.userCode || ""; 
                        if (itemShift.includes(curShift)) {
                            isMatch = true;
                        }
                    }
                    
                    if (isMatch) {
                        totalDataFirebase++; 
                    } else {
                        // Data beda hari atau beda shift (nyasar) -> Siap dibasmi
                        keysToDelete.push(key); 
                    }
                });
            }

            // Sapu bersih data shift lama yang nyangkut (Self-Cleaning Latar Belakang)
            if (keysToDelete.length > 0) {
                keysToDelete.forEach(k => {
                    fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/timbangan/${mac.toUpperCase()}/${k}.json`, {
                        method: 'DELETE'
                    }).catch(e => {});
                });
            }
            // ------------------------------------------------------------------

            // Pastikan kita HANYA menyentuh jadwal di shift yang SEKARANG AKTIF
            let validSchedules = scheduleDataList.filter(s => {
                return s.mesin === mac && s.shift === curShift && s.tglFull === tglIso;
            });

            if (validSchedules.length > 0) {
                let mData = machineData[mac];
                let runningProduct = mData ? mData.currentProduct.trim() : "";
                
                // Cari jadwal yang cocok dengan produk yang jalan (Atau fallback ke jadwal terakhir)
                let targetSched = validSchedules.find(s => s.produk.trim() === runningProduct);
                if (!targetSched) {
                    targetSched = validSchedules[validSchedules.length - 1]; 
                }

                // --- LOGIKA NYAMAIN DATA (ABSOLUT AMAN) ---
                if (totalDataFirebase > targetSched.actual) {
                    targetSched.actual = totalDataFirebase;

                    if (targetSched.firebaseKey && !isResettingSchedule) {
                        fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/schedules/${targetSched.firebaseKey}.json`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ actual: targetSched.actual })
                        }).catch(e => {});
                    }
                    
                    if(document.getElementById('page-schedule-maintenance').classList.contains('active')) renderQualityTable();
                    if(document.getElementById('page-tampilan').classList.contains('active')) updateTampilanUI();
                }
            }

            if (!realtimeDBData[mac]) realtimeDBData[mac] = {};
            realtimeDBData[mac].lastUpdate = Date.now();
        }).catch(e => {});
    });

    // 3. Fetch Realtime DAYA Listrik
    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/DAYA.json')
    .then(res => res.json())
    .then(dayaData => {
        if(!dayaData) return;
        
        let localTglIso = getFactoryDateIso();
        let localCurShift = getCurrentShiftInfo();

        for(let key in dayaData) {
            let macId = key.toUpperCase(); 
            let powerKw = parseFloat(dayaData[key]);
            if(isNaN(powerKw)) continue;

            if(machineData[macId]) {
                machineData[macId].livePowerKw = powerKw; 
                let mData = machineData[macId];
                
                let costDetikIni = powerKw * tarifListrikPerDetik;
                let addedKwh = powerKw / 3600;

                mData.kwhShift = (mData.kwhShift || 0) + addedKwh;
                mData.costShift = (mData.costShift || 0) + costDetikIni;

                if (isResettingSchedule || isShiftTransition) return;

                let schedulesThisShift = scheduleDataList.filter(s => 
                    s.mesin === macId && s.tglFull === localTglIso && s.shift === localCurShift
                );

                if (schedulesThisShift.length > 0) {
                    schedulesThisShift.forEach(sched => {
                        sched.kwh = mData.kwhShift;
                        sched.costListrik = mData.costShift;
                    });
                }
            }
        }
    }).catch(e => {});
    
    // 4. SINKRONISASI MODAL DOWNTIME LINTAS HP
    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/bd_resolved_flag.json')
    .then(res => res.json())
    .then(flags => {
        if(!flags) return;
        for(let mac in flags) {
            let mData = machineData[mac];
            let flag = flags[mac];
            
            if (mData && mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING") {
                if (flag.timestamp > mData.breakdown.startTime.getTime()) {
                    console.log(`[SYNC] Mesin ${mac} diselesaikan via HP lain. Menutup modal...`);
                    applySilentBreakdownResolution(mac, flag.category);
                }
            }
        }
    }).catch(e => {});

}

// --- PERBAIKAN MUTLAK AUTO FORCE DOWNTIME DAN PENUMPUKAN DOWNTIME ---
function processAutoBreakdown() {
    for (let macId in realtimeDBData) {
        if (machineData[macId]) {
            if(realtimeDBData[macId].speed === undefined || realtimeDBData[macId].speed === null) continue;

            let speedVal = parseFloat(realtimeDBData[macId].speed);

            if (!autoBreakdownState[macId]) {
                autoBreakdownState[macId] = { isAutoDown: false, startTime: null };
            }
            let state = autoBreakdownState[macId];
            let mData = machineData[macId];

            // CEK JIKA MESIN SEDANG IDLE ATAU BELUM ADA JADWAL (Mencegah Breakdown palsu)
            let isIdleStatus = mData.currentProduct.includes("IDLE") || mData.currentProduct.includes("BELUM ADA JADWAL");

            // JIKA MESIN JALAN (SPEED >= 20)
            if (speedVal >= 20) {
                if (state.isAutoDown) {
                    state.isAutoDown = false;
                    // Hanya kunci waktu untuk memunculkan modal (Tunggu pilihan dari user)
                    if (mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING") {
                        mData.breakdown.lockedElapsedSec = Math.floor((Date.now() - mData.breakdown.startTime.getTime()) / 1000);
                    }
                }
            } 
            // JIKA MESIN MATI / DOWNTIME (SPEED < 20)
            else if (speedVal < 20 && !isIdleStatus) {
                if (!state.isAutoDown) {
                    // Cek jika mesin mati LAGI sebelum downtime sebelumnya sempat dikategorikan dari Popup
                    if (mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING") {
                        let forcedSec = mData.breakdown.lockedElapsedSec !== null 
                            ? mData.breakdown.lockedElapsedSec 
                            : Math.floor((Date.now() - mData.breakdown.startTime.getTime()) / 1000);
                            
                        console.log(`[AUTO-FORCE] Mesin ${macId} mati beruntun sebelum dikategorikan. Paksa simpan dt sebelumnya ke 'production'.`);
                        // Auto-pilih ke 'production' sesuai instruksi jika lupa milih/mati beruntun
                        saveAutoBreakdown('production', macId, forcedSec);
                    }

                    // Buat dan jalankan Timer Downtime BARU
                    mData.breakdown.isActive = true;
                    mData.breakdown.category = "AUTO-PENDING";
                    mData.breakdown.startTime = new Date(); // Mulai dari 0 detik
                    mData.breakdown.lockedElapsedSec = null; 
                    
                    state.isAutoDown = true;
                    state.startTime = mData.breakdown.startTime;

                    // [POST EVENT] Start Breakdown agar tercatat ke Firebase
                    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/breakdown_events.json', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            machine: macId,
                            type: 'START',
                            startTime: mData.breakdown.startTime.getTime(),
                            timestamp: Date.now()
                        })
                    }).catch(e => console.error("Error post bd start:", e));

                    updateBreakdownUI();
                    refreshDashboardUI();
                    updateTampilanUI();
                }
            }
        }
    }
    
    // Eksekusi Pengecekan Monitor setelah semua proses deteksi mesin selesai
    checkPendingModal();
    updateDowntimeBadge(); // Panggil update badge
}

// PERBAIKAN MUTLAK PENYIMPANAN SHIFT LAMA: Memastikan event masuk ke tanggal dan shift yang akurat
function saveAutoBreakdown(finalCategory, forceMacId = null, forceSec = null) {
    let macId = forceMacId || pendingAutoBd.machineId;
    let elapsedSec = forceSec !== null ? forceSec : pendingAutoBd.elapsedSec;
    
    if(!macId) return;

    // --- CLAMPING DOWNTIME MUTLAK: Mencegah Angka Bengkak Ribuan Menit ---
    // Downtime tidak boleh lebih dari 1 shift (8 Jam = 28.800 detik)
    if (elapsedSec > 28800) {
        console.warn(`[GHOST PREVENT] Downtime mesin ${macId} terdeteksi sangat usang (${elapsedSec} detik). Diblokir ke 480 menit.`);
        elapsedSec = 28800; 
    }
    if (elapsedSec < 0) elapsedSec = 0;
    // ---------------------------------------------------------------------

    let mData = machineData[macId];
    if (!mData || !mData.breakdown.startTime) return;

    // --- SINKRONISASI BENDERA: Kasih tau HP lain kalau mesin ini sudah kita tangani! ---
    fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/bd_resolved_flag/${macId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: finalCategory, timestamp: Date.now() })
    }).catch(e => {});

    let productBeforeBd = mData.currentProduct;

    mData.breakdown.category = finalCategory;

    if(finalCategory === 'maintenance') {
        if(breakdownFreq[macId] === undefined) breakdownFreq[macId] = 0;
        breakdownFreq[macId]++;
        let freqLabel = document.getElementById(`bd-count-${macId}`);
        if(freqLabel) freqLabel.innerText = breakdownFreq[macId] + 'x';
    }

    // --- KUNCI ANTI-RAPEL SALAH SHIFT ---
    // Gunakan WAKTU MULAI DOWNTIME sebagai dasar penentuan TANGGAL dan SHIFT, bukan waktu saat ini!
    let dtStart = new Date(mData.breakdown.startTime);
    let correctTglIso = getFactoryDateIso(dtStart);
    let correctShift = getCurrentShiftInfo(dtStart);

    mData.breakdown.isActive = false;
    mData.breakdown.category = null;
    mData.breakdown.startTime = null;
    mData.breakdown.lockedElapsedSec = null; 
    
    // [PERBAIKAN] Reset state sensor agar bisa deteksi ulang jika speed masih 0
    if (autoBreakdownState[macId]) {
        autoBreakdownState[macId].isAutoDown = false;
    }

    // Format Event END untuk Breakdown menggunakan target shift yang TEPAT
    let newEvent = {
        machine: macId,
        type: 'END',
        category: finalCategory,
        elapsedSec: elapsedSec,
        product: productBeforeBd,
        date: correctTglIso, 
        shift: correctShift, 
        timestamp: Date.now()
    };

    allBreakdownEvents.push(newEvent);

    // Simpan log Breakdown ke Firebase (MENJAMIN DATA TIDAK AKAN HILANG)
    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/breakdown_events.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvent)
    }).catch(e => console.error("Error post bd end:", e));

    updateBreakdownUI();
    refreshDashboardUI();
    updateTampilanUI();
    
    if (pendingAutoBd.machineId === macId) {
        document.getElementById('autoBdModal').classList.remove('active');
        pendingAutoBd = { machineId: null, elapsedSec: 0 };
    }
    
    // Alert HANYA muncul kalau di-klik manual oleh operator, bukan auto-save paksaan
    if (!forceMacId) {
        alert(`Data Breakdown berhasil disimpan pada kategori ${finalCategory.toUpperCase()}!`);
    }

    updateDowntimeBadge(); 
}

// --- FUNGSI TOGGLE SIDEBAR ---
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    // Untuk Mobile
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('show');
        overlay.classList.toggle('show');
    } else {
        // Untuk Desktop / PC
        sidebar.classList.toggle('hidden');
    }
}

// --- FUNGSI UNTUK MENGHASILKAN DROPDOWN CUSTOM SEARCHABLE BERASASKAN HTML JS ---
function makeSelectSearchable(selectId) {
    let selectEl = document.getElementById(selectId);
    if (!selectEl) return;

    // Remove existing custom container if any (to prevent duplicates on refresh)
    let existingContainer = document.getElementById(selectId + '_custom_container');
    if (existingContainer) {
        existingContainer.remove();
    }

    selectEl.style.display = 'none';

    let container = document.createElement('div');
    container.id = selectId + '_custom_container';
    container.style.position = 'relative';
    container.style.width = '100%';

    let displayEl = document.createElement('div');
    displayEl.style.padding = '10px 15px';
    displayEl.style.border = '1px solid #cbd5e1';
    displayEl.style.borderRadius = '8px';
    displayEl.style.backgroundColor = '#f8fafc';
    displayEl.style.cursor = 'pointer';
    displayEl.style.fontWeight = '600';
    displayEl.style.color = 'var(--text-dark)';
    displayEl.style.display = 'flex';
    displayEl.style.justifyContent = 'space-between';
    displayEl.style.alignItems = 'center';
    
    let initialText = selectEl.options.length > 0 ? selectEl.options[selectEl.selectedIndex].text : 'Pilih Produk...';
    displayEl.innerHTML = `<span id="${selectId}_display_text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${initialText}</span><i class="fa-solid fa-chevron-down"></i>`;

    let dropdownPanel = document.createElement('div');
    dropdownPanel.style.display = 'none';
    dropdownPanel.style.position = 'absolute';
    dropdownPanel.style.top = '100%';
    dropdownPanel.style.left = '0';
    dropdownPanel.style.width = '100%';
    dropdownPanel.style.backgroundColor = '#ffffff';
    dropdownPanel.style.border = '1px solid #cbd5e1';
    dropdownPanel.style.borderRadius = '8px';
    dropdownPanel.style.boxShadow = '0 4px 15px rgba(0,0,0,0.15)';
    dropdownPanel.style.zIndex = '9999';
    dropdownPanel.style.marginTop = '5px';
    dropdownPanel.style.maxHeight = '350px';
    dropdownPanel.style.flexDirection = 'column';

    let searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Ketik untuk mencari produk...';
    searchInput.style.padding = '12px 15px';
    searchInput.style.border = 'none';
    searchInput.style.borderBottom = '1px solid #e2e8f0';
    searchInput.style.width = '100%';
    searchInput.style.outline = 'none';
    searchInput.style.fontWeight = 'bold';
    searchInput.style.color = 'var(--accent-color)';
    searchInput.style.position = 'sticky';
    searchInput.style.top = '0';
    searchInput.style.backgroundColor = '#ffffff';
    searchInput.style.borderRadius = '8px 8px 0 0';

    let optionsList = document.createElement('div');
    optionsList.style.overflowY = 'auto';
    optionsList.style.flex = '1';

    function populateOptions(filter = '') {
        optionsList.innerHTML = '';
        let count = 0;
        Array.from(selectEl.options).forEach(opt => {
            if (opt.text.toLowerCase().includes(filter.toLowerCase())) {
                let optDiv = document.createElement('div');
                optDiv.style.padding = '10px 15px';
                optDiv.style.cursor = 'pointer';
                optDiv.style.borderBottom = '1px solid #f1f5f9';
                optDiv.style.fontSize = '0.95em';
                optDiv.style.color = '#334155';
                optDiv.innerText = opt.text;
                
                optDiv.onmouseover = () => { optDiv.style.backgroundColor = 'var(--accent-color)'; optDiv.style.color = 'white'; };
                optDiv.onmouseout = () => { optDiv.style.backgroundColor = '#ffffff'; optDiv.style.color = '#334155'; };
                
                optDiv.onclick = () => {
                    selectEl.value = opt.value;
                    selectEl.dispatchEvent(new Event('change'));
                    document.getElementById(`${selectId}_display_text`).innerText = opt.text;
                    dropdownPanel.style.display = 'none';
                };
                optionsList.appendChild(optDiv);
                count++;
            }
        });
        
        if (count === 0) {
            optionsList.innerHTML = '<div style="padding: 10px 15px; color: #94a3b8; font-style: italic; text-align: center;">Produk tidak ditemukan</div>';
        }
    }

    populateOptions();
    searchInput.oninput = (e) => populateOptions(e.target.value);

    dropdownPanel.appendChild(searchInput);
    dropdownPanel.appendChild(optionsList);

    container.appendChild(displayEl);
    container.appendChild(dropdownPanel);

    selectEl.parentNode.insertBefore(container, selectEl.nextSibling);

    displayEl.onclick = (e) => {
        e.stopPropagation();
        let isHidden = dropdownPanel.style.display === 'none';
        
        // Tutup semua custom select lain jika ada
        document.querySelectorAll('[id$="_custom_container"] > div:nth-child(2)').forEach(el => el.style.display = 'none');
        
        dropdownPanel.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            searchInput.value = '';
            populateOptions();
            setTimeout(() => searchInput.focus(), 50);
        }
    };

    // Tutup jika klik di luar
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            dropdownPanel.style.display = 'none';
        }
    });
    
    // Setup initial text
    selectEl.addEventListener('change', () => {
         let textEl = document.getElementById(`${selectId}_display_text`);
         if(textEl && selectEl.selectedIndex >= 0) {
             textEl.innerText = selectEl.options[selectEl.selectedIndex].text;
         }
    });
}
// --------------------------------------------------------------------------------------


// --- MODIFIKASI GLOBAL: MENARIK SEMUA DATA MESIN & PRODUK SECARA DINAMIK DARI dataProduksi ---
if (typeof rawMachineList === 'undefined') {
    if (typeof dataProduksi !== 'undefined') {
        window.rawMachineList = [...new Set(dataProduksi.map(item => item["NAMA MESIN"].trim().toUpperCase()))].sort();
    } else {
        window.rawMachineList = ["NP313", "FC122", "TW408", "JRT06", "HRT02", "TL01"];
    }
}

if (typeof productList === 'undefined') {
    if (typeof dataProduksi !== 'undefined') {
        window.productList = [...new Set(dataProduksi.map(item => item["NAMA PRODUK"].trim()))].sort();
    } else {
        window.productList = ["Brand SPS Facial 2 Ply", "Brand SPS Napkin Regular", "Jumbo Roll Premium SP", "Towel Multipurpose SPS"];
    }
}
// ---------------------------------------------------------------------------------------------

if (typeof powerData === 'undefined') { window.powerData = {"MAIN_FACTORY": 1200, "NP313": 45.5, "FC122": 38.2}; }
if (typeof unitList === 'undefined') { window.unitList = ["Motor Unwinder", "Cylinder Emboss", "Folding Blade", "Logsaw Blade Belt", "Pneumatic Valve"]; }

function getCurrentShiftInfo(dateObj) {
    let d = dateObj ? new Date(dateObj) : getWIBTime();
    let hour = d.getHours();
    if (hour >= 7 && hour < 15) return "Shift 1";
    if (hour >= 15 && hour < 23) return "Shift 2";
    return "Shift 3";
}
        
function getCurrentShiftLabel() {
    let shift = getCurrentShiftInfo();
    if (shift === "Shift 1") return "Shift 1 (07:00 - 15:00)";
    if (shift === "Shift 2") return "Shift 2 (15:00 - 23:00)";
    return "Shift 3 (23:00 - 07:00)";
}

function buildInitialMachineData() {
    rawMachineList.forEach(m => {
        let id = m.toUpperCase();
        let proc = [];
        let fullName = "Line " + id;
        
        breakdownFreq[id] = 0; 

        // --- UBAHAN LOGIK KATEGORI MESIN SUPAYA SUPPORT SEMUA JENIS NAMA (JRT, HRT, JT, TL, DLL) ---
        if (id.startsWith("NP") || id.startsWith("FC") || id.startsWith("TW")) {
            proc = ['Unwinder', 'Emboss', 'Folding', 'Bandsaw'];
            if (id.startsWith("NP")) fullName += " (Napkin)";
            if (id.startsWith("FC")) fullName += " (Facial)";
            if (id.startsWith("TW")) fullName += " (Towel)";
        } else if (id.startsWith("JRT") || id.startsWith("HRT") || id.startsWith("JT")) {
            proc = ['Unwinder', 'Emboss', 'Rewinder', 'Logsaw'];
            if (id.startsWith("JRT") || id.startsWith("JT")) fullName += " (Jumbo Roll)";
            if (id.startsWith("HRT")) fullName += " (Hand Roll)";
        } else if (id.startsWith("TL")) {
            proc = ['Unwinder', 'Emboss', 'Folding', 'Logsaw'];
            fullName += " (Towel Line)";
        } else {
            proc = ['Unwinder', 'Emboss', 'Main Process', 'Cutting'];
        }

        let charCodeSum = 0;
        for(let i=0; i<id.length; i++) charCodeSum += id.charCodeAt(i);
        let initialRunHours = (charCodeSum * 25) % 1050; 
        
        let randomProduct = "IDLE / BELUM ADA JADWAL"; 
        let powerKw = powerData[id] || (Math.random() * 20 + 30).toFixed(2);

        machineData[id] = { 
            name: fullName, 
            processes: proc, 
            runningHours: initialRunHours,
            currentProduct: randomProduct,
            lastProductBeforeBd: null,
            powerKw: parseFloat(powerKw),
            livePowerKw: 0, 
            kwhShift: 0,   
            costShift: 0,   
            activeSecondsThisShift: 0, 
            lastFB: undefined,
            breakdown: {
                isActive: false,
                category: null,
                startTime: null,
                lockedElapsedSec: null, 
                accumulated: { production: 0, maintenance: 0, ppic: 0 }
            }
        };
    });
}

let bdChartInstance;

function syncBreakdownMachine() {
    currentMachine = document.getElementById('bd-machine-select').value;
    if(document.getElementById('machine-select')) document.getElementById('machine-select').value = currentMachine;
    if(document.getElementById('tampilan-machine-select')) document.getElementById('tampilan-machine-select').value = currentMachine;
    refreshDashboardUI();
    updateBreakdownUI();
    updateTampilanUI();
    
    checkPendingModal();
}
        
function syncTampilanMachine() {
    currentMachine = document.getElementById('tampilan-machine-select').value;
    if(document.getElementById('machine-select')) document.getElementById('machine-select').value = currentMachine;
    if(document.getElementById('bd-machine-select')) document.getElementById('bd-machine-select').value = currentMachine;
    refreshDashboardUI();
    updateBreakdownUI();
    updateTampilanUI();
    
    fetchHistoryFromLocal(currentMachine);
    checkPendingModal();
}

function recalcDowntimeAccumulation() {
    let currentTglIso = getFactoryDateIso();
    let totalPabrik = { production: 0, maintenance: 0, ppic: 0 };
    
    for(let mac in machineData) {
        machineData[mac].breakdown.accumulated = { production: 0, maintenance: 0, ppic: 0 };
    }

    allBreakdownEvents.forEach(ev => {
        if (ev.type === 'END' && ev.date === currentTglIso && ev.shift === currentActiveShift) {
            let cat = ev.category;
            if(cat) {
                totalPabrik[cat] += ev.elapsedSec;
                
                let mData = machineData[ev.machine];
                if(mData) {
                    mData.breakdown.accumulated[cat] += ev.elapsedSec;
                }
            }
        }
    });

    return totalPabrik;
}

function updateBreakdownUI() {
    let totalPabrik = recalcDowntimeAccumulation();

    if(!document.getElementById('page-kpi-oee').classList.contains('active')) return;

    let mData = machineData[currentMachine];
    let bd = mData.breakdown;
    document.getElementById('bd-spesific-name').innerText = mData.name;

    let statusEl = document.getElementById('bd-status-indicator');
    if(bd.isActive) {
        statusEl.innerText = `STATUS: BREAKDOWN (${bd.category ? bd.category.toUpperCase() : 'PENDING'})`;
        statusEl.style.background = '#ef4444';
        statusEl.style.color = '#fff';
        document.getElementById('bd-timer').classList.add('blink');
    } else {
        statusEl.innerText = `STATUS: AMAN BEROPERASI`;
        statusEl.style.background = '#10b981';
        statusEl.style.color = '#fff';
        document.getElementById('bd-timer').classList.remove('blink');
        document.getElementById('bd-timer').innerText = "00:00:00";
    }

    let currentTglIso = getFactoryDateIso();
    let spesifikWt = 480; 
    let totalWtPabrik = 0; 

    scheduleDataList.forEach(s => {
        if (s.tglFull === currentTglIso && s.shift === currentActiveShift) {
            totalWtPabrik += parseFloat(s.wt) || 0; 
            if (s.mesin === currentMachine && s.produk.trim() === mData.currentProduct.trim()) {
                let wtJadwal = parseFloat(s.wt);
                if (!isNaN(wtJadwal) && wtJadwal > 0) {
                    spesifikWt = wtJadwal;
                }
            }
        }
    });

    if (totalWtPabrik <= 0) totalWtPabrik = 480; 
    if (spesifikWt <= 0) spesifikWt = 480;

    let tpProd = totalPabrik.production / 60;
    let tpMaint = totalPabrik.maintenance / 60;
    let tpPpic = totalPabrik.ppic / 60;

    let percTpProd = ((tpProd / totalWtPabrik) * 100).toFixed(1);
    let percTpMaint = ((tpMaint / totalWtPabrik) * 100).toFixed(1);
    let percTpPpic = ((tpPpic / totalWtPabrik) * 100).toFixed(1);

    document.getElementById('global-val-prod').innerHTML = `${tpProd.toFixed(1)} <br><span style="font-size:0.65em; font-weight:normal;">(${percTpProd}%)</span>`;
    document.getElementById('global-val-maint').innerHTML = `${tpMaint.toFixed(1)} <br><span style="font-size:0.65em; font-weight:normal;">(${percTpMaint}%)</span>`;
    document.getElementById('global-val-ppic').innerHTML = `${tpPpic.toFixed(1)} <br><span style="font-size:0.65em; font-weight:normal;">(${percTpPpic}%)</span>`;

    let mProd = bd.accumulated.production / 60;
    let mMaint = bd.accumulated.maintenance / 60;
    let mPpic = bd.accumulated.ppic / 60;

    let percMProd = ((mProd / spesifikWt) * 100).toFixed(1);
    let percMMaint = ((mMaint / spesifikWt) * 100).toFixed(1);
    let percMPpic = ((mPpic / spesifikWt) * 100).toFixed(1);

    document.getElementById('val-bd-prod').innerHTML = `${mProd.toFixed(1)} m <br><span style="font-size:0.7em; color:#94a3b8;">(${percMProd}%)</span>`;
    document.getElementById('val-bd-maint').innerHTML = `${mMaint.toFixed(1)} m <br><span style="font-size:0.7em; color:#94a3b8;">(${percMMaint}%)</span>`;
    document.getElementById('val-bd-ppic').innerHTML = `${mPpic.toFixed(1)} m <br><span style="font-size:0.7em; color:#94a3b8;">(${percMPpic}%)</span>`;

    updateBreakdownChart(tpProd, tpMaint, tpPpic);
}

setInterval(() => {
    let mData = machineData[currentMachine];
    if(mData && mData.breakdown.isActive && mData.breakdown.startTime) {
        let elapsedSec = Math.floor((Date.now() - mData.breakdown.startTime.getTime()) / 1000);
        let h = Math.floor(elapsedSec / 3600).toString().padStart(2, '0');
        let m = Math.floor((elapsedSec % 3600) / 60).toString().padStart(2, '0');
        let s = (elapsedSec % 60).toString().padStart(2, '0');
        
        if(document.getElementById('page-kpi-oee').classList.contains('active')) {
            document.getElementById('bd-timer').innerText = `${h}:${m}:${s}`;
        }
    }
    checkPendingModal();
}, 1000);

function initBreakdownChart() {
    const ctx = document.getElementById('breakdownChart').getContext('2d');
    bdChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Production', 'Maintenance', 'PPIC'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: ['#3b82f6', '#ef4444', '#8b5cf6'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } }
        }
    });
}

function updateBreakdownChart(prod, maint, ppic) {
    if(bdChartInstance) {
        bdChartInstance.data.datasets[0].data = [parseFloat(prod), parseFloat(maint), parseFloat(ppic)];
        bdChartInstance.update();
    }
}

function initTampilanCharts() {
    const ctxSpeed = document.getElementById('tampilanSpeedChart').getContext('2d');
    tampilanSpeedChartInstance = new Chart(ctxSpeed, {
        type: 'line',
        data: {
            labels: tampilanTimeLabels,
            datasets: [{
                label: 'Speed Aktual (m/min)',
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                data: tampilanSpeedData,
                tension: 0.4, fill: true, borderWidth: 3, pointRadius: 0
            }]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false, 
            animation: false, 
            plugins: { 
                legend: { display: false },
                zoom: {
                    pan: { 
                        enabled: true, 
                        mode: 'x',
                        onPanComplete: function() {
                            isLiveView = false;
                            let btn = document.getElementById('btnLiveView');
                            if(btn) btn.style.display = 'inline-flex';
                        }
                    },
                    zoom: { 
                        wheel: { enabled: true }, 
                        pinch: { enabled: true }, 
                        mode: 'x',
                        onZoomComplete: function() {
                            isLiveView = false;
                            let btn = document.getElementById('btnLiveView');
                            if(btn) btn.style.display = 'inline-flex';
                        }
                    }
                }
            },
            scales: { y: { min: 0, grid: { borderDash: [5, 5] } }, x: { grid: { display: false } } }
        }
    });

    const ctxDt = document.getElementById('tampilanDtChart').getContext('2d');
    tampilanDtChartInstance = new Chart(ctxDt, {
        type: 'doughnut',
        data: {
            labels: ['Production', 'Maintenance', 'PPIC'],
            datasets: [{ data: [0, 0, 0], backgroundColor: ['#3b82f6', '#ef4444', '#8b5cf6'], borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
}

function resetTampilanOrder() {
    let elKode = document.getElementById('tampilan-kode-mat'); if(elKode) elKode.innerText = "-";
    let elT100 = document.getElementById('tampilan-target100'); if(elT100) elT100.innerText = "0";
    let elIdSp = document.getElementById('tampilan-ideal-speed'); if(elIdSp) elIdSp.innerText = "0 m/min";
    let elWt = document.getElementById('tampilan-wt'); if(elWt) elWt.innerText = "0 Min";
    let elAct = document.getElementById('tampilan-actual'); if(elAct) elAct.innerText = "0 Crt"; 
    let elAvgSp = document.getElementById('tampilan-avg-speed'); if(elAvgSp) elAvgSp.innerText = "0.00 Crt/Min";
    let elEff = document.getElementById('tampilan-eff'); if(elEff) elEff.innerText = "0.00%";

    let elDtMtc = document.getElementById('tampilan-dt-mtc'); if(elDtMtc) elDtMtc.innerText = "0 Min";
    let elDtProd = document.getElementById('tampilan-dt-prod'); if(elDtProd) elDtProd.innerText = "0 Min";
    let elDtPpic = document.getElementById('tampilan-dt-ppic'); if(elDtPpic) elDtPpic.innerText = "0 Min";

    let elDtTotal = document.getElementById('tampilan-detail-downtime'); if(elDtTotal) elDtTotal.innerText = "0 Min";
    let elOpTime = document.getElementById('tampilan-detail-optime'); if(elOpTime) elOpTime.innerText = "0 Min";
    
    // --- RESET TARGET & KEKURANGAN JUGA ---
    let elTargetAll = document.getElementById('tampilan-target-keseluruhan'); if(elTargetAll) elTargetAll.innerText = "0 Crt";
    let elKurang = document.getElementById('tampilan-kekurangan'); if(elKurang) elKurang.innerText = "0 Crt";
}

function updateTampilanUI() {
    if(!document.getElementById('page-tampilan').classList.contains('active') || !currentMachine) return;
    
    let mData = machineData[currentMachine];
    
    let elNamaMesin = document.getElementById('tampilan-nama-mesin'); if(elNamaMesin) elNamaMesin.innerText = mData.name;
    let elShiftInfo = document.getElementById('tampilan-shift'); if(elShiftInfo) elShiftInfo.innerText = getCurrentShiftLabel();
    
    let currentTglIso = getFactoryDateIso();
    
    let isCurrentlyBd = mData.breakdown.isActive;
    let productToCheck = mData.currentProduct;

    let matchingScheds = scheduleDataList.filter(s => 
        s.tglFull === currentTglIso && 
        s.shift === currentActiveShift && 
        s.mesin === currentMachine
    );

    let activeSched = matchingScheds.find(s => s.produk.trim() === productToCheck.trim());
    
    if (!activeSched && matchingScheds.length > 0) {
        activeSched = matchingScheds[matchingScheds.length - 1];
    }

    let isIdle = productToCheck.includes("IDLE") || productToCheck.includes("BELUM ADA JADWAL") || productToCheck === "";

    let kondisiEl = document.getElementById('tampilan-kondisi');
    let produkEl = document.getElementById('tampilan-produk');

    let finalProductName = activeSched ? activeSched.produk.trim() : productToCheck.trim();

    if (isCurrentlyBd) {
        if (kondisiEl) { kondisiEl.innerText = "BREAKDOWN"; kondisiEl.style.color = "var(--danger)"; }
        if (produkEl) { produkEl.innerText = finalProductName; produkEl.style.color = "var(--text-dark)"; }
    } else if (isIdle) {
        if (kondisiEl) { kondisiEl.innerText = "IDLE / STANDBY"; kondisiEl.style.color = "var(--warning)"; }
        if (produkEl) { 
            produkEl.innerText = activeSched ? finalProductName + " (Menunggu Start)" : "TIDAK ADA PRODUK"; 
            produkEl.style.color = "#94a3b8"; 
        }
    } else {
        if (kondisiEl) { kondisiEl.innerText = "RUNNING"; kondisiEl.style.color = "var(--success)"; }
        if (produkEl) { produkEl.innerText = finalProductName; produkEl.style.color = "var(--accent-color)"; }
    }

    let imgProduk = document.getElementById('tampilan-img-produk');
    let placeholderProduk = document.getElementById('tampilan-img-produk-placeholder');
    let imgSpec = document.getElementById('tampilan-img-spec');
    let placeholderSpec = document.getElementById('tampilan-img-spec-placeholder');

    if (imgProduk && placeholderProduk && imgSpec && placeholderSpec) {
        if (finalProductName && !finalProductName.includes("IDLE") && !finalProductName.includes("BELUM ADA JADWAL")) {
            
            let extensions = ['.jpg', '.png', '.jpeg', '.webp', '.JPG', '.PNG', '.JPEG'];
            
            function tryLoadImage(imgEl, placeholderEl, basePath, index, errorHTML) {
                if (index >= extensions.length) {
                    imgEl.style.display = 'none';
                    placeholderEl.style.display = 'block';
                    placeholderEl.innerHTML = errorHTML;
                    imgEl.onerror = null;
                    return;
                }
                imgEl.onload = function() {
                    imgEl.onerror = null;
                };
                imgEl.onerror = function() {
                    tryLoadImage(imgEl, placeholderEl, basePath, index + 1, errorHTML);
                };
                imgEl.src = basePath + extensions[index];
                imgEl.style.display = 'block';
                placeholderEl.style.display = 'none';
            }

            let basePathProduk = `gambar/${finalProductName}`;
            let basePathSpec = `gambar/${finalProductName}_spec`;
            
            let errorProduk = '<i class="fa-regular fa-image" style="font-size: 2em; display: block; margin-bottom: 10px;"></i>Belum Ada Gambar<br><small style="font-weight: normal;">(Pastikan nama file sesuai)</small>';
            let errorSpec = '<i class="fa-solid fa-file-circle-xmark" style="font-size: 2em; display: block; margin-bottom: 10px;"></i>Belum Ada Spec Sheet<br><small style="font-weight: normal;">(Pastikan nama file sesuai)</small>';

            tryLoadImage(imgProduk, placeholderProduk, basePathProduk, 0, errorProduk);
            tryLoadImage(imgSpec, placeholderSpec, basePathSpec, 0, errorSpec);

        } else {
            imgProduk.style.display = 'none';
            placeholderProduk.style.display = 'block';
            
            imgSpec.style.display = 'none';
            placeholderSpec.style.display = 'block';
        }
    }

    let schedWt = "0 Min";
    let schedActual = "0 Crt";
    let schedAvgSpeed = "0.00 Crt/Min";
    let schedEff = "0.00%";

    let schedDtMtc = "0 Min";
    let schedDtProd = "0 Min";
    let schedDtPpic = "0 Min";

    let schedDtTotal = "0 Min"; 
    let schedOpTime = "0 Min";  

    if(activeSched) { 
        if(typeof dataProduksi !== 'undefined') {
            let prodDetail = dataProduksi.find(item => item["NAMA PRODUK"].trim() === activeSched.produk.trim());
            let elKodeMat = document.getElementById('tampilan-kode-mat');
            if(elKodeMat) {
                if(prodDetail) {
                    elKodeMat.innerText = prodDetail["KODE MATERIAL SAP"] || prodDetail["KODE MATERIAL FG NEW"] || "-";
                } else {
                    elKodeMat.innerText = "-";
                }
            }
        }

        let elT100 = document.getElementById('tampilan-target100'); 
        if(elT100) elT100.innerText = activeSched.t100 !== undefined ? activeSched.t100 : "0"; 
        
        let iSpeed = parseFloat(activeSched.speed);
        let elIdealSp = document.getElementById('tampilan-ideal-speed');
        if(elIdealSp) elIdealSp.innerText = isNaN(iSpeed) ? "0 m/min" : iSpeed.toFixed(3) + " m/min"; 
        
        schedWt = (activeSched.wt !== undefined ? activeSched.wt : 0) + " Min";
        schedActual = (activeSched.actual !== undefined ? activeSched.actual : 0) + " Crt";
        schedEff = activeSched.eff || "0.00%"; 

        schedDtMtc = (activeSched.dtMtc !== undefined ? activeSched.dtMtc : 0) + " Min";
        schedDtProd = (activeSched.dtProd !== undefined ? activeSched.dtProd : 0) + " Min";
        schedDtPpic = (activeSched.dtPpic !== undefined ? activeSched.dtPpic : 0) + " Min";

        schedDtTotal = (activeSched.dtTotal !== undefined ? activeSched.dtTotal : 0) + " Min"; 
        schedOpTime = (activeSched.opTime !== undefined ? activeSched.opTime : 0) + " Min"; 

        if(activeSched.opTime > 0) {
             let avgSpeed = (activeSched.actual / activeSched.opTime).toFixed(2);
             schedAvgSpeed = avgSpeed + " Crt/Min";
        } else {
             schedAvgSpeed = "0.00 Crt/Min";
        }

        // --- TAMBAHAN BARU: KALKULASI TARGET & KEKURANGAN DENGAN LOGIKA "RESET SAAT GANTI PRODUK" ---
        // TANPA MENGGUNAKAN FIREBASE FETCH AGAR KUOTA AMAN 100%
        let totalTarget = 0;
        let totalActual = 0;
        
        let mTarget = currentMachine.trim().toUpperCase();
        let pTarget = activeSched.produk.trim().toUpperCase();

        // Ambil semua jadwal khusus untuk mesin ini agar mudah diurutkan
        let macScheds = scheduleDataList.filter(s => s.mesin.trim().toUpperCase() === mTarget);
        
        // Cari posisi jadwal yang sedang aktif sekarang
        let activeIdx = macScheds.findIndex(s => s === activeSched);
        
        if (activeIdx !== -1) {
            // 1. Hitung MUNDUR ke masa lalu selama produknya belum ganti
            for (let i = activeIdx; i >= 0; i--) {
                if (macScheds[i].produk.trim().toUpperCase() === pTarget) {
                    totalTarget += (parseFloat(macScheds[i].t100) || 0);
                    totalActual += (parseFloat(macScheds[i].actual) || 0);
                } else {
                    break; // GANTI PRODUK = STOP HITUNG! (Logika Reset)
                }
            }

            // 2. Hitung MAJU ke masa depan (shift selanjutnya) selama produknya belum ganti
            for (let i = activeIdx + 1; i < macScheds.length; i++) {
                if (macScheds[i].produk.trim().toUpperCase() === pTarget) {
                    totalTarget += (parseFloat(macScheds[i].t100) || 0);
                    totalActual += (parseFloat(macScheds[i].actual) || 0);
                } else {
                    break; // GANTI PRODUK = STOP HITUNG!
                }
            }
        }

        // 3. Hitung Kekurangan (Target - Total Actual)
        let kekurangan = totalTarget - totalActual;
        if (kekurangan < 0) kekurangan = 0; // Jika surplus, batasi ke 0

        // 4. Update UI Secara Langsung
        let elTargetAll = document.getElementById('tampilan-target-keseluruhan'); 
        if (elTargetAll) elTargetAll.innerText = totalTarget + " Crt";
        
        let elKurang = document.getElementById('tampilan-kekurangan'); 
        if (elKurang) elKurang.innerText = kekurangan + " Crt";
        // ------------------------------------------------------------------------------------------

    } else {
        resetTampilanOrder();
    }
    
    let elWt = document.getElementById('tampilan-wt'); if(elWt) elWt.innerText = schedWt;
    let elAct = document.getElementById('tampilan-actual'); if(elAct) elAct.innerText = schedActual;
    let elAvgSp = document.getElementById('tampilan-avg-speed'); if(elAvgSp) elAvgSp.innerText = schedAvgSpeed;
    let elEff = document.getElementById('tampilan-eff'); if(elEff) elEff.innerText = schedEff;

    let elDtMtc = document.getElementById('tampilan-dt-mtc'); if(elDtMtc) elDtMtc.innerText = schedDtMtc;
    let elDtProd = document.getElementById('tampilan-dt-prod'); if(elDtProd) elDtProd.innerText = schedDtProd;
    let elDtPpic = document.getElementById('tampilan-dt-ppic'); if(elDtPpic) elDtPpic.innerText = schedDtPpic;
    
    let elDtTotal = document.getElementById('tampilan-detail-downtime'); if(elDtTotal) elDtTotal.innerText = schedDtTotal;
    let elOpTime = document.getElementById('tampilan-detail-optime'); if(elOpTime) elOpTime.innerText = schedOpTime;

    let kwhDisplay = (mData.kwhShift || 0).toFixed(4) + " kWh";
    let costDisplay = formatRupiah(mData.costShift || 0);

    let elKwh = document.getElementById('tampilan-kwh'); if(elKwh) elKwh.innerText = kwhDisplay;
    let elCost = document.getElementById('tampilan-cost'); if(elCost) elCost.innerText = costDisplay;

    let dp = mData.breakdown.accumulated.production / 60;
    let dm = mData.breakdown.accumulated.maintenance / 60;
    let dppic = mData.breakdown.accumulated.ppic / 60;
    
    if(tampilanDtChartInstance) {
        tampilanDtChartInstance.data.datasets[0].data = [dp, dm, dppic];
        tampilanDtChartInstance.update();
    }
}

function initBreakdownFreq() {
    let container = document.getElementById('breakdown-freq-container');
    if (!container) return;
    container.innerHTML = '';
    rawMachineList.forEach(mac => {
        if(breakdownFreq[mac] === undefined) breakdownFreq[mac] = 0;
        container.innerHTML += `
            <div style="display:flex; flex-direction:column; align-items:center; padding: 15px; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 8px; cursor: default;">
                <span style="font-weight:bold; font-size: 1.1em; color: var(--text-dark);">${mac}</span>
                <span style="color: var(--danger); font-size: 1.2em; font-weight: bold;" id="bd-count-${mac}">${breakdownFreq[mac]}x</span>
            </div>
        `;
    });
}

function renderQualityTable() {
    let tbody = document.getElementById('sm-quality-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (scheduleDataList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; font-style: italic; padding: 20px;">Belum ada data dari Schedule Produksi. Silakan isi data di menu Schedule Produksi terlebih dahulu!</td></tr>`;
        return;
    }

    scheduleDataList.forEach((d, index) => {
        let qualityVal = d.quality !== undefined ? d.quality : '0.00%';
        let accVal = d.accProduk !== undefined ? d.accProduk : '';

        tbody.innerHTML += `
            <tr>
                <td><strong>${d.bulan}</strong></td>
                <td><strong>${d.tgl}</strong></td>
                <td>${d.wt}</td>
                <td style="color:blue; font-weight:bold;">${d.mesin}</td>
                <td style="color:blue; text-align:left;">${d.produk}</td>
                <td style="color:red; font-weight:bold;" id="qual-actual-val-${index}">${d.actual}</td>
                <td>
                    <input type="number" id="qual-input-${index}" value="${accVal}" placeholder="Input ACC..." 
                        oninput="calculateQualityPercent(${index}, this.value)" 
                        style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center; font-weight: bold; color: var(--purple);">
                </td>
                <td style="background: #f0fdf4; color: var(--success); font-weight: bold; font-size: 1.1em;" id="quality-res-${index}">${qualityVal}</td>
            </tr>
        `;
    });
}

function calculateQualityPercent(index, value) {
    let entry = scheduleDataList[index];
    let acc = parseFloat(value) || 0;
    
    if (acc > entry.actual) {
        alert("Jumlah ACC Produk tidak boleh melebihi hasil Actual Output!");
        acc = entry.actual;
        document.getElementById(`qual-input-${index}`).value = acc;
    }

    entry.accProduk = acc;
    let percent = entry.actual > 0 ? (acc / entry.actual) * 100 : 0;
    entry.quality = percent.toFixed(2) + '%';
    
    let resEl = document.getElementById(`quality-res-${index}`);
    if(resEl) resEl.innerText = entry.quality;
}

function updateScheduleMaintenanceStats() {
    if(scheduleDataList.length === 0) {
        document.getElementById('sm-avail').innerText = "0%";
        document.getElementById('sm-perf').innerText = "0%";
        document.getElementById('sm-oee').innerText = "0%";
        return;
    }
    let sumAvail = 0, sumPerf = 0, sumOee = 0;
    scheduleDataList.forEach(d => {
        sumAvail += parseFloat(d.availMachine) || 0;
        sumPerf += parseFloat(d.perf) || 0;
        sumOee += parseFloat(d.oee) || 0;
    });
    let len = scheduleDataList.length;
    document.getElementById('sm-avail').innerText = (sumAvail/len).toFixed(2) + "%";
    document.getElementById('sm-perf').innerText = (sumPerf/len).toFixed(2) + "%";
    document.getElementById('sm-oee').innerText = (sumOee/len).toFixed(2) + "%";
}

function switchPage(pageId) {
    // --- FITUR BARU: PASSWORD UNTUK MENU SCHEDULE ---
    if (pageId === 'schedule') {
        let pass = prompt("Masukkan Password untuk mengakses halaman Schedule Produksi:");
        if (pass !== "admin123") { 
            alert("Password Salah! Akses ditolak.");
            return; 
        }
    }
    // ------------------------------------------------

    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
    
    document.getElementById('page-' + pageId).classList.add('active');
    document.getElementById('nav-' + pageId).classList.add('active');

    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if(window.innerWidth <= 768) {
        sidebar.classList.remove('show');
        overlay.classList.remove('show');
    }

    if(pageId === 'dashboard') {
        document.getElementById('topbar-title').innerText = "Condition Based Monitoring";
        refreshDashboardUI();
    } else if (pageId === 'machine-list') {
        document.getElementById('topbar-title').innerText = "Manajemen Database Mesin";
        renderDatabaseTable(); 
    } else if (pageId === 'schedule-maintenance') {
        document.getElementById('topbar-title').innerText = "Schedule Maintenance & Work Orders";
        initBreakdownFreq();
        updateScheduleMaintenanceStats();
        renderQualityTable(); 
    } else if (pageId === 'production') {
        document.getElementById('topbar-title').innerText = "Manajemen Lini Produksi & Shift";
        renderProductionTable();
    } else if (pageId === 'kpi-oee') {
        document.getElementById('topbar-title').innerText = "Input & Analisa Downtime";
        let sel = document.getElementById('bd-machine-select');
        sel.innerHTML = '';
        rawMachineList.forEach(id => {
            sel.innerHTML += `<option value="${id}">${machineData[id].name}</option>`;
        });
        sel.value = currentMachine;
        updateBreakdownUI();
    } else if (pageId === 'electricity') {
        document.getElementById('topbar-title').innerText = "Finansial & Cost Konsumsi Listrik Pabrik";
        renderElectricityTable();
    } else if (pageId === 'logbook') {
        document.getElementById('topbar-title').innerText = "Catatan Logbook Technician & SHO";
    } else if (pageId === 'schedule') {
        document.getElementById('topbar-title').innerText = "Schedule Produksi & Parameter";
        initSchedulePage();
        renderScheduleTable();
    } else if (pageId === 'tampilan') {
        document.getElementById('topbar-title').innerText = "Tampilan Mesin Terintegrasi";
        let sel = document.getElementById('tampilan-machine-select');
        sel.innerHTML = '';
        rawMachineList.forEach(id => {
            sel.innerHTML += `<option value="${id}">${machineData[id].name}</option>`;
        });
        sel.value = currentMachine;
        updateTampilanUI();
        
        if (currentMachine) fetchHistoryFromLocal(currentMachine);
    } else if (pageId === 'analisa') {
        document.getElementById('topbar-title').innerText = "Analisa Historis & Reporting";
        initAnalisaPage();
    }

    checkPendingModal();
}

function openModal(modalId) { 
    document.getElementById(modalId).classList.add('active'); 
}
        
function closeModal(modalId) { 
    document.getElementById(modalId).classList.remove('active'); 
    if(modalId === 'addMachineModal') {
        document.getElementById('inputMachineId').value = '';
        document.getElementById('inputMachineName').value = '';
        document.querySelectorAll('.process-check').forEach(cb => cb.checked = false);
    }
}

function renderDatabaseTable() {
    const tbody = document.getElementById('db-machine-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    rawMachineList.forEach(id => {
        let mData = machineData[id];
        let lifeBadgeClass = 'life-good';
        if(mData.runningHours >= 950) lifeBadgeClass = 'life-danger';
        else if(mData.runningHours >= 800) lifeBadgeClass = 'life-warn';

        tbody.innerHTML += `<tr>
            <td><strong>${id}</strong></td>
            <td>${mData.name}</td>
            <td>${mData.processes.join(', ')}</td>
            <td style="text-align: center;">
                <span class="life-badge ${lifeBadgeClass}">${mData.runningHours} Jam</span>
            </td>
            <td style="text-align: center;">
                <button class="btn btn-danger" onclick="deleteMachine('${id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    });
}

function saveNewMachine() {
    let inputId = document.getElementById('inputMachineId').value.trim().toUpperCase();
    let inputName = document.getElementById('inputMachineName').value.trim();
    
    if(!inputId || !inputName) return alert("ID Mesin dan Nama Mesin tidak boleh kosong!");
    if(rawMachineList.includes(inputId)) return alert("Mesin ini sudah ada di database!");

    let selectedProcesses = [];
    document.querySelectorAll('.process-check:checked').forEach(cb => selectedProcesses.push(cb.value));
    if(selectedProcesses.length === 0) return alert("Pilih minimal satu proses!");

    let randomKw = parseFloat((Math.random() * 20 + 30).toFixed(2));

    rawMachineList.unshift(inputId); 
    breakdownFreq[inputId] = 0; 
    machineData[inputId] = { 
        name: inputName, 
        processes: selectedProcesses, 
        runningHours: 0,
        currentProduct: "IDLE / TIDAK PRODUKSI",
        lastProductBeforeBd: null,
        powerKw: randomKw,
        livePowerKw: 0, 
        kwhShift: 0,   
        costShift: 0,   
        activeSecondsThisShift: 0, 
        lastFB: undefined,
        breakdown: {
            isActive: false,
            category: null,
            startTime: null,
            lockedElapsedSec: null, 
            accumulated: { production: 0, maintenance: 0, ppic: 0 }
        }
    };
    
    refreshDashboardUI(); 
    renderDatabaseTable(); 
    if(document.getElementById('page-production').classList.contains('active')) renderProductionTable();
    closeModal('addMachineModal');
}

function deleteMachine(id) {
    if(!confirm("Yakin ingin menghapus mesin " + id + "?")) return;
    rawMachineList = rawMachineList.filter(m => m !== id); 
    delete machineData[id];
    delete breakdownFreq[id]; 
    
    if(currentMachine === id && rawMachineList.length > 0) currentMachine = rawMachineList[0];

    refreshDashboardUI();
    renderDatabaseTable();
    if(document.getElementById('page-production').classList.contains('active')) renderProductionTable();
}

function refreshDashboardUI() {
    const selectElement = document.getElementById('machine-select');
    if (selectElement) {
        selectElement.innerHTML = '';
        rawMachineList.forEach(id => {
            selectElement.innerHTML += `<option value="${id}">${machineData[id].name}</option>`;
        });
    }
    
    if(rawMachineList.length > 0) {
        if(!currentMachine || !rawMachineList.includes(currentMachine)) currentMachine = rawMachineList[0];
        if (selectElement) selectElement.value = currentMachine;
    } else {
        currentMachine = "";
    }
}

function switchMachine() {
    currentMachine = document.getElementById('machine-select').value;
    refreshDashboardUI(); 
    updateBreakdownUI(); 
    updateTampilanUI();
    fetchHistoryFromLocal(currentMachine);
    
    checkPendingModal();
}

function getProcessRemainingLife(machineId, processName) {
    let charCodeSum = 0;
    let combined = machineId + processName;
    for(let i=0; i<combined.length; i++) charCodeSum += combined.charCodeAt(i);
    return (charCodeSum * 15) % 1000 + 1; 
}

function setRunningProduct(index) {
    let dataJadwal = scheduleDataList[index];
    let mData = machineData[dataJadwal.mesin];

    if(!mData) return;

    if(mData.breakdown.isActive) {
        alert("Mesin sedang Breakdown! Selesaikan Breakdown di menu Downtime terlebih dahulu sebelum ganti produk.");
        renderScheduleTable(); 
        return;
    }

    mData.currentProduct = dataJadwal.produk.trim();

    fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/active_runs/${dataJadwal.mesin}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            machine: dataJadwal.mesin,
            product: dataJadwal.produk.trim(),
            timestamp: Date.now()
        })
    }).catch(e => console.error(e));
    
    if(document.getElementById('page-production').classList.contains('active')) renderProductionTable();
    if(document.getElementById('page-dashboard').classList.contains('active')) refreshDashboardUI();
    if(document.getElementById('page-tampilan').classList.contains('active') && currentMachine === dataJadwal.mesin) {
        updateTampilanUI();
        fetchHistoryFromLocal(currentMachine);
    }
    if(document.getElementById('page-schedule').classList.contains('active')) renderScheduleTable();
    
    updateBreakdownUI();
}

// --- LOGIKA PERGANTIAN SHIFT ---
setInterval(() => {
    let newShift = getCurrentShiftInfo();
    if(newShift !== currentActiveShift) {
        let oldShift = currentActiveShift;
        let currentTglIso = getFactoryDateIso();
        
        isShiftTransition = true; // KUNCI AGAR TABEL TIDAK KETABRAK DATA LAMA
        console.log(`[SHIFT CHANGE] Transisi ke ${newShift}. Resolving active downtime for old shift...`);
        
        // 1. AUTO RESOLVE DOWNTIME YANG MASIH GANTUNG KE SHIFT LAMA (Sebagai Production)
        rawMachineList.forEach(id => {
            let mData = machineData[id];
            if (mData && mData.breakdown.isActive) {
                let elapsedSec = mData.breakdown.lockedElapsedSec !== null 
                    ? mData.breakdown.lockedElapsedSec 
                    : Math.floor((Date.now() - mData.breakdown.startTime.getTime()) / 1000);
                
                console.log(`[SHIFT SPLIT] Memotong waktu downtime mesin ${id} untuk shift lama...`);
                // Paksa simpan sebagai production di shift lama (otomatis masuk ke jadwal Shift tsb)
                saveAutoBreakdown('production', id, elapsedSec);
                
                // Jika mesin secara fisik MASIH MATI (speed < 20), buat START event baru untuk shift baru
                if (autoBreakdownState[id] && autoBreakdownState[id].isAutoDown) {
                    mData.breakdown.isActive = true;
                    mData.breakdown.category = "AUTO-PENDING";
                    mData.breakdown.startTime = new Date(); // Start dari detik 0 di shift baru
                    mData.breakdown.lockedElapsedSec = null;
                    
                    // Push event ke firebase
                    fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/breakdown_events.json', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            machine: id,
                            type: 'START',
                            startTime: mData.breakdown.startTime.getTime(),
                            timestamp: Date.now()
                        })
                    }).catch(e => console.error(e));
                }
            }
        });

        // 2. Transisi Shift
        currentActiveShift = newShift;
        
        // --- UBAHAN BARU: HAPUS SEMUA DATA TIMBANGAN SAAT GANTI SHIFT ---
        rawMachineList.forEach(id => {
            fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/timbangan/${id.toUpperCase()}.json`, {
                method: 'DELETE'
            }).then(() => console.log(`[SHIFT CHANGE] Data timbangan mesin ${id} dibersihkan otomatis.`))
              .catch(e => console.error(e));
        });
        
        // Buka kunci polling setelah delay 10 detik (Beri waktu Firebase benar-benar kosong dulu)
        setTimeout(() => { isShiftTransition = false; }, 10000);
        // -----------------------------------------------------------------
        
        // 3. Reset parameter running shift baru
        rawMachineList.forEach(id => {
            if (machineData[id]) {
                machineData[id].activeSecondsThisShift = 0;
                machineData[id].kwhShift = 0;
                machineData[id].costShift = 0;
                
                machineData[id].breakdown.accumulated = { production: 0, maintenance: 0, ppic: 0 };
                
                let schedForShift = scheduleDataList.find(s => s.mesin === id && s.tglFull === currentTglIso && s.shift === currentActiveShift);
                if(schedForShift) {
                    machineData[id].currentProduct = schedForShift.produk.trim();
                } else {
                    machineData[id].currentProduct = "IDLE / BELUM ADA JADWAL";
                }
            }
        });
        
        updateBreakdownUI(); 
        refreshDashboardUI();
        if(document.getElementById('page-schedule').classList.contains('active')) renderScheduleTable();
    }

    let currentTglIso = getFactoryDateIso();

    rawMachineList.forEach(id => {
        let mData = machineData[id];
        let isRunning = !mData.currentProduct.includes("IDLE") && !mData.currentProduct.includes("BELUM ADA JADWAL") && !mData.breakdown.isActive;
        
        // Pastikan hanya mengakumulasi detik jika ADA jadwal aktif!
        let activeSched = scheduleDataList.find(s => s.mesin === id && s.tglFull === currentTglIso && s.shift === currentActiveShift && s.produk.trim() === mData.currentProduct.trim());
        
        if(isRunning && activeSched) {
            mData.activeSecondsThisShift += 1; 
        }
    });

    let isSchedulePageActive = document.getElementById('page-schedule').classList.contains('active');
    let isQualityPageActive = document.getElementById('page-schedule-maintenance').classList.contains('active');
    let isTampilanActive = document.getElementById('page-tampilan').classList.contains('active');

    if(scheduleDataList.length > 0) {
        
        // PRE-CALCULATE SCHEDULE COUNTS PER MACHINE-SHIFT-DATE TO HANDLE NAME EDITS
        let schedCounts = {};
        scheduleDataList.forEach(s => {
            let key = s.mesin + "_" + s.tglFull + "_" + s.shift;
            schedCounts[key] = (schedCounts[key] || 0) + 1;
        });

        scheduleDataList.forEach((d, index) => {

            let sumProd = 0, sumMtc = 0, sumPpic = 0;
            let sKey = d.mesin + "_" + d.tglFull + "_" + d.shift;
            let countForThisMac = schedCounts[sKey] || 1;

            allBreakdownEvents.forEach(ev => {
                let evProd = (ev.product || "").replace(/[^a-z0-9]/gi, '').toLowerCase();
                let dProd = (d.produk || "").replace(/[^a-z0-9]/gi, '').toLowerCase();
                
                let evMac = (ev.machine || "").trim().toUpperCase();
                let dMac = (d.mesin || "").trim().toUpperCase();
                
                let evShift = (ev.shift || "").trim().toLowerCase();
                let dShift = (d.shift || "").trim().toLowerCase();

                if (ev.type === 'END' && evMac === dMac && evShift === dShift) {
                    let isDateMatch = (ev.date === d.tglFull) || (!d.tglFull); 

                    if (isDateMatch) {
                        let isProductMatch = false;
                        if (evProd === dProd) {
                            isProductMatch = true;
                        } else if (countForThisMac === 1) {
                            isProductMatch = true;
                        }

                        if (isProductMatch) {
                            let eSec = parseFloat(ev.elapsedSec) || 0;
                            let dtMins = eSec / 60; // GAK USAH DI CEIL, BIARKAN DESIMAL KOMA ASLINYA
                            
                            if (ev.category === 'production') sumProd += dtMins;
                            if (ev.category === 'maintenance') sumMtc += dtMins;
                            if (ev.category === 'ppic') sumPpic += dtMins;
                        }
                    }
                }
            });

            d.dtProd = parseFloat(sumProd.toFixed(1));
            d.dtMtc = parseFloat(sumMtc.toFixed(1));
            d.dtPpic = parseFloat(sumPpic.toFixed(1));

            let workingTime = parseFloat(d.wt) || 0;
            let totalDtAll = parseFloat(d.dtMtc || 0) + parseFloat(d.dtPpic || 0) + parseFloat(d.dtProd || 0);
            
            let effMesin = d.t100 > 0 ? (d.actual / d.t100) * 100 : 0;
            let percDtMtc = workingTime > 0 ? (d.dtMtc / workingTime) * 100 : 0;
            let percDtAll = workingTime > 0 ? (totalDtAll / workingTime) * 100 : 0;
            
            let operatingTime = workingTime - totalDtAll;
            let availTime = workingTime - d.dtMtc;
            let availMachinePerc = workingTime > 0 ? (availTime / workingTime) * 100 : 0;
            
            let idealSpeed = parseFloat(d.speed) || 0;
            let performance = operatingTime > 0 ? ((idealSpeed * d.actual) / operatingTime) * 100 : 0;
            let oee = (performance / 100) * (availMachinePerc / 100) * 100;

            d.eff = effMesin.toFixed(2) + '%';
            d.dtTotal = parseFloat(totalDtAll.toFixed(1));
            d.pDtMtc = percDtMtc.toFixed(2) + '%';
            d.pDtAll = percDtAll.toFixed(2) + '%';
            d.opTime = parseFloat(operatingTime.toFixed(1));
            d.availTime = parseFloat(availTime.toFixed(1));
            d.availMachine = availMachinePerc.toFixed(2) + '%';
            d.perf = performance.toFixed(2) + '%';
            d.oee = oee.toFixed(2) + '%';

            if (d.tglFull === currentTglIso && d.shift === currentActiveShift) {
                let mac = d.mesin;
                let mData = machineData[mac];
                
                let isProductRunning = (mData.currentProduct.trim() === d.produk.trim());

                if (isQualityPageActive && isProductRunning) {
                    let cellActual = document.getElementById(`qual-actual-val-${index}`);
                    if (cellActual && cellActual.innerText != d.actual) cellActual.innerText = d.actual;
                    
                    let accInput = document.getElementById(`qual-input-${index}`);
                    if(accInput && accInput.value) {
                        calculateQualityPercent(index, accInput.value);
                    }
                }
            }
            
            if (isSchedulePageActive) {
                let cellActual = document.getElementById(`sched-actual-${index}`);
                if (cellActual && document.activeElement !== cellActual) {
                    cellActual.value = d.actual;
                }
                
                let effEl = document.getElementById(`sched-eff-${index}`);
                if (effEl) {
                    effEl.innerText = d.eff;
                    document.getElementById(`sched-dtprod-${index}`).innerText = d.dtProd;
                    document.getElementById(`sched-dtmtc-${index}`).innerText = d.dtMtc;
                    document.getElementById(`sched-dtppic-${index}`).innerText = d.dtPpic;
                    document.getElementById(`sched-dttotal-${index}`).innerText = d.dtTotal;
                    document.getElementById(`sched-pdtmtc-${index}`).innerText = d.pDtMtc;
                    document.getElementById(`sched-pdtall-${index}`).innerText = d.pDtAll;
                    document.getElementById(`sched-optime-${index}`).innerText = d.opTime;
                    document.getElementById(`sched-availtime-${index}`).innerText = d.availTime;
                    document.getElementById(`sched-availm-${index}`).innerText = d.availMachine;
                    document.getElementById(`sched-perf-${index}`).innerText = d.perf;
                    document.getElementById(`sched-oee-${index}`).innerText = d.oee;
                    
                    let costEl = document.getElementById(`sched-cost-${index}`);
                    if(costEl) {
                        let costVal = d.costListrik !== undefined ? formatRupiah(d.costListrik) : 'Rp 0';
                        costEl.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <i class="fa-solid fa-bolt" style="color: #f59e0b; filter: drop-shadow(0 0 2px rgba(245, 158, 11, 0.4)); font-size: 1.1em;"></i>
                            <span style="letter-spacing: 0.5px;">${costVal}</span>
                        </div>`;
                    }
                }
            }
        });
    }

    if(isSchedulePageActive) {
        // Biarkan saja tabelnya statis sampai user refresh atau klik, agar tidak mengganggu fokus klik & edit
    } else if(document.getElementById('page-production').classList.contains('active')) {
        renderProductionTable();
    } else if(document.getElementById('page-electricity').classList.contains('active')) {
        renderElectricityTable();
    }

    if(isTampilanActive) {
        updateTampilanUI();
    }

}, 1000);

function formatTime(totalSeconds) {
    let h = Math.floor(totalSeconds / 3600);
    let m = Math.floor((totalSeconds % 3600) / 60);
    let s = totalSeconds % 60;
    return `${h}h ${m}m ${s}s`;
}

function formatRupiah(angka) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
}

// [FUNGSI BARU] Mengunduh data Schedule ke CSV dan Mereset Firebase (KOLOM ACC & QUALITY DIHAPUS)
function exportAndClearSchedule() {
    if (scheduleDataList.length === 0) {
        alert("Tidak ada data jadwal untuk diunduh!");
        return;
    }

    let todayIso = getFactoryDateIso();

    let pastSchedules = scheduleDataList.filter(s => s.tglFull < todayIso);
    let activeSchedules = scheduleDataList.filter(s => s.tglFull >= todayIso);

    if (pastSchedules.length === 0) {
        alert("Tidak ada data jadwal dari hari sebelumnya yang bisa diunduh/di-reset.\n\nJadwal hari ini (dan masa depan) tidak akan diunduh/direset hingga berganti hari.");
        return;
    }

    if (!confirm(`Ditemukan ${pastSchedules.length} jadwal dari hari sebelumnya.\n\nApakah Anda yakin ingin mengunduh dan mereset (backup ke InfluxDB) data OEE tersebut? \n(Jadwal hari ini tidak akan terhapus)`)) {
        return;
    }

    isResettingSchedule = true; 

    console.log("Sedang mengirim backup data Schedule masa lalu ke InfluxDB...");
    fetch('https://marvelous-undamaged-flagship.ngrok-free.dev/api/write-schedule', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pastSchedules)
    })
    .then(res => {
        if(!res.ok) throw new Error("Gagal backup ke Server.");
        return res.text();
    })
    .then(msg => {
        console.log("[INFLUXDB] " + msg);
        lanjutkanExportDanClear(pastSchedules, activeSchedules);
    })
    .catch(err => {
        console.error(err);
        alert("Gagal mem-backup data ke InfluxDB! Proses hapus dibatalkan demi keamanan histori Anda.");
        isResettingSchedule = false; 
    });
}

function lanjutkanExportDanClear(pastSchedules, activeSchedules) {
    let csvContent = "data:text/csv;charset=utf-8,";
    
    let headers = [
        "Bulan", "Tanggal", "Shift", "Working Time (Menit)", "Nama Mesin", 
        "Nama Produk", "Lebar Jumbo", "Target 100% (CRT)", "Target 70% (CRT)", 
        "Actual Output (CRT)", "Eff Mesin", "Total DT Produksi", "Total DT MTC", 
        "Total DT PPIC", "Total Menit DT", "Down Time MTC (%)", "Downtime All (%)", 
        "Operating Time", "Availability Time", "Ideal Speed", "Availability Machine (%)", 
        "Performance", "OEE", "Cost Listrik (Rp)"
    ];
    csvContent += headers.join(",") + "\r\n";

    pastSchedules.forEach(d => {
        let row = [
            `"${d.bulan}"`, `"${d.tgl}"`, `"${d.shift}"`, `"${d.wt}"`, `"${d.mesin}"`, 
            `"${d.produk}"`, `"${d.lebar}"`, `"${d.t100}"`, `"${d.t70}"`, 
            `"${d.actual}"`, `"${d.eff}"`, `"${d.dtProd}"`, `"${d.dtMtc}"`, 
            `"${d.dtPpic}"`, `"${d.dtTotal}"`, `"${d.pDtMtc}"`, `"${d.pDtAll}"`, 
            `"${d.opTime}"`, `"${d.availTime}"`, `"${d.speed}"`, `"${d.availMachine}"`, 
            `"${d.perf}"`, `"${d.oee}"`, `"${d.costListrik || 0}"`
        ];
        csvContent += row.join(",") + "\r\n";
    });

    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    let today = new Date();
    let fileName = `Laporan_OEE_Schedule_${today.toISOString().slice(0, 10)}.csv`;
    link.setAttribute("download", fileName);
    
    document.body.appendChild(link); 
    link.click();
    document.body.removeChild(link);

    scheduleDataList = activeSchedules;

    let deletePromises = pastSchedules.map(s => {
        if (s.firebaseKey) {
            return fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/schedules/${s.firebaseKey}.json`, {
                method: 'DELETE'
            });
        }
        return Promise.resolve();
    });

    Promise.all(deletePromises)
    .then(() => {
        alert("Data hari sebelumnya berhasil diunduh, di-backup ke InfluxDB, dan di-reset dari sistem.\n\nJadwal hari ini tetap berjalan normal.");
        renderScheduleTable();
        updateScheduleMaintenanceStats();
        if(document.getElementById('page-schedule-maintenance').classList.contains('active')) renderQualityTable();
        
        setTimeout(() => { isResettingSchedule = false; }, 3000);
    }).catch(e => {
        console.error("Error menghapus jadwal lama:", e);
        isResettingSchedule = false;
    });
}

function renderProductionTable() {
    const tbodyProd = document.getElementById('db-production-body');
    if (!tbodyProd) return;
    tbodyProd.innerHTML = '';
    document.getElementById('production-shift-display').innerText = getCurrentShiftLabel();

    rawMachineList.forEach(id => {
        let mData = machineData[id];
        let isIdleOrBd = mData.currentProduct.includes("IDLE") || mData.breakdown.isActive;
        let badgeStyle = isIdleOrBd ? 'background-color: var(--danger); color: white;' : '';
        let displayedProduct = mData.currentProduct;

        tbodyProd.innerHTML += `<tr>
            <td><strong>${id}</strong></td>
            <td>${mData.name}</td>
            <td><span class="product-badge" style="${badgeStyle}">${displayedProduct}</span></td>
            <td style="text-align: center;">
                <button class="btn btn-outline" onclick="openProductionModal('${id}')"><i class="fa-solid fa-pen-to-square"></i> Set Produk</button>
            </td>
        </tr>`;
    });
}

function renderElectricityTable() {
    const tbodyElec = document.getElementById('db-electricity-body');
    if (!tbodyElec) return;
    tbodyElec.innerHTML = '';
    
    let totalFactoryKwh = 0;
    let totalFactoryCost = 0;

    let todayIso = getFactoryDateIso();

    rawMachineList.forEach(id => {
        let mData = machineData[id];
        
        let activeScheds = scheduleDataList.filter(s => s.mesin === id && s.tglFull === todayIso && s.shift === currentActiveShift);
        let hasSchedule = activeScheds.length > 0;
        let isIdle = mData.currentProduct.includes("IDLE") || mData.currentProduct.includes("BELUM ADA JADWAL");
        let isBd = mData.breakdown.isActive;

        let statusLed = '';
        if (!hasSchedule || isIdle) {
            statusLed = '<i class="fa-solid fa-circle" style="color:var(--danger); font-size:0.6em;"></i> Mati/Idle';
        } else if (isBd) {
            statusLed = '<i class="fa-solid fa-circle" style="color:var(--warning); font-size:0.6em;"></i> Breakdown';
        } else {
            statusLed = '<i class="fa-solid fa-circle" style="color:var(--success); font-size:0.6em;"></i> Menyala';
        }

        let actualKwh = mData.kwhShift || 0;
        let actualCost = mData.costShift || 0;
        
        totalFactoryKwh += actualKwh;
        totalFactoryCost += actualCost;

        let livePower = (!hasSchedule || isIdle) ? 0 : (mData.livePowerKw || 0); 

        tbodyElec.innerHTML += `<tr>
            <td><strong>${id}</strong></td>
            <td>${statusLed}</td>
            <td>${livePower.toFixed(2)} kW (Aktual)</td>
            <td style="text-align: center; font-family: monospace; font-size: 1.1em;">${formatTime(mData.activeSecondsThisShift)}</td>
            <td style="text-align: center; color: var(--accent-color); font-weight: bold;">${actualKwh.toFixed(4)}</td>
            <td style="text-align: right; color: var(--danger); font-weight: bold;">${formatRupiah(actualCost)}</td>
        </tr>`;
    });

    document.getElementById('total-factory-kwh').innerText = totalFactoryKwh.toFixed(4);
    document.getElementById('total-factory-cost').innerText = formatRupiah(totalFactoryCost);
}

function openProductionModal(machineId) {
    document.getElementById('inputProdMachineId').value = machineId;
    let sel = document.getElementById('inputProdSelect');
    sel.innerHTML = '';
    
    // --- UBAHAN LOGIK: Filter produk berdasarkan Mesin, supaya dropdown modal tak berselerak
    let filteredProducts = dataProduksi.filter(item => {
        let jenis = (item["BRAND/JENIS TISU"] || item["PRODUK"] || item["JENIS JUMBO"] || "").toUpperCase();
        let namaProd = (item["NAMA PRODUK"] || "").toUpperCase();
        let mac = machineId.toUpperCase();
        let isMatch = false;

        if (mac.startsWith("FC") && (jenis.includes("FACIAL") || namaProd.includes("FACIAL") || jenis.includes("SOFTPACK") || jenis.includes("HANDKERCHIEF") || jenis.includes("COMPACT"))) isMatch = true;
        else if (mac.startsWith("NP") && (jenis.includes("NAPKIN") || namaProd.includes("NAPKIN"))) isMatch = true;
        else if ((mac.startsWith("TW") || mac.startsWith("TL")) && (jenis.includes("TOWEL") || namaProd.includes("TOWEL"))) isMatch = true;
        else if ((mac.startsWith("JRT") || mac.startsWith("HRT") || mac.startsWith("JT")) && (jenis.includes("JUMBO") || jenis.includes("JRT") || jenis.includes("HRT") || jenis.includes("ROLL") || jenis.includes("CORE"))) isMatch = true;

        if (!isMatch && item["NAMA MESIN"] === mac) isMatch = true;
        return isMatch;
    }).map(p => p["NAMA PRODUK"]);
    
    let uniqueProds = [...new Set(filteredProducts)];
    if (uniqueProds.length === 0) uniqueProds = productList; // Fallback to all products

    uniqueProds.forEach(prod => {
        let isSelected = (machineData[machineId].currentProduct === prod) ? 'selected' : '';
        sel.innerHTML += `<option value="${prod}" ${isSelected}>${prod}</option>`;
    });
    
    document.getElementById('updateProductionModal').classList.add('active');
    
    // AKTIFKAN NATIVE JS SEARCHABLE DROPDOWN
    makeSelectSearchable('inputProdSelect');
}

function saveProductionUpdate() {
    let machineId = document.getElementById('inputProdMachineId').value;
    let selectedProduct = document.getElementById('inputProdSelect').value;
    
    if(machineData[machineId].breakdown.isActive) {
        alert("Mesin sedang Breakdown! Selesaikan Breakdown di menu Downtime terlebih dahulu.");
        return;
    }

    machineData[machineId].currentProduct = selectedProduct;

    fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/active_runs/${machineId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            machine: machineId,
            product: selectedProduct,
            timestamp: Date.now()
        })
    }).catch(e => console.error(e));
    
    let currentTglIso = getFactoryDateIso();
    
    let matchingSched = scheduleDataList.find(s => s.tglFull === currentTglIso && s.shift === currentActiveShift && s.mesin === machineId && s.produk.trim() === selectedProduct.trim());
    
    if(!matchingSched) {
        console.log(`Produk ${selectedProduct} tidak ada di jadwal, diubah secara manual.`);
    }

    closeModal('updateProductionModal');
    if(document.getElementById('page-production').classList.contains('active')) renderProductionTable();
    refreshDashboardUI(); 
    updateTampilanUI();
    
    updateBreakdownUI();

    alert(`Produksi Line ${machineId} berhasil diupdate menjadi: ${selectedProduct}`);
}

// --- FUNGSI BARU: KALKULASI TARGET 100% BERDASARKAN RUMUS INTERFOLD ATAU PACKAGING ---
function calculateTarget100(detail, workingTime, lebarOverride) {
    let speedInterfold = parseFloat(detail["Speed Interfold"]) || 0;
    let jumlahSheet = parseFloat(detail["JUMLAH SHEET"]) || 1;
    // Gunakan lebarOverride (dari input form) jika ada, jika tidak fallback ke detail DB (yang biasanya 0)
    let lebarJumbo = parseFloat(lebarOverride) || parseFloat(detail["LEBAR JUMBO (CM)"]) || 0;
    let variabelTinggi = parseFloat(detail["VARIABEL (CM)/ TINGGI PRODUK"]) || 0;
    let speedPackaging = parseFloat(detail["Speed Packaging"]) || 0;
    let isiCtn = parseFloat(detail["ISI/CTN (PACK)"]) || 1;

    let t100_1 = Infinity;
    let t100_2 = Infinity;

    // Rumus 1: Interfold
    if (speedInterfold > 0 && jumlahSheet > 0 && isiCtn > 0) {
        let multiplier = 1;
        if (lebarJumbo > 0 && variabelTinggi > 0) {
            multiplier = Math.floor(lebarJumbo / variabelTinggi);
            if (multiplier < 1) multiplier = 1; 
        }
        t100_1 = (speedInterfold / jumlahSheet) * multiplier * (workingTime / isiCtn);
    }

    // Rumus 2: Packaging
    if (speedPackaging > 0 && isiCtn > 0) {
        t100_2 = (speedPackaging * workingTime) / isiCtn;
    }

    let finalT100 = 0;
    if (t100_1 !== Infinity && t100_2 !== Infinity) {
        // Pilih yang paling rendah (bottleneck)
        finalT100 = Math.min(t100_1, t100_2);
    } else if (t100_1 !== Infinity) {
        finalT100 = t100_1;
    } else if (t100_2 !== Infinity) {
        finalT100 = t100_2;
    } else {
        // Fallback ke database jika dua-duanya kosong / bermasalah
        let targetDb = parseFloat(detail["TARGET 100% (CRT)"]);
        if (!isNaN(targetDb) && targetDb > 0) {
            finalT100 = (targetDb / 480) * workingTime; 
        }
    }

    return Math.floor(finalT100);
}

// --- FUNGSI BARU: LIVE RECALCULATE SAAT USER MENGETIK LEBAR JUMBO ATAU JAM KERJA ---
function triggerLiveRecalc() {
    let prodName = document.getElementById('schedProduct').value;
    if (prodName === 'Lainnya') return; // Lewati jika produk custom manual

    let detail = dataProduksi.find(item => item["NAMA PRODUK"] === prodName);
    if (!detail) return;

    // Hitung working time dinamis
    let workingTime = 480; 
    let jamMulaiInput = document.getElementById('schedJamMulai').value;
    let jamSelesaiInput = document.getElementById('schedJamSelesai').value;
    if (jamMulaiInput && jamSelesaiInput) {
        let [h1, m1] = jamMulaiInput.split(':').map(Number);
        let [h2, m2] = jamSelesaiInput.split(':').map(Number);
        let totalMins1 = (h1 * 60) + m1;
        let totalMins2 = (h2 * 60) + m2;
        if (totalMins2 < totalMins1) totalMins2 += (24 * 60);
        workingTime = totalMins2 - totalMins1;
    }

    let lebarJumboVal = document.getElementById('schedLebar').value;

    let target100 = calculateTarget100(detail, workingTime, lebarJumboVal);
    let target70 = Math.round(target100 * 0.70);

    document.getElementById('schedT100').innerText = target100;
    document.getElementById('schedT70').innerText = target70;

    let speed = target100 > 0 ? (workingTime / target100) : 0;
    document.getElementById('schedSpeed').innerText = speed > 0 ? speed.toFixed(3) : "-";
}
// --------------------------------------------------------------------------------------

function initSchedulePage() {
    if(typeof dataProduksi === 'undefined') {
        console.warn("File data_final.js (variabel dataProduksi) belum ditemukan atau belum dimuat!");
        return;
    }

    // UBAHAN: List dropdown mesin selalu mengacu ke rawMachineList yang paten, 
    // agar semua mesin selalu muncul tanpa terpengaruh isi array dataProduksi
    let selMac = document.getElementById('schedMachine');
    if (!selMac) return;
    selMac.innerHTML = '';
    rawMachineList.forEach(m => {
        selMac.innerHTML += `<option value="${m}">${m}</option>`;
    });

    document.getElementById('schedTglInput').value = getFactoryDateIso();
    document.getElementById('schedShiftInput').value = getCurrentShiftInfo();

    // --- SUNTIKAN EVENT LISTENER UNTUK LIVE CALCULATION ---
    let lebarEl = document.getElementById('schedLebar');
    let jamMulaiEl = document.getElementById('schedJamMulai');
    let jamSelesaiEl = document.getElementById('schedJamSelesai');

    if(lebarEl) lebarEl.addEventListener('input', triggerLiveRecalc);
    if(jamMulaiEl) jamMulaiEl.addEventListener('input', triggerLiveRecalc);
    if(jamSelesaiEl) jamSelesaiEl.addEventListener('input', triggerLiveRecalc);
    // ------------------------------------------------------

    updateScheduleProducts();
}

function updateScheduleProducts() {
    let mac = document.getElementById('schedMachine').value;
    
    // UBAHAN: Logika filter produk berdasarkan Jenis/Kategori (Bukan hanya berdasarkan ID Mesin spesifik)
    let prods = dataProduksi.filter(item => {
        let jenis = (item["BRAND/JENIS TISU"] || item["PRODUK"] || item["JENIS JUMBO"] || "").toUpperCase();
        let namaProd = (item["NAMA PRODUK"] || "").toUpperCase();
        let isMatch = false;

        // Padanan Kategori Fleksibel:
        if (mac.startsWith("FC") && (jenis.includes("FACIAL") || namaProd.includes("FACIAL") || jenis.includes("SOFTPACK") || jenis.includes("HANDKERCHIEF") || jenis.includes("COMPACT"))) isMatch = true;
        else if (mac.startsWith("NP") && (jenis.includes("NAPKIN") || namaProd.includes("NAPKIN"))) isMatch = true;
        else if ((mac.startsWith("TW") || mac.startsWith("TL")) && (jenis.includes("TOWEL") || namaProd.includes("TOWEL"))) isMatch = true;
        else if ((mac.startsWith("JRT") || mac.startsWith("HRT") || mac.startsWith("JT")) && (jenis.includes("JUMBO") || jenis.includes("JRT") || jenis.includes("HRT") || jenis.includes("ROLL") || jenis.includes("CORE"))) isMatch = true;

        // Fallback jika tidak tergolong tapi memang dari ID Mesin yg sama
        if (!isMatch && item["NAMA MESIN"] === mac) isMatch = true;

        return isMatch;
    });

    // Buang duplikasi produk yang sama namanya agar dropdown lebih bersih
    let uniqueProds = [];
    let seen = new Set();
    prods.forEach(p => {
        if(!seen.has(p["NAMA PRODUK"])) {
            seen.add(p["NAMA PRODUK"]);
            uniqueProds.push(p);
        }
    });
    
    let selProd = document.getElementById('schedProduct');
    selProd.innerHTML = '';
    uniqueProds.forEach(p => {
        selProd.innerHTML += `<option value="${p["NAMA PRODUK"]}">${p["NAMA PRODUK"]}</option>`;
    });

    selProd.innerHTML += `<option value="Lainnya">-- Lainnya (Ketik Manual) --</option>`;

    if (!document.getElementById('schedProductManual')) {
        let inputManual = document.createElement('input');
        inputManual.type = 'text';
        inputManual.id = 'schedProductManual';
        inputManual.placeholder = 'Ketik Nama Produk Baru...';
        inputManual.style.display = 'none';
        inputManual.style.marginTop = '10px';
        inputManual.style.width = '100%';
        inputManual.style.padding = '10px';
        inputManual.style.border = '1px solid #cbd5e1';
        inputManual.style.borderRadius = '6px';
        inputManual.style.outline = 'none';
        selProd.parentNode.appendChild(inputManual);
    }

    updateScheduleDetails();
    
    // AKTIFKAN NATIVE JS SEARCHABLE DROPDOWN UNTUK SCHEDULE
    makeSelectSearchable('schedProduct');
}

function updateScheduleDetails() {
    let mac = document.getElementById('schedMachine').value;
    let prodName = document.getElementById('schedProduct').value;
    let manualInput = document.getElementById('schedProductManual');
    
    let kodeMatEl = document.getElementById('schedKodeMat');
    let lebarEl = document.getElementById('schedLebar');

    // UBAHAN: Aktifkan semula borang input supaya boleh disunting secara bebas!
    kodeMatEl.disabled = false;
    kodeMatEl.style.backgroundColor = "#ffffff";
    kodeMatEl.placeholder = "Ketik/Edit Kode Material...";
    
    lebarEl.disabled = false;
    lebarEl.style.backgroundColor = "#ffffff";
    lebarEl.placeholder = "Ketik/Edit Lebar Jumbo...";
    
    if (prodName === 'Lainnya') {
        if(manualInput) {
            manualInput.style.display = 'block';
            manualInput.value = ''; 
        }
        
        kodeMatEl.value = "";
        lebarEl.value = "";
        
        document.getElementById('schedT100').innerText = "0";
        document.getElementById('schedT70').innerText = "0";
        document.getElementById('schedSpeed').innerText = "0";
    } else {
        if(manualInput) manualInput.style.display = 'none';

        // UBAHAN: Pencarian berdasarkan Nama Produk sahaja (tidak lagi terhad kepada mesin tertentu)
        let detail = dataProduksi.find(item => item["NAMA PRODUK"] === prodName);
        if(detail) {
            kodeMatEl.value = detail["KODE MATERIAL SAP"] || detail["KODE MATERIAL FG NEW"] || "-";
            lebarEl.value = detail["LEBAR JUMBO (CM)"] || "-";
            
            // UBAHAN: Gunakan fungsi kalkulasi baru untuk mendapatkan Target 100% dengan param lebar aktual
            let defaultTarget100 = calculateTarget100(detail, 480, lebarEl.value);
            let defaultTarget70 = Math.round(defaultTarget100 * 0.70);

            document.getElementById('schedT100').innerText = defaultTarget100;
            document.getElementById('schedT70').innerText = defaultTarget70;
            
            // Ideal speed (Menit/CRT) = 480 / Target100
            let speed = defaultTarget100 > 0 ? (480 / defaultTarget100) : 0;
            document.getElementById('schedSpeed').innerText = speed > 0 ? speed.toFixed(3) : "-";
        }
    }
}

function calculateAndAddSchedule() {
    let tglVal = document.getElementById('schedTglInput').value;
    if(!tglVal) return alert("Tanggal wajib diisi!");
    
    let shiftFull = document.getElementById('schedShiftInput').value;
    let shiftVal = shiftFull.includes("1") ? "Shift 1" : (shiftFull.includes("2") ? "Shift 2" : "Shift 3");
    
    let mesin = document.getElementById('schedMachine').value;
    let produk = document.getElementById('schedProduct').value;
    
    let jamMulaiInput = document.getElementById('schedJamMulai').value;
    let jamSelesaiInput = document.getElementById('schedJamSelesai').value;
    
    // --- UBAHAN PERBAIKAN: METODE MATEMATIKA MURNI AGAR SUPPORT SEMUA BROWSER ---
    let workingTime = 480; 
    if (jamMulaiInput && jamSelesaiInput) {
        let [h1, m1] = jamMulaiInput.split(':').map(Number);
        let [h2, m2] = jamSelesaiInput.split(':').map(Number);
        
        let totalMins1 = (h1 * 60) + m1;
        let totalMins2 = (h2 * 60) + m2;
        
        if (totalMins2 < totalMins1) {
            totalMins2 += (24 * 60); // Mengakali jika jadwal menyebrang malam
        }
        workingTime = totalMins2 - totalMins1;
    }

    // PENTING: Kita langsung comot nilai yang sudah live dari UI text, 
    // karena fungsi triggerLiveRecalc() sudah memastikannya selalu aktual.
    let target100 = parseFloat(document.getElementById('schedT100').innerText) || 0;
    let target70 = parseFloat(document.getElementById('schedT70').innerText) || 0;
    let idealSpeedBase = parseFloat(document.getElementById('schedSpeed').innerText) || 0;

    if (produk === 'Lainnya') {
        let manualInput = document.getElementById('schedProductManual');
        produk = manualInput ? manualInput.value.trim() : "";
        if (!produk) return alert("Silakan ketik nama produk baru secara manual!");
        
        // Cek jika user merubah jam kerja untuk produk manual tanpa ideal speed
        if (workingTime !== 480 && workingTime > 0 && idealSpeedBase === 0) {
            target100 = Math.ceil((workingTime / 480) * target100);
            target70 = Math.ceil(target100 * 0.70);
        }
    }
    // ------------------------------------------------------------------------------------------
    
    let kodeMat = document.getElementById('schedKodeMat').value || "-";
    let lebar = document.getElementById('schedLebar').value || "-";

    let qtyLoadInput = document.getElementById('schedQtyLoad');
    let qtyLoad = qtyLoadInput ? parseFloat(qtyLoadInput.value) : 0;

    let shiftsToGenerate = 1;
    if (qtyLoad > 0) {
        if (target100 <= 0) {
            return alert("Target 100% produk ini masih 0. Sistem tidak bisa menghitung auto-schedule. Silakan isi Manual atau pastikan Target 100% valid.");
        }
        shiftsToGenerate = Math.ceil(qtyLoad / target100);
        
        if (!confirm(`Total Load: ${qtyLoad} Crt\nTarget per-Shift: ${target100} Crt\n\nSistem akan membuat jadwal otomatis sebanyak ${shiftsToGenerate} Shift berturut-turut. Lanjutkan?`)) {
            return;
        }
    }

    let baseShiftIndex = parseInt(shiftVal.replace("Shift ", "")) - 1;
    
    let baseDateParts = tglVal.split('-');
    let baseDateObj = new Date(baseDateParts[0], baseDateParts[1] - 1, baseDateParts[2]); 
    
    let addedCount = 0;
    
    // --- UBAHAN BARU: Variabel untuk melacak sisa load ---
    let remainingLoad = qtyLoad;

    for (let i = 0; i < shiftsToGenerate; i++) {
        let currentShiftOffset = baseShiftIndex + i;
        let daysToAdd = Math.floor(currentShiftOffset / 3);
        let finalShiftIndex = currentShiftOffset % 3;
        let finalShiftVal = "Shift " + (finalShiftIndex + 1);

        let iterDateObj = new Date(baseDateObj.getTime());
        iterDateObj.setDate(iterDateObj.getDate() + daysToAdd);

        let iterY = iterDateObj.getFullYear();
        let iterM = String(iterDateObj.getMonth() + 1).padStart(2, '0');
        let iterD = String(iterDateObj.getDate()).padStart(2, '0');
        let iterTglVal = `${iterY}-${iterM}-${iterD}`;

        let bulanArr = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
        let iterBulanStr = bulanArr[iterDateObj.getMonth()];
        let iterTglStr = iterD;

        let exists = scheduleDataList.find(s => s.tglFull === iterTglVal && s.shift === finalShiftVal && s.mesin === mesin && s.produk === produk);
        if(exists) {
            if (shiftsToGenerate === 1) {
                return alert(`Penjadwalan untuk Mesin ${mesin} dengan produk ${produk} pada Tanggal ${iterTglVal} ${finalShiftVal} sudah ada!`);
            } else {
                console.warn(`Melewati pembuatan jadwal ${iterTglVal} ${finalShiftVal} karena sudah terisi.`);
                continue; 
            }
        }

        let existingCount = scheduleDataList.filter(s => s.tglFull === iterTglVal && s.shift === finalShiftVal && s.mesin === mesin).length;
        let isFirst = (existingCount === 0);

        let initialActual = 0;
        
        // --- LOGIKA SISA LOAD & WORKING TIME SHIFT TERAKHIR ---
        let shiftWt = workingTime;
        let shiftT100 = target100;
        let shiftT70 = target70;

        if (qtyLoad > 0) {
            if (remainingLoad >= target100) {
                shiftT100 = target100;
                shiftT70 = target70;
                shiftWt = workingTime;
                remainingLoad -= target100;
            } else {
                shiftT100 = remainingLoad;
                shiftT70 = Math.ceil(shiftT100 * 0.70);
                
                if (idealSpeedBase > 0) {
                    shiftWt = Math.ceil(shiftT100 * idealSpeedBase);
                } else {
                    shiftWt = Math.ceil((shiftT100 / target100) * workingTime);
                }
                remainingLoad = 0;
            }
        }
        // ------------------------------------------------------

        let newEntry = {
            idJadwal: Date.now() + i, 
            tglFull: iterTglVal,
            bulan: iterBulanStr,
            tgl: iterTglStr,
            shift: finalShiftVal,
            wt: shiftWt,  // <-- Menggunakan Waktu Shift Dinamis
            mesin: mesin,
            produk: produk,
            lebar: lebar,
            t100: shiftT100, // <-- Menggunakan Target 100 Dinamis
            t70: shiftT70,   // <-- Menggunakan Target 70 Dinamis
            speed: idealSpeedBase.toFixed(3), // <-- MENGGUNAKAN IDEAL SPEED BARU HASIL HITUNGAN (480 / Target)
            isFirst: isFirst,
            
            actual: initialActual, 
            dtProd: 0,
            dtMtc: 0,
            dtPpic: 0,
            
            eff: '0.00%',
            dtTotal: 0,
            pDtMtc: '0.00%',
            pDtAll: '0.00%',
            opTime: shiftWt,   // <-- Menyesuaikan Waktu
            availTime: shiftWt, // <-- Menyesuaikan Waktu
            availMachine: '100.00%',
            perf: '0.00%',
            oee: '0.00%',
            
            kwh: 0,
            costListrik: 0,
            
            accProduk: '',
            quality: '0.00%'
        };

        scheduleDataList.push(newEntry);
        addedCount++;
        
        fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/schedules.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newEntry)
        })
        .then(res => res.json())
        .then(dataFB => {
            newEntry.firebaseKey = dataFB.name; 
        })
        .catch(err => console.error(err));
    }

    let mData = machineData[mesin];
    if(mData && (mData.currentProduct.includes("IDLE") || mData.currentProduct.includes("BELUM ADA JADWAL"))) {
        mData.currentProduct = produk.trim();
    }

    if (qtyLoadInput) qtyLoadInput.value = "";
    if (document.getElementById('schedJamMulai')) document.getElementById('schedJamMulai').value = "";
    if (document.getElementById('schedJamSelesai')) document.getElementById('schedJamSelesai').value = "";

    if(document.getElementById('page-schedule').classList.contains('active')) renderScheduleTable();
    updateScheduleMaintenanceStats();
    
    if (addedCount > 0) {
        if (shiftsToGenerate === 1) {
            alert(`Jadwal Produksi ${mesin} berhasil ditambahkan! Data OEE akan terhitung Realtime sesuai Shift.`);
        } else {
            alert(`Berhasil menambahkan ${addedCount} Shift Jadwal Produksi secara otomatis!`);
        }
    } else {
        alert("Sistem tidak menambahkan jadwal (Mungkin jadwal di rentang tersebut sudah ada).");
    }
}

function updateScheduleInline(index, field, value) {
    let sched = scheduleDataList[index];
    if (!sched) return;

    let mac = sched.mesin;
    let mData = machineData[mac];
    let isCurrentlyRunning = (mData && mData.currentProduct.trim() === sched.produk.trim());

    if (field === 'wt' || field === 't100' || field === 't70' || field === 'actual' || field === 'speed') {
        sched[field] = parseFloat(value) || 0;
    } else {
        sched[field] = value;
    }

    let payload = {};
    payload[field] = sched[field];

    // --- TAMBAHAN: REKALKULASI OTOMATIS JIKA WT ATAU LEBAR DIUBAH DARI TABEL ---
    if (field === 'wt' || field === 'lebar' || field === 'produk') {
        let detail = dataProduksi.find(item => item["NAMA PRODUK"] === sched.produk);
        if (detail) {
            let newWt = parseFloat(sched.wt) || 0;
            let newLebar = sched.lebar;
            
            let newT100 = calculateTarget100(detail, newWt, newLebar);
            let newT70 = Math.round(newT100 * 0.70);
            let newSpeed = newT100 > 0 ? (newWt / newT100) : 0;

            sched.t100 = newT100;
            sched.t70 = newT70;
            sched.speed = newSpeed.toFixed(3);

            payload['t100'] = sched.t100;
            payload['t70'] = sched.t70;
            payload['speed'] = sched.speed;
        }
    } else if (field === 't100') {
        // Jika user secara manual merubah T100 di tabel, update T70 dan Speed-nya menyesuaikan!
        let newWt = parseFloat(sched.wt) || 0;
        let newT100 = parseFloat(sched.t100) || 0;
        let newT70 = Math.round(newT100 * 0.70);
        let newSpeed = newT100 > 0 ? (newWt / newT100) : 0;
        
        sched.t70 = newT70;
        sched.speed = newSpeed.toFixed(3);
        
        payload['t70'] = sched.t70;
        payload['speed'] = sched.speed;
    }
    // --------------------------------------------------------------------------

    if (field === 'produk' && isCurrentlyRunning) {
        mData.currentProduct = value.trim();
        
        fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/active_runs/${mac}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                machine: mac,
                product: value.trim(),
                timestamp: Date.now()
            })
        }).catch(e => console.error(e));
    }

    if (sched.firebaseKey && !isResettingSchedule) {
        // PATCH SEMUA FIELD YANG BERUBAH SEKALIGUS
        fetch(`https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/schedules/${sched.firebaseKey}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(e => console.error("Gagal update data jadwal:", e));
    }
    
    // RENDER ULANG TABEL AGAR LANGSUNG KELIHATAN PERUBAHANNYA
    if(document.getElementById('page-schedule').classList.contains('active')) {
        renderScheduleTable();
    }
    if(document.getElementById('page-schedule-maintenance').classList.contains('active')) {
        renderQualityTable();
    }
    if(document.getElementById('page-tampilan').classList.contains('active')) {
        updateTampilanUI(); 
    }
}

function renderScheduleTable() {
    let tbody = document.getElementById('db-schedule-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if(scheduleDataList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="25" style="text-align: center; color: #94a3b8; font-style: italic; padding: 20px;">Belum ada jadwal produksi yang ditambahkan...</td></tr>`;
        return;
    }

    let currentTglIso = getFactoryDateIso();

    let machineSchedCount = {};
    scheduleDataList.forEach(s => {
        if (s.tglFull === currentTglIso && s.shift === currentActiveShift) {
            machineSchedCount[s.mesin] = (machineSchedCount[s.mesin] || 0) + 1;
        }
    });

    scheduleDataList.forEach((d, index) => {
        let mData = machineData[d.mesin];
        
        let isCurrentSchedule = (d.tglFull === currentTglIso && d.shift === currentActiveShift);
        let isRunning = (mData && mData.currentProduct.trim() === d.produk.trim()) ? 'checked' : '';
        
        let radioTitle = isCurrentSchedule ? 'title="Pilih untuk set mesin menjalankan produk ini"' : 'title="Hanya bisa dipilih pada hari & shift yang sesuai"';
        let selectorHtml = '';

        if (isCurrentSchedule) {
            if (machineSchedCount[d.mesin] > 1) {
                selectorHtml = `<input type="radio" name="run_machine_${d.mesin}" class="run-radio" ${isRunning} ${radioTitle} onchange="setRunningProduct(${index})">`;
            } else {
                selectorHtml = `<input type="radio" class="run-radio" checked disabled title="Otomatis berjalan karena hanya 1 produk pada shift ini">`;
            }
        } else {
            selectorHtml = `<input type="radio" disabled title="Hanya bisa dipilih pada hari & shift yang sesuai">`;
        }

        let inputStyle = 'width: 100%; border: none; background: transparent; text-align: center; font-weight: inherit; color: inherit; font-size: inherit; font-family: inherit; outline: none; border-bottom: 1px dashed rgba(0,0,0,0.3); cursor: text; padding: 2px 0;';

        let wtInput = `<input type="number" value="${d.wt}" onchange="updateScheduleInline(${index}, 'wt', this.value)" style="${inputStyle} width: 60px;">`;
        let produkInput = `<input type="text" value="${d.produk}" onchange="updateScheduleInline(${index}, 'produk', this.value)" style="${inputStyle} text-align: left; width: 100%; min-width: 120px;">`;
        let lebarInput = `<input type="text" value="${d.lebar}" onchange="updateScheduleInline(${index}, 'lebar', this.value)" style="${inputStyle} width: 60px;">`;
        let t100Input = `<input type="number" value="${d.t100}" onchange="updateScheduleInline(${index}, 't100', this.value)" style="${inputStyle} width: 60px;">`;
        let t70Input = `<input type="number" value="${d.t70}" onchange="updateScheduleInline(${index}, 't70', this.value)" style="${inputStyle} width: 60px;">`;
        let actualInput = `<input type="number" id="sched-actual-${index}" value="${d.actual}" onchange="updateScheduleInline(${index}, 'actual', this.value)" style="${inputStyle} width: 60px; color: red;">`;
        let speedInput = `<input type="number" step="0.001" id="sched-speed-${index}" value="${d.speed}" onchange="updateScheduleInline(${index}, 'speed', this.value)" style="${inputStyle} width: 60px; color: #0284c7;">`;

        let costDisplay = `<div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
            <i class="fa-solid fa-bolt" style="color: #f59e0b; filter: drop-shadow(0 0 2px rgba(245, 158, 11, 0.4)); font-size: 1.1em;"></i>
            <span style="letter-spacing: 0.5px;">${d.costListrik !== undefined ? formatRupiah(d.costListrik) : 'Rp 0'}</span>
        </div>`;

        tbody.innerHTML += `
            <tr>   
                <td style="text-align: center; vertical-align: middle; width: 60px;">
                    ${selectorHtml}
                </td>
                <td><strong>${d.bulan}</strong></td>
                <td><strong>${d.tgl}</strong></td>
                <td style="color:#64748b; font-weight:bold;">${d.shift}</td>
                <td style="color:red; font-weight:bold;">${wtInput}</td>
                <td style="color:blue; font-weight:bold;">${d.mesin}</td>
                <td style="color:blue; font-weight:bold;">${produkInput}</td>
                <td style="background:#dcfce7; color:#047857; font-weight:bold;">${lebarInput}</td>
                <td style="color:blue; font-weight:bold; font-style:italic;">${t100Input}</td>
                <td style="color:blue; font-weight:bold; font-style:italic;">${t70Input}</td>
                <td style="background:#fee2e2; font-weight:bold; font-size: 1.1em; padding: 5px;">${actualInput}</td>
                <td style="background:#e0f2fe; color:blue; font-weight:bold; font-size:1.1em;" id="sched-eff-${index}">${d.eff}</td>
                <td style="color:#d946ef; font-weight:bold;" id="sched-dtprod-${index}">${d.dtProd}</td>
                <td style="color:#d946ef; font-weight:bold;" id="sched-dtmtc-${index}">${d.dtMtc}</td>
                <td style="color:#d946ef; font-weight:bold;" id="sched-dtppic-${index}">${d.dtPpic}</td>
                <td style="color:red; font-weight:bold;" id="sched-dttotal-${index}">${d.dtTotal}</td>
                <td style="color:red; font-weight:bold;" id="sched-pdtmtc-${index}">${d.pDtMtc}</td>
                <td style="color:red; font-weight:bold;" id="sched-pdtall-${index}">${d.pDtAll}</td>
                <td style="color:red; font-weight:bold;" id="sched-optime-${index}">${d.opTime}</td>
                <td style="color:red; font-weight:bold;" id="sched-availtime-${index}">${d.availTime}</td>
                <td style="color:#0284c7; font-weight:bold;">${speedInput}</td>
                <td style="color:red; font-weight:bold;" id="sched-availm-${index}">${d.availMachine}</td>
                <td style="background:#fef08a; color:#b45309; font-weight:bold;" id="sched-perf-${index}">${d.perf}</td>
                <td style="background:#fef08a; color:#b45309; font-weight:bold; font-size:1.1em;" id="sched-oee-${index}">${d.oee}</td>
                <td style="background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #065f46; font-weight: 800; font-size: 1.15em; box-shadow: inset 0 0 5px rgba(0,0,0,0.05); border-radius: 6px; border: 1px solid #86efac; text-align: center;" id="sched-cost-${index}">
                    ${costDisplay}
                </td>
            </tr>
        `;
    });
}

// ==========================================
// FITUR ANALISA HISTORIS & REPORTING
// ==========================================
let analisaSpeedChartInstance = null;
let analisaCostChartInstance = null;
let analisaKwChartInstance = null;
let analisaOeeChartInstance = null;
let analisaReportData = [];
let analisaScheduleHistoryData = []; 

function initAnalisaPage() {
    let sel = document.getElementById('analisaMachineSelect');
    if(sel.options.length === 0) {
        sel.innerHTML = `<option value="ALL">Semua Mesin</option>`;
        rawMachineList.forEach(id => {
            sel.innerHTML += `<option value="${id}">${machineData[id].name}</option>`;
        });
    }
    if (!document.getElementById('analisaStartDate').value) {
        let currentTglIso = getFactoryDateIso();
        
        let firstDay = currentTglIso.slice(0, 8) + '01'; 
        document.getElementById('analisaStartDate').value = firstDay;
        document.getElementById('analisaEndDate').value = currentTglIso;
        
        document.getElementById('analisaStartMonth').value = currentTglIso.slice(0, 7);
        document.getElementById('analisaEndMonth').value = currentTglIso.slice(0, 7);
    }
    toggleAnalisaDateInputs();
}

function toggleAnalisaDateInputs() {
    let type = document.getElementById('analisaTypeSelect').value;
    let sd = document.getElementById('analisaStartDate');
    let ed = document.getElementById('analisaEndDate');
    let sm = document.getElementById('analisaStartMonth');
    let em = document.getElementById('analisaEndMonth');

    if (type === '1mo') {
        sd.style.display = 'none'; ed.style.display = 'none';
        sm.style.display = 'block'; em.style.display = 'block';
        document.getElementById('labelAnalisaStart').innerText = 'Bulan Mulai';
        document.getElementById('labelAnalisaEnd').innerText = 'Bulan Akhir';
    } else {
        sd.style.display = 'block'; ed.style.display = 'block';
        sm.style.display = 'none'; em.style.display = 'none';
        document.getElementById('labelAnalisaStart').innerText = 'Tanggal Mulai';
        document.getElementById('labelAnalisaEnd').innerText = 'Tanggal Akhir';
    }
}

function initAnalisaCharts() {
    const ctxSpeed = document.getElementById('analisaSpeedChart');
    if (ctxSpeed) {
        analisaSpeedChartInstance = new Chart(ctxSpeed.getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ label: 'Speed Rata-rata (m/min)', backgroundColor: '#3b82f6', data: [] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    const ctxKw = document.getElementById('analisaKwChart');
    if (ctxKw) {
        analisaKwChartInstance = new Chart(ctxKw.getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ label: 'Konsumsi Daya Rata-rata (kW)', backgroundColor: '#f59e0b', data: [] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    const ctxCost = document.getElementById('analisaCostChart');
    if (ctxCost) {
        analisaCostChartInstance = new Chart(ctxCost.getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ label: 'Total Cost Listrik (Rp)', backgroundColor: '#ef4444', data: [] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    const ctxOee = document.getElementById('analisaOeeChart');
    if (ctxOee) {
        analisaOeeChartInstance = new Chart(ctxOee.getContext('2d'), {
            type: 'bar',
            data: { 
                labels: [], 
                datasets: [
                    { label: 'AVAILABILITY', backgroundColor: '#3b82f6', data: [] },
                    { label: 'PERFORMANCE', backgroundColor: '#ef4444', data: [] },
                    { label: 'OEE', backgroundColor: '#f59e0b', data: [] }
                ] 
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: { y: { min: 0, max: 100, title: { display: true, text: 'Persentase (%)' } } }
            }
        });
    }
}

function generateAnalisaReport() {
    let machineId = document.getElementById('analisaMachineSelect').value;
    let interval = document.getElementById('analisaTypeSelect').value;
    let startVal, endVal, startIso, endIso;

    if (interval === '1mo') {
        startVal = document.getElementById('analisaStartMonth').value;
        endVal = document.getElementById('analisaEndMonth').value;
        if(!startVal || !endVal) return alert("Pilih bulan mulai dan akhir!");
        startIso = `${startVal}-01T00:00:00Z`;
        
        let [y, m] = endVal.split('-');
        let lastDay = new Date(y, m, 0).getDate();
        endIso = `${endVal}-${lastDay}T23:59:59Z`;
    } else {
        startVal = document.getElementById('analisaStartDate').value;
        endVal = document.getElementById('analisaEndDate').value;
        if(!startVal || !endVal) return alert("Pilih tanggal mulai dan akhir!");
        startIso = `${startVal}T00:00:00Z`;
        endIso = `${endVal}T23:59:59Z`;
    }

    fetch(`https://marvelous-undamaged-flagship.ngrok-free.dev/api/report-sensor/${machineId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startIso, stop: endIso, interval: interval })
    })
    .then(res => res.json())
    .then(data => {
        if(!data || data.length === 0) {
            console.warn("Tidak ada histori sensor pada rentang waktu ini.");
        } else {
            analisaReportData = data;
            let labels = [];
            let speedArr = [];
            let costArr = [];
            let kwArr = [];

            data.forEach(row => {
                let dt = new Date(row.time);
                let label = "";
                if (interval === '1h') {
                    label = `${dt.getDate()}/${dt.getMonth()+1} ${dt.getHours()}:00`;
                } else if (interval === '1d') {
                    label = `${dt.getDate()}/${dt.getMonth()+1}/${dt.getFullYear()}`;
                } else {
                    let monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
                    label = `${monthNames[dt.getMonth()]} ${dt.getFullYear()}`;
                }
                labels.push(label);

                speedArr.push(parseFloat(row.speed).toFixed(2));
                kwArr.push(parseFloat(row.powerKw).toFixed(2));

                let hoursInInterval = interval === '1h' ? 1 : (interval === '1d' ? 24 : 720);
                let energyKwh = parseFloat(row.powerKw) * hoursInInterval;
                let calcCost = Math.round(energyKwh * tarifKwh);
                
                costArr.push(calcCost);
                
                row.calculatedCost = calcCost;
                row.label = label;
            });

            analisaSpeedChartInstance.data.labels = labels;
            analisaSpeedChartInstance.data.datasets[0].data = speedArr;
            analisaSpeedChartInstance.update();

            analisaKwChartInstance.data.labels = labels;
            analisaKwChartInstance.data.datasets[0].data = kwArr;
            analisaKwChartInstance.update();

            analisaCostChartInstance.data.labels = labels;
            analisaCostChartInstance.data.datasets[0].data = costArr;
            analisaCostChartInstance.update();
        }
    })
    .catch(err => {
        console.error("Gagal menarik data report sensor:", err);
    });

    fetch(`https://marvelous-undamaged-flagship.ngrok-free.dev/api/report-schedule/${machineId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startIso, stop: endIso, interval: interval }) 
    })
    .then(res => res.json())
    .then(data => {
        if(!data || data.length === 0) {
            console.warn("Tidak ada histori schedule OEE pada rentang waktu ini.");
            let tbody = document.getElementById('db-analisa-schedule-body');
            if(tbody) tbody.innerHTML = '<tr><td colspan="25" style="text-align: center; color: #94a3b8; font-style: italic; padding: 20px;">Tidak ada histori schedule / OEE pada rentang tanggal ini.</td></tr>';
        } else {
            analisaScheduleHistoryData = data;
            renderAnalisaScheduleTable(data);
            updateAnalisaOeeChart(data);
        }
    })
    .catch(err => {
        console.error("Gagal menarik data histori schedule:", err);
    });
}

function renderAnalisaScheduleTable(data) {
    let tbody = document.getElementById('db-analisa-schedule-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    data.forEach(d => {
        let pDtMtc = typeof d.pDtMtc === 'string' ? d.pDtMtc : parseFloat(d.pDtMtc).toFixed(2) + '%';
        let pDtAll = typeof d.pDtAll === 'string' ? d.pDtAll : parseFloat(d.pDtAll).toFixed(2) + '%';
        let availMachine = typeof d.availMachine === 'string' ? d.availMachine : parseFloat(d.availMachine).toFixed(2) + '%';
        let perf = typeof d.perf === 'string' ? d.perf : parseFloat(d.perf).toFixed(2) + '%';
        let oee = typeof d.oee === 'string' ? d.oee : parseFloat(d.oee).toFixed(2) + '%';
        let eff = typeof d.eff === 'string' ? d.eff : parseFloat(d.eff).toFixed(2) + '%';
        let speed = parseFloat(d.speed).toFixed(3);
        
        let costDisplay = `<div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
            <i class="fa-solid fa-bolt" style="color: #f59e0b; filter: drop-shadow(0 0 2px rgba(245, 158, 11, 0.4)); font-size: 1.1em;"></i>
            <span style="letter-spacing: 0.5px;">${d.costListrik !== undefined ? formatRupiah(d.costListrik) : 'Rp 0'}</span>
        </div>`;

        tbody.innerHTML += `
            <tr>   
                <td><strong>${d.bulan || '-'}</strong></td>
                <td><strong>${d.tglFull || d.tgl || '-'}</strong></td>
                <td style="color:#64748b; font-weight:bold;">${d.shift || '-'}</td>
                <td style="color:red; font-weight:bold; text-align: center;">${d.wt}</td>
                <td style="color:blue; font-weight:bold;">${d.mesin}</td>
                <td style="color:blue; font-weight:bold;">${d.produk}</td>
                <td style="background:#dcfce7; color:#047857; font-weight:bold; text-align: center;">${d.lebar || '-'}</td>
                <td style="color:blue; font-weight:bold; font-style:italic; text-align: center;">${d.t100}</td>
                <td style="color:blue; font-weight:bold; font-style:italic; text-align: center;">${d.t70}</td>
                <td style="background:#fee2e2; font-weight:bold; font-size: 1.1em; padding: 5px; color: red; text-align: center;">${d.actual}</td>
                <td style="background:#e0f2fe; color:blue; font-weight:bold; font-size:1.1em; text-align: center;">${eff}</td>
                <td style="color:#d946ef; font-weight:bold; text-align: center;">${d.dtProd}</td>
                <td style="color:#d946ef; font-weight:bold; text-align: center;">${d.dtMtc}</td>
                <td style="color:#d946ef; font-weight:bold; text-align: center;">${d.dtPpic}</td>
                <td style="color:red; font-weight:bold; text-align: center;">${d.dtTotal}</td>
                <td style="color:red; font-weight:bold; text-align: center;">${pDtMtc}</td>
                <td style="color:red; font-weight:bold; text-align: center;">${pDtAll}</td>
                <td style="color:red; font-weight:bold; text-align: center;">${d.opTime}</td>
                <td style="color:red; font-weight:bold; text-align: center;">${d.availTime}</td>
                <td style="color:#0284c7; font-weight:bold; text-align: center;">${speed}</td>
                <td style="color:red; font-weight:bold; text-align: center;">${availMachine}</td>
                <td style="background:#fef08a; color:#b45309; font-weight:bold; text-align: center;">${perf}</td>
                <td style="background:#fef08a; color:#b45309; font-weight:bold; font-size:1.1em; text-align: center;">${oee}</td>
                <td style="background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #065f46; font-weight: 800; font-size: 1.15em; box-shadow: inset 0 0 5px rgba(0,0,0,0.05); border-radius: 6px; border: 1px solid #86efac; text-align: center;">
                    ${costDisplay}
                </td>
            </tr>
        `;
    });
}

function updateAnalisaOeeChart(data) {
    if(!analisaOeeChartInstance) return;
    
    let labels = [];
    let availData = [];
    let perfData = [];
    let oeeData = [];

    let machineId = document.getElementById('analisaMachineSelect').value;
    
    if (machineId === "ALL") {
        let grouped = {};
        data.forEach(d => {
            if(!grouped[d.mesin]) {
                grouped[d.mesin] = { availSum: 0, perfSum: 0, oeeSum: 0, count: 0 };
            }
            grouped[d.mesin].availSum += parseFloat(d.availMachine) || 0;
            grouped[d.mesin].perfSum += parseFloat(d.perf) || 0;
            grouped[d.mesin].oeeSum += parseFloat(d.oee) || 0;
            grouped[d.mesin].count++;
        });

        for (let mac in grouped) {
            labels.push(mac);
            let count = grouped[mac].count;
            availData.push((grouped[mac].availSum / count).toFixed(2));
            perfData.push((grouped[mac].perfSum / count).toFixed(2));
            oeeData.push((grouped[mac].oeeSum / count).toFixed(2));
        }
    } else {
        data.forEach(d => {
            let tglFormat = d.tglFull ? d.tglFull.slice(5) : ''; 
            labels.push(`${tglFormat} (${d.shift})`);
            availData.push(parseFloat(d.availMachine) || 0);
            perfData.push(parseFloat(d.perf) || 0);
            oeeData.push(parseFloat(d.oee) || 0);
        });
    }

    analisaOeeChartInstance.data.labels = labels;
    analisaOeeChartInstance.data.datasets[0].data = availData;
    analisaOeeChartInstance.data.datasets[1].data = perfData;
    analisaOeeChartInstance.data.datasets[2].data = oeeData;
    analisaOeeChartInstance.update();
}

function downloadAnalisaChart(chartId, title) {
    let canvas = document.getElementById(chartId);
    if(!canvas) return;
    let link = document.createElement('a');
    
    let ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    link.href = canvas.toDataURL('image/jpeg', 1.0);
    link.download = `Grafik_${title}_${document.getElementById('analisaMachineSelect').value}.jpg`;
    link.click();
    
    ctx.globalCompositeOperation = 'source-over';
}

function downloadAnalisaCSV(type) {
    if(analisaReportData.length === 0) return alert("Generate data terlebih dahulu!");
    
    let headerText = '';
    if (type === 'Speed') headerText = 'Kecepatan Rata-rata (m/min)';
    else if (type === 'Cost') headerText = 'Cost Listrik (Rp)';
    else headerText = 'Konsumsi Daya (kW)';

    let csv = `Waktu,${headerText}\n`;
    
    analisaReportData.forEach(row => {
        let val = 0;
        if (type === 'Speed') val = row.speed;
        else if (type === 'Cost') val = row.calculatedCost;
        else val = row.powerKw;
        
        csv += `"${row.label}","${val}"\n`;
    });

    let encodedUri = encodeURI("data:text/csv;charset=utf-8," + csv);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Data_${type}_${document.getElementById('analisaMachineSelect').value}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadAnalisaScheduleCSV() {
    if (analisaScheduleHistoryData.length === 0) {
        alert("Tidak ada data histori jadwal untuk diunduh. Silakan generate laporan terlebih dahulu!");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    
    let headers = [
        "Bulan", "Tanggal", "Shift", "Working Time (Menit)", "Nama Mesin", 
        "Nama Produk", "Lebar Jumbo", "Target 100% (CRT)", "Target 70% (CRT)", 
        "Actual Output (CRT)", "Eff Mesin", "Total DT Produksi", "Total DT MTC", 
        "Total DT PPIC", "Total Menit DT", "Down Time MTC (%)", "Downtime All (%)", 
        "Operating Time", "Availability Time", "Ideal Speed", "Availability Machine (%)", 
        "Performance", "OEE", "Cost Listrik (Rp)"
    ];
    csvContent += headers.join(",") + "\r\n";

    analisaScheduleHistoryData.forEach(d => {
        let row = [
            `"${d.bulan || '-'}"`, `"${d.tglFull || d.tgl || '-'}"`, `"${d.shift || '-'}"`, `"${d.wt}"`, `"${d.mesin}"`, 
            `"${d.produk}"`, `"${d.lebar || '-'}"`, `"${d.t100}"`, `"${d.t70}"`, 
            `"${d.actual}"`, `"${d.eff}"`, `"${d.dtProd}"`, `"${d.dtMtc}"`, 
            `"${d.dtPpic}"`, `"${d.dtTotal}"`, `"${d.pDtMtc}"`, `"${d.pDtAll}"`, 
            `"${d.opTime}"`, `"${d.availTime}"`, `"${d.speed}"`, `"${d.availMachine}"`, 
            `"${d.perf}"`, `"${d.oee}"`, `"${d.costListrik || 0}"`
        ];
        csvContent += row.join(",") + "\r\n";
    });

    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    let today = new Date();
    let mac = document.getElementById('analisaMachineSelect').value;
    let fileName = `Histori_OEE_${mac}_${today.toISOString().slice(0, 10)}.csv`;
    link.setAttribute("download", fileName);
    
    document.body.appendChild(link); 
    link.click();
    document.body.removeChild(link);
}

window.onload = () => {
    currentActiveShift = getCurrentShiftInfo(); 

    // --- TAMBAHAN BARU: INJEKSI CSS UNTUK TOMBOL HAMBURGER PC ---
    const style = document.createElement('style');
    style.innerHTML = `
        .menu-toggle-btn { display: block !important; margin-right: 15px; }
        .topbar-left { display: flex; align-items: center; }
        @media (min-width: 769px) {
            .sidebar { transition: margin-left 0.3s ease !important; margin-left: 0; }
            .sidebar.hidden { margin-left: -270px !important; }
        }
    `;
    document.head.appendChild(style);

    buildInitialMachineData();
    refreshDashboardUI();
    initTampilanCharts(); 
    initAnalisaCharts(); 

    // Panggil fungsi fetch data dari Firebase
    fetchSchedulesFromFirebase();

    setInterval(updateRealtimeClock, 1000);
    // pollRealtimeData kini bertugas sebagai prosesor matematika offline dan polling normal
    setInterval(pollRealtimeData, 1000); 
    
    // MENGHIDUPKAN KEMBALI INTERVAL LIVE UPDATE UNTUK HALAMAN TAMPILAN
    setInterval(liveUpdateDashboard, 2000);
};

// --- UBAHAN PERBAIKAN TERAKHIR: BATCH UPDATE KE FIREBASE SETIAP 5 DETIK UNTUK MENCEGAH SPAM DAN DROP DATA ---
setInterval(() => {
    if (isResettingSchedule || isShiftTransition) return;
    
    // 2. Sinkronisasi Kalkulasi OEE, Downtime, Cost Listrik & KWH ke Schedule Produksi
    let localTglIso = getFactoryDateIso();
    let localCurShift = getCurrentShiftInfo();

    let schedPayload = {};
    scheduleDataList.forEach(sched => {
        // Sinkronisasi dikirim ke Firebase asalkan ID valid. 
        // Ini memastikan jika downtime menimpa shift kemarin, tetap terupdate di Firebase
        if (sched.firebaseKey) {
            schedPayload[sched.firebaseKey + "/kwh"] = sched.kwh;
            schedPayload[sched.firebaseKey + "/costListrik"] = sched.costListrik;
            
            // --->> PERBAIKAN MUTLAK KUNCI FLAPPING: 
            // Baris 'sched.actual' KITA HAPUS DARI SINI agar tidak mem-broadcast 
            // memori usang ke Firebase ketika ada multi-device/multi-tab!
            
            schedPayload[sched.firebaseKey + "/dtProd"] = sched.dtProd;
            schedPayload[sched.firebaseKey + "/dtMtc"] = sched.dtMtc;
            schedPayload[sched.firebaseKey + "/dtPpic"] = sched.dtPpic;
            schedPayload[sched.firebaseKey + "/eff"] = sched.eff;
            schedPayload[sched.firebaseKey + "/oee"] = sched.oee;
            schedPayload[sched.firebaseKey + "/dtTotal"] = sched.dtTotal;
            schedPayload[sched.firebaseKey + "/availMachine"] = sched.availMachine;
            schedPayload[sched.firebaseKey + "/perf"] = sched.perf;
            schedPayload[sched.firebaseKey + "/opTime"] = sched.opTime;
        }
    });

    if (Object.keys(schedPayload).length > 0) {
        fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/schedules.json', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(schedPayload)
        }).catch(e => {});
    }

    // 3. Sinkronisasi DAYA_AKUMULASI
    let dayaPayload = {};
    rawMachineList.forEach(macId => {
        let mData = machineData[macId];
        // Pastikan hanya mengirim jika ada penambahan daya / cost
        if(mData && (mData.kwhShift > 0 || mData.costShift > 0)) {
            dayaPayload[macId] = {
                kwh: mData.kwhShift,
                costListrik: mData.costShift,
                tglFull: localTglIso,
                shift: localCurShift
            };
        }
    });

    if(Object.keys(dayaPayload).length > 0) {
        fetch('https://cmms-e41d0-default-rtdb.asia-southeast1.firebasedatabase.app/DAYA_AKUMULASI.json', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dayaPayload)
        }).catch(e => {});
    }

}, 5000);