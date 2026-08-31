// VARIABLE GLOBAL SHIFT UNTUK TRACKING PERUBAHAN
let currentActiveShift = "";
let isResettingSchedule = false; // FLAG PENGUNCI AGAR TIDAK BENTROK SAAT RESET
let lastPollTime = Date.now(); // KUNCI ANTI-GHOST UNTUK TAB TERTIDUR

// --- UBAHAN: TARIF KWH MENJADI AKTUAL RP 1500 ---
const tarifKwh = 1500; 
const tarifListrikPerDetik = tarifKwh / 3600; // Rp 0.4166666... per detik
// ---------------------------

// --- FUNGSI MUTLAK: TANGGAL PABRIK (FACTORY DATE) ---
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
// ----------------------------------------------------

// FUNGSI JAM REALTIME WIB
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
    } else {
        console.log("[GOOGLE SHEETS] Melewati proses kirim karena URL Script belum diatur.");
    }
}

let machineData = {};
let currentMachine = "";

let workOrders = { manual: [], preventive: [], predictive: [] };
let currentWoTab = 'manual';

let logbookData = [];
let shoData = [];
let scheduleDataList = [];

// Variabel untuk menyimpan count breakdown maintenance otomatis
let breakdownFreq = {};

// --- TAMBAHAN: Variabel Global untuk Chart Tampilan ---
let tampilanSpeedChartInstance;
let tampilanDtChartInstance;
let tampilanTimeLabels = [];
let tampilanSpeedData = [];
let isLiveView = true; 
// --------------------------------------------------------

// Array Global Untuk Menampung Semua Riwayat Breakdown
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
        alert("Gagal mengunduh data. Pastikan API Lokal InfluxDB menyala (node server.js).");
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

// --- FIREBASE RTDB AUTO BREAKDOWN ---
const firebaseUrlRT = 'https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//speed_mesin.json';        
        
let realtimeDBData = {};
let autoBreakdownState = {};
let pendingAutoBd = { machineId: null, elapsedSec: 0 }; 

