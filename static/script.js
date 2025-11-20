/**
 * script.js (Versión 24.0 - Estructura Limpia y Correcciones Críticas)
 * -----------------------------------------------------------------------
 * ÍNDICE DE CONTENIDOS:
 * 1.  CONFIGURACIÓN Y VARIABLES GLOBALES
 * 2.  INICIALIZACIÓN (DOMContentLoaded)
 * 3.  GESTIÓN DE EVENTOS (Listeners)
 * 4.  AUTENTICACIÓN Y CARGA (Login/Upload)
 * 5.  VISTAS Y COLUMNAS (UI Principal)
 * 6.  TABULATOR (Configuración de Tabla y SORTER CORREGIDO)
 * 7.  FILTROS
 * 8.  MÓDULO: REGLAS DE PRIORIDAD (Reglas Avanzadas + Edición)
 * 9.  MÓDULO: EDICIÓN MASIVA Y FIND/REPLACE
 * 10. OPERACIONES DE DATOS (Filas, Deshacer, Guardar)
 * 11. EXPORTACIÓN Y AUDITORÍA
 * 12. UTILIDADES Y EXTRAS
 */

// ============================================================
// 1. CONFIGURACIÓN Y VARIABLES GLOBALES
// ============================================================

let i18n = {}; 
let currentFileId = null; 
let activeFilters = []; 
let tableData = [];
let currentData = [];
let todasLasColumnas = [];
let columnasVisibles = [];
let currentView = 'detailed'; // 'detailed' o 'grouped'
let undoHistoryCount = 0;
let autocompleteOptions = {};
let modalFindReplaceFilters = [];

// Configuración interna por defecto
let systemSettings = {
    enable_scf_intercompany: true,
    enable_age_sort: true
};

// Instancias de Tabulator
let tabulatorInstance = null;
let groupedTabulatorInstance = null; 

// Listas constantes
const COLUMNAS_AGRUPABLES = [
    "Vendor Name", "Status", "Assignee", 
    "Operating Unit Name", "Pay Status", "Document Type", 
    "_row_status", "_priority", 
    "Pay group", "WEC Email Inbox", "Sender Email", "Currency Code", "payment method"
];

// Palabras clave para detección automática de tipos (opcional para UI)
const KEYWORDS_NUMERICO = ['amount', 'monto', 'total', 'qty', 'price', 'balance'];
const KEYWORDS_FECHA = ['date', 'fecha', 'time', 'created', 'due'];

// ============================================================
// 2. INICIALIZACIÓN (ENTRY POINT)
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();
    try {
        // 1. Verificar sesión
        await checkLoginStatus(); 

        // 2. Restaurar estado si venimos de un reload/postback simulado
        if (typeof SESSION_DATA !== 'undefined' && SESSION_DATA.file_id) {
            currentFileId = SESSION_DATA.file_id;
            todasLasColumnas = SESSION_DATA.columnas;
            columnasVisibles = [...todasLasColumnas];
            if (SESSION_DATA.autocomplete_options) autocompleteOptions = SESSION_DATA.autocomplete_options;

            // Restaurar UI
            populateColumnDropdowns();
            renderColumnSelector();
            updateVisibleColumnsFromCheckboxes();
            updateFilterInputAutocomplete();

            undoHistoryCount = SESSION_DATA.history_count || 0;
            updateActionButtonsVisibility();
            refreshActiveView(); 
        } else {
            // Estado inicial limpio
            renderColumnSelector();
            undoHistoryCount = 0;
            updateActionButtonsVisibility();
        }
        
        // 3. Activar Listeners
        setupEventListeners(); 
    } catch (e) { 
        console.error("Error fatal al inicializar:", e); 
    }
});

// ============================================================
// 3. GESTIÓN DE EVENTOS (LISTENERS)
// ============================================================

