/**
 * script.js (Versión 17.3.1 - Corrección de Placeholder)
 * ------------------------------------------------------------------
 * Modificaciones v17.3.1:
 * - (Basado en la v17.3)
 * - Eliminada la línea 622 ('tabulatorInstance.setPlaceholder(...)')
 * dentro de renderTable(), ya que era redundante y causaba un
 * TypeError benigno después de una eliminación masiva.
 * 'setData([])' es suficiente para mostrar el placeholder.
 */

// ============================================================
// 0. VARIABLES GLOBALES
// ============================================================

let i18n = {}; 
let currentFileId = null; 
let activeFilters = []; 
let currentData = [];
let tableData = [];
let todasLasColumnas = [];
let columnasVisibles = [];
let currentView = 'detailed';
let undoHistoryCount = 0;
let autocompleteOptions = {};

// Configuración global por defecto
let systemSettings = {
    enable_scf_intercompany: true,
    enable_age_sort: true
};

let tabulatorInstance = null;
let groupedTabulatorInstance = null; 

const COLUMNAS_AGRUPABLES = [
    "Vendor Name", "Status", "Assignee", 
    "Operating Unit Name", "Pay Status", "Document Type", 
    "_row_status", "_priority", 
    "Pay group", "WEC Email Inbox", "Sender Email", "Currency Code", "payment method"
];

// ============================================================
// 1. MANEJO DE COLUMNAS
// ============================================================

/**
 * Renderiza la lista de checkboxes para mostrar/ocultar columnas.
 */
function renderColumnSelector() {
    const wrapper = document.getElementById('column-selector-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = ''; 
    if (todasLasColumnas.length === 0) { 
        wrapper.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    
    // Filtramos columnas internas que no deben ser seleccionables manualmente
    todasLasColumnas.filter(col => 
        col !== '_row_id' && 
        col !== '_priority' && 
        col !== '_priority_reason' && 
        col !== 'Priority'
    ).forEach(columnName => {
        const isChecked = columnasVisibles.includes(columnName);
        let colText = columnName;
        if (columnName === '_row_status') { colText = "Row Status"; }

        const itemHTML = `
            <div class="column-selector-item">
                <label>
                    <input type="checkbox" value="${columnName}" ${isChecked ? 'checked' : ''}>
                    ${colText}
                </label>
            </div>`;
        wrapper.innerHTML += itemHTML;
    });
}

/**
 * Actualiza el array columnasVisibles basado en los checkboxes marcados.
 */
function updateVisibleColumnsFromCheckboxes() {
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    columnasVisibles = [];
    checkboxes.forEach(cb => {
        if (cb.checked) {
            columnasVisibles.push(cb.value);
        }
    });
    
    // Aseguramos columnas obligatorias
    if (todasLasColumnas.includes('_row_id')) columnasVisibles.push('_row_id');
    if (todasLasColumnas.includes('_priority')) columnasVisibles.push('_priority');
    
    // Limpiamos duplicados o nombres reservados legacy
    if (columnasVisibles.includes('Priority')) {
        columnasVisibles = columnasVisibles.filter(col => col !== 'Priority');
    }
    
    renderTable();
}

function handleColumnVisibilityChange(event) {
    if (event.target.type !== 'checkbox') return;
    updateVisibleColumnsFromCheckboxes();
}

function handleCheckAllColumns() {
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    updateVisibleColumnsFromCheckboxes();
}

function handleUncheckAllColumns() {
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    updateVisibleColumnsFromCheckboxes();
}

// ============================================================
// 2. CONFIGURACIÓN INICIAL Y LISTENERS
// ============================================================

/**
 * Carga las traducciones del servidor.
 */
async function loadTranslations() {
    try {
        const response = await fetch('/api/get_translations');
        if (!response.ok) throw new Error('Network response was not ok');
        i18n = await response.json();
    } catch (error) { 
        console.error('Error cargando traducciones:', error); 
        i18n = { }; 
    }
    updateDynamicText();
}

/**
 * Configura todos los event listeners de la aplicación.
 */
function setupEventListeners() {
    const fileUploader = document.getElementById('file-uploader');
    const dragDropArea = document.querySelector('.drag-drop-label');
    const btnAdd = document.getElementById('btn-add-filter');
    const btnLangEs = document.getElementById('btn-lang-es');
    const btnLangEn = document.getElementById('btn-lang-en');
    const columnSelectorWrapper = document.getElementById('column-selector-wrapper');
    const btnCheckAllCols = document.getElementById('btn-check-all-cols');
    const btnUncheckAllCols = document.getElementById('btn-uncheck-all-cols');

    // Helper para añadir listeners con seguridad
    const addSafeListener = (element, event, handler) => {
        if (element) element.addEventListener(event, handler);
    };

    addSafeListener(document, 'keydown', handleGlobalKeydown);

    addSafeListener(fileUploader, 'change', handleFileUpload);
    addSafeListener(btnAdd, 'click', handleAddFilter);
    addSafeListener(btnLangEs, 'click', () => setLanguage('es'));
    addSafeListener(btnLangEn, 'click', () => setLanguage('en'));
    addSafeListener(columnSelectorWrapper, 'change', handleColumnVisibilityChange);
    addSafeListener(btnCheckAllCols, 'click', handleCheckAllColumns);
    addSafeListener(btnUncheckAllCols, 'click', handleUncheckAllColumns);

    addSafeListener(document.getElementById('select-columna'), 'change', updateFilterInputAutocomplete);

    addSafeListener(document.getElementById('btn-clear-filters'), 'click', handleClearFilters);
    addSafeListener(document.getElementById('btn-fullscreen'), 'click', handleFullscreen);
    addSafeListener(document.getElementById('btn-download-excel'), 'click', handleDownloadExcel);
    addSafeListener(document.getElementById('input-search-table'), 'keyup', handleSearchTable);
    addSafeListener(document.getElementById('active-filters-list'), 'click', handleRemoveFilter);
    
    addSafeListener(document.getElementById('btn-add-row'), 'click', handleAddRow);
    addSafeListener(document.getElementById('btn-undo-change'), 'click', handleUndoChange);
    addSafeListener(document.getElementById('btn-commit-changes'), 'click', handleCommitChanges);


    // Listeners Bulk Edit
    addSafeListener(document.getElementById('btn-bulk-edit'), 'click', openBulkEditModal);
    addSafeListener(document.getElementById('btn-bulk-cancel'), 'click', closeBulkEditModal);
    addSafeListener(document.getElementById('btn-bulk-apply'), 'click', handleBulkEditApply);
    addSafeListener(document.getElementById('bulk-edit-column'), 'change', updateBulkEditAutocomplete);

    // --- (INICIO - NUEVA LÍNEA v17.3) ---
    // (Documentación: Añadido listener para el nuevo botón de eliminación masiva)
    addSafeListener(document.getElementById('btn-bulk-delete'), 'click', handleBulkDelete);
    // --- (FIN - NUEVA LÍNEA v17.3) ---

    // (INICIO - NUEVO v16.8) Listener para el reporte de auditoría
    addSafeListener(document.getElementById('btn-download-audit-log'), 'click', handleDownloadAuditLog);

    // Listeners Vistas
    addSafeListener(document.getElementById('btn-view-detailed'), 'click', () => toggleView('detailed'));
    addSafeListener(document.getElementById('btn-view-grouped'), 'click', () => toggleView('grouped'));
    addSafeListener(document.getElementById('select-columna-agrupar'), 'change', handleGroupColumnChange);
    
    addSafeListener(document.getElementById('btn-clear-filters-grouped'), 'click', handleClearFilters);
    addSafeListener(document.getElementById('btn-fullscreen-grouped'), 'click', handleFullscreen);
    addSafeListener(document.getElementById('btn-download-excel-grouped'), 'click', handleDownloadExcelGrouped);
    addSafeListener(document.getElementById('active-filters-list-grouped'), 'click', handleRemoveFilter);

    // Listeners Gestión de Listas
    addSafeListener(document.getElementById('btn-manage-lists'), 'click', openManageListsModal);
    addSafeListener(document.getElementById('btn-manage-cancel'), 'click', closeManageListsModal);
    addSafeListener(document.getElementById('btn-manage-save'), 'click', handleManageListsSave);
    addSafeListener(document.getElementById('manage-list-column'), 'change', updateManageListsCurrentValues);

    // Listeners Reglas de Prioridad
    addSafeListener(document.getElementById('btn-priority-rules'), 'click', openPriorityRulesModal);
    addSafeListener(document.getElementById('btn-rules-close'), 'click', closePriorityRulesModal);
    addSafeListener(document.getElementById('btn-add-rule'), 'click', handleAddRule);
    addSafeListener(document.getElementById('btn-save-settings'), 'click', handleSaveSettings);
    addSafeListener(document.getElementById('rule-column'), 'change', updateRuleValueAutocomplete);

    // Listeners para Settings y Autocomplete de Reglas
    addSafeListener(document.getElementById('btn-save-settings'), 'click', handleSaveSettings);
    addSafeListener(document.getElementById('rule-column'), 'change', updateRuleValueAutocomplete);

    // --- (INICIO - SECCIÓN MODIFICADA v17.1) ---
    // (Documentación de Google: Se eliminan los listeners v17.0 del modal de duplicados genérico)
    // (Documentación de Google: Se añaden los listeners v17.1 para el nuevo flujo específico)
    addSafeListener(document.getElementById('btn-show-duplicates'), 'click', handleShowDuplicates);
    addSafeListener(document.getElementById('btn-cleanup-duplicates'), 'click', handleCleanupDuplicates);
    // --- (FIN - SECCIÓN MODIFICADA v17.1) ---

    // Listeners Guardar Vista
    addSafeListener(document.getElementById('btn-save-view'), 'click', handleSaveView);
    addSafeListener(document.getElementById('input-load-view'), 'change', handleLoadView);
    addSafeListener(document.getElementById('btn-save-view'), 'click', handleSaveView);

    // Drag and Drop
    if (dragDropArea) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dragDropArea.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
        });
        ['dragenter', 'dragover'].forEach(eventName => {
            dragDropArea.addEventListener(eventName, () => dragDropArea.classList.add('dragging'), false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
            dragDropArea.addEventListener(eventName, () => dragDropArea.classList.remove('dragging'), false);
        });
        dragDropArea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0 && fileUploader) {
                fileUploader.files = files;
                const changeEvent = new Event('change', { 'bubbles': true });
                fileUploader.dispatchEvent(changeEvent);
            }
        }, false);
    }
}

