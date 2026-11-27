const DB_NAME = "HNA_VZLA_DB";
const DB_VER = 1;
const SETTINGS_KEY = "hna_vzla_settings_v1";

const METODO_LABELS = {
    EFECTIVO_USD: "Efectivo USD",
    ZELLE: "Zelle",
    PAGO_MOVIL: "Pago Móvil",
    TRANSF_BS: "Transf. Bs.",
    TRANSF_USD: "Transf. USD",
    TARJETA: "Tarjeta",
    OTRO: "Otro"
};

const CAT_LABELS = {
    FONDO_INICIAL: "Aporte Casa Matriz",
    COBROS_CLIENTES: "Cobros Clientes",
    CONST_LEGAL: "Registro Mercantil",
    SENIAT_RIF: "SENIAT / RIF",
    ALCALDIA_PATENTE: "Alcaldía / Patente",
    ENTES_LABORALES: "IVSS / INCES / FAOV",
    GESTORIA_NOTARIA: "Gestoría / Notaría",
    ALQ_OFICINA: "Alquiler de Local",
    LOCAL_ADEC: "Adecuación Local",
    EQUIP_MOB: "Equipos y Mobiliario",
    HONORARIOS_PROF: "Honorarios Prof.",
    NOMINA_HON: "Nómina / Personal",
    SERV_CONECT: "Internet / Servicios",
    VIAT_CAMPO: "Transporte / Viáticos",
    INSUMOS_OFIC: "Insumos Oficina",
    IMP_RETENC: "Impuestos / IGTF",
    BANC_COMIS: "Comisiones Bancarias",
    SERV_EXT_ADM: "Serv. Adm. Ext.",
    PROY_OP: "Otros Operativos"
};

const FRENTE_LABELS = {
    LEGAL_REGISTRO: "Registro Mercantil / Legal",
    SENIAT_TRIBUTARIO: "SENIAT / RIF / Tributario",
    ALCALDIA_PERMISOS: "Alcaldía / Patente / Bomberos",
    ENTES_LABORALES: "IVSS / INCES / FAOV / RNET",
    BANCA_FISCAL: "Banca y Cuentas",
    LOCAL_OFICINA: "Local / Oficina",
    CONTABILIDAD_IMPUESTOS: "Contabilidad y Facturación",
    NOMINA_RRHH: "Nómina y RRHH",
    PROVEEDORES_COTIZ: "Proveedores y Presupuestos",
    SISTEMAS_CONTROL: "Internet, Equipos y Operación",
    COMERCIAL_OPERATIVO: "Comercial / Clientes",
    COBRANZA_CARTERA: "Cobranza y Cartera"
};

const CHECKLIST_VENEZUELA = [
    { frente: "LEGAL_REGISTRO", estado: "EN_CURSO", paso: "Constitución / Registro Mercantil y publicación de acta", nota: "Verificar reserva de nombre, acta constitutiva y aranceles del Registro Mercantil." },
    { frente: "SENIAT_TRIBUTARIO", estado: "PENDIENTE_TERCERO", paso: "Inscripción de RIF jurídico ante el SENIAT", nota: "Requiere documento constitutivo registrado y recibo de servicio del domicilio fiscal." },
    { frente: "LOCAL_OFICINA", estado: "EN_CURSO", paso: "Búsqueda, comparación y contrato de arrendamiento de oficina", nota: "Documentar opciones de locales con canon mensual, depósito y servicios incluidos." },
    { frente: "ALCALDIA_PERMISOS", estado: "PENDIENTE_TERCERO", paso: "Licencia de Actividades Económicas (Alcaldía) y Bomberos", nota: "Conformidad de uso, solvencia municipal y permiso de bomberos del local." },
    { frente: "BANCA_FISCAL", estado: "PENDIENTE_TERCERO", paso: "Apertura de cuenta bancaria jurídica (Bs. / USD)", nota: "Consignar RIF, acta constitutiva, referencias y balance de apertura." },
    { frente: "ENTES_LABORALES", estado: "PENDIENTE_TERCERO", paso: "Inscripción laboral obligatoria (IVSS, FAOV, INCES, RNET)", nota: "Registro patronal en entes parafiscales y Ministerio del Trabajo." },
    { frente: "CONTABILIDAD_IMPUESTOS", estado: "PENDIENTE_TERCERO", paso: "Libros contables, facturación y calendario fiscal (IVA/ISLR)", nota: "Definir imprenta autorizada SENIAT y esquema de retenciones." },
    { frente: "SISTEMAS_CONTROL", estado: "EN_CURSO", paso: "Instalación de internet, telefonía y puesta en marcha operativa", nota: "Contratar fibra óptica y respaldo eléctrico si aplica." }
];

function frenteLabel(code) {
    return FRENTE_LABELS[code] || code;
}

function catLabel(code) {
    return CAT_LABELS[code] || code;
}

function metodoLabel(code) {
    return METODO_LABELS[code] || code || "—";
}

let db;
let movimientos = [];
let hitos = [];

let editingMovId = null;
let editingHitoId = null;
let pendingPhotoDataUrl = null;
let pendingPhotoSizeKb = 0;
let pendingPhotoName = null;
let pendingPhotoType = null;
let quickAttachMovId = null;
let pendingHitoDocs = [];
let quickAttachHitoId = null;

const CHECKLIST_PASOS_SET = new Set(CHECKLIST_VENEZUELA.map((c) => c.paso.toLowerCase()));

function isChecklistHito(h) {
    return Boolean(h && (h.isChecklistBase || CHECKLIST_PASOS_SET.has(String(h.paso || "").trim().toLowerCase())));
}

function sortByFechaDesc(list) {
    return [...list].sort((a, b) => {
        const fa = a.fecha || "";
        const fb = b.fecha || "";
        if (fb !== fa) return fb.localeCompare(fa);
        return String(b.id || "").localeCompare(String(a.id || ""));
    });
}

// --- Helpers ---
function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getLocalDateStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function formatMoney(n) {
    const num = Number(n) || 0;
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? JSON.parse(raw) : { umbral: 500, tasa: 45.0 };
    } catch {
        return { umbral: 500, tasa: 45.0 };
    }
}

function saveSettings(partial) {
    const current = loadSettings();
    const next = { ...current, ...partial };
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch { /* ignore quota */ }
}

// --- IndexedDB ---
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains("movimientos")) {
                d.createObjectStore("movimientos", { keyPath: "id" });
            }
            if (!d.objectStoreNames.contains("hitos")) {
                d.createObjectStore("hitos", { keyPath: "id" });
            }
        };
        req.onsuccess = () => {
            db = req.result;
            resolve(db);
        };
        req.onerror = () => reject(req.error);
    });
}

function getAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

function putItem(storeName, item) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function deleteItem(storeName, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function clearAndPutAll(storeName, items) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.clear();
        items.forEach((item) => store.put(item));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- Image Compression ---
function compressImageFile(file, maxDim = 1280, quality = 0.78) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith("image/")) {
            reject(new Error("Selecciona un archivo de imagen válido."));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("Formato de imagen no soportado."));
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    if (width >= height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL("image/jpeg", quality);
                const sizeKb = Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024));
                resolve({ dataUrl, sizeKb });
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function isImageData(type, dataUrl) {
    if (type && type.startsWith("image/")) return true;
    if (!type && typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) return true;
    return false;
}

function getDocBadge(type, name, dataUrl) {
    if (isImageData(type, dataUrl)) return { tag: "IMG", cls: "" };
    const ext = (String(name || "").split(".").pop() || "").toLowerCase();
    const t = String(type || "").toLowerCase();
    if (t === "application/pdf" || ext === "pdf") return { tag: "PDF", cls: "pdf" };
    if (t.includes("word") || ext === "doc" || ext === "docx") return { tag: "DOC", cls: "doc" };
    if (t.includes("excel") || t.includes("spreadsheet") || ext === "xls" || ext === "xlsx") return { tag: "XLS", cls: "xls" };
    if (t === "text/csv" || ext === "csv") return { tag: "CSV", cls: "xls" };
    if (t === "text/plain" || ext === "txt") return { tag: "TXT", cls: "file" };
    return { tag: ext && ext.length <= 4 ? ext.toUpperCase() : "ARCH", cls: "file" };
}

function openStoredFile(doc, title, meta) {
    if (!doc || !doc.dataUrl) return;
    if (isImageData(doc.type, doc.dataUrl)) {
        document.getElementById("lightboxTitle").textContent = title || doc.name || "Comprobante";
        document.getElementById("lightboxMeta").textContent = meta || `~${doc.sizeKb || 0} KB`;
        document.getElementById("lightboxImg").src = doc.dataUrl;
        const dlBtn = document.getElementById("btnDownloadPhoto");
        dlBtn.href = doc.dataUrl;
        dlBtn.download = doc.name || "soporte.jpg";
        document.getElementById("photoModal").classList.remove("hidden");
        return;
    }

    const isPdf = doc.type === "application/pdf" || String(doc.name || "").toLowerCase().endsWith(".pdf");
    fetch(doc.dataUrl)
        .then((r) => r.blob())
        .then((blob) => {
            const url = URL.createObjectURL(blob);
            if (isPdf) {
                const win = window.open(url, "_blank");
                if (!win) {
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = doc.name || "documento.pdf";
                    a.click();
                }
            } else {
                const a = document.createElement("a");
                a.href = url;
                a.download = doc.name || "documento";
                a.click();
            }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        })
        .catch(() => {
            const a = document.createElement("a");
            a.href = doc.dataUrl;
            a.download = doc.name || "documento";
            a.click();
        });
}

