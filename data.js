// VARIABLE GLOBAL SHIFT UNTUK TRACKING PERUBAHAN
let currentActiveShift = "";
let isResettingSchedule = false; 
let lastPollTime = Date.now(); 

// --- UBAHAN: TARIF KWH MENJADI AKTUAL RP 1500 ---
const tarifKwh = 1500; 
const tarifListrikPerDetik = tarifKwh / 3600; 

// PENGAMANAN VARIABEL GLOBAL AGAR TIDAK CRASH (Mencegah ReferenceError)
let MACHINES = typeof rawMachineList !== 'undefined' ? rawMachineList : ["NP313", "FC122", "TW408", "JRT06", "HRT02", "TL01"];
let PRODUCTS = typeof productList !== 'undefined' ? productList : ["Brand SPS Facial 2 Ply", "Brand SPS Napkin Regular", "Jumbo Roll Premium SP", "Towel Multipurpose SPS"];
let POWERS = typeof powerData !== 'undefined' ? powerData : {"MAIN_FACTORY": 1200, "NP313": 45.5, "FC122": 38.2};
let UNITS = typeof unitList !== 'undefined' ? unitList : ["Motor Unwinder", "Cylinder Emboss", "Folding Blade", "Logsaw Blade Belt", "Pneumatic Valve"];

function getFactoryDateIso(dateObj) {
    let d = dateObj ? new Date(dateObj) : new Date();
    let hour = d.getHours();
    
    if (hour < 7) {
        let prevDay = new Date(d.getTime());
        prevDay.setDate(prevDay.getDate() - 1);
        let tzOffset = prevDay.getTimezoneOffset() * 60000;
        return (new Date(prevDay.getTime() - tzOffset)).toISOString().slice(0, 10);
    } else {
        let tzOffset = d.getTimezoneOffset() * 60000;
        return (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 10);
    }
}

function updateRealtimeClock() {
    let now = new Date();
    let options = { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
    let timeString = now.toLocaleTimeString('id-ID', options) + " WIB";
    let clockEl = document.getElementById('realtime-clock');
    if(clockEl) clockEl.innerHTML = `<i class="fa-regular fa-clock"></i> ` + timeString;
}

function syncToGoogleSheets(actionName, dataObj) {
    const scriptURL = 'https://script.google.com/macros/s/AKfycbxEX_TzUJ1Qwbw-a9VgM95LJUrRlAqaKuVmkg4Qlwj8wqfoLBdS04J7KjDEh_LO5J3-/exec'; 
    
    const firebaseFolder = actionName === 'addLogbook' ? 'logbook_technician' : 'shift_handover';
    const firebaseUrl = `https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//${firebaseFolder}.json`;

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
    }
}

let machineData = {};
let currentMachine = "";

let workOrders = { manual: [], preventive: [], predictive: [] };
let currentWoTab = 'manual';

let logbookData = [];
let shoData = [];
let scheduleDataList = [];

let breakdownFreq = {};

let tampilanSpeedChartInstance;
let tampilanDtChartInstance;
let tampilanTimeLabels = [];
let tampilanSpeedData = [];
let isLiveView = true; 

let allBreakdownEvents = [];

function fetchHistoryFromLocal(machineId) {
    fetch(`https://marvelous-undamaged-flagship.ngrok-free.dev/api/read-sensor/${machineId}`)
    .then(res => res.json())
    .then(data => {
        if(data && data.length > 0) {
            tampilanTimeLabels = data.map(d => {
                let dt = new Date(d.time);
                return dt.getHours().toString().padStart(2, '0') + ':' +
                       dt.getMinutes().toString().padStart(2, '0') + ':' +
                       dt.getSeconds().toString().padStart(2, '0');
            });
            tampilanSpeedData = data.map(d => d.speed);
            if(tampilanSpeedChartInstance) {
                tampilanSpeedChartInstance.data.labels = tampilanTimeLabels;
                tampilanSpeedChartInstance.data.datasets[0].data = tampilanSpeedData;
                
                if (isLiveView) {
                    tampilanSpeedChartInstance.options.scales.x.min = Math.max(0, tampilanTimeLabels.length - 20);
                    tampilanSpeedChartInstance.options.scales.x.max = tampilanTimeLabels.length - 1;
                }
                tampilanSpeedChartInstance.update('none'); 
            }
        } else {
            tampilanTimeLabels = [];
            tampilanSpeedData = [];
            if(tampilanSpeedChartInstance) {
                tampilanSpeedChartInstance.update('none');
            }
        }
    }).catch(e => console.warn("Menunggu API Lokal InfluxDB menyala..."));
}