/**
 * Actualiza textos dinámicos en la interfaz (Placeholders, etc).
 */
function updateDynamicText() {
    const valInput = document.getElementById('input-valor');
    const searchTableInput = document.getElementById('input-search-table');
    const resultsTableDiv = document.getElementById('results-table');
    const resultsTableGrouped = document.getElementById('results-table-grouped');

    if (valInput) valInput.placeholder = i18n['search_text'] || "Texto a buscar...";
    if (searchTableInput) searchTableInput.placeholder = (i18n['search_text'] || "Buscar...") + "... (Hotkey: F)";
    
    if (resultsTableDiv && !tabulatorInstance && !currentFileId) {
        resultsTableDiv.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`;
    }
    if (resultsTableGrouped && !groupedTabulatorInstance && !currentFileId) { 
        resultsTableGrouped.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`;
    }
}

/**
 * Cambia el idioma de la sesión y recarga la página.
 */
async function setLanguage(langCode) {
    try { 
        await fetch(`/api/set_language/${langCode}`); 
        location.reload();
    }
    catch (error) { console.error('Error al cambiar idioma:', error); }
}

// ============================================================
// SECCIÓN 3: EVENTOS PRINCIPALES (Carga, Filtros)
// ============================================================

async function handleFileUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const fileUploadList = document.getElementById('file-upload-list');
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    fileUploadList.innerHTML = `
        <div class="file-list-item">
            <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
            <div class="file-details">
                <span class="file-name">${file.name}</span>
                <span class="file-size">${fileSizeMB}MB</span>
            </div>
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
        console.error('Error en fetch /api/upload:', error); 
        todasLasColumnas = []; columnasVisibles = []; 
        fileUploadList.innerHTML = `<p style="color: red;">Error al cargar el archivo.</p>`;
    }
}

async function handleAddFilter() {
    const colSelect = document.getElementById('select-columna');
    const valInput = document.getElementById('input-valor');
    const col = colSelect.value; 
    const val = valInput.value;
    
    if (col && val) { 
        activeFilters.push({ columna: col, valor: val }); 
        valInput.value = ''; 
        if (currentView === 'detailed') document.getElementById('input-search-table').value = ''; 
        await refreshActiveView();
    }
    else { alert(i18n['warning_no_filter'] || 'Select col and value'); }
}

async function handleClearFilters() { 
    activeFilters = []; 
    if (currentView === 'detailed') document.getElementById('input-search-table').value = ''; 
    await refreshActiveView(); 
}

async function handleRemoveFilter(event) {
    if (!event.target.classList.contains('remove-filter-btn')) return;
    const indexToRemove = parseInt(event.target.dataset.index, 10);
    activeFilters.splice(indexToRemove, 1);
    await refreshActiveView(); 
}

function handleFullscreen(event) {
    const viewContainerId = (currentView === 'detailed') ? 'view-container-detailed' : 'view-container-grouped';
    const viewContainer = document.getElementById(viewContainerId);
    const activeTableInstance = (currentView === 'detailed') ? tabulatorInstance : groupedTabulatorInstance;

    const iconExpand = `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />`;
    const iconCollapse = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />`;

    if (document.body.classList.contains('fullscreen-mode')) {
        document.body.classList.remove('fullscreen-mode');
        if (viewContainer) viewContainer.classList.remove('in-fullscreen');
        document.querySelectorAll('.icon-button[title="Pantalla Completa (Hotkey: G)"]').forEach(btn => btn.querySelector('svg').innerHTML = iconExpand);
    } else {
        document.body.classList.add('fullscreen-mode');
        if (viewContainer) viewContainer.classList.add('in-fullscreen');
        document.querySelectorAll('.icon-button[title="Pantalla Completa (Hotkey: G)"]').forEach(btn => btn.querySelector('svg').innerHTML = iconCollapse);
    }
    setTimeout(() => { if (activeTableInstance) activeTableInstance.redraw(true); }, 200); 
}

function handleSearchTable() {
    const searchTableInput = document.getElementById('input-search-table');
    const searchTerm = searchTableInput.value.toLowerCase();
    
    if (tabulatorInstance) {
        if (!searchTerm) { tabulatorInstance.clearFilter(); } 
        else {
            tabulatorInstance.setFilter(function(data){
                for(let col of columnasVisibles){ 
                    let dataToSearch = (col === '_row_id') ? data[col] + 1 : data[col];
                    if(dataToSearch && String(dataToSearch).toLowerCase().includes(searchTerm)) return true; 
                }
                return false; 
            });
        }
    }
}

async function handleDownloadExcel() {
    if (!currentFileId) { alert(i18n['no_data_to_download'] || "No hay datos para descargar."); return; }
    const colsToDownload = columnasVisibles.filter(col => col !== 'Priority');
    try {
        const response = await fetch('/api/download_excel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columnas_visibles: colsToDownload })
        });
        if (!response.ok) throw new Error('Error del servidor al generar Excel.');
        const blob = await response.blob(); 
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; a.download = 'datos_filtrados_detallado.xlsx';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); 
        URL.revokeObjectURL(url);
    } catch (error) { alert('Error al descargar el archivo: ' + error.message); }
}