function setFormPhoto(dataUrl, sizeKb = 0, name = null, type = null) {
    pendingPhotoDataUrl = dataUrl || null;
    pendingPhotoSizeKb = sizeKb || (dataUrl ? Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024)) : 0);
    pendingPhotoName = dataUrl ? (name || null) : null;
    pendingPhotoType = dataUrl ? (type || (dataUrl.startsWith("data:image/") ? "image/jpeg" : null)) : null;

    const previewBox = document.getElementById("photoPreviewBox");
    const previewImg = document.getElementById("photoPreviewImg");
    const previewDocBadge = document.getElementById("photoPreviewDocBadge");
    const previewMeta = document.getElementById("photoPreviewMeta");
    const previewHint = document.getElementById("photoPreviewHint");

    if (pendingPhotoDataUrl) {
        const isImg = isImageData(pendingPhotoType, pendingPhotoDataUrl);
        if (isImg) {
            previewImg.src = pendingPhotoDataUrl;
            previewImg.classList.remove("hidden");
            if (previewDocBadge) previewDocBadge.classList.add("hidden");
            previewMeta.textContent = `${pendingPhotoName ? pendingPhotoName + " · " : ""}~${pendingPhotoSizeKb} KB (comprimido)`;
            if (previewHint) previewHint.textContent = "Clic en la miniatura para ampliar";
        } else {
            const badge = getDocBadge(pendingPhotoType, pendingPhotoName, pendingPhotoDataUrl);
            previewImg.removeAttribute("src");
            previewImg.classList.add("hidden");
            if (previewDocBadge) {
                previewDocBadge.textContent = badge.tag;
                previewDocBadge.className = `doc-preview-badge ${badge.cls}`;
            }
            previewMeta.textContent = `${pendingPhotoName || "Documento adjunto"} · ~${pendingPhotoSizeKb} KB`;
            if (previewHint) previewHint.textContent = "Clic en el ícono para abrir o descargar";
        }
        previewBox.classList.remove("hidden");
    } else {
        previewImg.removeAttribute("src");
        previewImg.classList.remove("hidden");
        if (previewDocBadge) previewDocBadge.classList.add("hidden");
        previewMeta.textContent = "";
        previewBox.classList.add("hidden");
        const input = document.getElementById("fotoInput");
        if (input) input.value = "";
    }
}

async function processAttachmentFile(file) {
    if (!file) throw new Error("Archivo inválido.");
    const isImg = file.type && file.type.startsWith("image/");

    if (isImg) {
        const { dataUrl, sizeKb } = await compressImageFile(file);
        return {
            id: "DOC-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
            name: file.name || "imagen.jpg",
            type: "image/jpeg",
            sizeKb,
            dataUrl
        };
    }

    // Documents (PDF, Word, Excel, CSV, TXT, etc.): limit 5 MB per file to keep IndexedDB fast
    if (file.size > 5 * 1024 * 1024) {
        throw new Error(`El archivo "${file.name}" supera el límite de 5 MB.`);
    }

    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const inferredType = file.type || (ext === "pdf" ? "application/pdf" : "application/octet-stream");

    return {
        id: "DOC-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        name: file.name || "documento",
        type: inferredType,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
        dataUrl
    };
}

async function processHitoAttachment(file) {
    return processAttachmentFile(file);
}

function renderPendingHitoDocs() {
    const box = document.getElementById("hitoFilesPreview");
    if (!pendingHitoDocs.length) {
        box.innerHTML = "";
        box.classList.add("hidden");
        return;
    }
    box.classList.remove("hidden");
    box.innerHTML = pendingHitoDocs.map((doc) => {
        const badge = getDocBadge(doc.type, doc.name, doc.dataUrl);
        return `
            <span class="doc-chip">
                <span class="doc-chip-tag ${badge.cls}">${badge.tag}</span>
                <span class="doc-chip-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
                <span class="mono text-subtle" style="font-size:0.68rem;">${doc.sizeKb}KB</span>
                <button type="button" data-remove-pending-doc="${escapeHtml(doc.id)}" class="doc-chip-remove btn-remove-pending-doc" aria-label="Quitar documento">✕</button>
            </span>
        `;
    }).join("");
}

function openHitoDocument(hitoId, docId) {
    const h = hitos.find((x) => x.id === hitoId);
    const doc = h?.adjuntos?.find((d) => d.id === docId);
    if (!doc) return;
    openStoredFile(doc, `${frenteLabel(h.frente)} · ${doc.name}`, `${h.fecha} · ~${doc.sizeKb || 0} KB`);
}

// --- Business Logic ---
function calcUSD(moneda, monto, tasa) {
    const m = Number(monto) || 0;
    if (moneda === "USD") return Number(m.toFixed(2));
    const t = Number(tasa) || 1;
    return Number((m / t).toFixed(2));
}