function fetchSchedulesFromFirebase() {
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules.json')
    .then(res => res.json())
    .then(data => {
        if (data) {
            let validSchedules = [];
            let ghostKeys = [];

            Object.keys(data).forEach(key => {
                let obj = data[key];
                if(obj && typeof obj === 'object' && obj.idJadwal && obj.mesin && obj.mesin !== "undefined") {
                    obj.firebaseKey = key; 
                    validSchedules.push(obj);
                } else {
                    ghostKeys.push(key);
                }
            });
            
            scheduleDataList = validSchedules;

            ghostKeys.forEach(gKey => {
                fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules/${gKey}.json`, {
                    method: 'DELETE'
                }).catch(e => {});
            });
            
            let currentTglIso = getFactoryDateIso();
            
            rawMachineList.forEach(id => {
                let mData = machineData[id];
                if(mData && mData.currentProduct.includes("IDLE")) {
                    let sched = scheduleDataList.find(s => s.mesin === id && s.tglFull === currentTglIso && s.shift === currentActiveShift);
                    if(sched) mData.currentProduct = sched.produk.trim();
                }
            });
        }
        fetchBreakdownStatesFromFirebase();
    }).catch(e => {
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
            updateDowntimeBadge(); 
        }
        fetchActiveRunsFromFirebase();
    }).catch(e => {
        console.error("Error fetch breakdowns:", e);
        fetchActiveRunsFromFirebase();
    });
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
        
        fetchAccumulatedPowerFromFirebase(); 

        refreshDashboardUI();
        if(document.getElementById('page-production').classList.contains('active')) renderProductionTable();
        if(document.getElementById('page-schedule').classList.contains('active')) renderScheduleTable();
        if(document.getElementById('page-tampilan').classList.contains('active')) {
            updateTampilanUI();
            if (currentMachine) fetchHistoryFromLocal(currentMachine); 
        }
        if(document.getElementById('page-schedule-maintenance').classList.contains('active')) {
            updateScheduleMaintenanceStats();
            renderQualityTable();
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

function checkPendingModal() {
    if (!currentMachine) return;
    let mData = machineData[currentMachine];
    if (!mData) return;

    let modalEl = document.getElementById('autoBdModal');
    let isDowntimePage = document.getElementById('page-kpi-oee').classList.contains('active');
    
    if (isDowntimePage && mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING" && mData.breakdown.lockedElapsedSec !== null) {
        
        if (!modalEl.classList.contains('active') || pendingAutoBd.machineId !== currentMachine) {
            pendingAutoBd.machineId = currentMachine;
            pendingAutoBd.elapsedSec = mData.breakdown.lockedElapsedSec;

            let m = Math.floor(pendingAutoBd.elapsedSec / 60);
            let s = pendingAutoBd.elapsedSec % 60;
            
            document.getElementById('autoBdMessage').innerText = `Mesin ${currentMachine} telah kembali beroperasi (Speed > 20).\nTotal Durasi Downtime tercatat: ${m} Menit ${s} Detik.\n\nSilakan tentukan Kategori Breakdown dari tombol di bawah:`;
            modalEl.classList.add('active');
        }
    } else {
        if (modalEl.classList.contains('active')) {
            modalEl.classList.remove('active');
            pendingAutoBd = { machineId: null, elapsedSec: 0 };
        }
    }
}

function updateDowntimeBadge() {
    let pendingCount = 0;
    let currentTglIso = getFactoryDateIso();

    rawMachineList.forEach(id => {
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

    let elapsedSec = mData.breakdown.lockedElapsedSec !== null ? mData.breakdown.lockedElapsedSec : Math.floor((new Date() - mData.breakdown.startTime) / 1000);

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
    
    if (autoBreakdownState[macId]) {
        autoBreakdownState[macId].isAutoDown = false;
    }

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

    // --- KUNCI ANTI-GHOST TAB TIDUR ---
    let nowTime = Date.now();
    let isAsleep = (nowTime - lastPollTime > 10000); 
    lastPollTime = nowTime;

    if (isAsleep) {
        console.warn("[SYSTEM] Tab terdeteksi sempat tertidur (background sleep). Sinkronisasi ulang data mutlak...");
        fetchSchedulesFromFirebase();
        return; 
    }
    // ----------------------------------

    // 1. Fetch Speed untuk Update UI
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
          processAutoBreakdown();
      })
      .catch(e => console.warn("Menunggu koneksi RTDB Speed...", e));

    // 2. Fetch Actual Output KHUSUS
    let tglIso = getFactoryDateIso();
    let curShift = getCurrentShiftInfo();

    function getShiftRank(isoDate, shiftName) {
        let sNum = shiftName.includes("1") ? 1 : (shiftName.includes("2") ? 2 : 3);
        return parseInt(isoDate.replace(/-/g, '') + sNum);
    }
    let currentRank = getShiftRank(tglIso, curShift);
    
    rawMachineList.forEach(mac => {
        fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//timbangan/${mac.toUpperCase()}.json`)
        .then(res => res.json())
        .then(data => {
            if (!data) return;

            let countsPerShift = { "Shift 1": 0, "Shift 2": 0, "Shift 3": 0 };
            
            Object.keys(data).forEach(key => {
                let item = data[key];
                let uCode = (item.userCode || item.userName || "").toString().toUpperCase();
                if (uCode.includes("SHIFT 1")) countsPerShift["Shift 1"]++;
                else if (uCode.includes("SHIFT 2")) countsPerShift["Shift 2"]++;
                else if (uCode.includes("SHIFT 3")) countsPerShift["Shift 3"]++;
            });

            ["Shift 1", "Shift 2", "Shift 3"].forEach(iterShift => {
                let shiftCount = countsPerShift[iterShift];
                let isCurrentShift = (iterShift === curShift);
                
                if (shiftCount > 0) {
                    let validSchedules = scheduleDataList.filter(s => {
                        return s.mesin === mac && s.shift === iterShift && getShiftRank(s.tglFull, s.shift) <= currentRank;
                    });
                    
                    let targetSched = validSchedules[validSchedules.length - 1]; 
                    
                    if (targetSched) {
                        let mData = machineData[mac];
                        let fbKeyStr = "lastFB_" + targetSched.idJadwal; 
                        let isUpdated = false;

                        if (mData[fbKeyStr] === undefined) {
                            let totalScheduledActual = 0;
                            scheduleDataList.forEach(s => {
                                if (s.tglFull === targetSched.tglFull && s.shift === iterShift && s.mesin === mac) {
                                    totalScheduledActual += (parseFloat(s.actual) || 0);
                                }
                            });

                            if (shiftCount > totalScheduledActual) {
                                let missedCount = shiftCount - totalScheduledActual;
                                targetSched.actual += missedCount;
                                isUpdated = true;
                            }
                            mData[fbKeyStr] = shiftCount;
                        } else {
                            let delta = shiftCount - mData[fbKeyStr];
                            if (delta !== 0) {
                                if (delta > 0) {
                                    targetSched.actual += delta;
                                    isUpdated = true;
                                } else if (delta < 0 && shiftCount > 0) {
                                    targetSched.actual += shiftCount; 
                                    isUpdated = true;
                                }
                                mData[fbKeyStr] = shiftCount;
                            }
                        }

                        if (isUpdated && targetSched.firebaseKey && !isResettingSchedule) {
                            fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules/${targetSched.firebaseKey}.json`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ actual: targetSched.actual })
                            }).catch(e => {});
                        }
                    }
                }

                if (!isCurrentShift && shiftCount > 0 && !isResettingSchedule) {
                    let keysToClean = Object.keys(data).filter(k => {
                        let uc = (data[k].userCode || data[k].userName || "").toString().toUpperCase();
                        return uc.includes(iterShift.replace("Shift ", "SHIFT "));
                    });
                    
                    if (keysToClean.length > 0) {
                        keysToClean.forEach(k => {
                            fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//timbangan/${mac.toUpperCase()}/${k}.json`, {
                                method: 'DELETE'
                            }).catch(e => {});
                        });
                    }
                }
            });
            
            if (!realtimeDBData[mac]) realtimeDBData[mac] = {};
            realtimeDBData[mac].lastUpdate = Date.now();
        }).catch(e => {}); 
    });

    // 3. Fetch Daya
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//DAYA.json')
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

                if (isResettingSchedule) return; 

                let schedulesThisShift = scheduleDataList.filter(s => 
                    s.mesin === macId && 
                    s.tglFull === localTglIso && 
                    s.shift === localCurShift
                );

                if (schedulesThisShift.length > 0) {
                    schedulesThisShift.forEach(sched => {
                        sched.kwh = mData.kwhShift;
                        sched.costListrik = mData.costShift;
                    });
                }
            }
        }
    }).catch(e => console.warn("Menunggu data DAYA dari Firebase..."));
    
    // 4. --- SINKRONISASI PENDING MODAL DARI BACKEND PYTHON ---
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//pending_modal.json')
    .then(res => res.json())
    .then(pendingData => {
        if (!pendingData) return;
        for (let mac in pendingData) {
            let pData = pendingData[mac];
            let mData = machineData[mac];
            // Jika backend memutuskan mesin nyala dan mengunci waktu
            if (mData && mData.breakdown.isActive) {
                mData.breakdown.lockedElapsedSec = pData.elapsedSec;
                if (pendingAutoBd.machineId !== mac) {
                    pendingAutoBd.machineId = mac;
                    pendingAutoBd.elapsedSec = pData.elapsedSec;
                }
            }
        }
        checkPendingModal();
    }).catch(e => {});

    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//bd_resolved_flag.json')
    .then(res => res.json())
    .then(flags => {
        if(!flags) return;
        for(let mac in flags) {
            let mData = machineData[mac];
            let flag = flags[mac];
            if (mData && mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING") {
                if (flag.timestamp > mData.breakdown.startTime.getTime()) {
                    console.log(`[SYNC] Mesin ${mac} telah dikategorikan sebagai '${flag.category}' oleh perangkat lain.`);
                    applySilentBreakdownResolution(mac, flag.category);
                }
            }
        }
    }).catch(e => {});
}