function setupEventListeners() {
    // --- Elementos Base ---
    const fileUploader = document.getElementById('file-uploader');
    
    // --- Globales ---
    addSafeListener(document, 'keydown', handleGlobalKeydown);
    addSafeListener(fileUploader, 'change', handleFileUpload);
    addSafeListener(document.getElementById('btn-lang-es'), 'click', () => setLanguage('es'));
    addSafeListener(document.getElementById('btn-lang-en'), 'click', () => setLanguage('en'));
    addSafeListener(document.getElementById('btn-login-start'), 'click', handleLogin);

    // --- Control de Columnas ---
    addSafeListener(document.getElementById('column-selector-wrapper'), 'change', handleColumnVisibilityChange);
    addSafeListener(document.getElementById('btn-check-all-cols'), 'click', handleCheckAllColumns);
    addSafeListener(document.getElementById('btn-uncheck-all-cols'), 'click', handleUncheckAllColumns);

    // --- Vistas (Detallada vs Agrupada) ---
    addSafeListener(document.getElementById('btn-view-detailed'), 'click', () => toggleView('detailed'));
    addSafeListener(document.getElementById('btn-view-grouped'), 'click', () => toggleView('grouped'));
    addSafeListener(document.getElementById('select-columna-agrupar'), 'change', handleGroupColumnChange);
    
    // --- Guardar/Cargar Vista ---
    addSafeListener(document.getElementById('btn-save-view'), 'click', handleSaveView);
    addSafeListener(document.getElementById('input-load-view'), 'change', handleLoadView);

    // --- Filtros ---
    addSafeListener(document.getElementById('btn-add-filter'), 'click', handleAddFilter);
    addSafeListener(document.getElementById('btn-clear-filters'), 'click', handleClearFilters);
    addSafeListener(document.getElementById('btn-clear-filters-grouped'), 'click', handleClearFilters);
    addSafeListener(document.getElementById('input-search-table'), 'keyup', handleSearchTable);
    addSafeListener(document.getElementById('select-columna'), 'change', updateFilterInputAutocomplete);
    
    // Delegación de eventos para borrar filtros (chips dinámicos)
    const filtersList = document.getElementById('active-filters-list');
    if (filtersList) filtersList.addEventListener('click', handleRemoveFilter);
    const filtersListGrp = document.getElementById('active-filters-list-grouped');
    if (filtersListGrp) filtersListGrp.addEventListener('click', handleRemoveFilter);

    // --- MÓDULO: REGLAS DE PRIORIDAD ---
    addSafeListener(document.getElementById('btn-priority-rules'), 'click', openPriorityRulesModal);
    addSafeListener(document.getElementById('btn-rules-close'), 'click', closePriorityRulesModal);
    addSafeListener(document.getElementById('btn-add-rule'), 'click', handleAddRule);
    addSafeListener(document.getElementById('btn-save-settings'), 'click', handleSaveSettings);
    addSafeListener(document.getElementById('rule-column'), 'change', updateRuleValueAutocomplete);

    // --- MÓDULO: EDICIÓN MASIVA & FIND/REPLACE ---
    addSafeListener(document.getElementById('btn-bulk-edit'), 'click', () => openBulkEditModal('selection')); 
    addSafeListener(document.getElementById('btn-bulk-cancel'), 'click', closeBulkEditModal);
    addSafeListener(document.getElementById('btn-bulk-delete'), 'click', handleBulkDelete);
    
    addSafeListener(document.getElementById('btn-find-replace'), 'click', openFindReplaceModal);
    addSafeListener(document.getElementById('btn-fr-add-filter'), 'click', addModalFilter);
    addSafeListener(document.getElementById('btn-find-replace-cancel'), 'click', closeFindReplaceModal);
    addSafeListener(document.getElementById('btn-find-replace-apply'), 'click', handleFindReplaceApply);

    // --- Acciones de Datos (Filas/Undo/Commit) ---
    addSafeListener(document.getElementById('btn-add-row'), 'click', handleAddRow);
    addSafeListener(document.getElementById('btn-undo-change'), 'click', handleUndoChange);
    addSafeListener(document.getElementById('btn-commit-changes'), 'click', handleCommitChanges);

    // --- Exportación y UI ---
    addSafeListener(document.getElementById('btn-download-excel'), 'click', handleDownloadExcel);
    addSafeListener(document.getElementById('btn-download-excel-grouped'), 'click', handleDownloadExcelGrouped);
    addSafeListener(document.getElementById('btn-download-audit-log'), 'click', handleDownloadAuditLog);
    addSafeListener(document.getElementById('btn-fullscreen'), 'click', handleFullscreen);
    addSafeListener(document.getElementById('btn-fullscreen-grouped'), 'click', handleFullscreen);

    // --- Extras (Listas, Duplicados) ---
    addSafeListener(document.getElementById('btn-manage-lists'), 'click', openManageListsModal);
    addSafeListener(document.getElementById('btn-manage-cancel'), 'click', closeManageListsModal);
    addSafeListener(document.getElementById('btn-manage-save'), 'click', handleManageListsSave);
    addSafeListener(document.getElementById('manage-list-column'), 'change', updateManageListsCurrentValues);
    
    addSafeListener(document.getElementById('btn-show-duplicates'), 'click', handleShowDuplicates);
    addSafeListener(document.getElementById('btn-cleanup-duplicates'), 'click', handleCleanupDuplicates);

    // --- Configuración Drag & Drop ---
    setupDragAndDrop(fileUploader);
}

// Helper para evitar errores si el elemento no existe en el DOM
function addSafeListener(element, event, handler) {
    if (element) element.addEventListener(event, handler);
}

// ============================================================
// 4. AUTENTICACIÓN Y CARGA (LOGIN/UPLOAD)
// ============================================================

async function checkLoginStatus() {
    try {
        const response = await fetch('/api/check_session');
        const data = await response.json();
        if (!data.logged_in) {
            document.getElementById('modal-overlay').style.display = 'flex';
            document.getElementById('login-modal').style.display = 'flex';
        }
    } catch (e) {}
}

async function handleLogin() {
    const name = document.getElementById('login-name').value;
    const role = document.getElementById('login-role').value;
    if (!name || !role) { alert("Por favor completa ambos campos."); return; }
    
    await fetch('/api/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name, role })
    });
    
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
}

