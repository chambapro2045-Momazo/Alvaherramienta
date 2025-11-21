/**
 * ============================================================================
 * SCRIPT.JS - CONTROLADOR PRINCIPAL DEL CLIENTE
 * ============================================================================
 * VERSIÓN: 7.0 (Vistas Inteligentes: Incluyen Reglas de Negocio)
 */

// ============================================================================
// 1. VARIABLES GLOBALES & CONFIGURACIÓN
// ============================================================================

// Estado de la Aplicación
let currentFileId = null;
let currentData = [];
let tableData = [];
let undoHistoryCount = 0;
let currentView = 'detailed'; // 'detailed' | 'grouped'

// Configuración de Columnas
let todasLasColumnas = [];
let columnasVisibles = [];
const COLUMNAS_AGRUPABLES = [
    "Vendor Name", "Status", "Assignee", 
    "Operating Unit Name", "Pay Status", "Document Type", 
    "_row_status", "_priority", 
    "Pay group", "WEC Email Inbox", "Sender Email", "Currency Code", "payment method"
];

// Instancias de Tabulator
let tabulatorInstance = null;
let groupedTabulatorInstance = null;

// Datos Auxiliares
let i18n = {}; 
let activeFilters = []; 
let autocompleteOptions = {};
let systemSettings = {
    enable_scf_intercompany: true,
    enable_age_sort: true
};

// ============================================================================
// 2. SERVICIOS UI & UTILIDADES
// ============================================================================

/** Carga traducciones del servidor */
async function loadTranslations() {
    try {
        const response = await fetch('/api/get_translations');
        if (!response.ok) throw new Error('Error de red');
        i18n = await response.json();
    } catch (error) { 
        console.error('Error cargando traducciones:', error); 
        i18n = {}; 
    }
    updateDynamicText();
}

/** Cambia el idioma y recarga */
async function setLanguage(langCode) {
    try { 
        await fetch(`/api/set_language/${langCode}`); 
        location.reload();
    } catch (error) { console.error('Error cambio idioma:', error); }
}

/** Actualiza textos dinámicos (placeholders, mensajes vacíos) */
function updateDynamicText() {
    const valInput = document.getElementById('input-valor');
    const searchTableInput = document.getElementById('input-search-table');
    const resultsTableDiv = document.getElementById('results-table');
    const resultsTableGrouped = document.getElementById('results-table-grouped');

    if (valInput) valInput.placeholder = i18n['search_text'] || "Texto a buscar...";
    if (searchTableInput) searchTableInput.placeholder = (i18n['search_text'] || "Buscar...") + "... (Hotkey: F)";
    
    const emptyMsg = `<p>${i18n['info_upload'] || 'Upload file'}</p>`;
    if (resultsTableDiv && !tabulatorInstance && !currentFileId) resultsTableDiv.innerHTML = emptyMsg;
    if (resultsTableGrouped && !groupedTabulatorInstance && !currentFileId) resultsTableGrouped.innerHTML = emptyMsg;
}

/** Actualiza la tarjeta de KPIs (Resumen) */
function updateResumenCard(resumen_data) {
    if (!resumen_data) return; 
    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setTxt('resumen-total-facturas', resumen_data.total_facturas);
    setTxt('resumen-monto-total', resumen_data.monto_total);
    setTxt('resumen-monto-promedio', resumen_data.monto_promedio);
}

function resetResumenCard() {
    updateResumenCard({ total_facturas: '0', monto_total: '$0.00', monto_promedio: '$0.00' });
}

/** Renderiza selectores de columnas y autocompletado */
function renderColumnSelector() {
    const wrapper = document.getElementById('column-selector-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = ''; 
    if (todasLasColumnas.length === 0) { 
        wrapper.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    
    todasLasColumnas.filter(col => !['_row_id', '_priority', '_priority_reason', 'Priority'].includes(col))
        .forEach(columnName => {
            const isChecked = columnasVisibles.includes(columnName);
            const colText = (columnName === '_row_status') ? "Row Status" : columnName;
            const itemHTML = `
                <div class="column-selector-item">
                    <label><input type="checkbox" value="${columnName}" ${isChecked ? 'checked' : ''}> ${colText}</label>
                </div>`;
            wrapper.innerHTML += itemHTML;
        });
}

function updateVisibleColumnsFromCheckboxes() {
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    columnasVisibles = [];
    checkboxes.forEach(cb => { if (cb.checked) columnasVisibles.push(cb.value); });
    
    if (todasLasColumnas.includes('_row_id')) columnasVisibles.push('_row_id');
    if (todasLasColumnas.includes('_priority')) columnasVisibles.push('_priority');
    
    // Limpieza de legacy
    columnasVisibles = columnasVisibles.filter(col => col !== 'Priority');
    renderTable();
}

function populateColumnDropdowns() {
    const colSelect = document.getElementById('select-columna');
    if (!colSelect) return; 
    colSelect.innerHTML = `<option value="">${i18n['column_select'] || 'Select col...'}</option>`;
    
    todasLasColumnas.forEach(col => {
        if (col === 'Priority') return;
        const option = document.createElement('option'); 
        option.value = col; 
        if (col === '_row_id') option.textContent = "N° Fila"; 
        else if (col === '_row_status') option.textContent = "Row Status";
        else if (col === '_priority') option.textContent = "Prioridad";
        else option.textContent = col;
        colSelect.appendChild(option);
    });
    populateGroupDropdown();
}

function updateFilterInputAutocomplete() {
    const colSelect = document.getElementById('select-columna');
    const dataList = document.getElementById('input-valor-list');
    if (!colSelect || !dataList) return;

    const selectedColumn = colSelect.value;
    dataList.innerHTML = '';

    if (autocompleteOptions && autocompleteOptions[selectedColumn]) {
        autocompleteOptions[selectedColumn].forEach(optionValue => {
            const option = document.createElement('option');
            option.value = optionValue;
            dataList.appendChild(option);
        });
    }
}

// ============================================================================
// 3. GESTIÓN DE ARCHIVOS
// ============================================================================

async function handleFileUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const fileUploadList = document.getElementById('file-upload-list');
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    
    fileUploadList.innerHTML = `
        <div class="file-list-item">
            <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
            <div class="file-details"><span class="file-name">${file.name}</span><span class="file-size">${fileSizeMB}MB</span></div>
        </div>`;    

    const formData = new FormData(); formData.append('file', file);
    try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);

        if (tabulatorInstance) { tabulatorInstance.destroy(); tabulatorInstance = null; }
        if (groupedTabulatorInstance) { groupedTabulatorInstance.destroy(); groupedTabulatorInstance = null; }

        currentFileId = result.file_id;
        todasLasColumnas = result.columnas; 
        columnasVisibles = [...todasLasColumnas];
        autocompleteOptions = result.autocomplete_options || {};
        
        populateColumnDropdowns(); 
        renderColumnSelector(); 
        updateVisibleColumnsFromCheckboxes();
        updateFilterInputAutocomplete();
        resetResumenCard(); 
        
        activeFilters = []; 
        document.getElementById('input-search-table').value = ''; 
        undoHistoryCount = 0; 
        updateActionButtonsVisibility(); 
        toggleView('detailed', true); 

    } catch (error) { 
        console.error('Error Upload:', error); 
        fileUploadList.innerHTML = `<p style="color: red;">Error al cargar el archivo.</p>`;
    }
}