// --- PERBAIKAN MUTLAK AUTO FORCE DOWNTIME DENGAN BACKEND ---
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

            let isIdleStatus = mData.currentProduct.includes("IDLE") || mData.currentProduct.includes("BELUM ADA JADWAL");

            // Jika mesin JALAN, UI biarkan saja (jangan kunci waktu). Tunggu info dari pending_modal (Python)
            if (speedVal >= 20) {
                if (state.isAutoDown) {
                    state.isAutoDown = false;
                }
            } 
            // JIKA MESIN MATI, update Timer Merah di UI (Post Event START di-handle Python)
            else if (speedVal < 20 && !isIdleStatus) {
                if (!state.isAutoDown) {
                    // Cek jika mati beruntun sebelum dikategorikan
                    if (mData.breakdown.isActive && mData.breakdown.category === "AUTO-PENDING") {
                        let forcedSec = mData.breakdown.lockedElapsedSec !== null 
                            ? mData.breakdown.lockedElapsedSec 
                            : Math.floor((new Date() - mData.breakdown.startTime) / 1000);
                            
                        saveAutoBreakdown('production', macId, forcedSec);
                    }

                    mData.breakdown.isActive = true;
                    mData.breakdown.category = "AUTO-PENDING";
                    mData.breakdown.startTime = new Date(); 
                    mData.breakdown.lockedElapsedSec = null; 
                    
                    state.isAutoDown = true;
                    state.startTime = mData.breakdown.startTime;

                    updateBreakdownUI();
                    refreshDashboardUI();
                    updateTampilanUI();
                }
            }
        }
    }
    updateDowntimeBadge(); 
}

function saveAutoBreakdown(finalCategory, forceMacId = null, forceSec = null) {
    let macId = forceMacId || pendingAutoBd.machineId;
    let elapsedSec = forceSec !== null ? forceSec : pendingAutoBd.elapsedSec;
    
    if(!macId) return;

    if (elapsedSec > 28800) elapsedSec = 28800; 
    if (elapsedSec < 0) elapsedSec = 0;

    let mData = machineData[macId];
    if (!mData || !mData.breakdown.startTime) return;

    fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//bd_resolved_flag/${macId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: finalCategory, timestamp: Date.now() })
    }).catch(e => {});

    // --- MENGHAPUS NODE PENDING DARI PYTHON AGAR MODAL BERSIH ---
    fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//pending_modal/${macId}.json`, {
        method: 'DELETE'
    }).catch(e => {});

    let productBeforeBd = mData.currentProduct;
    mData.breakdown.category = finalCategory;

    if(finalCategory === 'maintenance') {
        if(breakdownFreq[macId] === undefined) breakdownFreq[macId] = 0;
        breakdownFreq[macId]++;
        let freqLabel = document.getElementById(`bd-count-${macId}`);
        if(freqLabel) freqLabel.innerText = breakdownFreq[macId] + 'x';
    }

    let dtStart = new Date(mData.breakdown.startTime);
    let correctTglIso = getFactoryDateIso(dtStart);
    let correctShift = getCurrentShiftInfo(dtStart);

    mData.breakdown.isActive = false;
    mData.breakdown.category = null;
    mData.breakdown.startTime = null;
    mData.breakdown.lockedElapsedSec = null; 
    
    if (autoBreakdownState[macId]) {
        autoBreakdownState[macId].isAutoDown = false;
    }

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

    updateBreakdownUI();
    refreshDashboardUI();
    updateTampilanUI();
    
    if (pendingAutoBd.machineId === macId) {
        document.getElementById('autoBdModal').classList.remove('active');
        pendingAutoBd = { machineId: null, elapsedSec: 0 };
    }
    
    if (!forceMacId) {
        alert(`Data Breakdown berhasil disimpan pada kategori ${finalCategory.toUpperCase()}!`);
    }

    updateDowntimeBadge(); 
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('show');
    overlay.classList.toggle('show');
}