async function handleFileUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const formData = new FormData(); formData.append('file', file);
    
    document.getElementById('file-upload-list').innerHTML = `<div class="file-list-item">Cargando ${file.name}...</div>`;

    try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);

        // Limpiar tablas antiguas
        if (tabulatorInstance) { tabulatorInstance.destroy(); tabulatorInstance = null; }
        if (groupedTabulatorInstance) { groupedTabulatorInstance.destroy(); groupedTabulatorInstance = null; }
        
        // Cargar nuevos datos
        currentFileId = result.file_id;
        todasLasColumnas = result.columnas; 
        columnasVisibles = [...todasLasColumnas];
        autocompleteOptions = result.autocomplete_options || {};
        
        // Resetear UI
        populateColumnDropdowns(); 
        renderColumnSelector(); 
        updateVisibleColumnsFromCheckboxes();
        activeFilters = []; 
        undoHistoryCount = 0; 
        
        updateActionButtonsVisibility(); 
        toggleView('detailed', true);

        document.getElementById('file-upload-list').innerHTML = `
            <div class="file-list-item">
                <div class="file-details"><span class="file-name">${file.name}</span></div>
            </div>`;    

    } catch (error) { 
        document.getElementById('file-upload-list').innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
    }
}

// ============================================================
// 5. VISTAS Y COLUMNAS (UI PRINCIPAL)
// ============================================================

function toggleView(view, force = false) {
    if (view === currentView && !force) return; 
    currentView = view;
    
    const detContainer = document.getElementById('view-container-detailed');
    const grpContainer = document.getElementById('view-container-grouped');
    const btnDet = document.getElementById('btn-view-detailed');
    const btnGrp = document.getElementById('btn-view-grouped');
    const grpControls = document.getElementById('group-by-controls-wrapper');

    if (view === 'detailed') {
        detContainer.style.display = 'flex'; grpContainer.style.display = 'none';
        btnDet.classList.add('active'); btnGrp.classList.remove('active');
        grpControls.style.display = 'none';
        refreshActiveView();
    } else { 
        detContainer.style.display = 'none'; grpContainer.style.display = 'flex';
        btnDet.classList.remove('active'); btnGrp.classList.add('active');
        grpControls.style.display = 'flex';
        
        // Auto-seleccionar primera opción si está vacío
        const select = document.getElementById('select-columna-agrupar');
        if (select && !select.value && select.options.length > 1) {
            select.value = select.options[1].value;
        }
        refreshActiveView();
    }
    updateActionButtonsVisibility();
}

async function refreshActiveView() {
    if (currentView === 'detailed') {
        await getFilteredData(); 
    } else if (currentView === 'grouped') {
        await getGroupedData();
    }
}

function populateColumnDropdowns() {
    // Dropdown Filtros
    const colSelect = document.getElementById('select-columna');
    colSelect.innerHTML = '<option value="">Seleccione columna...</option>';
    todasLasColumnas.forEach(col => {
        if(col === 'Priority') return;
        const opt = document.createElement('option'); opt.value = col; opt.textContent = col;
        colSelect.appendChild(opt);
    });

    // Dropdown Agrupar
    const grpSelect = document.getElementById('select-columna-agrupar');
    grpSelect.innerHTML = '<option value="">Agrupar por...</option>';
    COLUMNAS_AGRUPABLES.filter(c => todasLasColumnas.includes(c)).forEach(c => {
        const opt = document.createElement('option'); opt.value = c; opt.textContent = c; grpSelect.appendChild(opt);
    });
}

function renderColumnSelector() {
    const w = document.getElementById('column-selector-wrapper');
    if (!w) return; w.innerHTML = '';
    todasLasColumnas.filter(c => !c.startsWith('_') && c !== 'Priority').forEach(c => {
        const div = document.createElement('div');
        div.className = 'column-selector-item';
        div.innerHTML = `<label><input type="checkbox" value="${c}" ${columnasVisibles.includes(c)?'checked':''}> ${c}</label>`;
        w.appendChild(div);
    });
}

function handleColumnVisibilityChange() { updateVisibleColumnsFromCheckboxes(); }
function handleCheckAllColumns() { setAllColumns(true); }
function handleUncheckAllColumns() { setAllColumns(false); }

function setAllColumns(checked) {
    document.querySelectorAll('#column-selector-wrapper input').forEach(cb => cb.checked = checked);
    updateVisibleColumnsFromCheckboxes();
}

function updateVisibleColumnsFromCheckboxes() {
    columnasVisibles = Array.from(document.querySelectorAll('#column-selector-wrapper input:checked')).map(cb => cb.value);
    if(todasLasColumnas.includes('_row_id')) columnasVisibles.unshift('_row_id');
    if(todasLasColumnas.includes('_priority')) columnasVisibles.unshift('_priority');
    renderTable();
}

// ============================================================
// 6. TABULATOR (TABLA Y SORTER CORREGIDO)
// ============================================================