async function handleDownloadExcelGrouped() {
    const select = document.getElementById('select-columna-agrupar');
    const colAgrupar = select ? select.value : null;
    if (!currentFileId || !colAgrupar) { alert("Por favor seleccione una columna para agrupar antes de descargar."); return; }
    try {
        const response = await fetch('/api/download_excel_grouped', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columna_agrupar: colAgrupar })
        });
        if (!response.ok) throw new Error('Error del servidor al generar Excel.');
        const blob = await response.blob(); 
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; a.download = `datos_agrupados_por_${colAgrupar}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); 
        URL.revokeObjectURL(url);
    } catch (error) { alert('Error al descargar el archivo: ' + error.message); }
}

// ============================================================
// SECCIÓN 4: RENDERIZADO DE TABLA
// ============================================================

function updateResumenCard(resumen_data) {
    if (!resumen_data) return; 
    const totalFacturas = document.getElementById('resumen-total-facturas');
    const montoTotal = document.getElementById('resumen-monto-total');
    const montoPromedio = document.getElementById('resumen-monto-promedio');
    if (totalFacturas) totalFacturas.textContent = resumen_data.total_facturas;
    if (montoTotal) montoTotal.textContent = resumen_data.monto_total;
    if (montoPromedio) montoPromedio.textContent = resumen_data.monto_promedio;
}

function resetResumenCard() {
    updateResumenCard({
        total_facturas: '0',
        monto_total: '$0.00',
        monto_promedio: '$0.00'
    });
}

function renderFilters() {
    const listId = (currentView === 'detailed') ? 'active-filters-list' : 'active-filters-list-grouped';
    const clearBtnId = (currentView === 'detailed') ? 'btn-clear-filters' : 'btn-clear-filters-grouped';
    const filtersListDiv = document.getElementById(listId);
    const btnClear = document.getElementById(clearBtnId);
    
    if (filtersListDiv) filtersListDiv.innerHTML = '';
    if (btnClear) btnClear.style.display = 'none';
    
    if (!filtersListDiv || !btnClear) return; 

    if (activeFilters.length === 0) return;
    
    btnClear.style.display = 'inline-block';
    
    activeFilters.forEach((filtro, index) => {
        let colName = filtro.columna;
        if (filtro.columna === '_row_id') { colName = 'N° Fila'; }
        if (filtro.columna === '_row_status') { colName = 'Row Status'; }
        if (filtro.columna === '_priority') { colName = 'Prioridad'; }
        if (filtro.columna === 'Priority') { return; }
        
        const filterItemHTML = `
            <div class="filtro-chip">
                <span>${colName}: <strong>${filtro.valor}</strong></span>
                <button class="remove-filter-btn" data-index="${index}">&times;</button>
            </div>`;
        filtersListDiv.innerHTML += filterItemHTML;
    });
}

function renderTable(data = null, forceClear = false) {
    const resultsTableDiv = document.getElementById('results-table');
    if (!resultsTableDiv) return; 

    if (forceClear && tabulatorInstance) {
        tabulatorInstance.destroy();
        tabulatorInstance = null;
    }
    
    const dataToRender = data || tableData;

    if (!currentFileId) { 
        if (tabulatorInstance) {
            tabulatorInstance.destroy();
            tabulatorInstance = null;
        }
        resultsTableDiv.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    
    const dateColumns = new Set([
        "Invoice Date", "Intake Date", "Assigned Date", "Due Date", "Terms Date", "GL Date", "Updated Date", "Batch Matching Date"
    ]);
    
    const columnDefs = [
        {
            formatter: "rowSelection", titleFormatter: "rowSelection",
            width: 40, hozAlign: "center", headerSort: false, frozen: true 
        },
        {
            title: "", field: "delete", width: 40, hozAlign: "center", headerSort: false, frozen: true,
            formatter: function(cell){ return '<i class="fas fa-trash-alt delete-icon"></i>'; },
            cellClick: function(e, cell){
                if (!confirm("¿Estás seguro de que quieres eliminar esta fila?")) return; 
                handleDeleteRow(cell.getRow().getData()._row_id);
            }
        },
        {
            title: "N°", field: "_row_id", width: 70, hozAlign: "right", headerSort: true, frozen: true, 
            formatter: function(cell) { return cell.getValue() + 1; }
        },
        {
            title: "Prioridad", field: "_priority", width: 100, hozAlign: "left", headerSort: true, editable: false, frozen: true, 
            
            // Tooltip personalizado
            tooltip: function(e, cell) {
                const data = cell.getRow().getData();
                return data._priority_reason || "Sin razón específica";
            },

            sorter: function(a, b, aRow, bRow, column, dir, sorterParams){
                const priorityMap = { "Alta": 3, "Media": 2, "Baja": 1, "": 0, null: 0 };
                const aPrioVal = priorityMap[a] || 0;
                const bPrioVal = priorityMap[b] || 0;
                const prioDiff = aPrioVal - bPrioVal;
                if (prioDiff !== 0) return prioDiff;
                
                // Respetar configuración de edad (Settings)
                if (systemSettings && systemSettings.enable_age_sort === false) {
                    return 0; 
                }

                const aData = aRow.getData();
                const bData = bRow.getData();
                const aAge = Number(aData['Invoice Date Age']) || 0;
                const bAge = Number(bData['Invoice Date Age']) || 0;
                return aAge - bAge; 
            }
        }
    ];

    columnasVisibles.forEach(colName => {
        if (colName === '_row_id' || colName === '_priority' || colName === 'Priority') return; 
        
        const colTitle = (colName === '_row_status') ? "Row Status" : colName;
        let editorType = "input"; 
        let editorParams = {};
        let formatter = undefined;
        let mutatorEdit = undefined;
        let isEditable = true; 
        
        if (colName === '_row_status') {
            isEditable = false;
            editorType = undefined;
        }
        else if (dateColumns.has(colName)) {
            editorType = "date";
            mutatorEdit = function(value) { return value ? value.split(" ")[0] : value; }
            formatter = function(cell) { const val = cell.getValue(); return val ? (val.split ? val.split(" ")[0] : val) : ""; }
        }
        else if (colName === 'Sender Email') {
            editorType = "autocomplete";
            const options = (autocompleteOptions && autocompleteOptions[colName]) ? autocompleteOptions[colName] : [];
            editorParams = { values: options, showListOnEmpty: true, freetext: true };
        } 
        else if (autocompleteOptions && autocompleteOptions[colName] && autocompleteOptions[colName].length > 0) {
            const options = autocompleteOptions[colName];
            if (options.length > 50) {
                editorType = "autocomplete";
                editorParams = { values: options, showListOnEmpty: true, freetext: true };
            } else {
                editorType = "select";
                editorParams = { values: ["", ...options] };
            }
        }

        columnDefs.push({
            title: colTitle,
            field: colName,
            editor: isEditable ? editorType : undefined, 
            editable: isEditable, 
            editorParams: editorParams,
            mutatorEdit: mutatorEdit, 
            formatter: formatter,    
            minWidth: 150, 
            visible: true, 
        });
    });

    if (tabulatorInstance) {
        tabulatorInstance.setColumns(columnDefs); 
        tabulatorInstance.setData(dataToRender);
        if(dataToRender.length === 0) {
            const placeholderText = (activeFilters.length > 0 || document.getElementById('input-search-table').value)
                ? (i18n['no_filters_applied'] || 'No results for these filters.')
                : (i18n['info_upload'] || 'No data found.');
            
            // --- (INICIO - CORRECCIÓN v17.3.1) ---
            // (Documentación: Línea eliminada para prevenir el TypeError benigno)
            // tabulatorInstance.setPlaceholder(placeholderText); // <-- (Línea 622 eliminada)
            // (Documentación: setData([]) es suficiente para que Tabulator muestre el placeholder original)
            // --- (FIN - CORRECCIÓN v17.3.1) ---
        }
    } else {
        tabulatorInstance = new Tabulator(resultsTableDiv, {
            selectableRows: true,
            
            rowFormatter: function(row) {
                const data = row.getData();
                const element = row.getElement(); 
                element.classList.remove('priority-alta', 'priority-media', 'priority-baja');
                if (data._priority === 'Alta') element.classList.add('priority-alta');
                else if (data._priority === 'Media') element.classList.add('priority-media');
                else if (data._priority === 'Baja') element.classList.add('priority-baja');
            },
            index: "_row_id", 
            virtualDom: true, 
            data: dataToRender, 
            columns: columnDefs, 
            layout: "fitData", 
            movableColumns: true, 
            placeholder: `<p>${i18n['info_upload'] || 'Upload file'}</p>`,
        });

        // --- (INICIO - SECCIÓN MODIFICADA v17.3) ---
        // (Documentación: Esta función ahora controla AMBOS botones, Edición y Eliminación)
        tabulatorInstance.on("rowSelectionChanged", function(data, rows){
            // (Documentación: Obtenemos ambos botones de acción)
            const btnBulkEdit = document.getElementById('btn-bulk-edit');
            const btnBulkDelete = document.getElementById('btn-bulk-delete');

            // (Documentación: Si no existen los botones, no hacemos nada)
            if (!btnBulkEdit || !btnBulkDelete) return;

            if (rows.length > 0) {
                // (Documentación: Mostrar ambos botones)
                btnBulkEdit.style.display = 'inline-block';
                btnBulkDelete.style.display = 'inline-block';
                
                // (Documentación: Actualizar contadores de ambos botones)
                btnBulkEdit.textContent = `Editar (${rows.length})`;
                btnBulkDelete.textContent = `${i18n['btn_bulk_delete'] || 'Eliminar'} (${rows.length})`;
            } else {
                // (Documentación: Ocultar ambos botones si no hay selección)
                btnBulkEdit.style.display = 'none';
                btnBulkDelete.style.display = 'none';
            }
        });
        // --- (FIN - SECCIÓN MODIFICADA v17.3) ---

        tabulatorInstance.on("cellEdited", async function(cell){
            const newValue = cell.getValue();
            const oldValue = cell.getOldValue(); 
            const colField = cell.getField();
            const rowData = cell.getRow().getData();
            const rowId = rowData._row_id; 

            if (dateColumns.has(colField) && (newValue === null || newValue === "") && (oldValue !== null && oldValue !== "")) {
                cell.restoreOldValue(); return; 
            }
            if (newValue === oldValue) return; 

            const rowElement = cell.getRow().getElement();
            if (rowElement) rowElement.style.backgroundColor = "#FFF9E5";
            
            try {
                const response = await fetch('/api/update_cell', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_id: currentFileId, row_id: rowId, columna: colField, valor: newValue })
                });
                
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                
                if (result.resumen) updateResumenCard(result.resumen);
                undoHistoryCount = result.history_count;
                updateActionButtonsVisibility();

                const row = cell.getRow();
                if (result.new_priority) {
                    if (rowElement) {
                        rowElement.classList.remove('priority-alta', 'priority-media', 'priority-baja');
                        if (result.new_priority === 'Alta') rowElement.classList.add('priority-alta');
                        else if (result.new_priority === 'Media') rowElement.classList.add('priority-media');
                        else if (result.new_priority === 'Baja') rowElement.classList.add('priority-baja');
                    }
                    row.update({_priority: result.new_priority});
                }
                if (result.new_row_status) row.update({_row_status: result.new_row_status});
                
                if (rowElement) {
                    rowElement.style.backgroundColor = "";
                    row.reformat();
                }
            } catch (error) {
                console.error("Error al guardar celda:", error);
                alert("Error al guardar el cambio: " + error.message);
                cell.restoreOldValue();
                if (rowElement) rowElement.style.backgroundColor = ""; 
            }
        });
    }
}

// ============================================================
// SECCIÓN 5: LÓGICA DE VISTAS
// ============================================================
function updateActionButtonsVisibility() {
    const btnUndo = document.getElementById('btn-undo-change');
    const btnCommit = document.getElementById('btn-commit-changes');
    const btnAddRow = document.getElementById('btn-add-row');
    
    // (NUEVO v16.8) Obtenemos el nuevo botón
    const btnAuditLog = document.getElementById('btn-download-audit-log');
    
    // (NUEVO v16.8) Añadimos la comprobación del nuevo botón
    if (!btnUndo || !btnCommit || !btnAddRow || !btnAuditLog) return;
    
    if (undoHistoryCount > 0 && currentView === 'detailed') {
        btnUndo.style.display = 'inline-block';
        btnCommit.style.display = 'inline-block';
        btnUndo.textContent = `Deshacer (${undoHistoryCount})`;
    } else {
        btnUndo.style.display = 'none';
        btnCommit.style.display = 'none';
    }
    
    if (currentFileId && currentView === 'detailed') {
         btnAddRow.style.display = 'inline-block';
         // (NUEVO v16.8) Mostrar el botón de auditoría si hay un archivo cargado
         btnAuditLog.style.display = 'inline-block';
    } else {
         btnAddRow.style.display = 'none';
         // (NUEVO v16.8) Ocultar el botón de auditoría si no hay archivo
         btnAuditLog.style.display = 'none';
    }
}

async function refreshActiveView() {
    if (currentView === 'detailed') {
        renderGroupedTable(null, null, true); 
        await getFilteredData(); 
    } 
    else if (currentView === 'grouped') {
        renderTable(null, true); 
        await getGroupedData();
    }
    updateActionButtonsVisibility();
}

async function getFilteredData() {
    const resultsHeader = document.getElementById('results-header');
    
    if (!currentFileId) { 
        currentData = []; tableData = []; renderFilters(); renderTable(null, true); resetResumenCard(); 
        if (resultsHeader) resultsHeader.textContent = i18n['results_header']?.split('(')[0] || 'Results'; 
        return; 
    }
    
    try {
        const response = await fetch('/api/filter', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters })
        });
        const result = await response.json(); 
        if (!response.ok) throw new Error(result.error);

        currentData = result.data;
        tableData = [...currentData];

        if (result.resumen) updateResumenCard(result.resumen);

        renderFilters(); 
        renderTable(result.data); 

        if (resultsHeader) resultsHeader.textContent = i18n['results_header']?.replace('{num_filas}', result.num_filas) || `Results (${result.num_filas})`;

    } catch (error) { 
        console.error('Error en fetch /api/filter:', error); 
        alert('Error al filtrar: ' + error.message);
        resetResumenCard(); 
        renderTable(null, true);
    }
}

async function getGroupedData() {
    const select = document.getElementById('select-columna-agrupar');
    const colAgrupar = select ? select.value : null;

    if (!currentFileId || !colAgrupar) {
        renderGroupedTable(null, null, true); 
        return;
    }

    try {
        const resultsDiv = document.getElementById('results-table-grouped');
        resultsDiv.innerHTML = `<p>Agrupando datos...</p>`;

        const response = await fetch('/api/group_by', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, filtros_activos: activeFilters, columna_agrupar: colAgrupar })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        renderGroupedTable(result.data, colAgrupar, false);
        renderFilters(); 

    } catch (error) {
        console.error('Error en fetch /api/group_by:', error);
        const resultsDiv = document.getElementById('results-table-grouped');
        resultsDiv.innerHTML = `<p style="color: red;">Error al agrupar: ${error.message}</p>`;
    }
}

function toggleView(view, force = false) {
    if (view === currentView && !force) return; 
    currentView = view;
    
    const contDetailed = document.getElementById('view-container-detailed');
    const contGrouped = document.getElementById('view-container-grouped');
    const btnDetailed = document.getElementById('btn-view-detailed');
    const btnGrouped = document.getElementById('btn-view-grouped');
    const groupControls = document.getElementById('group-by-controls-wrapper');
    const detailedControls = document.querySelector('#view-container-detailed .table-controls');

    if (view === 'detailed') {
        contDetailed.style.display = 'flex'; 
        contGrouped.style.display = 'none';
        btnDetailed.classList.add('active');
        btnGrouped.classList.remove('active');
        groupControls.style.display = 'none'; 
        if (detailedControls) detailedControls.style.display = 'flex'; 

    } else { 
        contDetailed.style.display = 'none';
        contGrouped.style.display = 'flex';
        btnDetailed.classList.remove('active');
        btnGrouped.classList.add('active');
        groupControls.style.display = 'flex'; 
        if (detailedControls) detailedControls.style.display = 'none'; 

        populateGroupDropdown();
        const selectAgrupar = document.getElementById('select-columna-agrupar');
        if (selectAgrupar) {
            const firstOption = selectAgrupar.querySelector('option[value!=""]');
            if (firstOption && !selectAgrupar.value) { 
                selectAgrupar.value = firstOption.value;
            }
        }
    }
    
    if (force && view === 'detailed') refreshActiveView();
    else if (!force) refreshActiveView();
    
    updateActionButtonsVisibility();
}

function populateGroupDropdown() {
    const select = document.getElementById('select-columna-agrupar');
    if (!select) return; 
    
    const valorActual = select.value;
    select.innerHTML = `<option value="">${i18n['group_by_placeholder'] || 'Select column...'}</option>`;

    const opcionesValidas = COLUMNAS_AGRUPABLES.filter(col => 
        todasLasColumnas.includes(col) && col !== '_row_id'
    );

    opcionesValidas.forEach(colName => {
        const option = document.createElement('option');
        option.value = colName;
        if (colName === '_row_status') option.textContent = "Row Status";
        else if (colName === '_priority') option.textContent = "Prioridad";
        else option.textContent = colName;
        select.appendChild(option);
    });

    if (opcionesValidas.includes(valorActual)) select.value = valorActual;
}

async function handleGroupColumnChange() {
    await getGroupedData();
}

function renderGroupedTable(data, colAgrupada, forceClear = false) {
    const resultsTableDiv = document.getElementById('results-table-grouped');
    if (!resultsTableDiv) return;

    if (forceClear && groupedTabulatorInstance) {
        groupedTabulatorInstance.destroy();
        groupedTabulatorInstance = null;
    }

    if (!data || data.length === 0) {
        if (groupedTabulatorInstance) {
             groupedTabulatorInstance.destroy();
             groupedTabulatorInstance = null;
        }
        resultsTableDiv.innerHTML = `<p>${i18n['info_upload'] || 'Please upload a file and select a grouping column.'}</p>`;
        return;
    }

    const headersMap = {};
    if (colAgrupada) { 
        headersMap[colAgrupada] = (colAgrupada === '_row_status') ? "Row Status" : colAgrupada;
        if (colAgrupada === '_priority') { headersMap[colAgrupada] = "Prioridad"; }
    }
    headersMap["Total_sum"] = i18n['group_total_amount'] || "Total Amount";
    headersMap["Total_mean"] = i18n['group_avg_amount'] || "Avg Amount";
    headersMap["Total_min"] = i18n['group_min_amount'] || "Min Amount";
    headersMap["Total_max"] = i18n['group_max_amount'] || "Max Amount";
    headersMap["Total_count"] = i18n['group_invoice_count'] || "Invoice Count";
    
    const headerOrder = [colAgrupada, "Total_sum", "Total_mean", "Total_min", "Total_max", "Total_count"];

    const columnDefs = [];
    headerOrder.forEach(key => {
        if (headersMap[key]) { 
            const isMoney = key.startsWith('Total_') && key !== 'Total_count';
            columnDefs.push({
                title: headersMap[key],
                field: key,
                minWidth: 140,
                hozAlign: isMoney ? "right" : "left",
                formatter: isMoney ? "money" : "string",
                formatterParams: isMoney ? { decimal: ".", thousand: ",", symbol: "$", precision: 2 } : {}
            });
        }
    });

    if (groupedTabulatorInstance) groupedTabulatorInstance.destroy();
    
    groupedTabulatorInstance = new Tabulator(resultsTableDiv, {
        data: data, 
        columns: columnDefs, 
        layout: "fitData", 
        movableColumns: true, 
    });
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

// ============================================================
// SECCIÓN 6: MODALES Y GESTIÓN DE LISTAS/BULK EDIT
// ============================================================

// --- Bulk Edit ---

function openBulkEditModal() {
    if (!tabulatorInstance) return;
    const selectedRows = tabulatorInstance.getSelectedData();
    if (selectedRows.length === 0) { alert("No hay filas seleccionadas."); return; }

    const countText = document.getElementById('bulk-edit-count');
    countText.textContent = `Vas a editar ${selectedRows.length} filas seleccionadas.`;

    const colSelect = document.getElementById('bulk-edit-column');
    colSelect.innerHTML = '<option value="">Seleccione una columna...</option>';
    
    todasLasColumnas.forEach(col => {
        if (col.startsWith('_') || col === 'Priority') return; 
        const option = document.createElement('option');
        option.value = col; option.textContent = col;
        colSelect.appendChild(option);
    });

    document.getElementById('bulk-edit-value').value = '';
    document.getElementById('bulk-edit-value-list').innerHTML = '';

    // Ocultar otros modales
    document.getElementById('manage-lists-modal').style.display = 'none';
    document.getElementById('priority-rules-modal').style.display = 'none';
    
    // --- (INICIO - MODIFICACIÓN v17.3) ---
    // (Documentación: Ocultar el modal de duplicados (que ya no existe, pero es buena práctica))
    const dupModal = document.getElementById('duplicates-modal');
    if (dupModal) dupModal.style.display = 'none';
    // --- (FIN - MODIFICACIÓN v17.3) ---

    document.getElementById('bulk-edit-modal').style.display = 'flex';
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeBulkEditModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('bulk-edit-modal').style.display = 'none';
}

function updateBulkEditAutocomplete() {
    const col = document.getElementById('bulk-edit-column').value;
    const list = document.getElementById('bulk-edit-value-list');
    list.innerHTML = '';
    if (autocompleteOptions[col]) {
        autocompleteOptions[col].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val; list.appendChild(opt);
        });
    }
}

async function handleBulkEditApply() {
    if (!tabulatorInstance || !currentFileId) return;
    const selectedRows = tabulatorInstance.getSelectedData();
    const col = document.getElementById('bulk-edit-column').value;
    const val = document.getElementById('bulk-edit-value').value;

    if (!col) { alert("Por favor, seleccione una columna."); return; }
    if (!confirm(`¿Estás seguro de cambiar "${col}" a "${val}" en ${selectedRows.length} filas?`)) return;

    const rowIds = selectedRows.map(r => r._row_id);

    try {
        const response = await fetch('/api/bulk_update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_id: currentFileId,
                row_ids: rowIds,
                column: col,
                new_value: val
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        alert(result.message); 
        undoHistoryCount = result.history_count;
        if (result.resumen) updateResumenCard(result.resumen);
        updateActionButtonsVisibility();
        
        closeBulkEditModal();
        tabulatorInstance.deselectRow(); 
        await getFilteredData();

    } catch (error) {
        console.error("Error en Bulk Update:", error);
        alert("Error al aplicar los cambios: " + error.message);
    }
}

// --- Manage Lists ---

function openManageListsModal() {
    const overlay = document.getElementById('modal-overlay');
    const modalLists = document.getElementById('manage-lists-modal');
    const modalBulk = document.getElementById('bulk-edit-modal'); 
    const modalRules = document.getElementById('priority-rules-modal');
    
    // --- (INICIO - MODIFICACIÓN v17.3) ---
    // (Documentación: Ocultar el modal de duplicados (que ya no existe, pero es buena práctica))
    const modalDuplicates = document.getElementById('duplicates-modal');
    // --- (FIN - MODIFICACIÓN v17.3) ---

    if (modalBulk) modalBulk.style.display = 'none';
    if (modalRules) modalRules.style.display = 'none';
    
    // --- (INICIO - MODIFICACIÓN v17.3) ---
    if (modalDuplicates) modalDuplicates.style.display = 'none';
    // --- (FIN - MODIFICACIÓN v17.3) ---
    
    overlay.style.display = 'flex';
    modalLists.style.display = 'flex';

    const selectCol = document.getElementById('manage-list-column');
    selectCol.innerHTML = '<option value="">Seleccione una columna...</option>';
    const columnasConListas = Object.keys(autocompleteOptions).sort();
    columnasConListas.forEach(col => {
        const option = document.createElement('option');
        option.value = col; option.textContent = col;
        selectCol.appendChild(option);
    });

    document.getElementById('manage-list-input').value = '';
    document.getElementById('current-list-values').innerHTML = '<em>Selecciona una columna para ver sus valores...</em>';
}

function closeManageListsModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('manage-lists-modal').style.display = 'none';
}

function updateManageListsCurrentValues() {
    const col = document.getElementById('manage-list-column').value;
    const displayBox = document.getElementById('current-list-values');
    if (!col || !autocompleteOptions[col]) {
        displayBox.innerHTML = '<em>(Lista vacía o no seleccionada)</em>'; return;
    }
    const values = autocompleteOptions[col];
    if (values.length > 0) {
        const html = values.map(v => `<span style="display:inline-block; background:#eee; padding:2px 6px; margin:2px; border-radius:4px; border:1px solid #ddd;">${v}</span>`).join('');
        displayBox.innerHTML = html;
    } else {
        displayBox.innerHTML = '<em>(Lista vacía)</em>';
    }
}

async function handleManageListsSave() {
    const colToEdit = document.getElementById('manage-list-column').value;
    const modificationsStr = document.getElementById('manage-list-input').value;

    if (!colToEdit) { alert("Selecciona qué columna editar."); return; }
    if (!modificationsStr.trim()) { alert("No escribiste cambios."); return; }

    const currentValues = autocompleteOptions[colToEdit] || [];
    const valuesSet = new Set(currentValues);
    const modificationsArray = modificationsStr.split(',').map(val => val.trim()).filter(val => val);   

    let addedCount = 0; let removedCount = 0;
    modificationsArray.forEach(mod => {
        if (mod.startsWith('-')) {
            const valueToRemove = mod.substring(1).trim(); 
            if (valuesSet.has(valueToRemove)) { valuesSet.delete(valueToRemove); removedCount++; }
        } else {
            const valueToAdd = mod.trim();
            if (valueToAdd && !valuesSet.has(valueToAdd)) { valuesSet.add(valueToAdd); addedCount++; }
        }
    });

    const newValuesArray = Array.from(valuesSet).sort();
    autocompleteOptions[colToEdit] = newValuesArray;

    try {
        const response = await fetch('/api/save_autocomplete_lists', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(autocompleteOptions) 
        });
        if (!response.ok) throw new Error('Error del servidor');
        
        alert(`Listas guardadas.\nAñadidos: ${addedCount}\nEliminados: ${removedCount}`);
        closeManageListsModal();
        if (currentView === 'detailed' && tabulatorInstance) renderTable();

    } catch (error) {
        console.error("Error guardar listas:", error);
        alert("Error al guardar: " + error.message);
        autocompleteOptions[colToEdit] = currentValues;
    }
}

// ============================================================
// SECCIÓN 7: REGLAS DE PRIORIDAD (v16.7.2 FIX)
// ============================================================

// Autocompletado para valor de regla
function updateRuleValueAutocomplete() {
    const colSelect = document.getElementById('rule-column');
    const dataList = document.getElementById('rule-value-datalist');
    if (!colSelect || !dataList) return;

    const colName = colSelect.value;
    dataList.innerHTML = ''; // Limpiar

    if (autocompleteOptions && autocompleteOptions[colName]) {
        autocompleteOptions[colName].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            dataList.appendChild(opt);
        });
    }
}

// --- (INICIO DE LA CORRECCIÓN v16.7.2) ---
/**
 * (Documentación de Google: Inicio)
 * Propósito: Resetea (limpia) los campos del formulario de "Añadir Regla".
 * * Se llama al cerrar el modal o al guardar una regla exitosamente
 * para prevenir que datos antiguos persistan en el formulario.
 * (Esta función corrige el bug reportado).
 * (Documentación de Google: Fin)
 */
function resetAddRuleForm() {
    const ruleColSelect = document.getElementById('rule-column');
    const ruleValueInput = document.getElementById('rule-value');
    const rulePrioSelect = document.getElementById('rule-priority');
    const ruleReasonInput = document.getElementById('rule-reason');
    const ruleDatalist = document.getElementById('rule-value-datalist');

    // (Reseteamos todos los campos a su estado inicial)
    if (ruleColSelect) ruleColSelect.value = "";
    if (ruleValueInput) ruleValueInput.value = "";
    if (rulePrioSelect) rulePrioSelect.value = "Media"; // (Resetear a 'Media')
    if (ruleReasonInput) ruleReasonInput.value = "";
    if (ruleDatalist) ruleDatalist.innerHTML = ""; // (Limpiar autocomplete)
}
// --- (FIN DE LA CORRECCIÓN v16.7.2) ---


async function openPriorityRulesModal() {
    const overlay = document.getElementById('modal-overlay');
    const modalRules = document.getElementById('priority-rules-modal');
    const modalBulk = document.getElementById('bulk-edit-modal');
    const modalLists = document.getElementById('manage-lists-modal');
    
    // --- (INICIO - MODIFICACIÓN v17.3) ---
    // (Documentación: Ocultar el modal de duplicados (que ya no existe, pero es buena práctica))
    const modalDuplicates = document.getElementById('duplicates-modal');
    // --- (FIN - MODIFICACIÓN v17.3) ---
    
    // Ocultar otros modales
    if (modalBulk) modalBulk.style.display = 'none';
    if (modalLists) modalLists.style.display = 'none';

    // --- (INICIO - MODIFICACIÓN v17.3) ---
    if (modalDuplicates) modalDuplicates.style.display = 'none';
    // --- (FIN - MODIFICACIÓN v17.3) ---
    
    overlay.style.display = 'flex';
    modalRules.style.display = 'flex';

    // 1. Llenar Dropdown de columnas (solo columnas útiles)
    const ruleColSelect = document.getElementById('rule-column');
    ruleColSelect.innerHTML = '<option value="">Seleccione columna...</option>';
    todasLasColumnas.forEach(col => {
        if (!col.startsWith('_') && col !== 'Priority') {
            const opt = document.createElement('option');
            opt.value = col; opt.textContent = col;
            ruleColSelect.appendChild(opt);
        }
    });

    // 2. Cargar reglas y settings
    const listContainer = document.getElementById('rules-list-container');
    listContainer.innerHTML = '<em>Cargando reglas...</em>';
    
    try {
        const response = await fetch('/api/priority_rules/get');
        const data = await response.json();
        
        renderRulesList(data.rules);
        
        // Cargar Settings Globales
        systemSettings = data.settings || systemSettings;
        document.getElementById('setting-scf').checked = systemSettings.enable_scf_intercompany;
        document.getElementById('setting-age-sort').checked = systemSettings.enable_age_sort;
        
    } catch (e) {
        listContainer.innerHTML = '<span style="color:red">Error cargando reglas.</span>';
    }
}
/**
 * (Documentación de Google: Inicio)
 * Propósito: Cierra el modal de reglas.
 * (MODIFICADO v16.7.2)
 * Se añade la llamada a `resetAddRuleForm` para limpiar el formulario
 * cada vez que el usuario cierra el modal.
 * (Documentación de Google: Fin)
 */
function closePriorityRulesModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('priority-rules-modal').style.display = 'none';

    // --- (INICIO DE LA CORRECCIÓN v16.7.2) ---
    // (Llamamos a la función de limpieza al cerrar)
    resetAddRuleForm();
    // --- (FIN DE LA CORRECCIÓN v16.7.2) ---
}

function renderRulesList(rules) {
    const container = document.getElementById('rules-list-container');
    container.innerHTML = '';
    
    if (!rules || rules.length === 0) {
        container.innerHTML = '<em>No hay reglas definidas.</em>';
        return;
    }

    rules.forEach(rule => {
        const div = document.createElement('div');
        div.className = 'rule-item';
        
        const opacityStyle = rule.active ? '' : 'opacity: 0.5;';
        const activeChecked = rule.active ? 'checked' : '';
        
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; ${opacityStyle} flex-grow:1;">
                <input type="checkbox" class="toggle-rule-active" data-col="${rule.column}" data-val="${rule.value}" ${activeChecked} title="Activar/Desactivar">
                <span>
                    Si <strong>${rule.column}</strong> es <strong>"${rule.value}"</strong> 
                    &rarr; <strong>${rule.priority}</strong>
                </span>
            </div>
            <button class="btn-delete-rule" title="Eliminar">&times;</button>
        `;
        
        div.querySelector('.btn-delete-rule').addEventListener('click', () => {
            if(confirm(`¿Eliminar regla para "${rule.value}"?`)) {
                handleDeleteRule(rule.column, rule.value);
            }
        });
        
        div.querySelector('.toggle-rule-active').addEventListener('change', (e) => {
            handleToggleRule(rule.column, rule.value, e.target.checked);
        });
        
        container.appendChild(div);
    });
}

