const fs = require('fs');

console.log("Membaca 4 file data...");

// Fungsi membaca file JS yang mengandung "export default"
function extractData(filename) {
    try {
        let content = fs.readFileSync(filename, 'utf-8');
        content = content.replace(/export default \w+;/g, '');
        content += '\nreturn dataProduksi;';
        return new Function(content)();
    } catch (err) {
        console.error(`❌ Gagal membaca ${filename}`);
        process.exit(1);
    }
}

// Fungsi Fallback Mesin sesuai instruksi (Membaca kolom PRODUK)
function getFallbackMesin(kategoriProduk) {
    if (!kategoriProduk) return "TIDAK ADA MESIN";
    const p = kategoriProduk.toUpperCase();
    
    if (p.includes("TOWEL")) return "TW404"; // Grup Towel -> TW
    if (p.includes("FACIAL") || p.includes("SOFTPACK") || p.includes("COMPACT") || p.includes("HANDKERCHIEF") || p.includes("TRAVEL") || p.includes("JUMBO PACK") || p.includes("MG")) return "FC121"; // Grup Facial -> FC
    if (p.includes("NAPKIN")) return "NP313"; // Grup Napkin -> NP
    if (p.includes("HRT")) return "HRT001"; // Grup Roll -> HRT
    if (p.includes("JRT")) return "JT005"; // Grup Roll -> JRT
    if (p.includes("TOILET") || p.includes("CORELESS") || p.includes("ROLL")) return "TL204"; // Grup Roll -> TL
    
    return "TIDAK ADA MESIN";
}

try {
    const dataJumboList = extractData('./data_jumbo.js'); 
    const dataMesin = extractData('./data_mesin.js'); 
    const dataProduksiMaster = extractData('./data_produksi.js'); 
    const dataTargetMesin = extractData('./dataProduksi.js'); 

    const mergedResult = [];

    console.log("Memproses penggabungan data (Linear Mapping & Inject Spek Speed)...");

    dataProduksiMaster.forEach(item => {
        delete item["NO"]; // Hapus NO
        
        const kodeSAP = item["KODE MATERIAL SAP"] || "";
        const namaProduk = item["NAMA PRODUK"] || "";
        const kategoriProduk = item["PRODUK"] || "";
        
        // 1. CARI MESIN (Berdasarkan KODE SAP / NAMA PRODUK)
        const relasiMesin = dataTargetMesin.find(m => 
            (m["KODE MATERIAL FG NEW"] && m["KODE MATERIAL FG NEW"] === kodeSAP) || 
            (m["NAMA PRODUK"] && m["NAMA PRODUK"].trim().toLowerCase() === namaProduk.trim().toLowerCase())
        ) || {};

        let namaMesin = relasiMesin["NAMA MESIN"];
        
        // 2. JIKA MESIN TIDAK KETEMU, ISI OTOMATIS BERDASARKAN KATEGORI (Towel=TW, Facial=FC, dsb)
        if (!namaMesin) {
            namaMesin = getFallbackMesin(kategoriProduk);
        }
        
        // 3. TARIK DATA SPEED DARI data_mesin.js
        let spekMesin = dataMesin.find(m => m["Mesin"] === namaMesin);
        // Jika karena suatu hal nama mesinnya tidak ada di database data_mesin.js, pakai fallback ulang
        if (!spekMesin) {
            let mesinAlternatif = getFallbackMesin(kategoriProduk);
            spekMesin = dataMesin.find(m => m["Mesin"] === mesinAlternatif) || {};
        }
        
        const { Mesin, ...sisaSpekMesin } = spekMesin; // Ekstrak semua parameter speed dan satuan

        // 4. LOGIKA LEBAR JUMBO
        const jumbo = dataJumboList.find(j => j["NAMA PRODUK"] && j["NAMA PRODUK"].trim().toLowerCase() === namaProduk.trim().toLowerCase());
        let lebar = "0";
        if (jumbo && jumbo["LEBAR JUMBO (CM)"] && jumbo["LEBAR JUMBO (CM)"] !== "0") {
            lebar = jumbo["LEBAR JUMBO (CM)"];
        } else if (relasiMesin["LEBAR JUMBO (CM)"] && relasiMesin["LEBAR JUMBO (CM)"] !== "0") {
            lebar = relasiMesin["LEBAR JUMBO (CM)"];
        }

        // GABUNGKAN SEMUA JADI 1 BARIS LINEAR
        mergedResult.push({
            "NAMA MESIN": namaMesin,
            "BRAND/JENIS TISU": kategoriProduk || relasiMesin["PRODUK"] || "-",
            "NAMA PRODUK": namaProduk,
            "LEBAR JUMBO (CM)": lebar,
            "IDEAL SPEED": relasiMesin["IDEAL SPEED"] || "0",
            "TARGET 100% (CRT)": relasiMesin["TARGET 100% (CRT)"] || "0",
            "TARGET 70% (CRT)": relasiMesin["TARGET 70% (CRT)"] || "0",
            ...item, 
            ...sisaSpekMesin // Inject Speed Interfold, Satuan, Speed Logsaw, dll masuk kesini!
        });
    });

    const fileContent = "const dataProduksi = " + JSON.stringify(mergedResult, null, 4) + ";\n\nexport default dataProduksi;";
    fs.writeFileSync('./data_final.js', fileContent);

    console.log("=================================================");
    console.log("✅ SUKSES! File berhasil digabungkan.");
    console.log(`📊 Total Data Tersimpan: ${mergedResult.length} baris.`);
    console.log("📁 NAMA MESIN & SPEED telah dikunci. Silakan cek file: data_final.js");
    console.log("=================================================");

} catch (error) {
    console.error("❌ Terjadi kesalahan fatal:", error);
}