function renderTable(data = null) {
    const div = document.getElementById('results-table');
    if (!div) return;
    const renderData = data || tableData;
    
    if (!currentFileId) { div.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; return; }

    // Definición de Columnas
    const cols = [
        { formatter: "rowSelection", titleFormatter: "rowSelection", width: 40, hozAlign: "center", frozen: true },
        {
            title: "", width: 40, hozAlign: "center", frozen: true,
            formatter: () => '<i class="fas fa-trash-alt delete-icon"></i>',
            cellClick: (e, c) => { if(confirm("¿Eliminar?")) handleDeleteRow(c.getRow().getData()._row_id); }
        },
        { title: "N°", field: "_row_id", width: 60, frozen: true, formatter: c => c.getValue() + 1 },
        {
            title: "Prioridad", field: "_priority", width: 120, headerSort: true, frozen: true,
            tooltip: (e, c) => c.getRow().getData()._priority_reason || "Sin razón",
            formatter: c => {
                const v = c.getValue();
                const color = v==="Alta"?"#e53e3e": v==="Media"?"#dd6b20": v==="Baja"?"#38a169":"gray";
                return `<span style="color:${color}; font-weight:bold;">${v}</span>`;
            },
            // --- SORTER BLINDADO (Fix: Ordena por importancia, no alfabeto) ---
            sorter: function(a, b, aRow, bRow, column, dir, sorterParams){
                // 1. Normalizar: Quitar espacios y minúsculas
                const valA = String(a || "").trim().toLowerCase();
                const valB = String(b || "").trim().toLowerCase();
                
                // 2. Mapa numérico de importancia
                const map = { "alta": 3, "media": 2, "baja": 1 };
                
                // 3. Calcular diferencia
                const scoreA = map[valA] || 0;
                const scoreB = map[valB] || 0;
                
                const diff = scoreA - scoreB;
                
                // 4. Desempate por antigüedad (si aplica)
                if (diff === 0 && systemSettings.enable_age_sort) {
                    const ageA = Number(aRow.getData()['Invoice Date Age']) || 0;
                    const ageB = Number(bRow.getData()['Invoice Date Age']) || 0;
                    return ageA - ageB;
                }
                return diff;
            }
        }
    ];

    // Columnas dinámicas
    columnasVisibles.forEach(c => {
        if (['_row_id', '_priority', 'Priority', '_row_status'].includes(c)) return;
        let editor = "input", params = {};
        
        // Autocompletar si hay lista
        if (autocompleteOptions[c]) {
             editor = "autocomplete";
             params = { values: autocompleteOptions[c], showListOnEmpty: true, freetext: true };
        }
        cols.push({ title: c, field: c, editor: editor, editorParams: params, minWidth: 130 });
    });

    if (tabulatorInstance) {
        tabulatorInstance.setColumns(cols);
        tabulatorInstance.setData(renderData);
    } else {
        tabulatorInstance = new Tabulator(div, {
            data: renderData, columns: cols, layout: "fitData",
            selectableRows: true, index: "_row_id",
            rowFormatter: row => {
                const el = row.getElement();
                const p = row.getData()._priority;
                el.classList.remove('priority-alta', 'priority-media', 'priority-baja');
                if (p) el.classList.add(`priority-${p.toLowerCase()}`);
            }
        });
        
        tabulatorInstance.on("cellEdited", handleCellEdited);
        tabulatorInstance.on("rowSelectionChanged", handleSelectionChange);
    }
}

async function handleCellEdited(cell) {
    const val = cell.getValue();
    const old = cell.getOldValue();
    if (val === old) return;
    
    try {
        const res = await fetch('/api/update_cell', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                file_id: currentFileId, row_id: cell.getRow().getData()._row_id, 
                columna: cell.getField(), valor: val
            })
        });
        const json = await res.json();
        
        if (json.new_priority) cell.getRow().update({_priority: json.new_priority});
        undoHistoryCount = json.history_count;
        updateActionButtonsVisibility();
        if(json.resumen) updateResumenCard(json.resumen);
    } catch (e) { console.error(e); cell.restoreOldValue(); }
}

function handleSelectionChange(data, rows) {
    const btnEdit = document.getElementById('btn-bulk-edit');
    const btnDel = document.getElementById('btn-bulk-delete');
    if (rows.length > 0) {
        btnEdit.style.display = 'inline-block'; btnEdit.textContent = `Editar (${rows.length})`;
        btnDel.style.display = 'inline-block'; btnDel.textContent = `Eliminar (${rows.length})`;
    } else {
        btnEdit.style.display = 'none'; btnDel.style.display = 'none';
    }
}

function renderGroupedTable(data, colAgrupada) {
    const div = document.getElementById('results-table-grouped');
    if (!div) return;
    
    if (!data || data.length === 0) {
        div.innerHTML = `<p>Seleccione una columna para agrupar.</p>`;
        if (groupedTabulatorInstance) { groupedTabulatorInstance.destroy(); groupedTabulatorInstance = null; }
        return;
    }

    const cols = [
        { title: colAgrupada, field: colAgrupada, minWidth: 150 },
        { title: "Monto Total", field: "Total_sum", formatter: "money", formatterParams: {symbol:"$"}, hozAlign:"right" },
        { title: "Promedio", field: "Total_mean", formatter: "money", formatterParams: {symbol:"$"}, hozAlign:"right" },
        { title: "Conteo", field: "Total_count", hozAlign:"center" }
    ];

    if (groupedTabulatorInstance) groupedTabulatorInstance.destroy();
    groupedTabulatorInstance = new Tabulator(div, { data: data, columns: cols, layout: "fitData" });
}

// ============================================================
// 7. SISTEMA DE FILTROS
// ============================================================

async function handleAddFilter() {
    const col = document.getElementById('select-columna').value;
    const val = document.getElementById('input-valor').value;
    if (col && val) { 
        activeFilters.push({ columna: col, operador: 'contains', valor: val }); 
        document.getElementById('input-valor').value = ''; 
        await refreshActiveView();
    } else { alert("Selecciona columna y valor."); }
}