/**
 * Guarda la configuración global y recarga la vista.
 * CORREGIDO: Ahora usa getFilteredData() en vez de redraw().
 */
async function handleSaveSettings() {
    const scf = document.getElementById('setting-scf').checked;
    const age = document.getElementById('setting-age-sort').checked;
    
    try {
        await fetch('/api/priority_rules/save_settings', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ enable_scf_intercompany: scf, enable_age_sort: age })
        });
        systemSettings.enable_age_sort = age; 
        alert("Configuración guardada.");
        
        // FIX CRÍTICO: Redibujar tabla completa con nuevos datos del servidor
        if (currentFileId) await getFilteredData(); 

    } catch (e) { alert("Error: " + e.message); }
}

/**
 * Activa/Desactiva una regla y refresca.
 */
async function handleToggleRule(col, val, status) {
    await fetch('/api/priority_rules/toggle', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ column: col, value: val, active: status })
    });
    // Recargar datos inmediatamente para reflejar el cambio
    if (currentFileId) await getFilteredData();
}

/**
 * (Documentación de Google: Inicio)
 * Propósito: Añade una nueva regla y refresca.
 * (MODIFICADO v16.7.2)
 * Llama a `resetAddRuleForm` después de guardar exitosamente
 * para limpiar el formulario y permitir añadir otra regla.
 * (Documentación de Google: Fin)
 */