function nextId() {
    const year = new Date().getFullYear();
    const prefix = `HNA-VZ-${year}-`;
    let maxSeq = 0;
    movimientos.forEach((m) => {
        if (typeof m.id === "string" && m.id.startsWith(prefix)) {
            const num = parseInt(m.id.slice(prefix.length), 10);
            if (!Number.isNaN(num) && num > maxSeq) maxSeq = num;
        }
    });
    return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

function isIngreso(tipo) {
    return tipo === "APORTE_FONDO" || tipo === "COBRO_CLIENTE";
}

function isEgresoCaja(tipo) {
    // LIQ_ANTICIPO liquida un anticipo ya desembolsado; no vuelve a restar caja
    return !isIngreso(tipo) && tipo !== "LIQ_ANTICIPO";
}

function computeTotals() {
    let fondos = 0;
    let ejecutado = 0;
    let capex = 0;
    let opex = 0;
    let liquidaciones = 0;
    let pendiente = 0;
    let pendientesCount = 0;

    movimientos.forEach((m) => {
        const usd = Number(m.montoUsd) || 0;
        if (isIngreso(m.tipo)) {
            fondos += usd;
        } else if (m.tipo === "LIQ_ANTICIPO") {
            liquidaciones += usd;
            if (m.estadoSoporte !== "CON_SOPORTE") {
                pendiente += usd;
                pendientesCount += 1;
            }
        } else {
            ejecutado += usd;
            if (m.tipo === "GASTO_CAPEX") capex += usd;
            else opex += usd;
            if (m.estadoSoporte !== "CON_SOPORTE") {
                pendiente += usd;
                pendientesCount += 1;
            }
        }
    });

    return {
        fondos,
        ejecutado,
        capex,
        opex,
        liquidaciones,
        saldo: fondos - ejecutado,
        pendiente,
        pendientesCount
    };
}

function updateLiveUsdPreview() {
    const moneda = document.getElementById("moneda").value;
    const monto = Number(document.getElementById("monto").value) || 0;
    const tasa = Number(document.getElementById("tasa").value) || 1;
    const hint = document.getElementById("usdPreviewHint");
    if (moneda === "VES" && monto > 0 && tasa > 0) {
        hint.textContent = `Equivalente: $${formatMoney(calcUSD("VES", monto, tasa))} USD`;
        hint.classList.remove("hidden");
    } else {
        hint.classList.add("hidden");
    }
}

function toggleTasa() {
    const moneda = document.getElementById("moneda").value;
    document.getElementById("tasaBox").classList.toggle("hidden", moneda !== "VES");
    updateLiveUsdPreview();
}

// --- Tabs ---
function switchTab(tabName) {
    ["hoy", "movimientos", "hitos"].forEach((t) => {
        const panel = document.getElementById(`panel-${t}`);
        if (panel) panel.classList.toggle("hidden", t !== tabName);

        const deskBtn = document.getElementById(`tab-desk-${t}`);
        if (deskBtn) deskBtn.classList.toggle("active", t === tabName);

        const mobBtn = document.getElementById(`tab-mob-${t}`);
        if (mobBtn) mobBtn.classList.toggle("active", t === tabName);
    });
}

// --- Editing Flows ---
function startEditMov(id) {
    const mov = movimientos.find((m) => m.id === id);
    if (!mov) return;
    editingMovId = mov.id;

    document.getElementById("fecha").value = mov.fecha || getLocalDateStr();
    document.getElementById("tipo").value = mov.tipo || "GASTO_OPEX";
    document.getElementById("codigoCc").value = mov.codigoCc || "INST-VZLA";
    document.getElementById("categoria").value = mov.categoria || "PROY_OP";
    document.getElementById("moneda").value = mov.moneda || "USD";
    document.getElementById("monto").value = mov.monto ?? "";
    if (mov.moneda === "VES" && mov.tasa) {
        document.getElementById("tasa").value = mov.tasa;
    }
    document.getElementById("contraparte").value = mov.contraparte || "";
    document.getElementById("estadoSoporte").value = mov.estadoSoporte || "CON_SOPORTE";
    document.getElementById("metodoPago").value = mov.metodoPago || "EFECTIVO_USD";
    document.getElementById("referencia").value = mov.referencia || "";
    document.getElementById("nota").value = mov.nota || "";
    setFormPhoto(mov.fotoSoporte || null, mov.soporteSizeKb || 0, mov.soporteNombre || null, mov.soporteTipo || null);

    toggleTasa();
    document.getElementById("movEditLabel").textContent = `Editando movimiento ${mov.id}`;
    document.getElementById("movEditBanner").classList.remove("hidden");
    document.getElementById("btnSubmitMov").textContent = "Guardar Cambios";

    switchTab("movimientos");
    document.getElementById("movForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditMov() {
    editingMovId = null;
    const form = document.getElementById("movForm");
    form.reset();
    document.getElementById("fecha").value = getLocalDateStr();
    document.getElementById("codigoCc").value = "INST-VZLA";
    document.getElementById("tasa").value = loadSettings().tasa;
    setFormPhoto(null);
    toggleTasa();
    document.getElementById("movEditBanner").classList.add("hidden");
    document.getElementById("btnSubmitMov").textContent = "Guardar Movimiento";
}

function startEditHito(id) {
    const h = hitos.find((x) => x.id === id);
    if (!h) return;
    editingHitoId = h.id;

    document.getElementById("hitoFecha").value = h.fecha || getLocalDateStr();
    document.getElementById("hitoFrente").value = h.frente;
    document.getElementById("hitoEstado").value = h.estado;
    document.getElementById("hitoPaso").value = h.paso || "";
    document.getElementById("hitoNota").value = h.nota || "";
    pendingHitoDocs = Array.isArray(h.adjuntos) ? [...h.adjuntos] : [];
    renderPendingHitoDocs();

    document.getElementById("hitoEditLabel").textContent = `Editando hito (${h.frente})`;
    document.getElementById("hitoEditBanner").classList.remove("hidden");
    document.getElementById("btnSubmitHito").textContent = "Guardar Hito";

    switchTab("hitos");
    document.getElementById("hitoForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditHito() {
    editingHitoId = null;
    document.getElementById("hitoForm").reset();
    document.getElementById("hitoFecha").value = getLocalDateStr();
    pendingHitoDocs = [];
    renderPendingHitoDocs();
    document.getElementById("hitoEditBanner").classList.add("hidden");
    document.getElementById("btnSubmitHito").textContent = "Registrar Hito";
}

// --- CRUD Actions ---
async function regularizar(id) {
    const mov = movimientos.find((m) => m.id === id);
    if (!mov) return;
    mov.estadoSoporte = "CON_SOPORTE";
    await putItem("movimientos", mov);
    renderAll();
    showToast(`${mov.id} marcado con soporte`);
}

function triggerQuickAttach(id) {
    quickAttachMovId = id;
    const input = document.getElementById("quickPhotoInput");
    input.value = "";
    input.click();
}

async function deleteMov(id) {
    const mov = movimientos.find((m) => m.id === id);
    const label = mov ? `${mov.id} (${mov.categoria} · $${formatMoney(mov.montoUsd)})` : id;
    if (!confirm(`¿Borrar el movimiento ${label}? Esta acción no se puede deshacer.`)) return;
    await deleteItem("movimientos", id);
    movimientos = movimientos.filter((m) => m.id !== id);
    if (editingMovId === id) cancelEditMov();
    renderAll();
    showToast("Movimiento eliminado");
}

async function deleteHito(id) {
    if (!confirm("¿Borrar este hito de sucursal? Esta acción no se puede deshacer.")) return;
    await deleteItem("hitos", id);
    hitos = hitos.filter((h) => h.id !== id);
    if (editingHitoId === id) cancelEditHito();
    renderHitos();
    showToast("Hito eliminado");
}

async function updateHitoEstado(id, nuevoEstado) {
    const h = hitos.find((x) => x.id === id);
    if (!h) return;
    h.estado = nuevoEstado;
    await putItem("hitos", h);
    renderHitos();
    showToast(`Hito actualizado a ${nuevoEstado}`);
}

// --- Rendering ---
function pillClassForHito(estado) {
    switch (estado) {
        case "COMPLETADO": return "pill-emerald";
        case "BLOQUEADO": return "pill-rose";
        case "PENDIENTE_TERCERO": return "pill-amber";
        default: return "pill-sky";
    }
}

function pillClassForSoporte(estado) {
    if (estado === "CON_SOPORTE") return "pill-emerald";
    if (estado === "OBSERVADO") return "pill-amber";
    return "pill-rose";
}

function updateChecklistButton() {
    const btn = document.getElementById("btnLoadChecklist");
    if (!btn) return;
    const loadedCount = hitos.filter(isChecklistHito).length;
    if (loadedCount > 0) {
        btn.textContent = `Quitar checklist Venezuela (${loadedCount})`;
        btn.classList.remove("btn-secondary");
        btn.classList.add("btn-danger-outline");
    } else {
        btn.textContent = "Cargar checklist Venezuela";
        btn.classList.remove("btn-danger-outline");
        btn.classList.add("btn-secondary");
    }
}

function renderHitos() {
    updateChecklistButton();
    const ul = document.getElementById("hitosLista");
    const filtro = document.getElementById("filtroHitoEstado").value;
    const sortedHitos = sortByFechaDesc(hitos);
    const visibles = sortedHitos.filter((h) => filtro === "ALL" || h.estado === filtro);

    // Progress bar calculation
    const totalH = sortedHitos.length;
    const doneH = sortedHitos.filter((h) => h.estado === "COMPLETADO").length;
    const pctH = totalH ? Math.round((doneH / totalH) * 100) : 0;

    const hitoProgText = document.getElementById("hitosProgressText");
    const hitoProgBar = document.getElementById("hitosProgressBar");
    const hitoProgFill = document.getElementById("hitosProgressFill");
    const hoyProgText = document.getElementById("hoyHitosProgressText");
    const hoyProgBar = document.getElementById("hoyHitosProgressBar");
    const hoyProgFill = document.getElementById("hoyHitosProgressFill");

    if (totalH > 0) {
        const msg = `Avance de apertura: ${doneH} de ${totalH} hitos completados (${pctH}%)`;
        hitoProgText.textContent = msg;
        hoyProgText.textContent = msg;
        hitoProgBar.classList.remove("hidden");
        hoyProgBar.classList.remove("hidden");
        hitoProgFill.style.width = `${pctH}%`;
        hoyProgFill.style.width = `${pctH}%`;
    } else {
        hitoProgText.textContent = "Cambia el estado en línea, adjunta presupuestos o carga el checklist base de Venezuela.";
        hoyProgText.textContent = "Avances recientes por frente operativo con sus notas de seguimiento.";
        hitoProgBar.classList.add("hidden");
        hoyProgBar.classList.add("hidden");
    }

    ul.innerHTML = visibles.map((h) => {
        const docs = Array.isArray(h.adjuntos) ? h.adjuntos : [];
        const docsHtml = docs.length ? `
            <div class="doc-chip-list" style="margin-top:4px;">
                ${docs.map((doc) => {
                    const badge = getDocBadge(doc.type, doc.name, doc.dataUrl);
                    return `
                        <span class="doc-chip">
                            <button type="button" data-open-hito="${escapeHtml(h.id)}" data-open-doc="${escapeHtml(doc.id)}" class="doc-chip-btn btn-open-hito-doc" title="Abrir ${escapeHtml(doc.name)}">
                                <span class="doc-chip-tag ${badge.cls}">${badge.tag}</span>
                                <span class="doc-chip-name">${escapeHtml(doc.name)}</span>
                                <span class="mono text-subtle" style="font-size:0.68rem;">${doc.sizeKb || 0}KB</span>
                            </button>
                            <button type="button" data-del-hito-ref="${escapeHtml(h.id)}" data-del-doc="${escapeHtml(doc.id)}" class="doc-chip-remove btn-del-hito-doc" aria-label="Eliminar documento">✕</button>
                        </span>
                    `;
                }).join("")}
            </div>
        ` : "";

        return `
        <div class="item-row">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span class="mono" style="font-size:0.78rem; font-weight:700; color:var(--accent-hover);">${escapeHtml(frenteLabel(h.frente))}</span>
                    <span class="pill ${pillClassForHito(h.estado)}">${escapeHtml(h.estado)}</span>
                    <span class="mono text-subtle" style="font-size:0.72rem;">${escapeHtml(h.fecha)}</span>
                </div>
                <div class="item-actions">
                    <select data-hito-estado="${escapeHtml(h.id)}" aria-label="Cambiar estado de hito"
                        class="hito-estado-select"
                        style="background:var(--bg-input); border:1px solid var(--border-subtle); color:var(--text-secondary); border-radius:7px; padding:3px 7px; font-size:0.72rem;">
                        <option value="EN_CURSO" ${h.estado === "EN_CURSO" ? "selected" : ""}>EN_CURSO</option>
                        <option value="PENDIENTE_TERCERO" ${h.estado === "PENDIENTE_TERCERO" ? "selected" : ""}>PENDIENTE_TERCERO</option>
                        <option value="COMPLETADO" ${h.estado === "COMPLETADO" ? "selected" : ""}>COMPLETADO</option>
                        <option value="BLOQUEADO" ${h.estado === "BLOQUEADO" ? "selected" : ""}>BLOQUEADO</option>
                    </select>
                    <button type="button" data-attach-hito="${escapeHtml(h.id)}" class="btn btn-secondary btn-sm btn-attach-hito">+ Doc</button>
                    <button type="button" data-edit-hito="${escapeHtml(h.id)}" class="btn btn-ghost btn-sm btn-edit-hito">Editar</button>
                    <button type="button" data-del-hito="${escapeHtml(h.id)}" class="btn-danger-link btn-del-hito">Borrar</button>
                </div>
            </div>
            <p class="item-title" style="font-weight:500;">${escapeHtml(h.paso)}</p>
            ${h.nota ? `<p class="item-note">${escapeHtml(h.nota)}</p>` : ""}
            ${docsHtml}
        </div>
    `;
    }).join("") || `<div class="empty-state">No hay hitos para mostrar.</div>`;

    const preview = document.getElementById("hoyHitosPreview");
    preview.innerHTML = sortedHitos.slice(0, 4).map((h) => {
        const docsCount = Array.isArray(h.adjuntos) ? h.adjuntos.length : 0;
        return `
        <div class="item-row">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span class="mono" style="font-size:0.76rem; font-weight:700; color:var(--accent-hover);">${escapeHtml(frenteLabel(h.frente))}</span>
                    <span class="mono text-subtle" style="font-size:0.72rem;">${escapeHtml(h.fecha)}</span>
                    ${docsCount ? `<span class="pill pill-sky">${docsCount} ${docsCount === 1 ? "doc" : "docs"}</span>` : ""}
                </div>
                <span class="pill ${pillClassForHito(h.estado)}">${escapeHtml(h.estado)}</span>
            </div>
            <p class="item-title" style="font-size:0.86rem; font-weight:500;">${escapeHtml(h.paso)}</p>
            ${h.nota ? `<p class="item-note">${escapeHtml(h.nota)}</p>` : ""}
        </div>
    `;
    }).join("") || `<div class="empty-state">Sin hitos registrados aún.</div>`;
}

function renderHoyCategorias(totals) {
    const box = document.getElementById("hoyCategoriasChart");
    const summary = document.getElementById("catUsageSummary");
    const porCat = {};
    movimientos.forEach((m) => {
        if (isEgresoCaja(m.tipo)) {
            porCat[m.categoria] = (porCat[m.categoria] || 0) + (Number(m.montoUsd) || 0);
        }
    });

    const entries = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
    if (totals.fondos > 0) {
        const pctUsed = Math.min(999, Math.round((totals.ejecutado / totals.fondos) * 100));
        summary.textContent = `Uso del fondo recibido: ${pctUsed}% ejecutado ($${formatMoney(totals.ejecutado)} de $${formatMoney(totals.fondos)} USD).`;
    } else {
        summary.textContent = "Distribución de egresos ejecutados por rubro.";
    }

    if (!entries.length) {
        box.innerHTML = `<div class="empty-state" style="padding:12px;">Aún no hay egresos ejecutados para graficar.</div>`;
        return;
    }

    const totalEj = totals.ejecutado || 1;
    box.innerHTML = entries.map(([cat, amount]) => {
        const pct = Math.round((amount / totalEj) * 100);
        return `
            <div class="cat-row">
                <div class="cat-row-head">
                    <span style="font-weight:600; color:var(--text-primary);">${escapeHtml(catLabel(cat))}</span>
                    <span class="mono" style="color:var(--text-secondary);">
                        <strong style="color:var(--accent-hover);">$${formatMoney(amount)}</strong> · ${pct}%
                    </span>
                </div>
                <div class="cat-bar-track">
                    <div class="cat-bar-fill" style="width:${Math.max(2, pct)}%;"></div>
                </div>
            </div>
        `;
    }).join("");
}

function renderMovSoporteControl(m, compact = false) {
    if (!m.fotoSoporte) {
        return compact
            ? `<button type="button" data-attach-mov="${escapeHtml(m.id)}" class="btn btn-ghost btn-sm btn-attach-mov" title="Adjuntar foto o documento">+ Soporte</button>`
            : "";
    }
    if (isImageData(m.soporteTipo, m.fotoSoporte)) {
        return `<img src="${m.fotoSoporte}" alt="Soporte ${escapeHtml(m.id)}" data-view-photo="${escapeHtml(m.id)}" class="${compact ? "photo-thumb-sm" : "photo-thumb"} btn-view-photo" title="Ver foto de soporte" />`;
    }
    const badge = getDocBadge(m.soporteTipo, m.soporteNombre, m.fotoSoporte);
    const label = m.soporteNombre || `Documento ${badge.tag}`;
    return `
        <button type="button" data-view-photo="${escapeHtml(m.id)}" class="doc-chip btn-view-photo" title="Abrir ${escapeHtml(label)}" style="cursor:pointer;">
            <span class="doc-chip-tag ${badge.cls}">${badge.tag}</span>
            <span class="doc-chip-name" style="max-width:${compact ? "110px" : "160px"};">${escapeHtml(label)}</span>
        </button>
    `;
}

function renderHoyPendientes() {
    const box = document.getElementById("hoyPendientesLista");
    const pendientes = sortByFechaDesc(movimientos).filter((m) => !isIngreso(m.tipo) && m.estadoSoporte !== "CON_SOPORTE");

    if (!pendientes.length) {
        box.innerHTML = `<div class="empty-state ok">Todo al día: no tienes egresos pendientes de soporte ni observados.</div>`;
        return;
    }

    box.innerHTML = pendientes.map((m) => `
        <div class="item-row item-row-split">
            <div class="item-main">
                ${renderMovSoporteControl(m, false)}
                <div style="min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <p class="item-title">${escapeHtml(m.contraparte || m.categoria)}</p>
                        <span class="pill ${pillClassForSoporte(m.estadoSoporte)}">${escapeHtml(m.estadoSoporte)}</span>
                    </div>
                    <p class="item-meta">
                        <span class="mono">${escapeHtml(m.id)}</span> · ${escapeHtml(m.categoria)} · ${escapeHtml(m.codigoCc)} · ${escapeHtml(m.fecha)}
                    </p>
                    ${m.nota ? `<p class="item-note">${escapeHtml(m.nota)}</p>` : ""}
                </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0;">
                <div class="text-right">
                    <span class="mono" style="font-size:1rem; font-weight:700; color:var(--accent-hover);">$${formatMoney(m.montoUsd)}</span>
                    ${m.moneda === "VES" ? `<div class="mono text-subtle" style="font-size:0.72rem;">VES ${formatMoney(m.monto)}</div>` : ""}
                </div>
                <div class="item-actions">
                    <button type="button" data-attach-mov="${escapeHtml(m.id)}" class="btn btn-secondary btn-sm btn-attach-mov">
                        ${m.fotoSoporte ? "Cambiar soporte" : "Adjuntar soporte"}
                    </button>
                    <button type="button" data-reg="${escapeHtml(m.id)}" class="btn-amber-soft btn-reg">
                        Marcar con soporte
                    </button>
                    <button type="button" data-edit-mov="${escapeHtml(m.id)}" class="btn btn-ghost btn-sm btn-edit-mov">Editar</button>
                    <button type="button" data-del-mov="${escapeHtml(m.id)}" class="btn-danger-link btn-del-mov">Borrar</button>
                </div>
            </div>
        </div>
    `).join("");
}

function renderAll() {
    const t = computeTotals();

    document.getElementById("kpiFondos").textContent = `$${formatMoney(t.fondos)}`;
    document.getElementById("kpiEjecutado").textContent = `$${formatMoney(t.ejecutado)}`;
    document.getElementById("kpiEjecutadoSub").textContent = `CAPEX $${formatMoney(t.capex)} · OPEX $${formatMoney(t.opex)}`;

    const saldoEl = document.getElementById("kpiSaldo");
    saldoEl.textContent = `$${formatMoney(t.saldo)}`;
    saldoEl.classList.toggle("rose", t.saldo < 0);

    const pendEl = document.getElementById("kpiPendiente");
    pendEl.textContent = `$${formatMoney(t.pendiente)}`;
    pendEl.classList.toggle("rose", t.pendiente > 0);
    pendEl.classList.toggle("emerald", t.pendiente === 0);
    document.getElementById("kpiPendienteSub").textContent = t.pendientesCount === 1
        ? "1 movimiento por regularizar"
        : `${t.pendientesCount} movimientos por regularizar`;

    // Badges on tabs
    const deskBadge = document.getElementById("deskBadgeHoy");
    const mobBadge = document.getElementById("mobBadgeHoy");
    if (t.pendientesCount > 0) {
        deskBadge.textContent = t.pendientesCount;
        deskBadge.classList.remove("hidden");
        mobBadge.textContent = t.pendientesCount;
        mobBadge.classList.remove("hidden");
    } else {
        deskBadge.classList.add("hidden");
        mobBadge.classList.add("hidden");
    }

    // Table
    const q = document.getElementById("filtroTexto").value.trim().toLowerCase();
    const sup = document.getElementById("filtroSoporte").value;
    const tipoFilter = document.getElementById("filtroTipo").value;

    const filtrados = sortByFechaDesc(movimientos).filter((m) => {
        const matchSup = sup === "ALL" || m.estadoSoporte === sup;
        const matchTipo = tipoFilter === "ALL" || m.tipo === tipoFilter;
        const searchable = `${m.id} ${m.fecha} ${m.tipo} ${m.categoria} ${m.codigoCc} ${m.contraparte} ${m.referencia} ${m.nota}`.toLowerCase();
        const matchQ = !q || searchable.includes(q);
        return matchSup && matchTipo && matchQ;
    });

    document.getElementById("movTabla").innerHTML = filtrados.map((m) => `
        <tr>
            <td>
                <div class="mono" style="font-weight:600; color:var(--text-primary);">${escapeHtml(m.id)}</div>
                <div class="mono text-subtle" style="font-size:0.74rem;">${escapeHtml(m.fecha)}</div>
            </td>
            <td>
                <div style="font-weight:600; color:var(--text-primary);">${escapeHtml(m.tipo)}</div>
                <div class="text-muted" style="font-size:0.76rem;">${escapeHtml(catLabel(m.categoria))}</div>
                ${m.metodoPago ? `<div class="text-subtle" style="font-size:0.7rem;">${escapeHtml(metodoLabel(m.metodoPago))}</div>` : ""}
            </td>
            <td>
                <div style="font-weight:500; color:var(--text-primary);">${escapeHtml(m.contraparte || "—")}</div>
                ${m.referencia ? `<div class="mono text-subtle" style="font-size:0.72rem;">Ref: ${escapeHtml(m.referencia)}</div>` : ""}
                ${m.nota ? `<div class="text-muted" style="font-size:0.74rem; max-width:240px;">${escapeHtml(m.nota)}</div>` : ""}
            </td>
            <td class="mono" style="color:var(--accent-hover); font-size:0.78rem;">${escapeHtml(m.codigoCc)}</td>
            <td class="mono text-right">
                <div style="font-weight:700; color:${isIngreso(m.tipo) ? "var(--emerald-text)" : "var(--text-primary)"};">
                    ${isIngreso(m.tipo) ? "+" : ""}$${formatMoney(m.montoUsd)}
                </div>
                ${m.moneda === "VES" ? `<div class="text-subtle" style="font-size:0.72rem;">VES ${formatMoney(m.monto)}</div>` : ""}
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:7px; flex-wrap:wrap;">
                    <span class="pill ${pillClassForSoporte(m.estadoSoporte)}">${escapeHtml(m.estadoSoporte)}</span>
                    ${renderMovSoporteControl(m, true)}
                </div>
            </td>
            <td style="white-space:nowrap;">
                <div style="display:flex; align-items:center; gap:4px;">
                    ${m.estadoSoporte !== "CON_SOPORTE" ? `<button type="button" data-reg="${escapeHtml(m.id)}" class="btn-amber-soft btn-reg">Regularizar</button>` : ""}
                    <button type="button" data-edit-mov="${escapeHtml(m.id)}" class="btn btn-ghost btn-sm btn-edit-mov">Editar</button>
                    <button type="button" data-del-mov="${escapeHtml(m.id)}" class="btn-danger-link btn-del-mov">Borrar</button>
                </div>
            </td>
        </tr>
    `).join("") || `<tr><td colspan="7" class="empty-state">No hay movimientos registrados con estos filtros.</td></tr>`;

    renderHoyCategorias(t);
    renderHoyPendientes();
    renderHitos();
}

// --- Report & Lightbox Modals ---
function filterByReportRange(items) {
    const desde = document.getElementById("reportDesde").value;
    const hasta = document.getElementById("reportHasta").value;
    return items.filter((item) => {
        const f = item.fecha || "";
        if (desde && f < desde) return false;
        if (hasta && f > hasta) return false;
        return true;
    });
}

function buildReportData() {
    const desde = document.getElementById("reportDesde").value;
    const hasta = document.getElementById("reportHasta").value;
    const rangeLabel = desde || hasta
        ? `Período: ${desde || "Inicio"} al ${hasta || getLocalDateStr()}`
        : `Período: Historial completo al ${getLocalDateStr()}`;

    const movs = sortByFechaDesc(filterByReportRange(movimientos));
    const hits = sortByFechaDesc(filterByReportRange(hitos));

    let fondos = 0, ejecutado = 0, capex = 0, opex = 0, pendiente = 0, pendCount = 0;
    const porCat = {};
    const porMetodo = {};
    const pendItems = [];

    movs.forEach((m) => {
        const usd = Number(m.montoUsd) || 0;
        if (isIngreso(m.tipo)) {
            fondos += usd;
        } else if (m.tipo === "LIQ_ANTICIPO") {
            if (m.estadoSoporte !== "CON_SOPORTE") {
                pendiente += usd;
                pendCount += 1;
                pendItems.push(`- [${m.id}] ${catLabel(m.categoria)} (${m.codigoCc}): $${formatMoney(usd)} (${m.estadoSoporte}) - ${m.nota || "Sin nota"}`);
            }
        } else {
            ejecutado += usd;
            if (m.tipo === "GASTO_CAPEX") capex += usd;
            else opex += usd;
            porCat[m.categoria] = (porCat[m.categoria] || 0) + usd;
            const mp = metodoLabel(m.metodoPago);
            porMetodo[mp] = (porMetodo[mp] || 0) + usd;
            if (m.estadoSoporte !== "CON_SOPORTE") {
                pendiente += usd;
                pendCount += 1;
                pendItems.push(`- [${m.id}] ${catLabel(m.categoria)} (${m.codigoCc}): $${formatMoney(usd)} (${m.estadoSoporte}) - ${m.nota || "Sin nota"}`);
            }
        }
    });

    const totalGlobal = computeTotals();
    return {
        rangeLabel,
        movs,
        hits,
        fondos,
        ejecutado,
        capex,
        opex,
        saldo: fondos - ejecutado,
        saldoGlobal: totalGlobal.saldo,
        pendiente,
        pendCount,
        porCat,
        porMetodo,
        pendItems
    };
}

function renderReportText() {
    const d = buildReportData();

    const catLines = Object.entries(d.porCat)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `- ${catLabel(k)}: $${formatMoney(v)}`)
        .join("\n") || "- Sin gastos ejecutados en el período";

    const metodoLines = Object.entries(d.porMetodo)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `- ${k}: $${formatMoney(v)}`)
        .join("\n") || "- Sin egresos registrados";

    const doneH = d.hits.filter((h) => h.estado === "COMPLETADO").length;
    const pctH = d.hits.length ? Math.round((doneH / d.hits.length) * 100) : 0;

    const hitoLines = d.hits.map((h) => {
        const notaTxt = h.nota ? `\n    Nota: ${h.nota}` : "";
        const docs = Array.isArray(h.adjuntos) ? h.adjuntos : [];
        const docsTxt = docs.length ? `\n    Adjuntos (${docs.length}): ${docs.map((x) => x.name).join(", ")}` : "";
        return `- [${frenteLabel(h.frente)}] ${h.estado} (${h.fecha}): ${h.paso}${notaTxt}${docsTxt}`;
    }).join("\n") || "- Sin hitos en el período";

    const conSoporteAdjuntoCount = d.movs.filter((m) => Boolean(m.fotoSoporte)).length;

    const txt = [
        `REPORTE EJECUTIVO — HNA INGENIERÍA VZ (LECHERÍA / ANZOÁTEGUI)`,
        `Fecha emisión: ${getLocalDateStr()} | ${d.rangeLabel}`,
        ``,
        `1. POSICIÓN DE CAJA (USD EQUIVALENTE)`,
        `- Fondos / Aportes recibidos: $${formatMoney(d.fondos)}`,
        `- Ejecutado en período: $${formatMoney(d.ejecutado)} (CAPEX: $${formatMoney(d.capex)} | OPEX: $${formatMoney(d.opex)})`,
        `- Balance del período: $${formatMoney(d.saldo)} | Saldo global acumulado: $${formatMoney(d.saldoGlobal)}`,
        `- Pendiente de soporte: $${formatMoney(d.pendiente)} (${d.pendCount} mov.)`,
        `- Comprobantes con soporte adjunto: ${conSoporteAdjuntoCount} de ${d.movs.length}`,
        ``,
        `2. EJECUCIÓN POR CATEGORÍA`,
        catLines,
        ``,
        `3. EGRESOS POR MÉTODO DE PAGO`,
        metodoLines,
        ``,
        `4. SOPORTES PENDIENTES / OBSERVADOS`,
        d.pendItems.length ? d.pendItems.join("\n") : "- Todo al día con soporte.",
        ``,
        `5. HITOS DE APERTURA (${doneH}/${d.hits.length} completados · ${pctH}%)`,
        hitoLines
    ].join("\n");

    document.getElementById("reportText").value = txt;
}

function buildFormalPrintSheet() {
    const d = buildReportData();
    const doneH = d.hits.filter((h) => h.estado === "COMPLETADO").length;
    const pctH = d.hits.length ? Math.round((doneH / d.hits.length) * 100) : 0;

    const movRows = d.movs.map((m) => `
        <tr>
            <td>${escapeHtml(m.fecha)}<br/><small>${escapeHtml(m.id)}</small></td>
            <td><strong>${escapeHtml(m.tipo)}</strong><br/>${escapeHtml(catLabel(m.categoria))}</td>
            <td>${escapeHtml(m.contraparte || "—")}${m.nota ? `<br/><small>${escapeHtml(m.nota)}</small>` : ""}</td>
            <td>${escapeHtml(metodoLabel(m.metodoPago))}${m.referencia ? `<br/><small>Ref: ${escapeHtml(m.referencia)}</small>` : ""}</td>
            <td>${escapeHtml(m.moneda)} ${formatMoney(m.monto)}</td>
            <td style="text-align:right;"><strong>$${formatMoney(m.montoUsd)}</strong></td>
            <td>${escapeHtml(m.estadoSoporte)}</td>
        </tr>
    `).join("") || `<tr><td colspan="7">Sin movimientos en este período.</td></tr>`;

    const hitoRows = d.hits.map((h) => {
        const docs = Array.isArray(h.adjuntos) ? h.adjuntos.map((x) => x.name).join(", ") : "";
        return `
            <tr>
                <td>${escapeHtml(h.fecha)}</td>
                <td>${escapeHtml(frenteLabel(h.frente))}</td>
                <td><strong>${escapeHtml(h.estado)}</strong></td>
                <td>${escapeHtml(h.paso)}${h.nota ? `<br/><small>${escapeHtml(h.nota)}</small>` : ""}${docs ? `<br/><small>Docs: ${escapeHtml(docs)}</small>` : ""}</td>
            </tr>
        `;
    }).join("") || `<tr><td colspan="4">Sin hitos registrados en este período.</td></tr>`;

    const photoItems = d.movs.filter((m) => m.fotoSoporte && isImageData(m.soporteTipo, m.fotoSoporte));
    const docItems = d.movs.filter((m) => m.fotoSoporte && !isImageData(m.soporteTipo, m.fotoSoporte));
    const docsSection = docItems.length ? `
        <div class="ps-section-title">Documentos de Soporte Adjuntos (${docItems.length})</div>
        <table class="ps-table">
            <thead>
                <tr>
                    <th>Fecha / ID</th>
                    <th>Contraparte / Categoría</th>
                    <th>Documento</th>
                    <th style="text-align:right;">USD Eq.</th>
                </tr>
            </thead>
            <tbody>
                ${docItems.map((m) => `
                    <tr>
                        <td>${escapeHtml(m.fecha)} · ${escapeHtml(m.id)}</td>
                        <td>${escapeHtml(m.contraparte || catLabel(m.categoria))}</td>
                        <td>${escapeHtml(m.soporteNombre || "Documento adjunto")}</td>
                        <td style="text-align:right;"><strong>$${formatMoney(m.montoUsd)}</strong></td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    ` : "";
    const photosSection = photoItems.length ? `
        <div class="ps-section-title">Anexo Fotográfico de Soportes (${photoItems.length})</div>
        <div class="ps-photos">
            ${photoItems.map((m) => `
                <div class="ps-photo-card">
                    <img src="${m.fotoSoporte}" alt="Soporte ${escapeHtml(m.id)}" />
                    <div class="ps-photo-cap">
                        <strong>${escapeHtml(m.id)}</strong> · ${escapeHtml(m.fecha)} · <strong>$${formatMoney(m.montoUsd)} USD</strong><br/>
                        ${escapeHtml(m.contraparte || catLabel(m.categoria))} ${m.referencia ? `· Ref: ${escapeHtml(m.referencia)}` : ""}
                    </div>
                </div>
            `).join("")}
        </div>
    ` : "";

    document.getElementById("printSheet").innerHTML = `
        <div class="ps-header">
            <div>
                <h1>HNA Ingeniería VZ — Rendición de Cuentas</h1>
                <p>Sucursal Lechería / Anzoátegui, Venezuela · Reporte para Casa Matriz</p>
            </div>
            <div style="text-align:right;">
                <p><strong>Emisión:</strong> ${getLocalDateStr()}</p>
                <p>${escapeHtml(d.rangeLabel)}</p>
            </div>
        </div>

        <div class="ps-kpis">
            <div class="ps-kpi"><span>Fondos / Aportes</span><strong>$${formatMoney(d.fondos)}</strong></div>
            <div class="ps-kpi"><span>Ejecutado (CAPEX/OPEX)</span><strong>$${formatMoney(d.ejecutado)}</strong></div>
            <div class="ps-kpi"><span>Saldo Global Disponible</span><strong>$${formatMoney(d.saldoGlobal)}</strong></div>
            <div class="ps-kpi"><span>Avance de Apertura</span><strong>${pctH}% (${doneH}/${d.hits.length})</strong></div>
        </div>

        <div class="ps-section-title">Detalle de Movimientos (${d.movs.length})</div>
        <table class="ps-table">
            <thead>
                <tr>
                    <th>Fecha / ID</th>
                    <th>Tipo / Categoría</th>
                    <th>Contraparte / Nota</th>
                    <th>Método / Ref.</th>
                    <th>Original</th>
                    <th style="text-align:right;">USD Eq.</th>
                    <th>Soporte</th>
                </tr>
            </thead>
            <tbody>${movRows}</tbody>
        </table>

        <div class="ps-section-title">Hitos y Avances de Sucursal (${d.hits.length})</div>
        <table class="ps-table">
            <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Frente</th>
                    <th>Estado</th>
                    <th>Paso / Nota / Documentos</th>
                </tr>
            </thead>
            <tbody>${hitoRows}</tbody>
        </table>

        ${docsSection}
        ${photosSection}
    `;
}

function openReport() {
    renderReportText();
    document.getElementById("reportModal").classList.remove("hidden");
}

function closeReport() {
    document.getElementById("reportModal").classList.add("hidden");
}

async function copyReport() {
    const ta = document.getElementById("reportText");
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(ta.value);
        } else {
            ta.select();
            document.execCommand("copy");
        }
        showToast("Resumen copiado al portapapeles");
    } catch {
        ta.select();
        document.execCommand("copy");
        showToast("Resumen copiado");
    }
}

function openPhotoLightbox(movId) {
    const mov = movimientos.find((m) => m.id === movId);
    if (!mov || !mov.fotoSoporte) return;

    openStoredFile(
        {
            dataUrl: mov.fotoSoporte,
            type: mov.soporteTipo || (mov.fotoSoporte.startsWith("data:image/") ? "image/jpeg" : "application/octet-stream"),
            name: mov.soporteNombre || `${mov.id}-soporte.jpg`,
            sizeKb: mov.soporteSizeKb || 0
        },
        `${mov.id} · ${mov.contraparte || mov.categoria}`,
        `${mov.fecha} · $${formatMoney(mov.montoUsd)} USD · ${mov.estadoSoporte}`
    );
}

function closePhotoLightbox() {
    document.getElementById("photoModal").classList.add("hidden");
    document.getElementById("lightboxImg").removeAttribute("src");
}

// --- Export / Import ---
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJSON() {
    const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        settings: loadSettings(),
        movimientos,
        hitos
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `hna-vzla-respaldo-${getLocalDateStr()}.json`);
    showToast("Respaldo JSON exportado");
}

async function importJSONFile(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data.movimientos) || !Array.isArray(data.hitos)) {
            throw new Error("El archivo no tiene el formato de respaldo HNA.");
        }
        const ok = confirm(
            `Se restaurarán ${data.movimientos.length} movimientos y ${data.hitos.length} hitos, reemplazando los datos actuales en este dispositivo. ¿Continuar?`
        );
        if (!ok) return;

        await clearAndPutAll("movimientos", data.movimientos);
        await clearAndPutAll("hitos", data.hitos);

        if (data.settings) {
            saveSettings(data.settings);
            document.getElementById("umbralInput").value = loadSettings().umbral;
            document.getElementById("tasa").value = loadSettings().tasa;
        }

        movimientos = sortByFechaDesc(data.movimientos);
        hitos = sortByFechaDesc(data.hitos);
        cancelEditMov();
        cancelEditHito();
        renderAll();
        showToast("Respaldo importado correctamente");
    } catch (err) {
        alert(`Error al importar respaldo: ${err.message}`);
    }
}

function exportCSV() {
    const headers = [
        "id", "fecha", "tipo", "codigoCc", "categoria", "moneda", "monto",
        "tasa", "montoUsd", "metodoPago", "contraparte", "estadoSoporte", "referencia", "nota", "tieneFoto"
    ];
    const rows = movimientos.map((m) =>
        headers.map((h) => {
            const val = h === "tieneFoto" ? (m.fotoSoporte ? "SI" : "NO") : (m[h] ?? "");
            return `"${String(val).replace(/"/g, '""')}"`;
        }).join(",")
    );
    // UTF-8 BOM for Excel Spanish accents
    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `hna-vzla-movimientos-${getLocalDateStr()}.csv`);
    showToast("Archivo CSV exportado");
}