function downloadSpeedHistory() {
    if (!currentMachine) {
        alert("Pilih mesin terlebih dahulu sebelum mengunduh data!");
        return;
    }

    fetch(`https://marvelous-undamaged-flagship.ngrok-free.dev/api/read-sensor/${currentMachine}`)
    .then(res => res.json())
    .then(data => {
        if (!data || data.length === 0) {
            alert(`Tidak ada data histori kecepatan untuk mesin ${currentMachine}. Pastikan InfluxDB and API lokal berjalan.`);
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,Waktu (Timestamp),Kecepatan Aktual (m/min),Shift Operasional,Nama Produk\r\n";

        data.forEach(item => {
            let dt = new Date(item.time);
            let formattedTime = dt.getFullYear() + '-' + 
                                String(dt.getMonth() + 1).padStart(2, '0') + '-' + 
                                String(dt.getDate()).padStart(2, '0') + ' ' + 
                                String(dt.getHours()).padStart(2, '0') + ':' + 
                                String(dt.getMinutes()).padStart(2, '0') + ':' + 
                                String(dt.getSeconds()).padStart(2, '0');
            
            let row = `"${formattedTime}","${item.speed}","${item.shift || '-'}","${item.product || '-'}"`;
            csvContent += row + "\r\n";
        });

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
        alert("Gagal mengunduh data. Pastikan API Lokal InfluxDB menyala.");
    });
}

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

const firebaseUrlRT = 'https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//speed_mesin.json';        
        
let realtimeDBData = {};
let pendingAutoBd = { machineId: null, elapsedSec: 0 }; 

function fetchSchedulesFromFirebase() {
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules.json')
    .then(res => res.json())
    .then(data => {
        if (data) {
            let validSchedules = [];

            Object.keys(data).forEach(key => {
                let obj = data[key];
                if(obj && typeof obj === 'object' && obj.idJadwal && obj.mesin && obj.mesin !== "undefined") {
                    obj.firebaseKey = key; 
                    validSchedules.push(obj);
                }
            });
            
            scheduleDataList = validSchedules;
            
            let currentTglIso = getFactoryDateIso();
            MACHINES.forEach(id => {
                let mData = machineData[id];
                if(mData && mData.currentProduct.includes("IDLE")) {
                    let sched = scheduleDataList.find(s => s.mesin === id && s.tglFull === currentTglIso && s.shift === currentActiveShift);
                    if(sched) mData.currentProduct = sched.produk.trim();
                }
            });
        }
        // Aman dari error promise lama
        fetchBreakdownStatesFromFirebase();
    })
    .catch(e => { 
        console.error("Error fetch schedules:", e); 
        fetchBreakdownStatesFromFirebase();
    });
}

function fetchBreakdownStatesFromFirebase() {
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//breakdown_events.json')
    .then(res => res.json())
    .then(data => {
        if (data) {
            let rawEvents = Object.values(data).sort((a,b) => a.timestamp - b.timestamp);
            let latestState = {};
            let processedEnds = {};
            let processedStarts = {};
            let filteredEvents = []; 

            rawEvents.forEach(ev => {
                if (ev.type === 'START') {
                    if (processedStarts[ev.machine] && (ev.timestamp - processedStarts[ev.machine] < 15000)) return;
                    processedStarts[ev.machine] = ev.timestamp;
                    filteredEvents.push(ev);
                    latestState[ev.machine] = { isDown: true, startTime: ev.startTime };
                } else if (ev.type === 'END') {
                    if (processedEnds[ev.machine] && (ev.timestamp - processedEnds[ev.machine] < 15000)) return;
                    processedEnds[ev.machine] = ev.timestamp;
                    filteredEvents.push(ev); 
                    latestState[ev.machine] = { isDown: false, startTime: null };
                }
            });

            allBreakdownEvents = filteredEvents;

            for (let mac in latestState) {
                if (latestState[mac].isDown && machineData[mac]) {
                    let dtStart = new Date(latestState[mac].startTime);
                    machineData[mac].breakdown.isActive = true;
                    machineData[mac].breakdown.category = "AUTO-PENDING";
                    machineData[mac].breakdown.startTime = dtStart;
                } else if (!latestState[mac].isDown && machineData[mac]) {
                    machineData[mac].breakdown.isActive = false;
                    machineData[mac].breakdown.startTime = null;
                }
            }
            
            updateBreakdownUI();
            updateDowntimeBadge();
        }
    }).catch(e => { console.error("Error fetch breakdowns:", e); });
}

function fetchActiveRunsFromFirebase() {
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//active_runs.json')
    .then(res => res.json())
    .then(data => {
        if (data) {
            let runs = Object.values(data).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
            runs.forEach(r => {
                if(r && r.machine && machineData[r.machine]) {
                    machineData[r.machine].currentProduct = (r.product || "").trim();
                }
            });
        }
    }).catch(e => console.error("Error fetch active runs:", e));
}

function fetchAccumulatedPowerFromFirebase() {
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//DAYA_AKUMULASI.json')
    .then(res => res.json())
    .then(data => {
        if(data) {
            let tglIso = getFactoryDateIso();
            let curShift = getCurrentShiftInfo();

            for(let mac in data) {
                let accData = data[mac];
                if(accData.tglFull === tglIso && accData.shift === curShift) {
                    if (machineData[mac]) {
                        machineData[mac].kwhShift = accData.kwh || 0;
                        machineData[mac].costShift = accData.costListrik || 0;
                    }
                }
            }
        }
    }).catch(e => console.error("Gagal menarik data akumulasi daya dari Firebase:", e));
}

function fetchWaitingResolution() {
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app/waiting_resolution.json')
    .then(res => res.json())
    .then(data => {
        if (!currentMachine) return;
        let isDowntimePage = document.getElementById('page-kpi-oee').classList.contains('active');
        let modalEl = document.getElementById('autoBdModal');

        if(data && data[currentMachine] && isDowntimePage) {
            let elapsed = data[currentMachine].elapsedSec;
            if (!modalEl.classList.contains('active') || pendingAutoBd.machineId !== currentMachine) {
                pendingAutoBd.machineId = currentMachine;
                pendingAutoBd.elapsedSec = elapsed;

                let m = Math.floor(elapsed / 60);
                let s = elapsed % 60;
                
                document.getElementById('autoBdMessage').innerText = `Mesin ${currentMachine} telah kembali beroperasi (Speed > 20).\nTotal Durasi Downtime tercatat: ${m} Menit ${s} Detik.\n\nSilakan tentukan Kategori Breakdown dari tombol di bawah:`;
                modalEl.classList.add('active');
            }
        } else {
            if (modalEl.classList.contains('active') && pendingAutoBd.machineId === currentMachine) {
                modalEl.classList.remove('active');
            }
        }
    }).catch(e => {});
}

function updateDowntimeBadge() {
    let pendingCount = 0;
    let currentTglIso = getFactoryDateIso();

    MACHINES.forEach(id => {
        let mData = machineData[id];
        let activeSched = scheduleDataList.find(s => 
            s.mesin === id && 
            s.tglFull === currentTglIso && 
            s.shift === currentActiveShift && 
            s.produk.trim() === mData.currentProduct.trim()
        );

        let isIdle = mData.currentProduct.includes("IDLE") || mData.currentProduct.includes("BELUM ADA JADWAL") || mData.currentProduct === "";

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

function applySilentBreakdownResolution(macId, finalCategory) {
    let mData = machineData[macId];
    if (!mData || !mData.breakdown.isActive) return;

    if(finalCategory === 'maintenance') {
        if(breakdownFreq[macId] === undefined) breakdownFreq[macId] = 0;
        breakdownFreq[macId]++;
        let freqLabel = document.getElementById(`bd-count-${macId}`);
        if(freqLabel) freqLabel.innerText = breakdownFreq[macId] + 'x';
    }

    mData.breakdown.isActive = false;
    mData.breakdown.category = null;
    mData.breakdown.startTime = null; 

    updateBreakdownUI();
    refreshDashboardUI();
    updateTampilanUI();
    
    if (pendingAutoBd.machineId === macId) {
        document.getElementById('autoBdModal').classList.remove('active');
        pendingAutoBd = { machineId: null, elapsedSec: 0 };
    }
    updateDowntimeBadge();
}

function pollRealtimeData() {
    if (isResettingSchedule) return;

    let nowTime = Date.now();
    let isAsleep = (nowTime - lastPollTime > 10000); 
    lastPollTime = nowTime;

    if (isAsleep) {
        console.warn("[SYSTEM] Tab terdeteksi sempat tertidur. Sinkronisasi ulang...");
        fetchSchedulesFromFirebase();
        return; 
    }

    fetch(firebaseUrlRT)
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
                  if (!isNaN(speedNum)) realtimeDBData[upperMacId] = { speed: speedNum };
              }
          }
      }).catch(e => console.warn("Menunggu koneksi RTDB Speed...", e));

    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//bd_resolved_flag.json')
    .then(res => res.json())
    .then(flags => {
        if(!flags) return;
        for(let mac in flags) {
            let mData = machineData[mac];
            let flag = flags[mac];
            if (mData && mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING") {
                if (flag.timestamp > mData.breakdown.startTime.getTime()) {
                    console.log(`[SYNC] Mesin ${mac} dikategorikan oleh backend.`);
                    applySilentBreakdownResolution(mac, flag.category);
                }
            }
        }
    }).catch(e => {});

    fetchWaitingResolution(); 
    updateDowntimeBadge();
    
    // VISUAL INSTANT UPDATE
    refreshDashboardUI();
    if(document.getElementById('page-tampilan').classList.contains('active')) updateTampilanUI();
}