async function handleAddRule() {
    const col = document.getElementById('rule-column').value;
    const val = document.getElementById('rule-value').value;
    const prio = document.getElementById('rule-priority').value;
    const reason = document.getElementById('rule-reason').value;

    if (!col || !val || !reason) {
        alert("Por favor completa todos los campos.");
        return;
    }

    try {
        const response = await fetch('/api/priority_rules/save', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ column: col, value: val, priority: prio, reason: reason, active: true })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        alert("Regla guardada correctamente.");
        
        // Recargar lista visual de reglas
        const listRes = await fetch('/api/priority_rules/get');
        const data = await listRes.json();
        renderRulesList(data.rules);
        
        // --- (INICIO DE LA CORRECCIÓN v16.7.2) ---
        // (Limpiamos el formulario después de guardar)
        resetAddRuleForm();
        // --- (FIN DE LA CORRECCIÓN v16.7.2) ---
        
        // Recargar datos de la tabla
        if (currentFileId) {
            if (result.resumen) updateResumenCard(result.resumen);
            await getFilteredData();
        }

    } catch (e) {
        alert("Error al guardar regla: " + e.message);
    }
}

async function handleDeleteRule(col, val) {
    try {
        const response = await fetch('/api/priority_rules/delete', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ column: col, value: val })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        const listRes = await fetch('/api/priority_rules/get');
        const data = await listRes.json();
        renderRulesList(data.rules);

        if (currentFileId) {
            if (result.resumen) updateResumenCard(result.resumen);
            await getFilteredData();
        }

    } catch (e) {
        alert("Error al eliminar regla: " + e.message);
    }
}