async function handleClearFilters() { 
    activeFilters = []; await refreshActiveView(); 
}

async function handleRemoveFilter(e) {
    if (!e.target.classList.contains('remove-filter-btn')) return;
    activeFilters.splice(e.target.dataset.index, 1);
    await refreshActiveView();
}

function updateFilterInputAutocomplete() {
    const col = document.getElementById('select-columna').value;
    const list = document.getElementById('input-valor-list');
    list.innerHTML = '';
    if (autocompleteOptions[col]) {
        autocompleteOptions[col].forEach(v => {
            const o = document.createElement('option'); o.value = v; list.appendChild(o);
        });
    }
}

function handleSearchTable() {
    const term = document.getElementById('input-search-table').value.toLowerCase();
    if (tabulatorInstance) {
        if (!term) tabulatorInstance.clearFilter();
        else tabulatorInstance.setFilter(data => {
            return columnasVisibles.some(c => String(data[c]||"").toLowerCase().includes(term));
        });
    }
}

async function getFilteredData() {
    if (!currentFileId) return;
    const res = await fetch('/api/filter', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters })
    });
    const json = await res.json();
    currentData = json.data; tableData = [...currentData];
    renderFilters();
    renderTable(json.data);
    if(json.resumen) updateResumenCard(json.resumen);
}

async function getGroupedData() {
    const col = document.getElementById('select-columna-agrupar').value;
    if (!currentFileId || !col) return;
    
    const res = await fetch('/api/group_by', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columna_agrupar: col })
    });
    const json = await res.json();
    renderGroupedTable(json.data, col);
    renderFilters();
}

function renderFilters() {
    const div = document.getElementById(currentView === 'detailed' ? 'active-filters-list' : 'active-filters-list-grouped');
    div.innerHTML = '';
    activeFilters.forEach((f, i) => {
        const chip = document.createElement('div');
        chip.className = 'filtro-chip';
        chip.innerHTML = `<span>${f.columna}: <strong>${f.valor}</strong></span> <button class="remove-filter-btn" data-index="${i}">&times;</button>`;
        div.appendChild(chip);
    });
    const btnClear = document.getElementById(currentView === 'detailed' ? 'btn-clear-filters' : 'btn-clear-filters-grouped');
    btnClear.style.display = activeFilters.length ? 'inline-block' : 'none';
}

// ============================================================
// 8. MÓDULO: REGLAS DE PRIORIDAD (LÓGICA AVANZADA)
// ============================================================

function updateRuleValueAutocomplete() {
    const col = document.getElementById('rule-column').value;
    const dl = document.getElementById('rule-value-datalist');
    if (dl) dl.innerHTML = '';
    if (dl && autocompleteOptions[col]) {
        autocompleteOptions[col].forEach(v => {
            const opt = document.createElement('option'); opt.value = v; dl.appendChild(opt);
        });
    }
}

function resetAddRuleForm() {
    const els = ['rule-column','rule-operator','rule-value','rule-priority','rule-reason'];
    els.forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = (id==='rule-operator'?'equals':(id==='rule-priority'?'Media':'')); });
}

async function openPriorityRulesModal() {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('priority-rules-modal').style.display = 'flex';

    // 1. Llenar columnas (defensivo: solo si existen datos)
    const sel = document.getElementById('rule-column');
    if(sel) {
        sel.innerHTML = '<option value="">Columna...</option>';
        todasLasColumnas.forEach(c => {
            if(!c.startsWith('_') && c !== 'Priority') {
                const opt = document.createElement('option'); opt.value = c; opt.textContent = c; sel.appendChild(opt);
            }
        });
    }

    // 2. Inyectar Operadores (Soporte numérico)
    const opSel = document.getElementById('rule-operator');
    if (opSel && opSel.options.length === 0) {
        opSel.innerHTML = `
            <option value="equals">Igual a (=)</option>
            <option value="contains">Contiene</option>
            <option value="not_equals">Diferente de (!=)</option>
            <option disabled>--- Numéricos ---</option>
            <option value="greater">Mayor que (>)</option>
            <option value="less">Menor que (<)</option>
            <option value="greater_eq">Mayor o igual (>=)</option>
            <option value="less_eq">Menor o igual (<=)</option>
        `;
    }

    await refreshRulesList();
}

function closePriorityRulesModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('priority-rules-modal').style.display = 'none';
    resetAddRuleForm();
}

async function refreshRulesList() {
    const container = document.getElementById('rules-list-container');
    if(container) container.innerHTML = '<em>Cargando...</em>';
    try {
        const res = await fetch('/api/priority_rules/get');
        const data = await res.json();
        renderRulesList(data.rules);
        
        // Settings Globales
        if (data.settings) {
            const scf = document.getElementById('setting-scf');
            const age = document.getElementById('setting-age-sort');
            if(scf) scf.checked = data.settings.enable_scf_intercompany;
            if(age) age.checked = data.settings.enable_age_sort;
        }
    } catch (e) { if(container) container.innerHTML = 'Error al cargar reglas.'; }
}