// --- Network Status ---
function updateNetworkBadge() {
    const badge = document.getElementById("networkStatus");
    if (!badge) return;
    const online = navigator.onLine;
    badge.textContent = online ? "En línea · Local" : "Modo offline";
    badge.classList.toggle("offline", !online);
}

// --- Event Binding ---
function bindEvents() {
    document.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });

    document.getElementById("umbralInput").addEventListener("change", (e) => {
        const val = Number(e.target.value) || 0;
        saveSettings({ umbral: val });
        showToast(`Umbral actualizado a $${formatMoney(val)} USD`);
    });

    document.getElementById("moneda").addEventListener("change", toggleTasa);
    document.getElementById("monto").addEventListener("input", updateLiveUsdPreview);
    document.getElementById("tasa").addEventListener("input", () => {
        const t = Number(document.getElementById("tasa").value);
        if (t > 0) saveSettings({ tasa: t });
        updateLiveUsdPreview();
    });

    document.getElementById("filtroTexto").addEventListener("input", renderAll);
    document.getElementById("filtroSoporte").addEventListener("change", renderAll);
    document.getElementById("filtroTipo").addEventListener("change", renderAll);
    document.getElementById("filtroHitoEstado").addEventListener("change", renderHitos);

    document.getElementById("btnOpenReport").addEventListener("click", openReport);
    document.getElementById("btnOpenReport2").addEventListener("click", openReport);
    document.getElementById("btnCloseReport").addEventListener("click", closeReport);
    document.getElementById("btnCopyReport").addEventListener("click", copyReport);
    document.getElementById("btnPrintReport").addEventListener("click", () => {
        buildFormalPrintSheet();
        window.print();
    });
    document.getElementById("reportDesde").addEventListener("change", renderReportText);
    document.getElementById("reportHasta").addEventListener("change", renderReportText);
    document.getElementById("btnReportClearRange").addEventListener("click", () => {
        document.getElementById("reportDesde").value = "";
        document.getElementById("reportHasta").value = "";
        renderReportText();
    });
    document.getElementById("btnLoadChecklist").addEventListener("click", async () => {
        const loadedChecklist = hitos.filter(isChecklistHito);
        if (loadedChecklist.length > 0) {
            const ok = confirm(
                `¿Quitar los ${loadedChecklist.length} hitos del checklist base de Venezuela? Tus hitos propios no se verán afectados.`
            );
            if (!ok) return;
            const idsToRemove = new Set(loadedChecklist.map((h) => h.id));
            for (const h of loadedChecklist) {
                await deleteItem("hitos", h.id);
            }
            hitos = hitos.filter((h) => !idsToRemove.has(h.id));
            if (editingHitoId && idsToRemove.has(editingHitoId)) {
                cancelEditHito();
            }
            renderHitos();
            showToast(`Checklist base de Venezuela quitado (${loadedChecklist.length} hitos)`);
            return;
        }

        const hoy = getLocalDateStr();
        const baseTs = Date.now();
        for (let i = CHECKLIST_VENEZUELA.length - 1; i >= 0; i--) {
            const tpl = CHECKLIST_VENEZUELA[i];
            const item = {
                id: "HITO-" + (baseTs + i),
                fecha: hoy,
                frente: tpl.frente,
                estado: tpl.estado,
                paso: tpl.paso,
                nota: tpl.nota,
                adjuntos: [],
                isChecklistBase: true
            };
            await putItem("hitos", item);
            hitos.unshift(item);
        }
        hitos = sortByFechaDesc(hitos);
        renderHitos();
        showToast(`${CHECKLIST_VENEZUELA.length} hitos del checklist de Venezuela cargados`);
    });
    document.getElementById("btnWhatsappReport").addEventListener("click", () => {
        const txt = document.getElementById("reportText").value;
        window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank");
    });
    document.getElementById("btnExportJSON").addEventListener("click", exportJSON);
    document.getElementById("btnExportCSV").addEventListener("click", exportCSV);

    document.getElementById("btnImportJSON").addEventListener("click", () => {
        const input = document.getElementById("importJsonInput");
        input.value = "";
        input.click();
    });
    document.getElementById("importJsonInput").addEventListener("change", (e) => {
        importJSONFile(e.target.files[0]);
    });

    document.getElementById("btnClosePhoto").addEventListener("click", closePhotoLightbox);
    document.getElementById("btnCancelEditMov").addEventListener("click", cancelEditMov);
    document.getElementById("btnCancelEditHito").addEventListener("click", cancelEditHito);
    document.getElementById("btnCloseAlerta").addEventListener("click", () => {
        document.getElementById("alertaBanner").classList.add("hidden");
    });

    // Photo input inside form
    const fotoInput = document.getElementById("fotoInput");
    const dropzone = document.getElementById("photoDropzone");

    document.getElementById("btnSelectPhoto").addEventListener("click", () => {
        fotoInput.value = "";
        fotoInput.click();
    });
    document.getElementById("btnRemovePhoto").addEventListener("click", () => setFormPhoto(null));
    const openPendingPreview = () => {
        if (!pendingPhotoDataUrl) return;
        openStoredFile(
            {
                dataUrl: pendingPhotoDataUrl,
                type: pendingPhotoType,
                name: pendingPhotoName || "recibo-soporte.jpg",
                sizeKb: pendingPhotoSizeKb
            },
            pendingPhotoName || "Vista previa de soporte",
            `~${pendingPhotoSizeKb} KB`
        );
    };
    document.getElementById("photoPreviewImg")?.addEventListener("click", openPendingPreview);
    document.getElementById("photoPreviewDocBadge")?.addEventListener("click", openPendingPreview);

    async function handleFormPhotoFile(file) {
        if (!file) return;
        try {
            const doc = await processAttachmentFile(file);
            setFormPhoto(doc.dataUrl, doc.sizeKb, doc.name, doc.type);
            // If user had PENDIENTE_SOPORTE selected, suggest/switch to CON_SOPORTE
            const supSel = document.getElementById("estadoSoporte");
            if (supSel.value === "PENDIENTE_SOPORTE") {
                supSel.value = "CON_SOPORTE";
            }
            const label = isImageData(doc.type, doc.dataUrl) ? "Foto adjuntada" : `Documento "${doc.name}" adjuntado`;
            showToast(`${label} (~${doc.sizeKb} KB)`);
        } catch (err) {
            alert(err.message);
        }
    }

    fotoInput.addEventListener("change", (e) => handleFormPhotoFile(e.target.files[0]));

    ["dragenter", "dragover"].forEach((ev) => {
        dropzone.addEventListener(ev, (e) => {
            e.preventDefault();
            dropzone.classList.add("dragover");
        });
    });
    ["dragleave", "drop"].forEach((ev) => {
        dropzone.addEventListener(ev, (e) => {
            e.preventDefault();
            dropzone.classList.remove("dragover");
        });
    });
    dropzone.addEventListener("drop", (e) => {
        const file = e.dataTransfer?.files?.[0];
        handleFormPhotoFile(file);
    });

    // Hitos file uploader (form)
    const hitoFileInput = document.getElementById("hitoFileInput");
    document.getElementById("btnSelectHitoFiles").addEventListener("click", () => {
        hitoFileInput.value = "";
        hitoFileInput.click();
    });
    hitoFileInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        let added = 0;
        for (const f of files) {
            try {
                const doc = await processHitoAttachment(f);
                pendingHitoDocs.push(doc);
                added += 1;
            } catch (err) {
                alert(err.message);
            }
        }
        renderPendingHitoDocs();
        if (added) showToast(`${added} ${added === 1 ? "documento adjuntado" : "documentos adjuntados"}`);
    });

    // Quick attach documents to existing hito
    document.getElementById("quickHitoFileInput").addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        const targetId = quickAttachHitoId;
        quickAttachHitoId = null;
        if (!files.length || !targetId) return;
        const h = hitos.find((x) => x.id === targetId);
        if (!h) return;
        if (!Array.isArray(h.adjuntos)) h.adjuntos = [];
        let added = 0;
        for (const f of files) {
            try {
                const doc = await processHitoAttachment(f);
                h.adjuntos.push(doc);
                added += 1;
            } catch (err) {
                alert(err.message);
            }
        }
        if (added) {
            await putItem("hitos", h);
            renderHitos();
            showToast(`${added} ${added === 1 ? "documento guardado" : "documentos guardados"} en el hito`);
        }
    });

    // Quick attach photo or document from Hoy / Table
    document.getElementById("quickPhotoInput").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file || !quickAttachMovId) return;
        const mov = movimientos.find((m) => m.id === quickAttachMovId);
        quickAttachMovId = null;
        if (!mov) return;
        try {
            const doc = await processAttachmentFile(file);
            mov.fotoSoporte = doc.dataUrl;
            mov.soporteNombre = doc.name;
            mov.soporteTipo = doc.type;
            mov.soporteSizeKb = doc.sizeKb;
            if (mov.estadoSoporte !== "CON_SOPORTE") {
                mov.estadoSoporte = "CON_SOPORTE";
            }
            await putItem("movimientos", mov);
            renderAll();
            showToast(`Soporte guardado en ${mov.id} (~${doc.sizeKb} KB)`);
        } catch (err) {
            alert(err.message);
        }
    });

    // Modal backdrop & Escape close
    ["reportModal", "photoModal"].forEach((modalId) => {
        document.getElementById(modalId).addEventListener("click", (e) => {
            if (e.target.id === modalId) {
                if (modalId === "reportModal") closeReport();
                else closePhotoLightbox();
            }
        });
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeReport();
            closePhotoLightbox();
        }
    });

    // Delegated clicks & changes
    document.addEventListener("click", (e) => {
        const regBtn = e.target.closest(".btn-reg");
        if (regBtn) return regularizar(regBtn.getAttribute("data-reg"));

        const attachBtn = e.target.closest(".btn-attach-mov");
        if (attachBtn) return triggerQuickAttach(attachBtn.getAttribute("data-attach-mov"));

        const viewPhoto = e.target.closest(".btn-view-photo");
        if (viewPhoto) return openPhotoLightbox(viewPhoto.getAttribute("data-view-photo"));

        const editMovBtn = e.target.closest(".btn-edit-mov");
        if (editMovBtn) return startEditMov(editMovBtn.getAttribute("data-edit-mov"));

        const delMovBtn = e.target.closest(".btn-del-mov");
        if (delMovBtn) return deleteMov(delMovBtn.getAttribute("data-del-mov"));

        const editHitoBtn = e.target.closest(".btn-edit-hito");
        if (editHitoBtn) return startEditHito(editHitoBtn.getAttribute("data-edit-hito"));

        const delHitoBtn = e.target.closest(".btn-del-hito");
        if (delHitoBtn) return deleteHito(delHitoBtn.getAttribute("data-del-hito"));

        const attachHitoBtn = e.target.closest(".btn-attach-hito");
        if (attachHitoBtn) {
            quickAttachHitoId = attachHitoBtn.getAttribute("data-attach-hito");
            const input = document.getElementById("quickHitoFileInput");
            input.value = "";
            input.click();
            return;
        }

        const openDocBtn = e.target.closest(".btn-open-hito-doc");
        if (openDocBtn) {
            openHitoDocument(openDocBtn.getAttribute("data-open-hito"), openDocBtn.getAttribute("data-open-doc"));
            return;
        }

        const delDocBtn = e.target.closest(".btn-del-hito-doc");
        if (delDocBtn) {
            const hId = delDocBtn.getAttribute("data-del-hito-ref");
            const dId = delDocBtn.getAttribute("data-del-doc");
            const h = hitos.find((x) => x.id === hId);
            if (!h || !Array.isArray(h.adjuntos)) return;
            if (!confirm("¿Eliminar este documento adjunto del hito?")) return;
            h.adjuntos = h.adjuntos.filter((d) => d.id !== dId);
            putItem("hitos", h).then(() => {
                renderHitos();
                showToast("Documento eliminado");
            });
            return;
        }

        const remPendingDoc = e.target.closest(".btn-remove-pending-doc");
        if (remPendingDoc) {
            const dId = remPendingDoc.getAttribute("data-remove-pending-doc");
            pendingHitoDocs = pendingHitoDocs.filter((d) => d.id !== dId);
            renderPendingHitoDocs();
        }
    });

    document.addEventListener("change", (e) => {
        const sel = e.target.closest(".hito-estado-select");
        if (sel) {
            updateHitoEstado(sel.getAttribute("data-hito-estado"), sel.value);
        }
    });

    // Submit Movimiento
    document.getElementById("movForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const moneda = document.getElementById("moneda").value;
        const monto = Number(document.getElementById("monto").value);
        const tasa = moneda === "VES" ? Number(document.getElementById("tasa").value) : 1;
        if (moneda === "VES" && tasa > 0) saveSettings({ tasa });

        const montoUsd = calcUSD(moneda, monto, tasa);
        const tipo = document.getElementById("tipo").value;
        const umbral = Number(document.getElementById("umbralInput").value) || 0;

        const banner = document.getElementById("alertaBanner");
        if (isEgresoCaja(tipo) && umbral > 0 && montoUsd > umbral) {
            document.getElementById("alertaTexto").textContent =
                `Alerta de umbral: el movimiento de $${formatMoney(montoUsd)} USD supera el umbral de $${formatMoney(umbral)} USD. Verifica aprobación previa de socios/casa matriz.`;
            banner.classList.remove("hidden");
        } else {
            banner.classList.add("hidden");
        }

        const item = {
            id: editingMovId || nextId(),
            fecha: document.getElementById("fecha").value,
            tipo,
            codigoCc: document.getElementById("codigoCc").value.trim().toUpperCase(),
            categoria: document.getElementById("categoria").value,
            moneda,
            monto,
            tasa,
            montoUsd,
            contraparte: document.getElementById("contraparte").value.trim(),
            estadoSoporte: document.getElementById("estadoSoporte").value,
            metodoPago: document.getElementById("metodoPago").value,
            referencia: document.getElementById("referencia").value.trim(),
            nota: document.getElementById("nota").value.trim(),
            fotoSoporte: pendingPhotoDataUrl || null,
            soporteNombre: pendingPhotoName || null,
            soporteTipo: pendingPhotoType || null,
            soporteSizeKb: pendingPhotoSizeKb || 0
        };

        await putItem("movimientos", item);

        if (editingMovId) {
            const idx = movimientos.findIndex((m) => m.id === editingMovId);
            if (idx >= 0) movimientos[idx] = item;
            showToast(`Movimiento ${item.id} actualizado`);
        } else {
            movimientos.unshift(item);
            showToast(`Movimiento ${item.id} registrado`);
        }
        movimientos = sortByFechaDesc(movimientos);

        cancelEditMov();
        renderAll();
    });

    // Submit Hito
    document.getElementById("hitoForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const existingHito = editingHitoId ? hitos.find((h) => h.id === editingHitoId) : null;
        const hito = {
            id: editingHitoId || ("HITO-" + Date.now()),
            fecha: document.getElementById("hitoFecha").value || getLocalDateStr(),
            frente: document.getElementById("hitoFrente").value,
            estado: document.getElementById("hitoEstado").value,
            paso: document.getElementById("hitoPaso").value.trim(),
            nota: document.getElementById("hitoNota").value.trim(),
            adjuntos: [...pendingHitoDocs],
            ...(existingHito?.isChecklistBase ? { isChecklistBase: true } : {})
        };

        await putItem("hitos", hito);

        if (editingHitoId) {
            const idx = hitos.findIndex((h) => h.id === editingHitoId);
            if (idx >= 0) hitos[idx] = hito;
            showToast("Hito actualizado");
        } else {
            hitos.unshift(hito);
            showToast("Hito registrado");
        }
        hitos = sortByFechaDesc(hitos);

        cancelEditHito();
        renderHitos();
    });

    window.addEventListener("online", updateNetworkBadge);
    window.addEventListener("offline", updateNetworkBadge);
}

// --- Init ---
(async function init() {
    const settings = loadSettings();
    document.getElementById("umbralInput").value = settings.umbral;
    document.getElementById("tasa").value = settings.tasa;
    document.getElementById("fecha").value = getLocalDateStr();
    document.getElementById("hitoFecha").value = getLocalDateStr();

    bindEvents();
    updateNetworkBadge();

    try {
        await openDB();
        movimientos = sortByFechaDesc(await getAll("movimientos"));
        hitos = sortByFechaDesc(await getAll("hitos"));
    } catch (err) {
        console.error(err);
        showToast("Error al abrir la base de datos local");
    }

    renderAll();

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("./sw.js").then((reg) => {
                reg.update().catch(() => {});
            }).catch(() => {});
        });
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    }
})();