// ============================================================
// SECCIÓN 8: FUNCIONES DE EDICIÓN (INDIVIDUAL)
// ============================================================

function handleGlobalKeydown(event) {
    const target = event.target;
    const isTyping = target.tagName === 'INPUT' || 
                       target.tagName === 'SELECT' || 
                       target.tagName === 'TEXTAREA' ||
                       target.isContentEditable ||
                       (target.classList && target.classList.contains('tabulator-editing'));

    if (isTyping) return; 

    let handled = true; 

    switch (event.key) {
        case 'a': 
        case 'A': 
            if (currentFileId && currentView === 'detailed') handleAddRow();
            break;
        case 'z':
        case 'Z':
            if (undoHistoryCount > 0 && currentView === 'detailed') handleUndoChange();
            break;
        case 's':
        case 'S':
            if (undoHistoryCount > 0 && currentView === 'detailed') handleCommitChanges();
            break;
        case 'Delete': 
            if (activeFilters.length > 0) handleClearFilters();
            break;
        case 'f':
        case 'F':
            if (currentView === 'detailed') {
                const searchInput = document.getElementById('input-search-table');
                if (searchInput) searchInput.focus();
            }
            break;
        case 'g': 
        case 'G':
            handleFullscreen();
            break;
        default:
            handled = false; 
            break;
    }

    if (handled) event.preventDefault();
}