function renderRulesList(rules) {
    const container = document.getElementById('rules-list-container');
    if(!container) return;
    container.innerHTML = '';
    if (!rules || rules.length === 0) { container.innerHTML = '<em>No hay reglas definidas.</em>'; return; }

    rules.forEach(rule => {
        const div = document.createElement('div');
        div.className = 'rule-item';
        const opMap = { 'equals': '=', 'contains': 'contiene', 'greater': '>', 'less': '<', 'greater_eq': '>=', 'less_eq': '<=', 'not_equals': '!=' };
        const opText = opMap[rule.operator] || rule.operator;

        div.innerHTML = `
            <div style="display:flex; flex-direction:column; flex-grow:1; font-size:0.9rem;">
                <div>
                    <input type="checkbox" class="toggle-active" ${rule.active ? 'checked' : ''}>
                    <strong>${rule.column}</strong> ${opText} <strong>"${rule.value}"</strong>
                    &rarr; <b>${rule.priority}</b>
                </div>
                <small style="color:#666; margin-left: 20px;">Motivo: <em>${rule.reason || "N/A"}</em></small>
            </div>
            <div style="display:flex; gap:5px;">
                <button class="btn-edit-rule btn-azul-secundario" title="Editar"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn-del-rule btn-rojo-secundario" title="Eliminar"><i class="fas fa-trash"></i></button>
            </div>
        `;
        
        div.querySelector('.toggle-active').onchange = (e) => toggleRule(rule, e.target.checked);
        div.querySelector('.btn-del-rule').onclick = () => deleteRule(rule);
        div.querySelector('.btn-edit-rule').onclick = () => handleEditRule(rule);
        
        container.appendChild(div);
    });
}

async function handleAddRule() {
    const col = document.getElementById('rule-column').value;
    const op = document.getElementById('rule-operator').value;
    const val = document.getElementById('rule-value').value;
    const prio = document.getElementById('rule-priority').value;
    const reason = document.getElementById('rule-reason').value;

    if (!col || !val) { alert("Falta columna o valor."); return; }

    await fetch('/api/priority_rules/save', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ column: col, operator: op, value: val, priority: prio, reason: reason, active: true })
    });
    
    resetAddRuleForm();
    await refreshRulesList();
    if(currentFileId) await getFilteredData(); 
}

// --- EDICIÓN DE REGLA (Carga datos + borra antigua) ---
async function handleEditRule(rule) {
    // Rellenar formulario
    document.getElementById('rule-column').value = rule.column;
    updateRuleValueAutocomplete();
    document.getElementById('rule-operator').value = rule.operator || 'equals';
    document.getElementById('rule-value').value = rule.value;
    document.getElementById('rule-priority').value = rule.priority;
    document.getElementById('rule-reason').value = rule.reason || "";
    
    // Eliminar antigua silenciosamente para "actualizar" al guardar
    await fetch('/api/priority_rules/delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ column: rule.column, value: rule.value, operator: rule.operator })
    });
    
    await refreshRulesList();
    const modalTitle = document.querySelector('#priority-rules-modal h4');
    if(modalTitle) modalTitle.scrollIntoView({ behavior: 'smooth' });
    alert("Regla cargada para edición. Modifícala y haz clic en 'Guardar Regla'.");
}

async function deleteRule(rule) {
    if(!confirm("¿Eliminar regla?")) return;
    await fetch('/api/priority_rules/delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ column: rule.column, value: rule.value, operator: rule.operator })
    });
    await refreshRulesList();
    if(currentFileId) await getFilteredData();
}

async function toggleRule(rule, active) {
    await fetch('/api/priority_rules/toggle', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ column: rule.column, value: rule.value, operator: rule.operator, active: active })
    });
    if(currentFileId) await getFilteredData();
}

async function handleSaveSettings() {
    const scf = document.getElementById('setting-scf').checked;
    const age = document.getElementById('setting-age-sort').checked;
    await fetch('/api/priority_rules/save_settings', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ enable_scf_intercompany: scf, enable_age_sort: age })
    });
    alert("Configuración guardada.");
    if(currentFileId) await getFilteredData();
}

// ============================================================
// 9. MÓDULO: EDICIÓN MASIVA Y BUSCAR/REEMPLAZAR
// ============================================================

function openBulkEditModal(mode = 'selection') {
    const count = mode === 'selection' 
        ? tabulatorInstance.getSelectedData().length 
        : tabulatorInstance.getDataCount("active");
        
    if (count === 0) return alert("No hay filas objetivo.");

    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('bulk-edit-modal').style.display = 'flex';
    document.getElementById('bulk-edit-count').textContent = `Afectará a ${count} filas (${mode}).`;
    
    const btn = document.getElementById('btn-bulk-apply');
    btn.onclick = () => handleBulkUpdateApply(mode);
    
    // Llenar columnas
    const sel = document.getElementById('bulk-edit-column');
    sel.innerHTML = '<option value="">Columna...</option>';
    todasLasColumnas.forEach(c => {
        if(!c.startsWith('_')) sel.innerHTML += `<option value="${c}">${c}</option>`;
    });
}

