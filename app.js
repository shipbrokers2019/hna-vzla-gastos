const DB_NAME = "HNA_VZLA_DB";
const DB_VER = 1;
const SETTINGS_KEY = "hna_vzla_settings_v1";

let db;
let movimientos = [];
let hitos = [];

let editingMovId = null;
let editingHitoId = null;
let pendingPhotoDataUrl = null;
let pendingPhotoSizeKb = 0;
let quickAttachMovId = null;

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

function setFormPhoto(dataUrl, sizeKb = 0) {
    pendingPhotoDataUrl = dataUrl || null;
    pendingPhotoSizeKb = sizeKb || (dataUrl ? Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024)) : 0);

    const previewBox = document.getElementById("photoPreviewBox");
    const previewImg = document.getElementById("photoPreviewImg");
    const previewMeta = document.getElementById("photoPreviewMeta");

    if (pendingPhotoDataUrl) {
        previewImg.src = pendingPhotoDataUrl;
        previewMeta.textContent = `Recibo listo · ~${pendingPhotoSizeKb} KB (comprimido)`;
        previewBox.classList.remove("hidden");
    } else {
        previewImg.removeAttribute("src");
        previewMeta.textContent = "";
        previewBox.classList.add("hidden");
        const input = document.getElementById("fotoInput");
        if (input) input.value = "";
    }
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
    document.getElementById("referencia").value = mov.referencia || "";
    document.getElementById("nota").value = mov.nota || "";
    setFormPhoto(mov.fotoSoporte || null);

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

function renderHitos() {
    const ul = document.getElementById("hitosLista");
    const filtro = document.getElementById("filtroHitoEstado").value;
    const visibles = hitos.filter((h) => filtro === "ALL" || h.estado === filtro);

    ul.innerHTML = visibles.map((h) => `
        <div class="item-row">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span class="mono" style="font-size:0.78rem; font-weight:700; color:var(--accent-hover);">${escapeHtml(h.frente)}</span>
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
                    <button type="button" data-edit-hito="${escapeHtml(h.id)}" class="btn btn-ghost btn-sm btn-edit-hito">Editar</button>
                    <button type="button" data-del-hito="${escapeHtml(h.id)}" class="btn-danger-link btn-del-hito">Borrar</button>
                </div>
            </div>
            <p class="item-title" style="font-weight:500;">${escapeHtml(h.paso)}</p>
            ${h.nota ? `<p class="item-note">${escapeHtml(h.nota)}</p>` : ""}
        </div>
    `).join("") || `<div class="empty-state">No hay hitos para mostrar.</div>`;

    const preview = document.getElementById("hoyHitosPreview");
    preview.innerHTML = hitos.slice(0, 4).map((h) => `
        <div class="item-row">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="mono" style="font-size:0.76rem; font-weight:700; color:var(--accent-hover);">${escapeHtml(h.frente)}</span>
                <span class="pill ${pillClassForHito(h.estado)}">${escapeHtml(h.estado)}</span>
            </div>
            <p class="item-title" style="font-size:0.86rem; font-weight:500;">${escapeHtml(h.paso)}</p>
            ${h.nota ? `<p class="item-note">${escapeHtml(h.nota)}</p>` : ""}
        </div>
    `).join("") || `<div class="empty-state">Sin hitos registrados aún.</div>`;
}