function saveAutoBreakdown(finalCategory, forceMacId = null, forceSec = null) {
    let macId = forceMacId || pendingAutoBd.machineId;
    let elapsedSec = forceSec !== null ? forceSec : pendingAutoBd.elapsedSec;
    
    if(!macId) return;

    if (elapsedSec > 28800) elapsedSec = 28800; 
    if (elapsedSec < 0) elapsedSec = 0;

    let mData = machineData[macId];
    let productBeforeBd = mData ? mData.currentProduct : "IDLE";

    fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//bd_resolved_flag/${macId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: finalCategory, timestamp: Date.now() })
    }).catch(e => {});

    fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app/waiting_resolution/${macId}.json`, {
        method: 'DELETE'
    }).catch(e => {});

    let correctTglIso = getFactoryDateIso();
    let correctShift = getCurrentShiftInfo();

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

    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//breakdown_events.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvent)
    }).catch(e => console.error("Error post bd end:", e));

    if (mData) {
        mData.breakdown.isActive = false;
        mData.breakdown.category = null;
        mData.breakdown.startTime = null;
    }

    if (pendingAutoBd.machineId === macId) {
        document.getElementById('autoBdModal').classList.remove('active');
        pendingAutoBd = { machineId: null, elapsedSec: 0 };
    }

    updateBreakdownUI();
    refreshDashboardUI();
    updateTampilanUI();
    
    if (!forceMacId) alert(`Data Breakdown berhasil disimpan pada kategori ${finalCategory.toUpperCase()}!`);
    updateDowntimeBadge(); 
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('show');
    overlay.classList.toggle('show');
}

function getCurrentShiftInfo(dateObj) {
    let d = dateObj ? new Date(dateObj) : new Date();
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
    MACHINES.forEach(m => {
        let id = m.toUpperCase();
        let proc = [];
        let fullName = "Line " + id;
        
        breakdownFreq[id] = 0; 

        if (id.startsWith("NP") || id.startsWith("FC") || id.startsWith("TW")) {
            proc = ['Unwinder', 'Emboss', 'Folding', 'Bandsaw'];
            if (id.startsWith("NP")) fullName += " (Napkin)";
            if (id.startsWith("FC")) fullName += " (Facial)";
            if (id.startsWith("TW")) fullName += " (Towel)";
        } else if (id.startsWith("JRT") || id.startsWith("HRT")) {
            proc = ['Unwinder', 'Emboss', 'Rewinder', 'Logsaw'];
            if (id.startsWith("JRT")) fullName += " (Jumbo Roll)";
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
        let powerKw = POWERS[id] || (Math.random() * 20 + 30).toFixed(2);

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
}
        
function syncTampilanMachine() {
    currentMachine = document.getElementById('tampilan-machine-select').value;
    if(document.getElementById('machine-select')) document.getElementById('machine-select').value = currentMachine;
    if(document.getElementById('bd-machine-select')) document.getElementById('bd-machine-select').value = currentMachine;
    refreshDashboardUI();
    updateBreakdownUI();
    updateTampilanUI();
    
    fetchHistoryFromLocal(currentMachine);
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
    if (!mData) return;
    
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
    let uniqueScheduledMachines = new Set();

    scheduleDataList.forEach(s => {
        if (s.tglFull === currentTglIso && s.shift === currentActiveShift) {
            uniqueScheduledMachines.add(s.mesin);
            if (s.mesin === currentMachine && s.produk.trim() === mData.currentProduct.trim()) {
                let wtJadwal = parseFloat(s.wt);
                if (!isNaN(wtJadwal) && wtJadwal > 0) spesifikWt = wtJadwal;
            }
        }
    });

    let scheduledMachinesCount = uniqueScheduledMachines.size;
    let totalWtPabrik = scheduledMachinesCount > 0 ? (scheduledMachinesCount * 480) : 480;

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
}, 1000);

function initBreakdownChart() {
    const ctx = document.getElementById('breakdownChart');
    if(!ctx) return;
    bdChartInstance = new Chart(ctx.getContext('2d'), {
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
    const ctxSpeed = document.getElementById('tampilanSpeedChart');
    if(ctxSpeed) {
        tampilanSpeedChartInstance = new Chart(ctxSpeed.getContext('2d'), {
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
                            enabled: true, mode: 'x',
                            onPanComplete: function() {
                                isLiveView = false;
                                let btn = document.getElementById('btnLiveView');
                                if(btn) btn.style.display = 'inline-flex';
                            }
                        },
                        zoom: { 
                            wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x',
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
    }

    const ctxDt = document.getElementById('tampilanDtChart');
    if(ctxDt) {
        tampilanDtChartInstance = new Chart(ctxDt.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Production', 'Maintenance', 'PPIC'],
                datasets: [{ data: [0, 0, 0], backgroundColor: ['#3b82f6', '#ef4444', '#8b5cf6'], borderWidth: 2 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
    }
}

function updateTampilanUI() {
    if(!document.getElementById('page-tampilan').classList.contains('active') || !currentMachine) return;
    
    let mData = machineData[currentMachine];
    if(!mData) return;

    document.getElementById('tampilan-nama-mesin').innerText = mData.name;
    document.getElementById('tampilan-shift').innerText = getCurrentShiftLabel();
    
    let currentTglIso = getFactoryDateIso();
    let productToCheck = mData.currentProduct;
    let isIdle = productToCheck.includes("IDLE") || productToCheck.includes("BELUM ADA JADWAL") || productToCheck === "";

    // --- VISUAL INSTANT FIX ---
    let curSpeed = 0;
    if (realtimeDBData[currentMachine] && realtimeDBData[currentMachine].speed !== undefined) {
        curSpeed = parseFloat(realtimeDBData[currentMachine].speed);
    }
    let isVisuallyDown = mData.breakdown.isActive || (!isIdle && curSpeed < 20);

    let matchingScheds = scheduleDataList.filter(s => 
        s.tglFull === currentTglIso && 
        s.shift === currentActiveShift && 
        s.mesin === currentMachine
    );

    let activeSched = matchingScheds.find(s => s.produk.trim() === productToCheck.trim());
    if (!activeSched && matchingScheds.length > 0) {
        activeSched = matchingScheds[matchingScheds.length - 1]; 
    }

    let kondisiEl = document.getElementById('tampilan-kondisi');
    let produkEl = document.getElementById('tampilan-produk');

    if (isVisuallyDown) {
        if (kondisiEl) { kondisiEl.innerText = "BREAKDOWN"; kondisiEl.style.color = "var(--danger)"; }
        if (produkEl) { produkEl.innerText = activeSched ? activeSched.produk : productToCheck; produkEl.style.color = "var(--danger)"; }
    } else if (isIdle) {
        if (kondisiEl) { kondisiEl.innerText = "IDLE / STANDBY"; kondisiEl.style.color = "var(--warning)"; }
        if (produkEl) { 
            produkEl.innerText = activeSched ? activeSched.produk + " (Menunggu Start)" : "TIDAK ADA PRODUK"; 
            produkEl.style.color = "#94a3b8"; 
        }
    } else {
        if (kondisiEl) { kondisiEl.innerText = "RUNNING"; kondisiEl.style.color = "var(--success)"; }
        if (produkEl) { produkEl.innerText = activeSched ? activeSched.produk : mData.currentProduct; produkEl.style.color = "var(--accent-color)"; }
    }

    let schedWt = "-";
    let schedActual = "-";
    let schedAvgSpeed = "-";
    let schedEff = "0%";
    let schedDtMtc = "-";
    let schedDtProd = "-";
    let schedDtPpic = "-";

    if(activeSched) { 
        if(typeof PRODUCTS !== 'undefined') {
            // Kita skip auto lookup dataProduksi jika ini ditarik manual dari firebase saja.
            let kodeMatTarget = "-";
            document.getElementById('tampilan-kode-mat').innerText = kodeMatTarget;
        }

        document.getElementById('tampilan-target100').innerText = activeSched.t100 !== undefined ? activeSched.t100 : "-";
        
        let iSpeed = parseFloat(activeSched.speed);
        document.getElementById('tampilan-ideal-speed').innerText = isNaN(iSpeed) ? "-" : iSpeed.toFixed(3) + " m/min";
        
        schedWt = (activeSched.wt !== undefined ? activeSched.wt : 0) + " Min";
        schedActual = (activeSched.actual !== undefined ? activeSched.actual : 0) + " Crt";
        schedEff = activeSched.eff || "0.00%"; 

        schedDtMtc = (activeSched.dtMtc !== undefined ? activeSched.dtMtc : 0) + " Min";
        schedDtProd = (activeSched.dtProd !== undefined ? activeSched.dtProd : 0) + " Min";
        schedDtPpic = (activeSched.dtPpic !== undefined ? activeSched.dtPpic : 0) + " Min";

        if(activeSched.opTime > 0) {
             let avgSpeed = (activeSched.actual / activeSched.opTime).toFixed(2);
             schedAvgSpeed = avgSpeed + " Crt/Min";
        } else {
             schedAvgSpeed = "0.00 Crt/Min";
        }
    } else {
        resetTampilanOrder();
    }
    
    document.getElementById('tampilan-wt').innerText = schedWt;
    document.getElementById('tampilan-actual').innerText = schedActual;
    document.getElementById('tampilan-avg-speed').innerText = schedAvgSpeed;
    document.getElementById('tampilan-eff').innerText = schedEff;
    document.getElementById('tampilan-dt-mtc').innerText = schedDtMtc;
    document.getElementById('tampilan-dt-prod').innerText = schedDtProd;
    document.getElementById('tampilan-dt-ppic').innerText = schedDtPpic;
    
    let kwhDisplay = (mData.kwhShift || 0).toFixed(4) + " kWh";
    let costDisplay = formatRupiah(mData.costShift || 0);

    document.getElementById('tampilan-kwh').innerText = kwhDisplay;
    document.getElementById('tampilan-cost').innerText = costDisplay;

    let dp = mData.breakdown.accumulated.production / 60;
    let dm = mData.breakdown.accumulated.maintenance / 60;
    let dppic = mData.breakdown.accumulated.ppic / 60;
    
    if(tampilanDtChartInstance) {
        tampilanDtChartInstance.data.datasets[0].data = [dp, dm, dppic];
        tampilanDtChartInstance.update();
    }
}
        
function resetTampilanOrder() {
    document.getElementById('tampilan-kode-mat').innerText = "-";
    document.getElementById('tampilan-target100').innerText = "-";
    document.getElementById('tampilan-ideal-speed').innerText = "-";
    document.getElementById('tampilan-wt').innerText = "-";
    document.getElementById('tampilan-actual').innerText = "-";
    document.getElementById('tampilan-avg-speed').innerText = "-";
    document.getElementById('tampilan-eff').innerText = "0%";
    document.getElementById('tampilan-dt-mtc').innerText = "-";
    document.getElementById('tampilan-dt-prod').innerText = "-";
    document.getElementById('tampilan-dt-ppic').innerText = "-";
}

function getProcessRemainingLife(machineId, processName) {
    let charCodeSum = 0;
    let combined = machineId + processName;
    for(let i=0; i<combined.length; i++) charCodeSum += combined.charCodeAt(i);
    return (charCodeSum * 15) % 1000 + 1; 
}

function autoCheckWO() {
    let kritisKomponen = 0;
    let pmMesin = 0;

    MACHINES.forEach(machineId => {
        let mData = machineData[machineId];
        if(!mData) return;
        let runHours = mData.runningHours;
        if (runHours >= 950) { 
            pmMesin++;
            let exists = workOrders.preventive.find(wo => wo.machine === machineId);
            if (!exists) {
                workOrders.preventive.push({
                    id: 'WO-PM-' + Math.floor(Math.random() * 9000 + 1000),
                    machine: machineId,
                    task: `[Jadwal PM] Mesin beroperasi ${runHours} Jam. Lakukan preventive maintenance.`,
                    status: 'Menunggu Eksekusi'
                });
            }
        }

        mData.processes.forEach(proc => {
            let lifeHours = getProcessRemainingLife(machineId, proc);
            if (lifeHours <= 50) { 
                kritisKomponen++;
                let exists = workOrders.predictive.find(wo => wo.machine === machineId && wo.process === proc);
                if (!exists) {
                    workOrders.predictive.push({
                        id: 'WO-PD-' + Math.floor(Math.random() * 9000 + 1000),
                        machine: machineId,
                        process: proc,
                        task: `[AI Alert] Sisa umur komponen ${proc} tinggal ${lifeHours} Jam! Jadwalkan pergantian.`,
                        status: 'Menunggu Eksekusi'
                    });
                }
            }
        });
    });

    if(document.getElementById('kpi-pm')) document.getElementById('kpi-pm').innerText = pmMesin;
    if(document.getElementById('kpi-kritis')) document.getElementById('kpi-kritis').innerText = kritisKomponen;
    renderWoUI();
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

    fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//active_runs/${dataJadwal.mesin}.json`, {
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

// LOGIKA SHIFT MURNI UPDATE VARIABEL UI (OEE DITANGANI BACKEND PYTHON)
setInterval(() => {
    let newShift = getCurrentShiftInfo();
    if(newShift !== currentActiveShift) {
        let currentTglIso = getFactoryDateIso();
        
        console.log(`[SHIFT CHANGE] Transisi ke ${newShift}. Perhitungan OEE dipisah oleh Python...`);
        currentActiveShift = newShift;
        
        MACHINES.forEach(id => {
            if (machineData[id]) {
                machineData[id].activeSecondsThisShift = 0;
                machineData[id].kwhShift = 0;
                machineData[id].costShift = 0;
                
                machineData[id]["lastFB_Shift1"] = undefined;
                machineData[id]["lastFB_Shift2"] = undefined;
                machineData[id]["lastFB_Shift3"] = undefined;
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
    MACHINES.forEach(id => {
        let mData = machineData[id];
        if(!mData) return;
        let isRunning = !mData.currentProduct.includes("IDLE") && !mData.currentProduct.includes("BELUM ADA JADWAL") && !mData.breakdown.isActive;
        let activeSched = scheduleDataList.find(s => s.mesin === id && s.tglFull === currentTglIso && s.shift === currentActiveShift && s.produk.trim() === mData.currentProduct.trim());
        if(isRunning && activeSched) {
            mData.activeSecondsThisShift += 1; 
        }
    });

    let isSchedulePageActive = document.getElementById('page-schedule').classList.contains('active');
    let isQualityPageActive = document.getElementById('page-schedule-maintenance').classList.contains('active');
    let isTampilanActive = document.getElementById('page-tampilan').classList.contains('active');

    if(scheduleDataList.length > 0) {
        scheduleDataList.forEach((d, index) => {
            if (d.tglFull === currentTglIso && d.shift === currentActiveShift) {
                let mac = d.mesin;
                let mData = machineData[mac];
                if(!mData) return;
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
                    effEl.innerText = d.eff || "0.00%";
                    document.getElementById(`sched-dtprod-${index}`).innerText = d.dtProd || 0;
                    document.getElementById(`sched-dtmtc-${index}`).innerText = d.dtMtc || 0;
                    document.getElementById(`sched-dtppic-${index}`).innerText = d.dtPpic || 0;
                    document.getElementById(`sched-dttotal-${index}`).innerText = d.dtTotal || 0;
                    document.getElementById(`sched-pdtmtc-${index}`).innerText = d.pDtMtc || "0.00%";
                    document.getElementById(`sched-pdtall-${index}`).innerText = d.pDtAll || "0.00%";
                    document.getElementById(`sched-optime-${index}`).innerText = d.opTime || d.wt;
                    document.getElementById(`sched-availtime-${index}`).innerText = d.availTime || d.wt;
                    document.getElementById(`sched-availm-${index}`).innerText = d.availMachine || "100.00%";
                    document.getElementById(`sched-perf-${index}`).innerText = d.perf || "0.00%";
                    document.getElementById(`sched-oee-${index}`).innerText = d.oee || "0.00%";
                    
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
        // Biarkan statis
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

function exportAndClearSchedule() {
    if (scheduleDataList.length === 0) {
        alert("Tidak ada data jadwal untuk diunduh!");
        return;
    }

    let todayIso = getFactoryDateIso();
    let pastSchedules = scheduleDataList.filter(s => s.tglFull < todayIso);
    let activeSchedules = scheduleDataList.filter(s => s.tglFull >= todayIso);

    if (pastSchedules.length === 0) {
        alert("Tidak ada jadwal kemarin yang bisa di-reset. Jadwal hari ini aman.");
        return;
    }

    if (!confirm(`Ditemukan ${pastSchedules.length} jadwal kemarin.\nYakin backup ke InfluxDB dan reset?`)) {
        return;
    }

    isResettingSchedule = true; 

    fetch('https://marvelous-undamaged-flagship.ngrok-free.dev/api/write-schedule', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pastSchedules)
    })
    .then(res => {
        if(!res.ok) throw new Error("Gagal backup.");
        return res.text();
    })
    .then(msg => {
        console.log("[INFLUXDB] " + msg);
        lanjutkanExportDanClear(pastSchedules, activeSchedules);
    })
    .catch(err => {
        console.error(err);
        alert("Gagal backup! Reset dibatalkan.");
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
    link.setAttribute("download", `Laporan_OEE_Schedule_${today.toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link); 
    link.click();
    document.body.removeChild(link);

    scheduleDataList = activeSchedules;

    let deletePromises = pastSchedules.map(s => {
        if (s.firebaseKey) {
            return fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules/${s.firebaseKey}.json`, { method: 'DELETE' });
        }
        return Promise.resolve();
    });

    Promise.all(deletePromises)
    .then(() => {
        alert("Reset jadwal kemarin sukses.");
        renderScheduleTable();
        updateScheduleMaintenanceStats();
        if(document.getElementById('page-schedule-maintenance').classList.contains('active')) renderQualityTable();
        setTimeout(() => { isResettingSchedule = false; }, 3000);
    }).catch(e => {
        isResettingSchedule = false;
    });
}

function renderProductionTable() {
    const tbodyProd = document.getElementById('db-production-body');
    if (!tbodyProd) return;
    tbodyProd.innerHTML = '';
    document.getElementById('production-shift-display').innerText = getCurrentShiftLabel();

    MACHINES.forEach(id => {
        let mData = machineData[id];
        if(!mData) return;
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

    MACHINES.forEach(id => {
        let mData = machineData[id];
        if(!mData) return;
        
        let activeScheds = scheduleDataList.filter(s => s.mesin === id && s.tglFull === todayIso && s.shift === currentActiveShift);
        let hasSchedule = activeScheds.length > 0;
        let isIdle = mData.currentProduct.includes("IDLE") || mData.currentProduct.includes("BELUM ADA JADWAL");
        
        let curSpeed = 0;
        if (realtimeDBData[id] && realtimeDBData[id].speed !== undefined) curSpeed = parseFloat(realtimeDBData[id].speed);
        let isBd = mData.breakdown.isActive || (!isIdle && curSpeed < 20);

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
    PRODUCTS.forEach(prod => {
        let isSelected = (machineData[machineId].currentProduct === prod) ? 'selected' : '';
        sel.innerHTML += `<option value="${prod}" ${isSelected}>${prod}</option>`;
    });
    document.getElementById('updateProductionModal').classList.add('active');
}

function saveProductionUpdate() {
    let machineId = document.getElementById('inputProdMachineId').value;
    let selectedProduct = document.getElementById('inputProdSelect').value;
    
    if(machineData[machineId].breakdown.isActive) {
        alert("Mesin sedang Breakdown! Selesaikan Breakdown di menu Downtime terlebih dahulu.");
        return;
    }

    machineData[machineId].currentProduct = selectedProduct;

    fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//active_runs/${machineId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine: machineId, product: selectedProduct, timestamp: Date.now() })
    }).catch(e => console.error(e));

    closeModal('updateProductionModal');
    if(document.getElementById('page-production').classList.contains('active')) renderProductionTable();
    refreshDashboardUI(); 
    updateTampilanUI();
    updateBreakdownUI();

    alert(`Produksi Line ${machineId} diupdate menjadi: ${selectedProduct}`);
}

function switchWoTab(tab) {
    currentWoTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    
    document.getElementById('btn-add-wo').style.display = (tab === 'manual') ? 'block' : 'none';
    renderWoUI();
}

function renderWoUI() {
    let countM = workOrders.manual.length;
    let countPrev = workOrders.preventive.length;
    let countPred = workOrders.predictive.length;
    let total = countM + countPrev + countPred;

    document.getElementById('badge-manual').innerText = countM;
    document.getElementById('badge-preventive').innerText = countPrev;
    document.getElementById('badge-predictive').innerText = countPred;

    let sbBadge = document.getElementById('sidebar-wo-badge');
    if (total > 0) {
        sbBadge.style.display = 'inline-block';
        sbBadge.innerText = total;
    } else {
        sbBadge.style.display = 'none';
    }

    if(document.getElementById('page-schedule-maintenance').classList.contains('active')) {
        let container = document.getElementById('wo-container');
        container.innerHTML = '';
        let list = workOrders[currentWoTab];

        if(list.length === 0) {
            container.innerHTML = `<p style="color:#94a3b8; font-style:italic; padding: 20px;">Tidak ada Work Order saat ini.</p>`;
            return;
        }

        list.forEach((wo, index) => {
            let borderColor = 'var(--accent-color)';
            if(currentWoTab === 'preventive') borderColor = 'var(--warning)';
            if(currentWoTab === 'predictive') borderColor = 'var(--danger)';

            let title = wo.machine;
            if(currentWoTab === 'predictive') title += ` - AI Alert (${wo.process})`;
            else if(currentWoTab === 'preventive') title += ` - Schedule PM`;
            else title += ` - Operator Request`;

            let card = `
            <div class="wo-card" style="border-top: 4px solid ${borderColor};">
                <div>
                    <div class="wo-card-header">
                        <span>${title}</span>
                        <span style="font-size:0.8em; color:#94a3b8;">${wo.id}</span>
                    </div>
                    <div class="wo-card-body" style="white-space: pre-line;">${wo.task}</div>
                </div>
                <div class="wo-card-footer">
                    <button class="btn btn-success" onclick="selesaikanWO('${currentWoTab}', ${index})">
                        <i class="fa-solid fa-check"></i> Selesai
                    </button>
                </div>
            </div>`;
            container.innerHTML += card;
        });
    }
}

function selesaikanWO(type, index) {
    if(confirm("Tandai Work Order ini telah selesai?")) {
        let completedWo = workOrders[type][index];
        if (type === 'preventive') {
            machineData[completedWo.machine].runningHours = 0; 
        }
        workOrders[type].splice(index, 1);
        autoCheckWO();
        renderDatabaseTable();
        if(currentMachine === completedWo.machine) refreshDashboardUI();
    }
}

function toggleWoMachineManual() {
    let val = document.getElementById('inputWoMachine').value;
    if(val === 'Lainnya') document.getElementById('inputWoMachineManual').style.display = 'block';
    else document.getElementById('inputWoMachineManual').style.display = 'none';
}

function saveManualWo() {
    let mac = document.getElementById('inputWoMachine').value;
    if (mac === 'Lainnya') mac = document.getElementById('inputWoMachineManual').value.trim();
    
    let dept = document.getElementById('inputWoDept').value;
    let deadline = document.getElementById('inputWoDeadline').value;
    let desc = document.getElementById('inputWoDesc').value.trim();
    
    if(!mac || !dept || !deadline || !desc) {
        return alert("Lengkapi data keluhan WO!");
    }

    let woEntry = {
        id: 'WO-M-' + Math.floor(Math.random() * 9000 + 1000),
        machine: mac, task: `[Req: ${dept}] | Deadline: ${deadline}\nKeluhan: ${desc}`,
        status: 'Menunggu Eksekusi', dept: dept, deadline: deadline, desc: desc          
    };

    workOrders.manual.push(woEntry);
    syncToGoogleSheets("addWo", woEntry);
    closeModal('addWoModal');
    renderWoUI();
    alert("WO berhasil dibuat!");
}

function toggleUnitManual() {
    let val = document.getElementById('logUnit').value;
    if(val === 'Lainnya') document.getElementById('logUnitManual').style.display = 'block';
    else document.getElementById('logUnitManual').style.display = 'none';
}

function calcLogbookTime() {
    let start = document.getElementById('logMulai').value;
    let end = document.getElementById('logSelesai').value;

    if(start && end) {
        let startTime = new Date(`1970-01-01T${start}:00`);
        let endTime = new Date(`1970-01-01T${end}:00`);
        let diffMs = endTime - startTime;
        if(diffMs < 0) diffMs += 24 * 60 * 60 * 1000; 
        document.getElementById('logTotalWaktu').value = Math.round(diffMs / 60000);
    }
}

function saveLogbook() {
    let tgl = document.getElementById('logTanggal').value;
    let shift = document.getElementById('logShift').value;
    let mesin = document.getElementById('logMesin').value;
    
    let unit = document.getElementById('logUnit').value;
    if(unit === 'Lainnya') unit = document.getElementById('logUnitManual').value.trim();

    let masalah = document.getElementById('logMasalah').value.trim();
    let penyebab = document.getElementById('logPenyebab').value.trim();
    let kategori = document.getElementById('logKategori').value.trim();
    let tindakan = document.getElementById('logTindakan').value.trim();
    let mulai = document.getElementById('logMulai').value;
    let selesai = document.getElementById('logSelesai').value;
    let totalWaktu = document.getElementById('logTotalWaktu').value;
    
    if(!tgl || !mesin || !unit || !masalah || !kategori || !mulai || !selesai) {
        return alert("Mohon lengkapi data!");
    }

    let logEntry = {
        tanggal: tgl, shift: shift, mesin: mesin, unit: unit, masalah: masalah,
        penyebab: penyebab, kategori: kategori, tindakan: tindakan, mulai: mulai,
        selesai: selesai, durasi: totalWaktu, hm: document.getElementById('logHourMeter').value || "-",
        part: document.getElementById('logGantiPart').value.trim() || "-",
        placement: document.getElementById('logPlacement').value.trim() || "-",
        subPlace: document.getElementById('logSubPlacement').value.trim() || "-",
        status: document.getElementById('logStatus').value, timestamp: new Date().toISOString()
    };

    logbookData.unshift(logEntry);
    syncToGoogleSheets("addLogbook", logEntry); 
    closeModal('addLogbookModal');
    renderLogbookTable();
    alert("Logbook disimpan!");
}

function renderLogbookTable() {
    const tbody = document.getElementById('db-logbook-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if(logbookData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; color: #94a3b8; font-style: italic; padding: 20px;">Belum ada history perbaikan / data logbook...</td></tr>`;
        return;
    }

    logbookData.forEach(log => {
        let statusBg = log.status === 'Selesai' ? 'var(--success)' : 'var(--warning)';
        tbody.innerHTML += `
            <tr>
                <td>${log.tanggal}</td>
                <td>Shift ${log.shift}</td>
                <td><strong>${log.mesin}</strong></td>
                <td>${log.unit}</td>
                <td>${log.masalah}</td>
                <td>${log.penyebab}</td>
                <td><span style="font-size:0.85em; background:#f1f5f9; padding:4px 8px; border-radius:4px; border:1px solid #cbd5e1;">${log.kategori}</span></td>
                <td>${log.tindakan}</td>
                <td>${log.mulai}</td>
                <td>${log.selesai}</td>
                <td style="text-align: center; font-weight: bold; color: var(--danger);">${log.durasi} Min</td>
                <td>${log.hm}</td>
                <td>${log.part}</td>
                <td>${log.placement}</td>
                <td>${log.subPlace}</td>
                <td style="text-align: center;">
                    <span style="padding: 4px 10px; border-radius: 6px; font-size: 0.85em; font-weight: bold; background: ${statusBg}; color: white;">${log.status}</span>
                </td>
            </tr>`;
    });
}

function autoFillSho() {
    let shift = document.getElementById('shoShift').value;
    let findings = logbookData.filter(l => l.shift === shift).map(l => `* [${l.mesin}] ${l.masalah}`).join("\n");
    let pendings = logbookData.filter(l => l.shift === shift && l.status === 'Pending Job').map(l => `* [${l.mesin}] ${l.masalah}`).join("\n");
    
    document.getElementById('shoFinding').value = findings || "-";
    document.getElementById('shoPending').value = pendings || "-";
}

function saveSho() {
    let tgl = document.getElementById('shoTanggal').value;
    let tekAwal = document.getElementById('shoTeknisi').value.trim();
    let tekLanjut = document.getElementById('shoTeknisiNext').value.trim();

    if(!tgl || !tekAwal || !tekLanjut) return alert("Lengkapi form SHO!");

    let shoEntry = {
        tanggal: tgl, shift: document.getElementById('shoShift').value,
        teknisi: tekAwal, shift_lanjut: document.getElementById('shoShiftNext').value,
        teknisi_lanjut: tekLanjut, finding: document.getElementById('shoFinding').value.trim(),
        pending: document.getElementById('shoPending').value.trim(),
        tools: document.getElementById('shoTools').value, timestamp: new Date().toISOString()
    };

    shoData = []; shoData.unshift(shoEntry); logbookData = []; 
    syncToGoogleSheets("addSho", shoEntry); 

    closeModal('addShoModal');
    renderShoTable();
    renderLogbookTable(); 
    alert("SHO Disimpan! Logbook direset untuk shift berikutnya.");
}

function renderShoTable() {
    const tbody = document.getElementById('db-sho-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if(shoData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; font-style: italic; padding: 20px;">Belum ada Laporan SHO...</td></tr>`;
        return;
    }
    shoData.forEach(s => {
        let toolsColor = s.tools.includes('LENGKAP') ? 'var(--success)' : 'var(--danger)';
        let htmlTeknisi = s.teknisi.replace(/\n/g, '<br>').replace(/\*/g, '');
        tbody.innerHTML += `
            <tr>
                <td>${s.tanggal} <br><strong>(Shift ${s.shift})</strong></td>
                <td><strong>${htmlTeknisi}</strong></td>
                <td style="white-space: pre-line;">${s.finding}</td>
                <td style="white-space: pre-line; color: var(--danger); font-weight: 500;">${s.pending}</td>
                <td style="text-align: center; color:${toolsColor}; font-weight:bold;">${s.tools}</td>
            </tr>`;
    });
}

function initBreakdownFreq() {
    let container = document.getElementById('breakdown-freq-container');
    if (!container) return;
    container.innerHTML = '';
    MACHINES.forEach(mac => {
        if(breakdownFreq[mac] === undefined) breakdownFreq[mac] = 0;
        container.innerHTML += `
            <div style="display:flex; flex-direction:column; align-items:center; padding: 15px; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 8px; cursor: default;">
                <span style="font-weight:bold; font-size: 1.1em; color: var(--text-dark);">${mac}</span>
                <span style="color: var(--danger); font-size: 1.2em; font-weight: bold;" id="bd-count-${mac}">${breakdownFreq[mac]}x</span>
            </div>`;
    });
}

function renderQualityTable() {
    let tbody = document.getElementById('sm-quality-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (scheduleDataList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; font-style: italic; padding: 20px;">Belum ada data dari Schedule Produksi.</td></tr>`;
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
            </tr>`;
    });
}

function calculateQualityPercent(index, value) {
    let entry = scheduleDataList[index];
    let acc = parseFloat(value) || 0;
    
    if (acc > entry.actual) {
        alert("Jumlah ACC Produk tidak boleh melebihi Actual Output!");
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
    if (pageId === 'schedule') {
        let pass = prompt("Masukkan Password untuk mengakses halaman Schedule Produksi:");
        if (pass !== "admin123") { 
            alert("Password Salah! Akses ditolak.");
            return; 
        }
    }

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
        renderWoUI();
    } else if (pageId === 'production') {
        document.getElementById('topbar-title').innerText = "Manajemen Lini Produksi & Shift";
        renderProductionTable();
    } else if (pageId === 'kpi-oee') {
        document.getElementById('topbar-title').innerText = "Input & Analisa Downtime";
        let sel = document.getElementById('bd-machine-select');
        sel.innerHTML = '';
        MACHINES.forEach(id => {
            sel.innerHTML += `<option value="${id}">${machineData[id].name}</option>`;
        });
        sel.value = currentMachine;
        updateBreakdownUI();
    } else if (pageId === 'electricity') {
        document.getElementById('topbar-title').innerText = "Finansial & Cost Konsumsi Listrik Pabrik";
        renderElectricityTable();
    } else if (pageId === 'logbook') {
        document.getElementById('topbar-title').innerText = "Catatan Logbook Technician & SHO";
        renderLogbookTable();
        renderShoTable();
    } else if (pageId === 'schedule') {
        document.getElementById('topbar-title').innerText = "Schedule Produksi & Parameter";
        initSchedulePage();
        renderScheduleTable();
    } else if (pageId === 'tampilan') {
        document.getElementById('topbar-title').innerText = "Tampilan Mesin Terintegrasi";
        let sel = document.getElementById('tampilan-machine-select');
        sel.innerHTML = '';
        MACHINES.forEach(id => {
            sel.innerHTML += `<option value="${id}">${machineData[id].name}</option>`;
        });
        sel.value = currentMachine;
        updateTampilanUI();
        
        if (currentMachine) fetchHistoryFromLocal(currentMachine);
    } else if (pageId === 'analisa') {
        document.getElementById('topbar-title').innerText = "Analisa Historis & Reporting";
        initAnalisaPage();
    }
}

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
        MACHINES.forEach(id => {
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
            let labels = []; let speedArr = []; let costArr = []; let kwArr = [];

            data.forEach(row => {
                let dt = new Date(row.time);
                let label = "";
                if (interval === '1h') label = `${dt.getDate()}/${dt.getMonth()+1} ${dt.getHours()}:00`;
                else if (interval === '1d') label = `${dt.getDate()}/${dt.getMonth()+1}/${dt.getFullYear()}`;
                else {
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
    .catch(err => console.error("Gagal menarik data report sensor:", err));

    fetch(`https://marvelous-undamaged-flagship.ngrok-free.dev/api/report-schedule/${machineId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startIso, stop: endIso, interval: interval }) 
    })
    .then(res => res.json())
    .then(data => {
        if(!data || data.length === 0) {
            console.warn("Tidak ada histori schedule OEE.");
            let tbody = document.getElementById('db-analisa-schedule-body');
            if(tbody) tbody.innerHTML = '<tr><td colspan="25" style="text-align: center; color: #94a3b8; font-style: italic; padding: 20px;">Tidak ada histori schedule / OEE pada rentang tanggal ini.</td></tr>';
        } else {
            analisaScheduleHistoryData = data;
            renderAnalisaScheduleTable(data);
            updateAnalisaOeeChart(data);
        }
    })
    .catch(err => console.error("Gagal menarik data histori schedule:", err));
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
    
    let labels = []; let availData = []; let perfData = []; let oeeData = [];
    let machineId = document.getElementById('analisaMachineSelect').value;
    
    if (machineId === "ALL") {
        let grouped = {};
        data.forEach(d => {
            if(!grouped[d.mesin]) grouped[d.mesin] = { availSum: 0, perfSum: 0, oeeSum: 0, count: 0 };
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
    if (analisaScheduleHistoryData.length === 0) return alert("Tidak ada data histori jadwal untuk diunduh.");

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
    link.setAttribute("download", `Histori_OEE_${mac}_${today.toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link); 
    link.click();
    document.body.removeChild(link);
}

// BUNGKUS DENGAN TRY-CATCH AGAR ERROR LIBRARY TIDAK MEMATIKAN APLIKASI
window.onload = () => {
    currentActiveShift = getCurrentShiftInfo(); 

    buildInitialMachineData();
    refreshDashboardUI();
    
    try { initChart(); } catch(e){}
    try { initTampilanCharts(); } catch(e){}
    try { initAnalisaCharts(); } catch(e){}
    
    autoCheckWO(); 
    renderLogbookTable(); 
    renderShoTable();

    fetchSchedulesFromFirebase();
    fetchActiveRunsFromFirebase();

    setInterval(updateRealtimeClock, 1000);
    setInterval(liveUpdateDashboard, 2000); 
    setInterval(pollRealtimeData, 1000); 
    setInterval(fetchSchedulesFromFirebase, 3000);
    setInterval(fetchAccumulatedPowerFromFirebase, 3000);
};