async function handleBulkUpdateApply(mode) {
    const col = document.getElementById('bulk-edit-column').value;
    const val = document.getElementById('bulk-edit-value').value;
    if(!col) return alert("Selecciona columna.");
    
    if(!confirm("¿Aplicar cambios masivos?")) return;

    const body = { file_id: currentFileId, column: col, new_value: val };
    let endpoint = '/api/bulk_update';
    
    if (mode === 'selection') {
        body.row_ids = tabulatorInstance.getSelectedData().map(r => r._row_id);
    } else {
        endpoint = '/api/bulk_update_filtered';
        body.filtros_activos = activeFilters;
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        const json = await res.json();
        undoHistoryCount = json.history_count;
        updateActionButtonsVisibility();
        alert(json.message);
        closeBulkEditModal();
        if(mode==='selection') tabulatorInstance.deselectRow();
        await getFilteredData();
    } catch (e) { alert(e.message); }
}

function closeBulkEditModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('bulk-edit-modal').style.display = 'none';
}

// --- Find & Replace ---
function openFindReplaceModal() {
    modalFindReplaceFilters = [];
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('find-replace-modal').style.display = 'flex';
    
    const fillCols = (id) => {
        const el = document.getElementById(id);
        if(el) {
            el.innerHTML = '<option value="">Columna...</option>';
            todasLasColumnas.forEach(c => {
                if(!c.startsWith('_')) el.innerHTML += `<option value="${c}">${c}</option>`;
            });
        }
    };
    fillCols('fr-filter-column');
    fillCols('find-replace-column');
    renderModalFilters();
}

function addModalFilter() {
    const c = document.getElementById('fr-filter-column').value;
    const o = document.getElementById('fr-filter-operator').value;
    const v = document.getElementById('fr-filter-value').value;
    if(c && v) {
        modalFindReplaceFilters.push({ columna: c, operador: o, valor: v });
        renderModalFilters();
        document.getElementById('fr-filter-value').value = '';
    }
}

function renderModalFilters() {
    const div = document.getElementById('fr-active-filters');
    if(!div) return;
    div.innerHTML = '';
    modalFindReplaceFilters.forEach((f, i) => {
        div.innerHTML += `<span class="filtro-chip">${f.columna} ${f.operador} "${f.valor}" <b onclick="modalFindReplaceFilters.splice(${i},1);renderModalFilters()" style="cursor:pointer">&times;</b></span>`;
    });
}

function closeFindReplaceModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('find-replace-modal').style.display = 'none';
}

async function handleFindReplaceApply() {
    const col = document.getElementById('find-replace-column').value;
    const find = document.getElementById('find-replace-find-text').value;
    const repl = document.getElementById('find-replace-replace-text').value;
    
    if(!col || !find) return alert("Faltan datos.");
    if(modalFindReplaceFilters.length === 0 && !confirm("¿Aplicar a TODO sin filtros?")) return;
    
    const res = await fetch('/api/find_replace_custom_filter', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            file_id: currentFileId, filtros_target: modalFindReplaceFilters,
            columna: col, find_text: find, replace_text: repl
        })
    });
    const json = await res.json();
    undoHistoryCount = json.history_count;
    updateActionButtonsVisibility();
    alert(json.message);
    closeFindReplaceModal();
    await getFilteredData();
}

// ============================================================
// 10. OPERACIONES DE DATOS (FILAS, DESHACER, COMMIT)
// ============================================================

async function handleAddRow() {
    if(!currentFileId) return;
    const res = await fetch('/api/add_row', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId })
    });
    const json = await res.json();
    undoHistoryCount = json.history_count;
    updateActionButtonsVisibility();
    await getFilteredData();
}

async function handleDeleteRow(row_id) {
    const res = await fetch('/api/delete_row', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId, row_id: row_id })
    });
    const json = await res.json();
    undoHistoryCount = json.history_count;
    updateActionButtonsVisibility();
    await getFilteredData();
}

async function handleBulkDelete() {
    const ids = tabulatorInstance.getSelectedData().map(r => r._row_id);
    if(ids.length === 0) return alert("Selecciona filas.");
    if(!confirm(`¿Eliminar ${ids.length} filas?`)) return;
    
    const res = await fetch('/api/bulk_delete_rows', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId, row_ids: ids })
    });
    const json = await res.json();
    undoHistoryCount = json.history_count;
    updateActionButtonsVisibility();
    tabulatorInstance.deselectRow();
    await getFilteredData();
}

async function handleUndoChange() {
    if(!undoHistoryCount) return;
    const res = await fetch('/api/undo_change', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId })
    });
    const json = await res.json();
    undoHistoryCount = json.history_count;
    updateActionButtonsVisibility();
    await getFilteredData();
}

async function handleCommitChanges() {
    if(!confirm("¿Consolidar cambios (borrar historial deshacer)?")) return;
    await fetch('/api/commit_changes', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId })
    });
    undoHistoryCount = 0;
    updateActionButtonsVisibility();
}

// ============================================================
// 11. EXPORTACIÓN Y AUDITORÍA
// ============================================================

async function handleDownloadExcel() {
    if (!currentFileId) return;
    const res = await fetch('/api/download_excel', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columnas_visibles: columnasVisibles })
    });
    downloadBlob(res, 'datos_filtrados.xlsx');
}