async function handleAddRow() {
    if (!currentFileId) {
        alert("Por favor, cargue un archivo primero.");
        return;
    }
    try {
        const response = await fetch('/api/add_row', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 
        
        await getFilteredData();
        
        if (result.new_row_id && tabulatorInstance) {
            setTimeout(() => {
                tabulatorInstance.scrollToRow(result.new_row_id, "bottom", false);
                const row = tabulatorInstance.getRow(result.new_row_id);
                if (row) {
                    const rowElement = row.getElement();
                    if (rowElement) {
                        rowElement.style.backgroundColor = "#FFF9E5"; 
                        setTimeout(() => {
                            if (rowElement) rowElement.style.backgroundColor = ""; 
                            if(row) row.reformat();
                        }, 2000);
                    }
                }
            }, 100);
        }
    } catch (error) {
        console.error("Error al añadir fila:", error);
        alert("Error al añadir fila: " + error.message);
    }
}

async function handleDeleteRow(row_id) {
    if (!currentFileId) {
        alert("Error: No hay archivo cargado.");
        return;
    }
    try {
        const response = await fetch('/api/delete_row', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file_id: currentFileId,
                row_id: row_id
            })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 
        await getFilteredData();
    } catch (error) {
        console.error("Error al eliminar fila:", error);
        alert("Error al eliminar fila: " + error.message);
    }
}

// --- (INICIO - NUEVA FUNCIÓN v17.3) ---
/**
 * (Documentación de Google: Inicio - v17.3)
 * Propósito: Elimina masivamente las filas seleccionadas (checkboxes).
 * Llama al endpoint /api/bulk_delete_rows.
 * Es 'undoable'.
 * (Documentación de Google: Fin)
 */
async function handleBulkDelete() {
    // (Documentación: 1. Validar que la tabla exista)
    if (!tabulatorInstance || !currentFileId) return;
    
    // (Documentación: 2. Obtener filas seleccionadas)
    const selectedRows = tabulatorInstance.getSelectedData();
    
    if (selectedRows.length === 0) {
        alert("No hay filas seleccionadas para eliminar.");
        return;
    }

    // (Documentación: 3. Confirmación del usuario)
    if (!confirm(`¿Estás seguro de que quieres eliminar ${selectedRows.length} filas?\n\nEsta acción se puede deshacer.`)) {
        return;
    }

    // (Documentación: 4. Extraer los IDs)
    const rowIds = selectedRows.map(r => r._row_id);

    try {
        // (Documentación: 5. Llamar a la nueva API de backend)
        const response = await fetch('/api/bulk_delete_rows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_id: currentFileId,
                row_ids: rowIds
            })
        });
        
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        // (Documentación: 6. Mostrar éxito)
        alert(result.message); // (Ej: "Se eliminaron 5 filas. Esta acción se puede deshacer.")
        
        // (Documentación: 7. Actualizar la UI (Contador de Deshacer, KPIs))
        undoHistoryCount = result.history_count;
        if (result.resumen) updateResumenCard(result.resumen);
        updateActionButtonsVisibility(); // (Esto actualizará el contador del botón 'Deshacer')
        
        // (Documentación: 8. Deseleccionar filas en la tabla)
        tabulatorInstance.deselectRow(); 
        
        // (Documentación: 9. Refrescar los datos de la tabla)
        await getFilteredData();

    } catch (error) {
        console.error("Error en Eliminación Masiva (Bulk Delete):", error);
        alert("Error al eliminar las filas: " + error.message);
    }
}
// --- (FIN - NUEVA FUNCIÓN v17.3) ---


async function handleUndoChange() {
    if (undoHistoryCount === 0 || !currentFileId) return;
    
    try {
        const response = await fetch('/api/undo_change', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ file_id: currentFileId }) 
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 

        // --- (INICIO - MODIFICACIÓN v17.3) ---
        // (Documentación: Si fue una acción masiva (bulk), no intentamos hacer scroll)
        if (result.affected_row_id && result.affected_row_id !== 'bulk' && tabulatorInstance) {
        // --- (FIN - MODIFICACIÓN v17.3) ---
            const rowId = result.affected_row_id;
            let renderAttempts = 0;   
            const maxAttempts = 3;    
            
            const scrollOnce = () => {
                renderAttempts++;
                const row = tabulatorInstance.getRow(rowId);
                
                if (row) {
                    tabulatorInstance.off("renderComplete", scrollOnce); 
                    tabulatorInstance.scrollToRow(row, "center", false)
                    .then(() => {
                        const rowElement = row.getElement();
                        if (rowElement) {
                            rowElement.style.backgroundColor = "#FFF9E5"; 
                            setTimeout(() => {
                                if (rowElement) rowElement.style.backgroundColor = ""; 
                                if(row) row.reformat();
                            }, 2000);
                        }
                    })
                    .catch(err => { console.warn(`scrollToRow falló`, err); });
                } else if (renderAttempts >= maxAttempts) {
                    tabulatorInstance.off("renderComplete", scrollOnce); 
                }
            };
            tabulatorInstance.on("renderComplete", scrollOnce);
        }
        await getFilteredData();
    } catch (error) {
        console.error("Error al deshacer el cambio:", error);
        alert("Error al deshacer: " + error.message);
    }
}

async function handleCommitChanges() {
    if (undoHistoryCount === 0 || !currentFileId) return;
    if (!confirm("¿Estás seguro de que quieres consolidar todos los cambios?\n\nEsta acción guardará el estado actual y limpiará el historial de deshacer.")) return;
    
    try {
        const response = await fetch('/api/commit_changes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        alert(result.message);
        undoHistoryCount = 0; 
        updateActionButtonsVisibility(); 

    } catch (error) {
        console.error("Error al consolidar cambios:", error);
        alert("Error al consolidar: " + error.message);
    }
}


/**
 * (INICIO - NUEVO v16.8)
 * (Documentación de Google: Esta función maneja la descarga del reporte de auditoría.)
 * Propósito: Descarga el reporte de auditoría de la sesión actual.
 * Llama al endpoint /api/download_audit_log que creamos en app.py.
 */
async function handleDownloadAuditLog() {
    // (Documentación de Google: Verificamos que un archivo esté cargado.)
    if (!currentFileId) {
        alert(i18n['no_data_to_download'] || "No hay datos para descargar.");
        return;
    }

    try {
        // (Documentación de Google: Llamamos a la API de Flask.)
        const response = await fetch('/api/download_audit_log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        // (Documentación de Google: Manejamos el caso de error)
        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.error || 'Error del servidor al generar el reporte.');
        }

        // (Documentación de Google: El backend devuelve un archivo TXT (blob).)
        const blob = await response.blob();
        
        // (Documentación de Google: Creamos un enlace temporal para descargar el archivo.)
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // --- (ESTA ES LA LÍNEA MODIFICADA) ---
        // (Documentación de Google: Asignamos el nombre de archivo .txt)
        a.download = 'reporte_auditoria_sesion.txt'; // (Cambiado de .csv a .txt)
        // --- (FIN DE LA MODIFICACIÓN) ---

        document.body.appendChild(a);
        a.click(); // (Simulamos el clic para iniciar la descarga.)
        document.body.removeChild(a); // (Limpiamos el enlace temporal.)
        URL.revokeObjectURL(url);

    } catch (error) {
        // (Documentación de Google: Mostramos cualquier error al usuario.)
        console.error('Error al descargar el reporte de auditoría:', error);
        alert('Error al descargar el reporte: ' + error.message);
    }
}