function renderHoyPendientes() {
    const box = document.getElementById("hoyPendientesLista");
    const pendientes = movimientos.filter((m) => !isIngreso(m.tipo) && m.estadoSoporte !== "CON_SOPORTE");

    if (!pendientes.length) {
        box.innerHTML = `<div class="empty-state ok">Todo al día: no tienes egresos pendientes de soporte ni observados.</div>`;
        return;
    }

    box.innerHTML = pendientes.map((m) => `
        <div class="item-row item-row-split">
            <div class="item-main">
                ${m.fotoSoporte
                    ? `<img src="${m.fotoSoporte}" alt="Soporte ${escapeHtml(m.id)}" data-view-photo="${escapeHtml(m.id)}" class="photo-thumb btn-view-photo" />`
                    : ""}
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
                        ${m.fotoSoporte ? "Cambiar foto" : "Adjuntar foto"}
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

    const filtrados = movimientos.filter((m) => {
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
                <div class="text-muted" style="font-size:0.76rem;">${escapeHtml(m.categoria)}</div>
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
                    ${m.fotoSoporte
                        ? `<img src="${m.fotoSoporte}" alt="Recibo ${escapeHtml(m.id)}" data-view-photo="${escapeHtml(m.id)}" class="photo-thumb-sm btn-view-photo" title="Ver foto de soporte" />`
                        : `<button type="button" data-attach-mov="${escapeHtml(m.id)}" class="btn btn-ghost btn-sm btn-attach-mov" title="Adjuntar foto">+ Foto</button>`}
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

    renderHoyPendientes();
    renderHitos();
}

// --- Report & Lightbox Modals ---
function openReport() {
    const t = computeTotals();
    const porCat = {};
    const pendItems = [];

    movimientos.forEach((m) => {
        if (isEgresoCaja(m.tipo)) {
            porCat[m.categoria] = (porCat[m.categoria] || 0) + (Number(m.montoUsd) || 0);
        }
        if (!isIngreso(m.tipo) && m.estadoSoporte !== "CON_SOPORTE") {
            pendItems.push(`- [${m.id}] ${m.categoria} (${m.codigoCc}): $${formatMoney(m.montoUsd)} (${m.estadoSoporte}) - ${m.nota || "Sin nota"}`);
        }
    });

    const catLines = Object.entries(porCat)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `- ${k}: $${formatMoney(v)}`)
        .join("\n") || "- Sin gastos ejecutados";

    const hitoLines = hitos.slice(0, 8).map((h) => {
        const notaTxt = h.nota ? `\n    Nota: ${h.nota}` : "";
        return `- [${h.frente}] ${h.estado} (${h.fecha}): ${h.paso}${notaTxt}`;
    }).join("\n") || "- Sin hitos recientes";

    const conFotoCount = movimientos.filter((m) => Boolean(m.fotoSoporte)).length;

    const txt = [
        `REPORTE HNA INGENIERÍA VZ — LECHERÍA / ANZOÁTEGUI`,
        `Fecha corte: ${getLocalDateStr()}`,
        ``,
        `1. POSICIÓN DE CAJA (USD EQUIVALENTE)`,
        `- Fondos / Aportes recibidos: $${formatMoney(t.fondos)}`,
        `- Ejecutado acumulado: $${formatMoney(t.ejecutado)} (CAPEX: $${formatMoney(t.capex)} | OPEX: $${formatMoney(t.opex)})`,
        `- Saldo disponible: $${formatMoney(t.saldo)}`,
        `- Pendiente de soporte: $${formatMoney(t.pendiente)} (${t.pendientesCount} mov.)`,
        `- Comprobantes con foto adjunta: ${conFotoCount} de ${movimientos.length}`,
        ``,
        `2. EJECUCIÓN POR CATEGORÍA`,
        catLines,
        ``,
        `3. SOPORTES PENDIENTES / OBSERVADOS`,
        pendItems.length ? pendItems.join("\n") : "- Todo al día con soporte.",
        ``,
        `4. HITOS DE SUCURSAL`,
        hitoLines
    ].join("\n");

    document.getElementById("reportText").value = txt;
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

    document.getElementById("lightboxTitle").textContent = `${mov.id} · ${mov.contraparte || mov.categoria}`;
    document.getElementById("lightboxMeta").textContent = `${mov.fecha} · $${formatMoney(mov.montoUsd)} USD · ${mov.estadoSoporte}`;
    document.getElementById("lightboxImg").src = mov.fotoSoporte;

    const dlBtn = document.getElementById("btnDownloadPhoto");
    dlBtn.href = mov.fotoSoporte;
    dlBtn.download = `${mov.id}-soporte.jpg`;

    document.getElementById("photoModal").classList.remove("hidden");
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

        movimientos = data.movimientos;
        hitos = data.hitos;
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
        "tasa", "montoUsd", "contraparte", "estadoSoporte", "referencia", "nota", "tieneFoto"
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

    document.getElementById("btnSelectPhoto").addEventListener("click", () => fotoInput.click());
    document.getElementById("btnRemovePhoto").addEventListener("click", () => setFormPhoto(null));
    document.getElementById("photoPreviewImg").addEventListener("click", () => {
        if (!pendingPhotoDataUrl) return;
        document.getElementById("lightboxTitle").textContent = "Vista previa de recibo";
        document.getElementById("lightboxMeta").textContent = `~${pendingPhotoSizeKb} KB (comprimido)`;
        document.getElementById("lightboxImg").src = pendingPhotoDataUrl;
        const dlBtn = document.getElementById("btnDownloadPhoto");
        dlBtn.href = pendingPhotoDataUrl;
        dlBtn.download = "recibo-soporte.jpg";
        document.getElementById("photoModal").classList.remove("hidden");
    });

    async function handleFormPhotoFile(file) {
        if (!file) return;
        try {
            const { dataUrl, sizeKb } = await compressImageFile(file);
            setFormPhoto(dataUrl, sizeKb);
            // If user had PENDIENTE_SOPORTE selected, suggest/switch to CON_SOPORTE
            const supSel = document.getElementById("estadoSoporte");
            if (supSel.value === "PENDIENTE_SOPORTE") {
                supSel.value = "CON_SOPORTE";
            }
            showToast(`Foto adjuntada (~${sizeKb} KB)`);
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

    // Quick attach photo from Hoy / Table
    document.getElementById("quickPhotoInput").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file || !quickAttachMovId) return;
        const mov = movimientos.find((m) => m.id === quickAttachMovId);
        quickAttachMovId = null;
        if (!mov) return;
        try {
            const { dataUrl, sizeKb } = await compressImageFile(file);
            mov.fotoSoporte = dataUrl;
            if (mov.estadoSoporte !== "CON_SOPORTE") {
                mov.estadoSoporte = "CON_SOPORTE";
            }
            await putItem("movimientos", mov);
            renderAll();
            showToast(`Recibo guardado en ${mov.id} (~${sizeKb} KB)`);
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
            referencia: document.getElementById("referencia").value.trim(),
            nota: document.getElementById("nota").value.trim(),
            fotoSoporte: pendingPhotoDataUrl || null
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

        cancelEditMov();
        renderAll();
    });

    // Submit Hito
    document.getElementById("hitoForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const hito = {
            id: editingHitoId || ("HITO-" + Date.now()),
            fecha: document.getElementById("hitoFecha").value || getLocalDateStr(),
            frente: document.getElementById("hitoFrente").value,
            estado: document.getElementById("hitoEstado").value,
            paso: document.getElementById("hitoPaso").value.trim(),
            nota: document.getElementById("hitoNota").value.trim()
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
        movimientos = (await getAll("movimientos")).reverse();
        hitos = (await getAll("hitos")).reverse();
    } catch (err) {
        console.error(err);
        showToast("Error al abrir la base de datos local");
    }

    renderAll();

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("./sw.js").catch(() => {});
        });
    }
})();