async function handleDownloadExcelGrouped() {
    const col = document.getElementById('select-columna-agrupar').value;
    if (!currentFileId || !col) return alert("Agrupa primero.");
    const res = await fetch('/api/download_excel_grouped', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columna_agrupar: col })
    });
    downloadBlob(res, `agrupado_${col}.xlsx`);
}

async function handleDownloadAuditLog() {
    if (!currentFileId) return alert("No hay archivo.");
    const res = await fetch('/api/download_audit_log', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId })
    });
    downloadBlob(res, 'audit_log.txt');
}

async function downloadBlob(res, name) {
    if(res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    } else alert("Error en descarga.");
}

// ============================================================
// 12. UTILIDADES Y EXTRAS
// ============================================================

function updateResumenCard(data) {
    if(document.getElementById('resumen-total-facturas'))
        document.getElementById('resumen-total-facturas').textContent = data.total_facturas;
    if(document.getElementById('resumen-monto-total'))
        document.getElementById('resumen-monto-total').textContent = data.monto_total;
    if(document.getElementById('resumen-monto-promedio'))
        document.getElementById('resumen-monto-promedio').textContent = data.monto_promedio;
}

function resetResumenCard() {
    updateResumenCard({total_facturas:'0', monto_total:'$0.00', monto_promedio:'$0.00'});
}

function updateActionButtonsVisibility() {
    const show = (currentFileId && currentView === 'detailed');
    const els = ['btn-add-row', 'btn-download-audit-log', 'btn-find-replace'];
    els.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = show ? 'inline-block' : 'none';
    });
    
    const undo = document.getElementById('btn-undo-change');
    const commit = document.getElementById('btn-commit-changes');
    if (undo) { undo.style.display = (undoHistoryCount > 0) ? 'inline-block' : 'none'; undo.textContent = `Deshacer (${undoHistoryCount})`; }
    if (commit) commit.style.display = (undoHistoryCount > 0) ? 'inline-block' : 'none';
}

// Duplicados
async function handleShowDuplicates() {
    const res = await fetch('/api/get_duplicate_invoices', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId })
    });
    const json = await res.json();
    if(json.num_filas > 0) { alert(`${json.num_filas} duplicados.`); renderTable(json.data); activeFilters=[]; renderFilters(); }
    else alert("Sin duplicados.");
}

async function handleCleanupDuplicates() {
    if(!confirm("¿Borrar duplicados?")) return;
    const res = await fetch('/api/cleanup_duplicate_invoices', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ file_id: currentFileId })
    });
    const json = await res.json();
    alert(json.message);
    undoHistoryCount = json.history_count; updateActionButtonsVisibility(); await getFilteredData();
}

// Listas
function openManageListsModal() {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('manage-lists-modal').style.display = 'flex';
    const sel = document.getElementById('manage-list-column');
    sel.innerHTML = '<option>Columna...</option>';
    Object.keys(autocompleteOptions).sort().forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`);
}

function closeManageListsModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('manage-lists-modal').style.display = 'none';
}

function updateManageListsCurrentValues() {
    const c = document.getElementById('manage-list-column').value;
    const div = document.getElementById('current-list-values');
    div.innerHTML = (autocompleteOptions[c]||[]).join(', ') || 'Vacía';
}

async function handleManageListsSave() {
    const c = document.getElementById('manage-list-column').value;
    const val = document.getElementById('manage-list-input').value;
    if(!c || !val) return;
    
    const current = new Set(autocompleteOptions[c] || []);
    val.split(',').map(s=>s.trim()).forEach(s => {
        if(s.startsWith('-')) current.delete(s.substring(1));
        else if(s) current.add(s);
    });
    autocompleteOptions[c] = Array.from(current).sort();
    
    await fetch('/api/save_autocomplete_lists', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(autocompleteOptions)
    });
    alert("Guardado."); closeManageListsModal();
}

// Global Keydown
function handleGlobalKeydown(e) {
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
    if(e.key === 'f') document.getElementById('input-search-table').focus();
    if(e.key === 'z') handleUndoChange();
    if(e.key === 's') handleCommitChanges();
}

function handleSaveView() {
    const blob = new Blob([JSON.stringify({viewType: currentView, activeFilters, visibleColumns: columnasVisibles})], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vista.json'; a.click();
}

function handleLoadView(e) {
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
        const c = JSON.parse(ev.target.result);
        activeFilters = c.activeFilters; columnasVisibles = c.visibleColumns;
        toggleView(c.viewType, true);
    };
    r.readAsText(f);
}

function handleFullscreen() {
    document.body.classList.toggle('fullscreen-mode');
    if(tabulatorInstance) tabulatorInstance.redraw();
}

function setupDragAndDrop(uploader) {
    const area = document.querySelector('.drag-drop-area');
    if(area && uploader) {
        area.ondragover = (e) => { e.preventDefault(); area.classList.add('dragging'); };
        area.ondragleave = () => area.classList.remove('dragging');
        area.ondrop = (e) => { 
            e.preventDefault(); 
            area.classList.remove('dragging');
            uploader.files = e.dataTransfer.files; 
            handleFileUpload({target: {files: e.dataTransfer.files}}); 
        };
    }
}

// Translations Helper
async function loadTranslations() {
    try { i18n = await (await fetch('/api/get_translations')).json(); } catch(e){}
}