if (typeof rawMachineList === 'undefined') { window.rawMachineList = ["NP313", "FC122", "TW408", "JRT06", "HRT02", "TL01"]; }
if (typeof productList === 'undefined') { window.productList = ["Brand SPS Facial 2 Ply", "Brand SPS Napkin Regular", "Jumbo Roll Premium SP", "Towel Multipurpose SPS"]; }
if (typeof powerData === 'undefined') { window.powerData = {"MAIN_FACTORY": 1200, "NP313": 45.5, "FC122": 38.2}; }
if (typeof unitList === 'undefined') { window.unitList = ["Motor Unwinder", "Cylinder Emboss", "Folding Blade", "Logsaw Blade Belt", "Pneumatic Valve"]; }

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
    rawMachineList.forEach(m => {
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
                if (!isNaN(wtJadwal) && wtJadwal > 0) {
                    spesifikWt = wtJadwal;
                }
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

function updateTampilanUI() {
    if(!document.getElementById('page-tampilan').classList.contains('active') || !currentMachine) return;
    
    let mData = machineData[currentMachine];
    document.getElementById('tampilan-nama-mesin').innerText = mData.name;
    document.getElementById('tampilan-shift').innerText = getCurrentShiftLabel();
    
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

    if (isCurrentlyBd) {
        if (kondisiEl) { kondisiEl.innerText = "BREAKDOWN"; kondisiEl.style.color = "var(--danger)"; }
        if (produkEl) { produkEl.innerText = activeSched ? activeSched.produk : productToCheck; produkEl.style.color = "var(--text-dark)"; }
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
        if(typeof dataProduksi !== 'undefined') {
            let prodDetail = dataProduksi.find(item => item["NAMA MESIN"] === currentMachine && item["NAMA PRODUK"].trim() === activeSched.produk.trim());
            if(prodDetail) {
                document.getElementById('tampilan-kode-mat').innerText = prodDetail["KODE MATERIAL FG NEW"] || "-";
            } else {
                document.getElementById('tampilan-kode-mat').innerText = "-";
            }
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
    tampilanDtChartInstance.data.datasets[0].data = [dp, dm, dppic];
    tampilanDtChartInstance.update();
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

    rawMachineList.forEach(machineId => {
        let mData = machineData[machineId];
        let runHours = mData.runningHours;
        if (runHours >= 950) { 
            pmMesin++;
            let exists = workOrders.preventive.find(wo => wo.machine === machineId);
            if (!exists) {
                workOrders.preventive.push({
                    id: 'WO-PM-' + Math.floor(Math.random() * 9000 + 1000),
                    machine: machineId,
                    task: `[Jadwal PM] Mesin sudah beroperasi ${runHours} Jam. Lakukan revisi total / preventive maintenance keseluruhan.`,
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
                        task: `[AI Alert] Sisa umur prediksi komponen ${proc} tinggal ${lifeHours} Jam! Berisiko breakdown, jadwalkan pergantian part.`,
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

setInterval(() => {
    let newShift = getCurrentShiftInfo();
    if(newShift !== currentActiveShift) {
        let oldShift = currentActiveShift;
        let currentTglIso = getFactoryDateIso();
        
        console.log(`[SHIFT CHANGE] Transisi ke ${newShift}. Resolving active downtime for old shift...`);
        
        rawMachineList.forEach(id => {
            let mData = machineData[id];
            if (mData && mData.breakdown.isActive) {
                let elapsedSec = mData.breakdown.lockedElapsedSec !== null 
                    ? mData.breakdown.lockedElapsedSec 
                    : Math.floor((new Date() - mData.breakdown.startTime) / 1000);
                
                console.log(`[SHIFT SPLIT] Memotong waktu downtime mesin ${id} untuk shift lama...`);
                saveAutoBreakdown('production', id, elapsedSec);
                
                if (autoBreakdownState[id] && autoBreakdownState[id].isAutoDown) {
                    mData.breakdown.isActive = true;
                    mData.breakdown.category = "AUTO-PENDING";
                    mData.breakdown.startTime = new Date(); 
                    mData.breakdown.lockedElapsedSec = null;
                    
                    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//breakdown_events.json', {
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

        currentActiveShift = newShift;
        
        rawMachineList.forEach(id => {
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

    rawMachineList.forEach(id => {
        let mData = machineData[id];
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
                            let dtMins = eSec / 60; 
                            
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
            return fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules/${s.firebaseKey}.json`, {
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
    productList.forEach(prod => {
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
            container.innerHTML = `<p style="color:#94a3b8; font-style:italic; padding: 20px;">Tidak ada Work Order ${currentWoTab} saat ini.</p>`;
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
                        <i class="fa-solid fa-check"></i> Eksekusi Selesai
                    </button>
                </div>
            </div>`;
            container.innerHTML += card;
        });
    }
}

function selesaikanWO(type, index) {
    if(confirm("Tandai Work Order ini telah selesai dieksekusi oleh teknisi?")) {
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
    if(val === 'Lainnya') {
        document.getElementById('inputWoMachineManual').style.display = 'block';
    } else {
        document.getElementById('inputWoMachineManual').style.display = 'none';
    }
}

function saveManualWo() {
    let mac = document.getElementById('inputWoMachine').value;
    
    if (mac === 'Lainnya') {
        mac = document.getElementById('inputWoMachineManual').value.trim();
    }
    
    let dept = document.getElementById('inputWoDept').value;
    let deadline = document.getElementById('inputWoDeadline').value;
    let desc = document.getElementById('inputWoDesc').value.trim();
    
    if(!mac || !dept || !deadline || !desc) {
        return alert("Pilih mesin, departemen requestor, deadline, dan isi deskripsi keluhan terlebih dahulu!");
    }

    let newTask = `[Req: ${dept}] | Deadline: ${deadline}\nKeluhan: ${desc}`;

    let woEntry = {
        id: 'WO-M-' + Math.floor(Math.random() * 9000 + 1000),
        machine: mac,
        task: newTask,
        status: 'Menunggu Eksekusi',
        dept: dept,          
        deadline: deadline, 
        desc: desc          
    };

    workOrders.manual.push(woEntry);
    
    syncToGoogleSheets("addWo", woEntry);

    closeModal('addWoModal');
    renderWoUI();
    alert("Work Order Manual berhasil dibuat dan data siap dikirim!");
}

function toggleUnitManual() {
    let val = document.getElementById('logUnit').value;
    if(val === 'Lainnya') {
        document.getElementById('logUnitManual').style.display = 'block';
    } else {
        document.getElementById('logUnitManual').style.display = 'none';
    }
}

function calcLogbookTime() {
    let start = document.getElementById('logMulai').value;
    let end = document.getElementById('logSelesai').value;

    if(start && end) {
        let startTime = new Date(`1970-01-01T${start}:00`);
        let endTime = new Date(`1970-01-01T${end}:00`);
        
        let diffMs = endTime - startTime;
        if(diffMs < 0) {
            diffMs += 24 * 60 * 60 * 1000; 
        }
        let diffMins = Math.round(diffMs / 60000);
        document.getElementById('logTotalWaktu').value = diffMins;
    }
}

function saveLogbook() {
    let tgl = document.getElementById('logTanggal').value;
    let shift = document.getElementById('logShift').value;
    let mesin = document.getElementById('logMesin').value;
    
    let unit = document.getElementById('logUnit').value;
    if(unit === 'Lainnya') {
        unit = document.getElementById('logUnitManual').value.trim();
    }

    let masalah = document.getElementById('logMasalah').value.trim();
    let penyebab = document.getElementById('logPenyebab').value.trim();
    let kategori = document.getElementById('logKategori').value.trim();
    let tindakan = document.getElementById('logTindakan').value.trim();
    let mulai = document.getElementById('logMulai').value;
    let selesai = document.getElementById('logSelesai').value;
    let totalWaktu = document.getElementById('logTotalWaktu').value;
    let hm = document.getElementById('logHourMeter').value || "-";
    let gantiPart = document.getElementById('logGantiPart').value.trim() || "-";
    let placement = document.getElementById('logPlacement').value.trim() || "-";
    let subPlacement = document.getElementById('logSubPlacement').value.trim() || "-";
    let statusPekerjaan = document.getElementById('logStatus').value;
    
    if(!tgl || !mesin || !unit || !masalah || !kategori || !mulai || !selesai) {
        return alert("Mohon lengkapi data Tanggal, Mesin, Unit, Kategori, Masalah, dan Waktu Pengerjaan!");
    }

    let logEntry = {
        tanggal: tgl,
        shift: shift,
        mesin: mesin,
        unit: unit,
        masalah: masalah,
        penyebab: penyebab,
        kategori: kategori,
        tindakan: tindakan,
        mulai: mulai,
        selesai: selesai,
        durasi: totalWaktu,
        hm: hm,
        part: gantiPart,
        placement: placement,
        subPlace: subPlacement,
        status: statusPekerjaan,
        timestamp: new Date().toISOString()
    };

    logbookData.unshift(logEntry);
    syncToGoogleSheets("addLogbook", logEntry); 

    closeModal('addLogbookModal');
    renderLogbookTable();
    alert("Laporan Logbook berhasil disimpan dan dikirim!");
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
                    <span style="padding: 4px 10px; border-radius: 6px; font-size: 0.85em; font-weight: bold; background: ${statusBg}; color: white;">
                        ${log.status}
                    </span>
                </td>
            </tr>
        `;
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
    let shiftAwal = document.getElementById('shoShift').value;
    let shiftLanjut = document.getElementById('shoShiftNext').value;
    let tekAwal = document.getElementById('shoTeknisi').value.trim();
    let tekLanjut = document.getElementById('shoTeknisiNext').value.trim();
    let finding = document.getElementById('shoFinding').value.trim();
    let pending = document.getElementById('shoPending').value.trim();
    let tools = document.getElementById('shoTools').value;

    if(!tgl || !tekAwal || !tekLanjut) return alert("Tanggal dan Nama Teknisi (Shift Selesai & Penerima) wajib diisi!");

    let shoEntry = {
        tanggal: tgl,
        shift: shiftAwal,
        teknisi: tekAwal,            
        shift_lanjut: shiftLanjut,
        teknisi_lanjut: tekLanjut,  
        finding: finding,
        pending: pending,
        tools: tools,
        timestamp: new Date().toISOString()
    };

    shoData = []; 
    shoData.unshift(shoEntry); 

    logbookData = []; 

    syncToGoogleSheets("addSho", shoEntry); 

    closeModal('addShoModal');
    
    renderShoTable();
    renderLogbookTable(); 
    
    alert("Laporan Shift Handover (SHO) Berhasil Disimpan! Layar Logbook telah bersihkan untuk shift berikutnya.");
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
            </tr>
        `;
    });
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
}

function openModal(modalId) { 
    document.getElementById(modalId).classList.add('active'); 
    if (modalId === 'addWoModal') {
        let sel = document.getElementById('inputWoMachine');
        sel.innerHTML = '<option value="">-- Pilih Mesin --</option>';
        rawMachineList.forEach(id => {
            sel.innerHTML += `<option value="${id}">${machineData[id].name}</option>`;
        });
        sel.innerHTML += '<option value="Lainnya">Lainnya (Ketik Manual)</option>';
        
        document.getElementById('inputWoMachineManual').style.display = 'none';
        document.getElementById('inputWoMachineManual').value = '';
        document.getElementById('inputWoDept').value = '';
        document.getElementById('inputWoDeadline').value = '';
        document.getElementById('inputWoDesc').value = '';

    } else if (modalId === 'addLogbookModal') {
        document.getElementById('logTanggal').valueAsDate = new Date();
        
        let selMesin = document.getElementById('logMesin');
        selMesin.innerHTML = '';
        rawMachineList.forEach(id => {
            selMesin.innerHTML += `<option value="${id}">${id}</option>`;
        });

        let selUnit = document.getElementById('logUnit');
        selUnit.innerHTML = '<option value="">-- Pilih Unit --</option>';
        unitList.forEach(u => {
            selUnit.innerHTML += `<option value="${u}">${u}</option>`;
        });
        selUnit.innerHTML += '<option value="Lainnya">Lainnya (Ketik Manual)</option>';
        
        document.getElementById('logUnitManual').style.display = 'none';
        document.getElementById('logUnitManual').value = '';

        document.getElementById('logMasalah').value = '';
        document.getElementById('logPenyebab').value = '';
        document.getElementById('logKategori').value = '';
        document.getElementById('logTindakan').value = '';
        document.getElementById('logMulai').value = '';
        document.getElementById('logSelesai').value = '';
        document.getElementById('logTotalWaktu').value = '';
        document.getElementById('logHourMeter').value = '';
        document.getElementById('logGantiPart').value = '';
        document.getElementById('logPlacement').value = '';
        document.getElementById('logSubPlacement').value = '';
    } else if (modalId === 'addShoModal') {
        document.getElementById('shoTanggal').valueAsDate = new Date();
        document.getElementById('shoTeknisi').value = '';
        document.getElementById('shoTeknisiNext').value = ''; 
        document.getElementById('shoTools').value = 'LENGKAP';
        autoFillSho();
    }
}
        
function closeModal(modalId) { 
    document.getElementById(modalId).classList.remove('active'); 
    if(modalId === 'addMachineModal') {
        document.getElementById('inputMachineId').value = '';
        document.getElementById('inputMachineName').value = '';
        document.querySelectorAll('.process-check').forEach(cb => cb.checked = false);
    } else if(modalId === 'addWoModal') {
        document.getElementById('inputWoMachine').value = '';
        document.getElementById('inputWoDesc').value = '';
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
    autoCheckWO(); 
    closeModal('addMachineModal');
}

function deleteMachine(id) {
    if(!confirm("Yakin ingin menghapus mesin " + id + "?")) return;
    rawMachineList = rawMachineList.filter(m => m !== id); 
    delete machineData[id];
    delete breakdownFreq[id]; 
    
    if(currentMachine === id && rawMachineList.length > 0) currentMachine = rawMachineList[0];

    workOrders.manual = workOrders.manual.filter(wo => wo.machine !== id);
    workOrders.preventive = workOrders.preventive.filter(wo => wo.machine !== id);
    workOrders.predictive = workOrders.predictive.filter(wo => wo.machine !== id);

    refreshDashboardUI();
    renderDatabaseTable();
    renderWoUI();
    if(document.getElementById('page-production').classList.contains('active')) renderProductionTable();
}

function refreshDashboardUI() {
    if(document.getElementById('kpi-total')) document.getElementById('kpi-total').innerText = rawMachineList.length;

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
        
        if (document.getElementById('display-machine-name')) document.getElementById('display-machine-name').innerText = currentMachine;
        
        let runHours = machineData[currentMachine].runningHours;
        let dayColor = runHours >= 950 ? 'var(--danger)' : '#64748b';
        if (document.getElementById('machine-run-days')) document.getElementById('machine-run-days').innerHTML = `(Telah beroperasi: <span style="color:${dayColor}; font-weight:bold;">${runHours} Jam</span>)`;
        
        if (document.getElementById('dash-shift-info')) document.getElementById('dash-shift-info').innerText = getCurrentShiftLabel();
        
        let isBd = machineData[currentMachine].breakdown.isActive || machineData[currentMachine].currentProduct.includes("BREAKDOWN");
        let prod = isBd ? `BREAKDOWN (${machineData[currentMachine].currentProduct})` : machineData[currentMachine].currentProduct;
        let prodEl = document.getElementById('dash-product-info');
        if (prodEl) {
            prodEl.innerText = prod;
            if (prod.includes("IDLE") || isBd) {
                prodEl.style.color = 'var(--danger)';
            } else {
                prodEl.style.color = 'var(--success)';
            }
        }

    } else {
        currentMachine = "";
        if (document.getElementById('display-machine-name')) document.getElementById('display-machine-name').innerText = "-";
        if (document.getElementById('machine-run-days')) document.getElementById('machine-run-days').innerText = "";
        if (document.getElementById('dash-product-info')) document.getElementById('dash-product-info').innerText = "-";
    }
    chartDataArus.fill(0); chartDataSuhu.fill(0); chartDataVib.fill(0);
}

function switchMachine() {
    currentMachine = document.getElementById('machine-select').value;
    refreshDashboardUI(); 
    updateBreakdownUI(); 
    updateTampilanUI();
    fetchHistoryFromLocal(currentMachine);
}

let trendChart;
const maxDataPoints = 15; 
let timeLabels = Array(maxDataPoints).fill('');
let chartDataArus = Array(maxDataPoints).fill(0);
let chartDataSuhu = Array(maxDataPoints).fill(0);
let chartDataVib = Array(maxDataPoints).fill(0);

function initChart() {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;
    trendChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [
                { label: 'Suhu Avg (°C)', borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', data: chartDataSuhu, tension: 0.4, fill: true, borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
                { label: 'Arus Avg (A)', borderColor: '#3b82f6', backgroundColor: 'transparent', data: chartDataArus, tension: 0.4, borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
                { label: 'Vibrasi Avg (mm/s)', borderColor: '#8b5cf6', backgroundColor: 'transparent', data: chartDataVib, tension: 0.4, borderWidth: 2, pointRadius: 0, borderDash: [5, 5], yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
            plugins: { legend: { position: 'top' } },
            scales: {
                y: { type: 'linear', position: 'left', min: 0, max: 100, grid: { borderDash: [5, 5] } },
                y1: { type: 'linear', position: 'right', min: 0, max: 5, grid: { display: false } },
                x: { grid: { display: false } }
            }
        }
    });
    initBreakdownChart(); 
}

function getRandom(min, max) { return parseFloat((Math.random() * (max - min) + min).toFixed(2)); }
function getStatusClass(val, type) {
    if (type === 'temp') return val < 50 ? 'status-good' : (val < 65 ? 'status-warn' : 'status-danger');
    if (type === 'vib') return val < 1.5 ? 'status-good' : (val < 2.5 ? 'status-warn' : 'status-danger');
    return 'status-good';
}

function liveUpdateDashboard() {
    if(document.getElementById('dash-shift-info')) {
        document.getElementById('dash-shift-info').innerText = getCurrentShiftLabel();
    }

    if(document.getElementById('page-dashboard').classList.contains('active') === false && document.getElementById('page-tampilan').classList.contains('active') === false) return;

    let now = new Date();
    let timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');

    if(document.getElementById('page-dashboard').classList.contains('active') && currentMachine) {
        const tbody = document.getElementById('table-body');
        tbody.innerHTML = '';
        
        let totalArus = 0, totalSuhu = 0, totalVib = 0;
        const processes = machineData[currentMachine].processes;
        
        let isIdle = (machineData[currentMachine].currentProduct.includes("IDLE") || machineData[currentMachine].currentProduct.includes("BELUM ADA JADWAL") || machineData[currentMachine].breakdown.isActive);

        processes.forEach(process => {
            let freq = isIdle ? 0 : getRandom(48.5, 50.5);
            let current = isIdle ? 0 : getRandom(4.0, 15.0);
            let temp = isIdle ? getRandom(28.0, 32.0) : getRandom(38.0, 68.0); 
            let vib = isIdle ? 0 : getRandom(0.5, 2.8);
            
            let lifeHours = getProcessRemainingLife(currentMachine, process);
            let lifeBadgeClass = 'life-good';
            if (lifeHours <= 50) lifeBadgeClass = 'life-danger';
            else if (lifeHours <= 150) lifeBadgeClass = 'life-warn';

            totalArus += current; totalSuhu += temp; totalVib += vib;

            let row = `<tr>
                <td><strong>${process}</strong></td>
                <td class="status-good">${freq}</td>
                <td class="status-good">${current}</td>
                <td class="${getStatusClass(temp, 'temp')}">${temp}</td>
                <td class="${getStatusClass(vib, 'vib')}">${vib}</td>
                <td><span class="life-badge ${lifeBadgeClass}">${lifeHours} Jam</span></td>
            </tr>`;
            tbody.innerHTML += row;
        });

        let avgArus = totalArus / processes.length;
        let avgSuhu = totalSuhu / processes.length;
        let avgVib = totalVib / processes.length;
        
        timeLabels.shift(); timeLabels.push(timeStr);
        chartDataArus.shift(); chartDataArus.push(avgArus);
        chartDataSuhu.shift(); chartDataSuhu.push(avgSuhu);
        chartDataVib.shift(); chartDataVib.push(avgVib); 

        trendChart.update();
    }

    if(document.getElementById('page-tampilan').classList.contains('active') && currentMachine) {
        let tData = machineData[currentMachine];
        let tIsIdle = tData.currentProduct.includes("IDLE") || tData.currentProduct.includes("BELUM ADA JADWAL") || tData.breakdown.isActive;
        let idealSpeedVal = 0;
        
        if(!tIsIdle && typeof dataProduksi !== 'undefined') {
            let pDetail = dataProduksi.find(item => item["NAMA MESIN"] === currentMachine && item["NAMA PRODUK"].trim() === tData.currentProduct.trim());
            if(pDetail && pDetail["IDEAL SPEED"]) idealSpeedVal = parseFloat(pDetail["IDEAL SPEED"]);
        }
        
        let curSpeed = 0;
        
        if (realtimeDBData[currentMachine] && realtimeDBData[currentMachine].speed !== undefined) {
            curSpeed = parseFloat(realtimeDBData[currentMachine].speed);
        } else {
            curSpeed = tIsIdle ? 0 : getRandom(idealSpeedVal * 0.95, idealSpeedVal * 1.05);
            if(!tIsIdle && idealSpeedVal === 0) curSpeed = getRandom(80, 100); 
        }

        document.getElementById('tampilan-kecepatan').innerText = curSpeed.toFixed(1) + " m/min";
        
        if (tampilanTimeLabels.length > 1000) {
            tampilanTimeLabels.shift();
            tampilanSpeedData.shift();
        }

        tampilanTimeLabels.push(timeStr);
        tampilanSpeedData.push(curSpeed);
        
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

function initSchedulePage() {
    if(typeof dataProduksi === 'undefined') {
        console.warn("File dataProduksi.js belum ditemukan atau belum dimuat!");
        return;
    }

    let machines = [...new Set(dataProduksi.map(item => item["NAMA MESIN"]))];
    
    let selMac = document.getElementById('schedMachine');
    if (!selMac) return;
    selMac.innerHTML = '';
    machines.forEach(m => {
        selMac.innerHTML += `<option value="${m}">${m}</option>`;
    });

    document.getElementById('schedTglInput').value = getFactoryDateIso();
    document.getElementById('schedShiftInput').value = getCurrentShiftInfo();

    updateScheduleProducts();
}

function updateScheduleProducts() {
    let mac = document.getElementById('schedMachine').value;
    let prods = dataProduksi.filter(item => item["NAMA MESIN"] === mac);
    
    let selProd = document.getElementById('schedProduct');
    selProd.innerHTML = '';
    prods.forEach(p => {
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
}

function updateScheduleDetails() {
    let mac = document.getElementById('schedMachine').value;
    let prodName = document.getElementById('schedProduct').value;
    let manualInput = document.getElementById('schedProductManual');
    
    let kodeMatEl = document.getElementById('schedKodeMat');
    let lebarEl = document.getElementById('schedLebar');
    
    if (prodName === 'Lainnya') {
        if(manualInput) {
            manualInput.style.display = 'block';
            manualInput.value = ''; 
        }
        
        kodeMatEl.disabled = false;
        kodeMatEl.value = "";
        kodeMatEl.style.backgroundColor = "#ffffff";
        kodeMatEl.placeholder = "Ketik Kode Material...";
        
        lebarEl.disabled = false;
        lebarEl.value = "";
        lebarEl.style.backgroundColor = "#ffffff";
        lebarEl.placeholder = "Ketik Lebar Jumbo...";
        
        document.getElementById('schedT100').innerText = "0";
        document.getElementById('schedT70').innerText = "0";
        document.getElementById('schedSpeed').innerText = "0";
    } else {
        if(manualInput) manualInput.style.display = 'none';
        
        kodeMatEl.disabled = true;
        kodeMatEl.style.backgroundColor = "#f8fafc";
        kodeMatEl.placeholder = "";
        
        lebarEl.disabled = true;
        lebarEl.style.backgroundColor = "#f8fafc";
        lebarEl.placeholder = "";

        let detail = dataProduksi.find(item => item["NAMA MESIN"] === mac && item["NAMA PRODUK"] === prodName);
        if(detail) {
            kodeMatEl.value = detail["KODE MATERIAL FG NEW"] || "-";
            lebarEl.value = detail["LEBAR JUMBO (CM)"] || "-";
            
            document.getElementById('schedT100').innerText = detail["TARGET 100% (CRT)"] || "0";
            document.getElementById('schedT70').innerText = detail["TARGET 70% (CRT)"] || "0";
            
            let speed = parseFloat(detail["IDEAL SPEED"]);
            document.getElementById('schedSpeed').innerText = isNaN(speed) ? "-" : speed.toFixed(3);
        }
    }
}

function calculateAndAddSchedule() {
    let tglVal = document.getElementById('schedTglInput').value;
    if(!tglVal) return alert("Tanggal wajib diisi!");
    
    let dateObj = new Date(tglVal);
    let bulanArr = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
    let bulanStr = bulanArr[dateObj.getMonth()];
    let tglStr = dateObj.getDate().toString().padStart(2, '0');

    let shiftFull = document.getElementById('schedShiftInput').value;
    let shiftVal = shiftFull.includes("1") ? "Shift 1" : (shiftFull.includes("2") ? "Shift 2" : "Shift 3");
    
    let target100 = parseFloat(document.getElementById('schedT100').innerText) || 0;
    let target70 = parseFloat(document.getElementById('schedT70').innerText) || 0;
    let idealSpeed = parseFloat(document.getElementById('schedSpeed').innerText) || 0;
    
    let mesin = document.getElementById('schedMachine').value;
    let produk = document.getElementById('schedProduct').value;
    
    if (produk === 'Lainnya') {
        let manualInput = document.getElementById('schedProductManual');
        produk = manualInput ? manualInput.value.trim() : "";
        if (!produk) return alert("Silakan ketik nama produk baru secara manual!");
    }
    
    let kodeMat = document.getElementById('schedKodeMat').value || "-";
    let lebar = document.getElementById('schedLebar').value || "-";

    let exists = scheduleDataList.find(s => s.tglFull === tglVal && s.shift === shiftVal && s.mesin === mesin && s.produk === produk);
    if(exists) return alert(`Penjadwalan untuk Mesin ${mesin} dengan produk ${produk} pada Tanggal ${tglVal} ${shiftVal} sudah ada!`);

    let existingCount = scheduleDataList.filter(s => s.tglFull === tglVal && s.shift === shiftVal && s.mesin === mesin).length;
    let isFirst = (existingCount === 0);

    let initialActual = 0;

    let workingTime = 480; 

    let newEntry = {
        idJadwal: Date.now(),
        tglFull: tglVal,
        bulan: bulanStr,
        tgl: tglStr,
        shift: shiftVal,
        wt: workingTime,
        mesin: mesin,
        produk: produk,
        lebar: lebar,
        t100: target100,
        t70: target70,
        speed: idealSpeed.toFixed(3),
        isFirst: isFirst, 
        
        actual: initialActual,
        dtProd: 0,
        dtMtc: 0,
        dtPpic: 0,
        
        eff: '0.00%',
        dtTotal: 0,
        pDtMtc: '0.00%',
        pDtAll: '0.00%',
        opTime: workingTime,
        availTime: workingTime,
        availMachine: '100.00%',
        perf: '0.00%',
        oee: '0.00%',
        
        kwh: 0,
        costListrik: 0,
        
        accProduk: '',
        quality: '0.00%'
    };

    scheduleDataList.push(newEntry);
    
    fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEntry)
    })
    .then(res => res.json())
    .then(dataFB => {
        newEntry.firebaseKey = dataFB.name; 
    })
    .catch(err => console.error(err));

    let mData = machineData[mesin];
    if(mData && (mData.currentProduct.includes("IDLE") || mData.currentProduct.includes("BELUM ADA JADWAL"))) {
        mData.currentProduct = produk.trim();
    }

    if(document.getElementById('page-schedule').classList.contains('active')) renderScheduleTable();
    updateScheduleMaintenanceStats();
    
    alert(`Jadwal Produksi ${mesin} berhasil ditambahkan! Data OEE akan terhitung Realtime sesuai Shift.`);
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

    if (field === 'produk' && isCurrentlyRunning) {
        mData.currentProduct = value.trim();
        
        fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//active_runs/${mac}.json`, {
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
        let payload = {};
        payload[field] = sched[field];
        fetch(`https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules/${sched.firebaseKey}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(e => console.error("Gagal update data jadwal:", e));
    }

    if(field === 'actual') {
         if(machineData[mac]) {
             machineData[mac].lastFB = (realtimeDBData[mac] && realtimeDBData[mac].actual !== undefined) ? realtimeDBData[mac].actual : 0;
         }
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

    buildInitialMachineData();
    refreshDashboardUI();
    initChart();
    initTampilanCharts(); 
    initAnalisaCharts(); 
    autoCheckWO(); 
    renderLogbookTable(); 
    renderShoTable();

    fetchSchedulesFromFirebase();

    setInterval(updateRealtimeClock, 1000);
    setInterval(pollRealtimeData, 1000); 
    setInterval(liveUpdateDashboard, 2000); 
};

setInterval(() => {
    if (isResettingSchedule) return;
    
    let localTglIso = getFactoryDateIso();
    let localCurShift = getCurrentShiftInfo();

    let schedPayload = {};
    scheduleDataList.forEach(sched => {
        if (sched.firebaseKey) {
            schedPayload[sched.firebaseKey + "/kwh"] = sched.kwh;
            schedPayload[sched.firebaseKey + "/costListrik"] = sched.costListrik;
            
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
        fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//schedules.json', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(schedPayload)
        }).catch(e => {});
    }

    let dayaPayload = {};
    rawMachineList.forEach(macId => {
        let mData = machineData[macId];
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
        fetch('https://cmms-2c23c-default-rtdb.asia-southeast1.firebasedatabase.app//DAYA_AKUMULASI.json', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dayaPayload)
        }).catch(e => {});
    }

}, 5000);