// ============================================================
// (INICIO - SECCIÓN ELIMINADA v17.1)
// ============================================================
// (Documentación de Google: Se ha eliminado la "SECCIÓN 8B: CONTROL DE DUPLICADOS (v17.0)")
// (Documentación de Google: Las funciones openDuplicatesModal, closeDuplicatesModal, y)
// (Documentación de Google: handleFindDuplicates han sido eliminadas.)
// ============================================================

// ============================================================
// (INICIO - NUEVA SECCIÓN v17.1) 
// SECCIÓN 8B: FLUJO DE DUPLICADOS DE FACTURAS (v17.1)
// ============================================================

/**
 * (Documentación de Google: Inicio - v17.1)
 * Propósito: Muestra solo las filas de facturas duplicadas (basado en 'Invoice #').
 * Llama al endpoint /api/get_duplicate_invoices que creamos en app.py.
 * Usa la función renderTable() para mostrar *solo* los resultados,
 * sin alterar los filtros globales (activeFilters).
 * (Documentación de Google: Fin)
 */
async function handleShowDuplicates() {
    // (Documentación de Google: 1. Validar que haya un archivo cargado)
    if (!currentFileId) {
        alert(i18n['info_upload'] || "Cargue un archivo primero.");
        return;
    }
    
    // (Documentación de Google: (Opcional: Mostrar un spinner o feedback))
    // (En este caso, usamos un 'alert' al final)

    try {
        // (Documentación de Google: 2. Llamar al nuevo endpoint de VISUALIZACIÓN)
        const response = await fetch('/api/get_duplicate_invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        const result = await response.json();
        // (Documentación de Google: Manejar error del backend, ej. "columna no encontrada")
        if (!response.ok) throw new Error(result.error);

        // (Documentación de Google: 3. Analizar la respuesta)
        if (result.num_filas > 0) {
            alert(`Se encontraron ${result.num_filas} filas duplicadas. Mostrando solo duplicados.`);
            
            // (Documentación de Google: 4. Renderizar la tabla solo con los datos recibidos)
            // (Documentación de Google: Pasamos 'result.data' directamente a renderTable)
            // (Documentación de Google: Esto NO usa 'activeFilters')
            renderTable(result.data); 
            
            // (Documentación de Google: 5. Limpiamos los filtros de la UI para evitar confusión)
            // (Documentación de Google: El usuario ve duplicados, no filtros)
            activeFilters = [];
            renderFilters();
            
        } else {
            // (Documentación de Google: No se encontraron duplicados)
            alert("¡Buenas noticias! No se encontraron duplicados.");
        }
    } catch (error) {
        console.error('Error al buscar duplicados:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * (Documentación de Google: Inicio - v17.1)
 * Propósito: Elimina permanentemente las filas duplicadas (conservando la 1ra).
 * Llama al endpoint /api/cleanup_duplicate_invoices.
 * (MODIFICADO v17.2) - Esta acción ahora se puede deshacer.
 * (Documentación de Google: Fin)
 */
async function handleCleanupDuplicates() {
    // (Documentación de Google: 1. Validar que haya un archivo cargado)
    if (!currentFileId) {
        alert(i18n['info_upload'] || "Cargue un archivo primero.");
        return;
    }

    // (Documentación de Google: 2. Pedir confirmación al usuario)
    if (!confirm(
        "¿Estás seguro de que deseas eliminar permanentemente todas las facturas duplicadas?\n\n" +
        "Esta acción conservará la PRIMERA aparición de cada factura y eliminará el resto.\n\n" +
        "Esta acción se puede deshacer." // (v17.2)
    )) {
        alert('Limpieza cancelada.');
        return;
    }

    // (Documentación de Google: (Opcional: Mostrar spinner global))
    // ( ... )

    try {
        // (Documentación de Google: 3. Llamar al nuevo endpoint de ACCIÓN/LIMPIEZA)
        const response = await fetch('/api/cleanup_duplicate_invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        // (Documentación de Google: 4. Mostrar mensaje de éxito/info del backend)
        alert(result.message); // (v17.2 - El mensaje ahora dice "se puede deshacer")

        // (Documentación de Google: 5. Actualizar la UI con los datos del backend)
        if (result.resumen) updateResumenCard(result.resumen);
        
        // (Documentación de Google: (v17.2) Actualizamos el contador de 'undo')
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility();
        
        // (Documentación de Google: 6. CRÍTICO - Refrescar toda la vista de datos)
        // (Documentación de Google: Llamamos a la función principal de filtro)
        // (Documentación de Google: (que ahora obtendrá los datos limpios de la sesión))
        await getFilteredData();

    } catch (error) {
        console.error('Error al limpiar duplicados:', error);
        alert(`Error al limpiar duplicados: ${error.message}`);
    }
}
// ============================================================
// (FIN - NUEVA SECCIÓN v17.1)
// ============================================================

// ============================================================
// SECCIÓN 9: GESTIÓN DE VISTAS (Guardar/Cargar JSON)
// ============================================================

function handleSaveView() {
    if (!currentFileId) {
        alert(i18n['no_data_to_save_view'] || "Cargue un archivo primero para guardar una vista.");
        return;
    }
    const groupByColElement = document.getElementById('select-columna-agrupar');
    const viewConfig = {
        viewType: currentView,
        activeFilters: activeFilters,
        visibleColumns: columnasVisibles,
        groupByColumn: groupByColElement ? groupByColElement.value : ""
    };

    const jsonString = JSON.stringify(viewConfig, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'mi_vista_config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleLoadView(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/json') {
        alert(i18n['invalid_json_file'] || "Por favor, seleccione un archivo .json válido.");
        event.target.value = null; 
        return;
    }
    if (!currentFileId) {
        alert(i18n['load_excel_first'] || "Por favor, cargue primero un archivo Excel antes de cargar una vista.");
        event.target.value = null; 
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const config = JSON.parse(e.target.result);
            activeFilters = config.activeFilters || [];
            
            const loadedVisibleCols = config.visibleColumns || todasLasColumnas;
            columnasVisibles = loadedVisibleCols.filter(col => todasLasColumnas.includes(col));

            const viewType = config.viewType || 'detailed';
            const groupByCol = config.groupByColumn || '';
            
            const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = columnasVisibles.includes(cb.value);
            });
            
            const groupBySelect = document.getElementById('select-columna-agrupar');
            if (groupBySelect) {
                if (groupBySelect.querySelector(`option[value="${groupByCol}"]`)) {
                    groupBySelect.value = groupByCol;
                } else {
                    groupBySelect.value = ""; 
                }
            }
            toggleView(viewType, true); 
        } catch (error) {
            console.error("Error al parsear el archivo JSON:", error);
            alert(i18n['json_parse_error'] || "Error al leer el archivo JSON.");
        }
    };
    reader.onerror = () => { alert(i18n['file_read_error'] || "No se pudo leer el archivo."); };
    reader.readAsText(file);
    event.target.value = null;
}

// ============================================================
// INICIALIZACIÓN
// ============================================================

document.addEventListener('DOMContentLoaded', async (event) => {
    
    await loadTranslations();
    
    try {
        if (typeof SESSION_DATA !== 'undefined' && SESSION_DATA.file_id) {
            currentFileId = SESSION_DATA.file_id;
            todasLasColumnas = SESSION_DATA.columnas;
            
            columnasVisibles = [...todasLasColumnas];
            
            if (SESSION_DATA.autocomplete_options) {
                 autocompleteOptions = SESSION_DATA.autocomplete_options;
            }

            populateColumnDropdowns();
            renderColumnSelector();
            updateVisibleColumnsFromCheckboxes();
            updateFilterInputAutocomplete();
            
            undoHistoryCount = SESSION_DATA.history_count || 0;
            updateActionButtonsVisibility();
            
            refreshActiveView(); 
            
        } else {
            renderColumnSelector();
            undoHistoryCount = 0;
            updateActionButtonsVisibility();
        }
        setupEventListeners(); 
        
    } catch (e) {
        console.error("Error fatal al inicializar:", e);
    }
});