async function handleDownloadExcel() {
    if (!currentFileId) { alert(i18n['no_data_to_download'] || "No hay datos."); return; }
    const colsToDownload = columnasVisibles.filter(col => col !== 'Priority');
    try {
        const response = await fetch('/api/download_excel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columnas_visibles: colsToDownload })
        });
        if (!response.ok) throw new Error('Error servidor');
        const blob = await response.blob(); 
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; a.download = 'datos_filtrados_detallado.xlsx';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); 
        URL.revokeObjectURL(url);
    } catch (error) { alert('Error descarga: ' + error.message); }
}

async function handleDownloadExcelGrouped() {
    const select = document.getElementById('select-columna-agrupar');
    const colAgrupar = select ? select.value : null;
    if (!currentFileId || !colAgrupar) { alert("Seleccione columna para agrupar."); return; }
    try {
        const response = await fetch('/api/download_excel_grouped', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columna_agrupar: colAgrupar })
        });
        if (!response.ok) throw new Error('Error servidor');
        const blob = await response.blob(); 
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; a.download = `datos_agrupados_por_${colAgrupar}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); 
        URL.revokeObjectURL(url);
    } catch (error) { alert('Error descarga: ' + error.message); }
}

async function handleDownloadAuditLog() {
    if (!currentFileId) { alert(i18n['no_data_to_download'] || "No hay datos."); return; }
    try {
        const response = await fetch('/api/download_audit_log', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });
        if (!response.ok) throw new Error('Error servidor');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'reporte_auditoria_sesion.txt';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) { alert('Error descarga reporte: ' + error.message); }
}

// ============================================================================
// 4. MOTOR DE TABLAS (TABULATOR)
// ============================================================================

/** Renderiza la tabla detallada principal */
function renderTable(data = null, forceClear = false) {
    const resultsTableDiv = document.getElementById('results-table');
    if (!resultsTableDiv) return; 

    if (forceClear && tabulatorInstance) { tabulatorInstance.destroy(); tabulatorInstance = null; }
    
    const dataToRender = data || tableData;

    if (!currentFileId) { 
        if (tabulatorInstance) { tabulatorInstance.destroy(); tabulatorInstance = null; }
        resultsTableDiv.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    
    const dateColumns = new Set(["Invoice Date", "Intake Date", "Assigned Date", "Due Date", "Terms Date", "GL Date", "Updated Date", "Batch Matching Date"]);
    
    // --- HANDLER INTELIGENTE (FIX 6.6) ---
    // 1. Detiene la selección de la fila (stopPropagation).
    // 2. Forza la apertura del editor con un ligero retraso para saltarse el bloqueo.
    const handleCellClick = function(e, cell) { 
        e.stopPropagation(); 
        
        const colDef = cell.getColumn().getDefinition();
        if (colDef.editor) {
            // El delay de 50ms es crucial para que el evento de click termine
            // y el navegador pueda enfocar el nuevo input del editor.
            setTimeout(() => {
                cell.edit(true); 
            }, 50);
        }
    }
    // -------------------------------------

    const columnDefs = [
        // 1. Checkbox: STANDARD. No lleva 'handleCellClick' para que funcione la selección.
        { formatter: "rowSelection", titleFormatter: "rowSelection", width: 40, hozAlign: "center", headerSort: false, frozen: true },
        
        // 2. Borrar: Su propia lógica + stopPropagation
        {
            title: "", field: "delete", width: 40, hozAlign: "center", headerSort: false, frozen: true,
            formatter: function(cell){ return '<i class="fas fa-trash-alt delete-icon"></i>'; },
            cellClick: function(e, cell){
                e.stopPropagation(); 
                if (!confirm("¿Eliminar fila?")) return; 
                handleDeleteRow(cell.getRow().getData()._row_id);
            }
        },
        // 3. Columnas Fijas: Bloqueamos selección accidental
        { title: "N°", field: "_row_id", width: 70, hozAlign: "right", headerSort: true, frozen: true, formatter: (cell) => cell.getValue() + 1, cellClick: handleCellClick },
        {
            title: "Prioridad", field: "_priority", width: 100, hozAlign: "left", headerSort: true, editable: false, frozen: true, 
            tooltip: (e, cell) => cell.getRow().getData()._priority_reason || "Sin razón",
            sorter: function(a, b, aRow, bRow){
                const pMap = { "Alta": 3, "Media": 2, "Baja": 1, "": 0, null: 0 };
                const diff = (pMap[a] || 0) - (pMap[b] || 0);
                if (diff !== 0) return diff;
                if (systemSettings && !systemSettings.enable_age_sort) return 0;
                return (Number(aRow.getData()['Invoice Date Age']) || 0) - (Number(bRow.getData()['Invoice Date Age']) || 0);
            },
            cellClick: handleCellClick // Bloqueo aquí también
        }
    ];

    columnasVisibles.forEach(colName => {
        if (['_row_id', '_priority', 'Priority'].includes(colName)) return; 
        
        let editorType = "input", editorParams = {}, formatter = undefined, mutatorEdit = undefined, isEditable = true;
        
        if (colName === '_row_status') { isEditable = false; editorType = undefined; }
        else if (dateColumns.has(colName)) {
            editorType = "date";
            mutatorEdit = (v) => v ? v.split(" ")[0] : v;
            formatter = (cell) => { const v = cell.getValue(); return v ? (v.split ? v.split(" ")[0] : v) : ""; }
        }
        else if (autocompleteOptions && autocompleteOptions[colName] && autocompleteOptions[colName].length > 0) {
            const opts = autocompleteOptions[colName];
            if (opts.length > 50 || colName === 'Sender Email') {
                editorType = "autocomplete"; editorParams = { values: opts, showListOnEmpty: true, freetext: true };
            } else {
                editorType = "select"; editorParams = { values: ["", ...opts] };
            }
        }

        columnDefs.push({
            title: colName === '_row_status' ? "Row Status" : colName,
            field: colName, editor: isEditable ? editorType : undefined, editable: isEditable, 
            editorParams: editorParams, mutatorEdit: mutatorEdit, formatter: formatter, minWidth: 150, visible: true,
            // --- AÑADIDO: Handler inteligente para todas las celdas de datos ---
            cellClick: handleCellClick 
        });
    });

    if (tabulatorInstance) {
        tabulatorInstance.setColumns(columnDefs); 
        tabulatorInstance.setData(dataToRender);
    } else {
        tabulatorInstance = new Tabulator(resultsTableDiv, {
            // --- CONFIGURACIÓN: ACTIVAMOS MULTI-SELECCIÓN REAL ---
            selectable: true, 
            // -----------------------------------------------------
            
            rowFormatter: function(row) {
                const d = row.getData(), el = row.getElement(); 
                el.classList.remove('priority-alta', 'priority-media', 'priority-baja');
                if (d._priority === 'Alta') el.classList.add('priority-alta');
                else if (d._priority === 'Media') el.classList.add('priority-media');
                else if (d._priority === 'Baja') el.classList.add('priority-baja');
            },
            index: "_row_id", virtualDom: true, data: dataToRender, columns: columnDefs, 
            layout: "fitData", movableColumns: true, placeholder: `<p>${i18n['info_upload'] || 'Upload file'}</p>`,
        });

        // Evento de Selección para botones masivos
        tabulatorInstance.on("rowSelectionChanged", function(data, rows){
            const btnEdit = document.getElementById('btn-bulk-edit'), btnDel = document.getElementById('btn-bulk-delete'), btnFind = document.getElementById('btn-find-replace');
            if (!btnEdit) return;
            const display = rows.length > 0 ? 'inline-block' : 'none';
            btnEdit.style.display = display; btnEdit.textContent = `${i18n['btn_bulk_edit'] || 'Editar'} (${rows.length})`;
            btnDel.style.display = display; btnDel.textContent = `${i18n['btn_bulk_delete'] || 'Eliminar'} (${rows.length})`;
            btnFind.style.display = display; btnFind.textContent = `${i18n['btn_find_replace'] || 'Buscar/Reemplazar'} (${rows.length})`;
        });

        // Evento de Edición de Celda
        tabulatorInstance.on("cellEdited", handleCellEdited);
    }
}

/** Renderiza la tabla agrupada */
function renderGroupedTable(data, colAgrupada, forceClear = false) {
    const resultsTableDiv = document.getElementById('results-table-grouped');
    if (!resultsTableDiv) return;

    if (forceClear && groupedTabulatorInstance) { groupedTabulatorInstance.destroy(); groupedTabulatorInstance = null; }

    if (!data || data.length === 0) {
        if (groupedTabulatorInstance) { groupedTabulatorInstance.destroy(); groupedTabulatorInstance = null; }
        resultsTableDiv.innerHTML = `<p>${i18n['info_upload'] || 'Upload file & group.'}</p>`;
        return;
    }

    const headersMap = {
        [colAgrupada]: colAgrupada === '_row_status' ? "Row Status" : (colAgrupada === '_priority' ? "Prioridad" : colAgrupada),
        "Total_sum": i18n['group_total_amount'] || "Total Amount",
        "Total_mean": i18n['group_avg_amount'] || "Avg Amount",
        "Total_min": i18n['group_min_amount'] || "Min Amount",
        "Total_max": i18n['group_max_amount'] || "Max Amount",
        "Total_count": i18n['group_invoice_count'] || "Invoice Count"
    };
    
    const columnDefs = [colAgrupada, "Total_sum", "Total_mean", "Total_min", "Total_max", "Total_count"].map(key => {
        if (!headersMap[key]) return null;
        const isMoney = key.startsWith('Total_') && key !== 'Total_count';
        return {
            title: headersMap[key], field: key, minWidth: 140, hozAlign: isMoney ? "right" : "left",
            formatter: isMoney ? "money" : "string", formatterParams: isMoney ? { decimal: ".", thousand: ",", symbol: "$", precision: 2 } : {}
        };
    }).filter(Boolean);

    if (groupedTabulatorInstance) groupedTabulatorInstance.destroy();
    
    groupedTabulatorInstance = new Tabulator(resultsTableDiv, {
        data: data, columns: columnDefs, layout: "fitData", movableColumns: true, 
    });
}

// ============================================================================
// 5. FILTROS Y VISTAS
// ============================================================================

async function handleAddFilter() {
    const col = document.getElementById('select-columna').value;
    const val = document.getElementById('input-valor').value;
    
    if (col && val) { 
        activeFilters.push({ columna: col, valor: val }); 
        document.getElementById('input-valor').value = ''; 
        if (currentView === 'detailed') document.getElementById('input-search-table').value = ''; 
        await refreshActiveView();
    } else { alert(i18n['warning_no_filter'] || 'Select col and value'); }
}

async function handleClearFilters() { 
    activeFilters = []; 
    if (currentView === 'detailed') document.getElementById('input-search-table').value = ''; 
    await refreshActiveView(); 
}

async function handleRemoveFilter(event) {
    if (!event.target.classList.contains('remove-filter-btn')) return;
    activeFilters.splice(parseInt(event.target.dataset.index, 10), 1);
    await refreshActiveView(); 
}

function handleSearchTable() {
    const searchTerm = document.getElementById('input-search-table').value.toLowerCase();
    if (tabulatorInstance) {
        if (!searchTerm) tabulatorInstance.clearFilter(); 
        else tabulatorInstance.setFilter(data => columnasVisibles.some(col => 
            String(col === '_row_id' ? data[col] + 1 : data[col]).toLowerCase().includes(searchTerm)
        ));
    }
}

function renderFilters() {
    const listId = (currentView === 'detailed') ? 'active-filters-list' : 'active-filters-list-grouped';
    const clearBtnId = (currentView === 'detailed') ? 'btn-clear-filters' : 'btn-clear-filters-grouped';
    const filtersListDiv = document.getElementById(listId);
    const btnClear = document.getElementById(clearBtnId);
    
    if (filtersListDiv) filtersListDiv.innerHTML = '';
    if (btnClear) btnClear.style.display = (activeFilters.length > 0) ? 'inline-block' : 'none';
    
    if (!filtersListDiv || activeFilters.length === 0) return;
    
    activeFilters.forEach((filtro, index) => {
        let colName = filtro.columna === '_row_id' ? 'N° Fila' : (filtro.columna === '_row_status' ? 'Row Status' : (filtro.columna === '_priority' ? 'Prioridad' : filtro.columna));
        filtersListDiv.innerHTML += `
            <div class="filtro-chip">
                <span>${colName}: <strong>${filtro.valor}</strong></span>
                <button class="remove-filter-btn" data-index="${index}">&times;</button>
            </div>`;
    });
}

async function getFilteredData() {
    const resultsHeader = document.getElementById('results-header');
    if (!currentFileId) { 
        currentData = []; tableData = []; renderFilters(); renderTable(null, true); resetResumenCard(); 
        if (resultsHeader) resultsHeader.textContent = 'Results'; 
        return; 
    }
    try {
        const response = await fetch('/api/filter', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters })
        });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);

        currentData = result.data; tableData = [...currentData];
        if (result.resumen) updateResumenCard(result.resumen);
        renderFilters(); renderTable(result.data); 

    } catch (error) { 
        console.error('Error filter:', error); alert('Error al filtrar: ' + error.message);
        resetResumenCard(); renderTable(null, true);
    }
}

// --- Lógica de Vistas (Detailed / Grouped) ---

function toggleView(view, force = false) {
    if (view === currentView && !force) return; 
    currentView = view;
    
    const showDetailed = (view === 'detailed');
    document.getElementById('view-container-detailed').style.display = showDetailed ? 'flex' : 'none';
    document.getElementById('view-container-grouped').style.display = showDetailed ? 'none' : 'flex';
    document.getElementById('btn-view-detailed').classList.toggle('active', showDetailed);
    document.getElementById('btn-view-grouped').classList.toggle('active', !showDetailed);
    document.getElementById('group-by-controls-wrapper').style.display = showDetailed ? 'none' : 'flex';
    
    if (!showDetailed) {
        populateGroupDropdown();
        const selectAgrupar = document.getElementById('select-columna-agrupar');
        if (selectAgrupar && !selectAgrupar.value) selectAgrupar.value = selectAgrupar.querySelector('option:not([value=""])')?.value || "";
    }
    
    refreshActiveView();
}

async function refreshActiveView() {
    if (currentView === 'detailed') {
        // ANTES: renderGroupedTable(null, null, true); <--- ESTO LA DESTRUÍA (Borrar línea)
        
        // AHORA: Solo pedimos los datos. La función renderTable sabrá reutilizar la tabla existente.
        await getFilteredData(); 
        
        // IMPORTANTE: Al mostrar una tabla que estaba oculta (display: none), 
        // a veces se desajusta. .redraw() la obliga a recalcularse para verse perfecta.
        if (tabulatorInstance) tabulatorInstance.redraw();
    } 
    else { 
        // ANTES: renderTable(null, true); <--- ESTO LA DESTRUÍA (Borrar línea)
        
        await getGroupedData(); 
        
        if (groupedTabulatorInstance) groupedTabulatorInstance.redraw();
    }
    updateActionButtonsVisibility();
}

function populateGroupDropdown() {
    const select = document.getElementById('select-columna-agrupar');
    if (!select) return; 
    const val = select.value;
    select.innerHTML = `<option value="">${i18n['group_by_placeholder'] || 'Select column...'}</option>`;
    COLUMNAS_AGRUPABLES.filter(c => todasLasColumnas.includes(c) && c !== '_row_id').forEach(colName => {
        const option = document.createElement('option'); option.value = colName;
        option.textContent = colName === '_row_status' ? "Row Status" : (colName === '_priority' ? "Prioridad" : colName);
        select.appendChild(option);
    });
    if (val) select.value = val;
}

async function handleGroupColumnChange() { await getGroupedData(); }

async function getGroupedData() {
    const select = document.getElementById('select-columna-agrupar');
    if (!currentFileId || !select?.value) { renderGroupedTable(null, null, true); return; }

    try {
        document.getElementById('results-table-grouped').innerHTML = `<p>Agrupando datos...</p>`;
        const response = await fetch('/api/group_by', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columna_agrupar: select.value })
        });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        renderGroupedTable(result.data, select.value, false); renderFilters();
    } catch (error) {
        document.getElementById('results-table-grouped').innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
    }
}

function handleFullscreen() {
    const isDetailed = currentView === 'detailed';
    const container = document.getElementById(isDetailed ? 'view-container-detailed' : 'view-container-grouped');
    const table = isDetailed ? tabulatorInstance : groupedTabulatorInstance;

    document.body.classList.toggle('fullscreen-mode');
    if(container) container.classList.toggle('in-fullscreen');
    
    // Icono SVG Toggle
    const isFull = document.body.classList.contains('fullscreen-mode');
    const svg = isFull 
        ? `<path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />`
        : `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />`;
    
    document.querySelectorAll('.icon-button[title*="Hotkey: G"]').forEach(btn => btn.querySelector('svg').innerHTML = svg);
    setTimeout(() => { if (table) table.redraw(true); }, 200);
}

// ============================================================================
// 6. ACCIONES DE FILA
// ============================================================================

async function handleCellEdited(cell) {
    const newVal = cell.getValue(), oldVal = cell.getOldValue(), row = cell.getRow();
    const colField = cell.getField(), rowId = row.getData()._row_id;
    const rowEl = row.getElement();

    // Validaciones
    const isDate = ["Invoice Date", "Intake Date", "Assigned Date", "Due Date"].includes(colField);
    if (isDate && (!newVal) && oldVal) { cell.restoreOldValue(); return; }
    if (newVal === oldVal) return;

    if (rowEl) rowEl.style.backgroundColor = "#FFF9E5";

    try {
        const response = await fetch('/api/update_cell', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, row_id: rowId, columna: colField, valor: newVal })
        });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);

        if (result.resumen) updateResumenCard(result.resumen);
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility();

        // Actualización visual reactiva (Prioridad y Status)
        if (result.new_priority) {
            if (rowEl) {
                rowEl.classList.remove('priority-alta', 'priority-media', 'priority-baja');
                if (result.new_priority) rowEl.classList.add(`priority-${result.new_priority.toLowerCase()}`);
            }
            row.update({_priority: result.new_priority});
        }
        if (result.new_row_status) row.update({_row_status: result.new_row_status});
        
        if (rowEl) { rowEl.style.backgroundColor = ""; row.reformat(); }

    } catch (error) {
        console.error("Error update cell:", error); alert("Error guardando cambio: " + error.message);
        cell.restoreOldValue(); if (rowEl) rowEl.style.backgroundColor = "";
    }
}

async function handleAddRow() {
    if (!currentFileId) { alert("Cargue archivo primero."); return; }
    try {
        const response = await fetch('/api/add_row', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 
        await getFilteredData();
        
        // Scroll y highlight
        if (result.new_row_id && tabulatorInstance) {
            setTimeout(() => {
                tabulatorInstance.scrollToRow(result.new_row_id, "bottom", false);
                const row = tabulatorInstance.getRow(result.new_row_id);
                if (row?.getElement()) {
                    const el = row.getElement(); el.style.backgroundColor = "#FFF9E5";
                    setTimeout(() => { if(el) el.style.backgroundColor = ""; row.reformat(); }, 2000);
                }
            }, 100);
        }
    } catch (error) { alert("Error añadir fila: " + error.message); }
}

async function handleDeleteRow(row_id) {
    if (!currentFileId) return;
    try {
        const response = await fetch('/api/delete_row', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, row_id: row_id })
        });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 
        await getFilteredData();
    } catch (error) { alert("Error eliminar fila: " + error.message); }
}

async function handleUndoChange() {
    if (undoHistoryCount === 0 || !currentFileId) return;
    try {
        const response = await fetch('/api/undo_change', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ file_id: currentFileId }) 
        });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 

        if (result.affected_row_id && result.affected_row_id !== 'bulk' && tabulatorInstance) {
            const row = tabulatorInstance.getRow(result.affected_row_id);
            if (row) tabulatorInstance.scrollToRow(row, "center", false);
        }
        await getFilteredData();
    } catch (error) { alert("Error Undo: " + error.message); }
}

async function handleCommitChanges() {
    if (undoHistoryCount === 0 || !currentFileId) return;
    if (!confirm("¿Consolidar cambios y limpiar historial de deshacer?")) return;
    try {
        const response = await fetch('/api/commit_changes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        alert(result.message);
        undoHistoryCount = 0; updateActionButtonsVisibility(); 
    } catch (error) { alert("Error Commit: " + error.message); }
}

function updateActionButtonsVisibility() {
    const show = (id, visible) => { const el = document.getElementById(id); if(el) el.style.display = visible ? 'inline-block' : 'none'; };
    const hasFile = !!currentFileId && currentView === 'detailed';
    
    show('btn-undo-change', undoHistoryCount > 0 && currentView === 'detailed');
    show('btn-commit-changes', undoHistoryCount > 0 && currentView === 'detailed');
    if (document.getElementById('btn-undo-change')) document.getElementById('btn-undo-change').textContent = `Deshacer (${undoHistoryCount})`;
    
    show('btn-add-row', hasFile);
    show('btn-download-audit-log', hasFile);
}

// ============================================================================
// 7. OPERACIONES MASIVAS (BULK)
// ============================================================================

// --- Modal Utils ---
function closeModal(id) {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById(id).style.display = 'none';
}
function openModal(id, initFunc = null) {
    ['bulk-edit-modal', 'manage-lists-modal', 'priority-rules-modal', 'find-replace-modal'].forEach(m => 
        document.getElementById(m).style.display = 'none'
    );
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById(id).style.display = 'flex';
    if(initFunc) initFunc();
}

// --- Bulk Edit ---
function openBulkEditModal() {
    if (!tabulatorInstance) return;
    const rows = tabulatorInstance.getSelectedData();
    if (rows.length === 0) { alert("No hay selección."); return; }

    document.getElementById('bulk-edit-count').textContent = `Editar ${rows.length} filas.`;
    const sel = document.getElementById('bulk-edit-column');
    sel.innerHTML = '<option value="">Seleccione...</option>';
    todasLasColumnas.forEach(col => { if (!col.startsWith('_') && col !== 'Priority') sel.innerHTML += `<option value="${col}">${col}</option>`; });
    
    document.getElementById('bulk-edit-value').value = '';
    openModal('bulk-edit-modal');
}

async function handleBulkEditApply() {
    const col = document.getElementById('bulk-edit-column').value, val = document.getElementById('bulk-edit-value').value;
    if (!col) return alert("Seleccione columna");
    const rows = tabulatorInstance.getSelectedData();
    if (!confirm(`¿Cambiar "${col}" a "${val}" en ${rows.length} filas?`)) return;

    try {
        const response = await fetch('/api/bulk_update', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, row_ids: rows.map(r => r._row_id), column: col, new_value: val })
        });
        const res = await response.json(); if (!response.ok) throw new Error(res.error);
        
        alert(res.message); undoHistoryCount = res.history_count;
        if (res.resumen) updateResumenCard(res.resumen);
        closeModal('bulk-edit-modal'); tabulatorInstance.deselectRow();
        await getFilteredData();
    } catch (e) { alert("Error Bulk Edit: " + e.message); }
}

// --- Find & Replace ---
function openFindReplaceModal() {
    if (!tabulatorInstance) return;
    const rows = tabulatorInstance.getSelectedData();
    if (rows.length === 0) { alert("No hay selección."); return; }
    
    document.getElementById('find-replace-count').textContent = `En ${rows.length} filas seleccionadas.`;
    const sel = document.getElementById('find-replace-column');
    sel.innerHTML = '<option value="">Seleccione...</option>';
    todasLasColumnas.forEach(col => { if (!col.startsWith('_') && col !== 'Priority') sel.innerHTML += `<option value="${col}">${col}</option>`; });
    
    document.getElementById('find-replace-find-text').value = '';
    document.getElementById('find-replace-replace-text').value = '';
    openModal('find-replace-modal');
}

async function handleFindReplaceApply() {
    const col = document.getElementById('find-replace-column').value;
    const findT = document.getElementById('find-replace-find-text').value;
    const replT = document.getElementById('find-replace-replace-text').value;
    if (!col) return alert("Seleccione columna");

    const rows = tabulatorInstance.getSelectedData();
    if (!confirm(`Buscar "${findT}" y reemplazar con "${replT}" en ${rows.length} filas de "${col}"?`)) return;

    try {
        const response = await fetch('/api/find_replace_in_selection', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, row_ids: rows.map(r => r._row_id), columna: col, find_text: findT, replace_text: replT })
        });
        const res = await response.json(); if (!response.ok) throw new Error(res.error);

        alert(res.message); undoHistoryCount = res.history_count;
        if (res.resumen) updateResumenCard(res.resumen);
        closeModal('find-replace-modal'); tabulatorInstance.deselectRow();
        await getFilteredData();
    } catch (e) { alert("Error Find/Replace: " + e.message); }
}

// --- Bulk Delete ---
async function handleBulkDelete() {
    const rows = tabulatorInstance.getSelectedData();
    if (rows.length === 0) return alert("Seleccione filas.");
    if (!confirm(`¿Eliminar ${rows.length} filas? (Deshacer disponible)`)) return;

    try {
        const response = await fetch('/api/bulk_delete_rows', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, row_ids: rows.map(r => r._row_id) })
        });
        const res = await response.json(); if (!response.ok) throw new Error(res.error);

        alert(res.message); 
        
        // Actualizamos el conteo de historial
        undoHistoryCount = res.history_count;
        
        if (res.resumen) updateResumenCard(res.resumen);
        
        tabulatorInstance.deselectRow(); 
        
        // Hacemos visibles los botones de acción (Deshacer)
        updateActionButtonsVisibility(); 
        
        await getFilteredData();
    } catch (e) { alert("Error Bulk Delete: " + e.message); }
}

// --- Duplicados ---
async function handleShowDuplicates() {
    if (!currentFileId) return alert("Cargue archivo.");
    try {
        const response = await fetch('/api/get_duplicate_invoices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });
        const res = await response.json(); if (!response.ok) throw new Error(res.error);
        
        if (res.num_filas > 0) {
            alert(`Encontrados ${res.num_filas} duplicados.`);
            renderTable(res.data); activeFilters = []; renderFilters();
        } else alert("No hay duplicados.");
    } catch (e) { alert("Error Duplicados: " + e.message); }
}

async function handleCleanupDuplicates() {
    if (!currentFileId) return alert("Cargue archivo.");
    if (!confirm("¿Eliminar duplicados dejando solo el primero? (Deshacer disponible)")) return;
    try {
        const response = await fetch('/api/cleanup_duplicate_invoices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });
        const res = await response.json(); if (!response.ok) throw new Error(res.error);
        
        alert(res.message); undoHistoryCount = res.history_count;
        if (res.resumen) updateResumenCard(res.resumen);
        updateActionButtonsVisibility(); await getFilteredData();
    } catch (e) { alert("Error Cleanup: " + e.message); }
}

// ============================================================================
// 8. GESTIÓN DE REGLAS Y LISTAS
// ============================================================================

// --- Autocomplete Lists ---
function openManageListsModal() {
    openModal('manage-lists-modal', () => {
        const sel = document.getElementById('manage-list-column');
        sel.innerHTML = '<option value="">Seleccione columna...</option>';
        
        // Unión de columnas del archivo + columnas guardadas
        const allCols = new Set([...todasLasColumnas, ...Object.keys(autocompleteOptions)]);
        const cleanCols = Array.from(allCols).filter(c => !c.startsWith('_') && c !== 'Priority').sort();

        cleanCols.forEach(col => {
            const hasAuto = autocompleteOptions[col] && autocompleteOptions[col].length > 0;
            const mark = hasAuto ? ' (Activo)' : '';
            sel.innerHTML += `<option value="${col}">${col}${mark}</option>`;
        });

        document.getElementById('manage-list-input').value = '';
        document.getElementById('current-list-values').innerHTML = '<em>Seleccione una columna arriba...</em>';
    });
}

/**
 * Renderiza los valores como etiquetas (chips) interactivas.
 */
function updateManageListsCurrentValues() {
    const col = document.getElementById('manage-list-column').value;
    const container = document.getElementById('current-list-values');
    const vals = autocompleteOptions[col];

    container.innerHTML = ''; // Limpiar

    if (!col) {
        container.innerHTML = '<em>Seleccione una columna...</em>';
        return;
    }
    if (!vals || vals.length === 0) {
        container.innerHTML = '<em>Vacío</em>';
        return;
    }

    // Crear chips interactivos
    vals.forEach(val => {
        const chip = document.createElement('div');
        chip.className = 'value-chip';
        
        // Texto del valor
        const textSpan = document.createElement('span');
        textSpan.textContent = val;
        chip.appendChild(textSpan);

        // Icono de eliminar (X)
        const icon = document.createElement('i');
        icon.className = 'fas fa-times remove-icon';
        icon.title = "Eliminar valor";
        icon.onclick = () => handleRemoveSingleValue(col, val); // Acción directa
        chip.appendChild(icon);

        container.appendChild(chip);
    });
}

/**
 * Elimina un solo valor de la lista en memoria y actualiza la vista.
 */
function handleRemoveSingleValue(col, valToRemove) {
    if (!autocompleteOptions[col]) return;

    // Filtrar el valor
    autocompleteOptions[col] = autocompleteOptions[col].filter(v => v !== valToRemove);
    
    // Refrescar vista
    updateManageListsCurrentValues();
}

/**
 * Elimina TODA la lista de la columna seleccionada.
 */
function handleDeleteAllValues() {
    const col = document.getElementById('manage-list-column').value;
    if (!col) return alert("Seleccione una columna.");
    
    if (!autocompleteOptions[col] || autocompleteOptions[col].length === 0) {
        return alert("La lista ya está vacía.");
    }

    if (!confirm(`¿Está seguro de borrar TODOS los valores de autocompletado para "${col}"?`)) return;

    // Vaciar array en memoria
    autocompleteOptions[col] = [];
    updateManageListsCurrentValues();
}

async function handleManageListsSave() {
    const col = document.getElementById('manage-list-column').value;
    const input = document.getElementById('manage-list-input').value;
    
    if (!col) return alert("Seleccione una columna.");

    // Si hay texto manual, lo procesamos y mezclamos
    const current = new Set(autocompleteOptions[col] || []);
    if (input.trim()) {
        input.split(',').map(v => v.trim()).filter(Boolean).forEach(mod => {
            if (mod.startsWith('-')) current.delete(mod.substring(1).trim());
            else current.add(mod);
        });
    }
    autocompleteOptions[col] = Array.from(current).sort();

    try {
        // Guardar el estado actual (incluyendo eliminaciones hechas con las X)
        await fetch('/api/save_autocomplete_lists', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(autocompleteOptions) 
        });
        
        renderTable(); // Actualizar tabla principal
        
        alert("Listas guardadas correctamente."); 
        closeModal('manage-lists-modal');
    } catch (e) { alert("Error guardar listas: " + e.message); }
}

async function handleImportAutocomplete() {
    const col = document.getElementById('manage-list-column').value;
    if (!col) return alert("Seleccione una columna primero.");
    if (!currentFileId) return alert("No hay archivo cargado para importar valores.");

    if (!confirm(`¿Analizar la columna "${col}" del archivo actual y guardar todos sus valores únicos para autocompletado?`)) return;

    try {
        const btn = document.getElementById('btn-manage-import');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        btn.disabled = true;

        const response = await fetch('/api/import_autocomplete_values', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, column: col })
        });
        const result = await response.json();
        
        btn.innerHTML = originalText;
        btn.disabled = false;

        if (!response.ok) throw new Error(result.error);

        autocompleteOptions = result.autocomplete_options;
        updateManageListsCurrentValues();
        renderTable(); // Redibujar tabla para activar autocompletado

        alert(result.message);

    } catch (error) {
        alert("Error importando valores: " + error.message);
        if (document.getElementById('btn-manage-import')) document.getElementById('btn-manage-import').disabled = false;
    }
}

// --- Priority Rules ---
async function openPriorityRulesModal() {
    openModal('priority-rules-modal', async () => {
        // 1. Llenar columnas
        const sel = document.getElementById('rule-column');
        sel.innerHTML = '<option value="">Seleccione...</option>';
        todasLasColumnas.forEach(col => { if(!col.startsWith('_') && col !== 'Priority') sel.innerHTML += `<option value="${col}">${col}</option>`; });

        // 2. Cargar reglas
        document.getElementById('rules-list-container').innerHTML = '<em>Cargando...</em>';
        try {
            const res = await fetch('/api/priority_rules/get');
            const data = await res.json();
            renderRulesList(data.rules);
            systemSettings = data.settings || systemSettings;
            document.getElementById('setting-scf').checked = systemSettings.enable_scf_intercompany;
            document.getElementById('setting-age-sort').checked = systemSettings.enable_age_sort;
        } catch (e) { document.getElementById('rules-list-container').innerHTML = 'Error.'; }
    });
}

function renderRulesList(rules) {
    const c = document.getElementById('rules-list-container');
    c.innerHTML = (!rules || !rules.length) ? '<em>Sin reglas.</em>' : '';
    
    rules.forEach(r => {
        const div = document.createElement('div'); div.className = 'rule-item';
        div.style.opacity = r.active ? '1' : '0.5';
        div.innerHTML = `
            <div style="display:flex;gap:10px;align-items:center;flex:1;">
                <input type="checkbox" class="toggle-rule" ${r.active?'checked':''} data-col="${r.column}" data-val="${r.value}">
                <span>Si <strong>${r.column}</strong> = <strong>"${r.value}"</strong> &rarr; ${r.priority}</span>
            </div>
            <button class="btn-delete-rule">&times;</button>`;
        
        div.querySelector('.btn-delete-rule').onclick = () => confirm(`¿Borrar regla "${r.value}"?`) && handleDeleteRule(r.column, r.value);
        div.querySelector('.toggle-rule').onchange = (e) => handleToggleRule(r.column, r.value, e.target.checked);
        c.appendChild(div);
    });
}

async function handleSaveSettings() {
    const scf = document.getElementById('setting-scf').checked;
    const age = document.getElementById('setting-age-sort').checked;
    try {
        await fetch('/api/priority_rules/save_settings', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ enable_scf_intercompany: scf, enable_age_sort: age })
        });
        systemSettings.enable_age_sort = age; alert("Configuración guardada.");
        if (currentFileId) await getFilteredData();
    } catch (e) { alert(e.message); }
}

async function handleAddRule() {
    const col = document.getElementById('rule-column').value, val = document.getElementById('rule-value').value;
    const prio = document.getElementById('rule-priority').value, reason = document.getElementById('rule-reason').value;
    if (!col || !val || !reason) return alert("Complete campos.");

    try {
        const res = await fetch('/api/priority_rules/save', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ column: col, value: val, priority: prio, reason: reason, active: true })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        
        alert("Regla guardada."); 
        document.getElementById('rule-value').value = ''; document.getElementById('rule-reason').value = '';
        
        const listRes = await fetch('/api/priority_rules/get');
        renderRulesList((await listRes.json()).rules);
        if (currentFileId) await getFilteredData();
    } catch (e) { alert(e.message); }
}

async function handleToggleRule(col, val, status) {
    await fetch('/api/priority_rules/toggle', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ column: col, value: val, active: status })
    });
    if (currentFileId) await getFilteredData();
}

async function handleDeleteRule(col, val) {
    await fetch('/api/priority_rules/delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ column: col, value: val })
    });
    const listRes = await fetch('/api/priority_rules/get');
    renderRulesList((await listRes.json()).rules);
    if (currentFileId) await getFilteredData();
}

// ============================================================================
// 9. PERSISTENCIA DE VISTAS (INCLUYENDO REGLAS)
// ============================================================================

async function handleSaveView() {
    if (!currentFileId) return alert("No hay datos.");
    
    // 1. Obtener las reglas actuales del servidor
    let currentRulesData = { rules: [], settings: {} };
    try {
        const res = await fetch('/api/priority_rules/get');
        if (res.ok) currentRulesData = await res.json();
    } catch (e) { console.error("Error fetching rules for save:", e); }

    const config = {
        viewType: currentView, 
        activeFilters: activeFilters, 
        visibleColumns: columnasVisibles,
        groupByColumn: document.getElementById('select-columna-agrupar')?.value || "",
        // Incluimos las reglas en el archivo guardado
        priorityRules: currentRulesData.rules,
        prioritySettings: currentRulesData.settings
    };
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
    a.download = 'vista_config.json'; 
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function handleLoadView(event) {
    const file = event.target.files[0];
    if (!file || !currentFileId) return alert("Archivo inválido o no hay datos cargados.");
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const c = JSON.parse(e.target.result);
            
            // Restaurar UI básica
            activeFilters = c.activeFilters || [];
            columnasVisibles = (c.visibleColumns || todasLasColumnas).filter(col => todasLasColumnas.includes(col));
            document.querySelectorAll('#column-selector-wrapper input').forEach(cb => cb.checked = columnasVisibles.includes(cb.value));
            
            if (c.groupByColumn) {
                const sel = document.getElementById('select-columna-agrupar');
                if (sel && sel.querySelector(`option[value="${c.groupByColumn}"]`)) sel.value = c.groupByColumn;
            }

            // --- RESTAURAR REGLAS SI EXISTEN ---
            if (c.priorityRules || c.prioritySettings) {
                if(confirm("Esta vista contiene reglas de prioridad. ¿Desea sobrescribir las reglas actuales con las del archivo?")) {
                    try {
                        const res = await fetch('/api/priority_rules/import_view', {
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                rules: c.priorityRules || [], 
                                settings: c.prioritySettings || {} 
                            })
                        });
                        const result = await res.json();
                        if (result.resumen) updateResumenCard(result.resumen);
                        alert("Vista y reglas restauradas correctamente.");
                    } catch(err) { alert("Error restaurando reglas: " + err.message); }
                }
            } else {
                alert("Vista restaurada.");
            }

            toggleView(c.viewType || 'detailed', true);
            
        } catch (e) { alert("JSON inválido o error al cargar: " + e.message); }
    };
    reader.readAsText(file); event.target.value = null;
}

// ============================================================================
// 10. INICIALIZACIÓN Y EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
    const on = (id, evt, fn) => { const el = document.getElementById(id); if(el) el.addEventListener(evt, fn); };

    // Core UI
    on('file-uploader', 'change', handleFileUpload);
    on('btn-lang-es', 'click', () => setLanguage('es'));
    on('btn-lang-en', 'click', () => setLanguage('en'));
    on('btn-fullscreen', 'click', handleFullscreen);
    on('btn-fullscreen-grouped', 'click', handleFullscreen);

    // Filtros
    on('btn-add-filter', 'click', handleAddFilter);
    on('btn-clear-filters', 'click', handleClearFilters);
    on('btn-clear-filters-grouped', 'click', handleClearFilters);
    on('input-search-table', 'keyup', handleSearchTable);
    on('select-columna', 'change', updateFilterInputAutocomplete);
    document.getElementById('active-filters-list')?.addEventListener('click', handleRemoveFilter);
    document.getElementById('active-filters-list-grouped')?.addEventListener('click', handleRemoveFilter);

    // Columnas
    document.getElementById('column-selector-wrapper')?.addEventListener('change', (e) => { if(e.target.type === 'checkbox') updateVisibleColumnsFromCheckboxes(); });
    on('btn-check-all-cols', 'click', () => { document.querySelectorAll('#column-selector-wrapper input').forEach(c=>c.checked=true); updateVisibleColumnsFromCheckboxes(); });
    on('btn-uncheck-all-cols', 'click', () => { document.querySelectorAll('#column-selector-wrapper input').forEach(c=>c.checked=false); updateVisibleColumnsFromCheckboxes(); });

    // Vistas
    on('btn-view-detailed', 'click', () => toggleView('detailed'));
    on('btn-view-grouped', 'click', () => toggleView('grouped'));
    on('select-columna-agrupar', 'change', handleGroupColumnChange);
    on('btn-save-view', 'click', handleSaveView);
    on('input-load-view', 'change', handleLoadView);

    // Descargas
    on('btn-download-excel', 'click', handleDownloadExcel);
    on('btn-download-excel-grouped', 'click', handleDownloadExcelGrouped);
    on('btn-download-audit-log', 'click', handleDownloadAuditLog);

    // Acciones Fila
    on('btn-add-row', 'click', handleAddRow);
    on('btn-undo-change', 'click', handleUndoChange);
    on('btn-commit-changes', 'click', handleCommitChanges);

    // Acciones Masivas
    on('btn-bulk-edit', 'click', openBulkEditModal);
    on('btn-bulk-delete', 'click', handleBulkDelete);
    on('btn-find-replace', 'click', openFindReplaceModal);
    
    on('btn-bulk-apply', 'click', handleBulkEditApply);
    on('btn-bulk-cancel', 'click', () => closeModal('bulk-edit-modal'));
    on('bulk-edit-column', 'change', () => {
        const col = document.getElementById('bulk-edit-column').value, list = document.getElementById('bulk-edit-value-list');
        list.innerHTML = ''; autocompleteOptions[col]?.forEach(v => list.innerHTML += `<option value="${v}"></option>`);
    });

    on('btn-find-replace-apply', 'click', handleFindReplaceApply);
    on('btn-find-replace-cancel', 'click', () => closeModal('find-replace-modal'));

    // Reglas y Listas
    on('btn-priority-rules', 'click', openPriorityRulesModal);
    on('btn-rules-close', 'click', () => closeModal('priority-rules-modal'));
    on('btn-add-rule', 'click', handleAddRule);
    on('btn-save-settings', 'click', handleSaveSettings);
    on('rule-column', 'change', () => {
        const col = document.getElementById('rule-column').value, list = document.getElementById('rule-value-datalist');
        list.innerHTML = ''; autocompleteOptions[col]?.forEach(v => list.innerHTML += `<option value="${v}"></option>`);
    });

    on('btn-manage-lists', 'click', openManageListsModal);
    on('btn-manage-save', 'click', handleManageListsSave);
    on('btn-manage-cancel', 'click', () => closeModal('manage-lists-modal'));
    on('manage-list-column', 'change', updateManageListsCurrentValues);
    // NUEVOS LISTENERS
    on('btn-manage-import', 'click', handleImportAutocomplete);
    on('btn-manage-delete-all', 'click', handleDeleteAllValues);

    // Duplicados
    on('btn-show-duplicates', 'click', handleShowDuplicates);
    on('btn-cleanup-duplicates', 'click', handleCleanupDuplicates);

    // Atajos Globales
    document.addEventListener('keydown', (e) => {
        if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
        if (e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('input-search-table')?.focus(); }
        if (e.key.toLowerCase() === 'g') { e.preventDefault(); handleFullscreen(); }
        if (e.key.toLowerCase() === 'z') { if(undoHistoryCount > 0) handleUndoChange(); }
        if (e.key.toLowerCase() === 'a') { if(currentFileId) handleAddRow(); }
        if (e.key === 'Delete') { if(activeFilters.length) handleClearFilters(); }
    });

    // Drag & Drop
    const area = document.querySelector('.drag-drop-label');
    if (area) {
        ['dragenter', 'dragover'].forEach(e => area.addEventListener(e, (ev) => { ev.preventDefault(); area.classList.add('dragging'); }));
        ['dragleave', 'drop'].forEach(e => area.addEventListener(e, (ev) => { ev.preventDefault(); area.classList.remove('dragging'); }));
        area.addEventListener('drop', (ev) => {
            const files = ev.dataTransfer.files;
            if(files.length) { document.getElementById('file-uploader').files = files; handleFileUpload({target: {files: files}}); }
        });
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();
    if (typeof SESSION_DATA !== 'undefined' && SESSION_DATA.file_id) {
        currentFileId = SESSION_DATA.file_id;
        todasLasColumnas = SESSION_DATA.columnas;
        columnasVisibles = [...todasLasColumnas];
        autocompleteOptions = SESSION_DATA.autocomplete_options || {};
        undoHistoryCount = SESSION_DATA.history_count || 0;

        populateColumnDropdowns(); renderColumnSelector(); updateVisibleColumnsFromCheckboxes();
        updateActionButtonsVisibility(); refreshActiveView();
    } else {
        renderColumnSelector(); updateActionButtonsVisibility();
    }
    setupEventListeners();
});