/**
 * script.js (Versión 15.3 - Modales Completos)
 *
 * Cambios realizados en esta versión:
 * 1. SECCIÓN 6: Se reemplazó la función 'handleManageLists' (basada en prompt)
 * por un conjunto de funciones para manejar el nuevo Modal de Listas:
 * - openManageListsModal: Abre el modal y carga el dropdown de columnas.
 * - closeManageListsModal: Cierra el modal.
 * - updateManageListsCurrentValues: Muestra visualmente los valores actuales.
 * - handleManageListsSave: Procesa la lógica de añadir/eliminar y guarda.
 * 2. setupEventListeners: Se actualizaron los listeners para conectar
 * los botones del nuevo modal (Guardar, Cancelar, Cambio de Columna).
 * 3. openBulkEditModal: Se asegura de ocultar el modal de listas si estaba abierto.
 */

// --- Variable global para traducciones ---
let i18n = {}; 

// --- Variables de Estado Globales ---
let currentFileId = null; 
let activeFilters = []; 
let currentData = [];
let tableData = [];
let todasLasColumnas = [];
let columnasVisibles = [];
let currentView = 'detailed';
let undoHistoryCount = 0;

// --- Variable para Autocompletado ---
let autocompleteOptions = {};

// --- Instancias de Tabulator ---
let tabulatorInstance = null;
let groupedTabulatorInstance = null; 

// (Columnas agrupables)
const COLUMNAS_AGRUPABLES = [
    "Vendor Name", "Status", "Assignee", 
    "Operating Unit Name", "Pay Status", "Document Type", 
    "_row_status", "_priority", 
    "Pay group", "WEC Email Inbox", "Sender Email", "Currency Code", "payment method"
];

// ---
// SECCIÓN 1: MANEJO DE COLUMNAS
// ---
function renderColumnSelector() {
    const wrapper = document.getElementById('column-selector-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = ''; 
    if (todasLasColumnas.length === 0) { 
        wrapper.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    
    todasLasColumnas.filter(col => 
        col !== '_row_id' && 
        col !== '_priority' && 
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

function updateVisibleColumnsFromCheckboxes() {
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    columnasVisibles = [];
    checkboxes.forEach(cb => {
        if (cb.checked) {
            columnasVisibles.push(cb.value);
        }
    });
    
    if (todasLasColumnas.includes('_row_id')) {
        columnasVisibles.push('_row_id');
    }
    if (todasLasColumnas.includes('_priority')) {
        columnasVisibles.push('_priority');
    }
    
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

// ---
// SECCIÓN 2: CONFIGURACIÓN INICIAL Y LISTENERS
// ---
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

function setupEventListeners() {
    const fileUploader = document.getElementById('file-uploader');
    const dragDropArea = document.querySelector('.drag-drop-label');
    const btnAdd = document.getElementById('btn-add-filter');
    const btnLangEs = document.getElementById('btn-lang-es');
    const btnLangEn = document.getElementById('btn-lang-en');
    const columnSelectorWrapper = document.getElementById('column-selector-wrapper');
    const btnCheckAllCols = document.getElementById('btn-check-all-cols');
    const btnUncheckAllCols = document.getElementById('btn-uncheck-all-cols');

    const addSafeListener = (element, event, handler) => {
        if (element) {
            element.addEventListener(event, handler);
        }
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

    // Listeners Vistas
    addSafeListener(document.getElementById('btn-view-detailed'), 'click', () => toggleView('detailed'));
    addSafeListener(document.getElementById('btn-view-grouped'), 'click', () => toggleView('grouped'));
    addSafeListener(document.getElementById('select-columna-agrupar'), 'change', handleGroupColumnChange);
    
    addSafeListener(document.getElementById('btn-clear-filters-grouped'), 'click', handleClearFilters);
    addSafeListener(document.getElementById('btn-fullscreen-grouped'), 'click', handleFullscreen);
    addSafeListener(document.getElementById('btn-download-excel-grouped'), 'click', handleDownloadExcelGrouped);
    addSafeListener(document.getElementById('active-filters-list-grouped'), 'click', handleRemoveFilter);

    // (Documentación de Google: ¡MODIFICADO v15.3! Listeners del Nuevo Modal de Listas)
    addSafeListener(document.getElementById('btn-manage-lists'), 'click', openManageListsModal);
    addSafeListener(document.getElementById('btn-manage-cancel'), 'click', closeManageListsModal);
    addSafeListener(document.getElementById('btn-manage-save'), 'click', handleManageListsSave);
    addSafeListener(document.getElementById('manage-list-column'), 'change', updateManageListsCurrentValues);

    addSafeListener(document.getElementById('btn-save-view'), 'click', handleSaveView);
    addSafeListener(document.getElementById('input-load-view'), 'change', handleLoadView);

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

async function setLanguage(langCode) {
    try { 
        await fetch(`/api/set_language/${langCode}`); 
        location.reload();
    }
    catch (error) { console.error('Error al cambiar idioma:', error); }
}

// ---
// SECCIÓN 3: MANEJO de EVENTOS PRINCIPALES
// ---
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
        </div>
    `;     

    const formData = new FormData(); formData.append('file', file);
    try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);

        if (tabulatorInstance) {
            tabulatorInstance.destroy();
            tabulatorInstance = null;
        }
        if (groupedTabulatorInstance) { 
            groupedTabulatorInstance.destroy();
            groupedTabulatorInstance = null;
        }

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
        todasLasColumnas = []; 
        columnasVisibles = []; 
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
        if (currentView === 'detailed') {
            document.getElementById('input-search-table').value = ''; 
        }
        await refreshActiveView();
    }
    else { alert(i18n['warning_no_filter'] || 'Select col and value'); }
}

async function handleClearFilters() { 
    activeFilters = []; 
    if (currentView === 'detailed') {
        document.getElementById('input-search-table').value = ''; 
    }
    await refreshActiveView(); 
}

async function handleRemoveFilter(event) {
    if (!event.target.classList.contains('remove-filter-btn')) return;
    const indexToRemove = parseInt(event.target.dataset.index, 10);
    activeFilters.splice(indexToRemove, 1);
    await refreshActiveView(); 
}

function handleFullscreen(event) {
    const viewContainerId = (currentView === 'detailed') 
        ? 'view-container-detailed' 
        : 'view-container-grouped';
    
    const viewContainer = document.getElementById(viewContainerId);

    const activeTableInstance = (currentView === 'detailed') 
        ? tabulatorInstance 
        : groupedTabulatorInstance;

    const iconExpand = `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />`;
    const iconCollapse = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />`;

    if (document.body.classList.contains('fullscreen-mode')) {
        document.body.classList.remove('fullscreen-mode');
        if (viewContainer) viewContainer.classList.remove('in-fullscreen');
        
        document.querySelectorAll('.icon-button[title="Pantalla Completa (Hotkey: G)"]').forEach(btn => {
            const svg = btn.querySelector('svg');
            if (svg) svg.innerHTML = iconExpand; 
        });

    } else {
        document.body.classList.add('fullscreen-mode');
        if (viewContainer) viewContainer.classList.add('in-fullscreen');

        document.querySelectorAll('.icon-button[title="Pantalla Completa (Hotkey: G)"]').forEach(btn => { 
            const svg = btn.querySelector('svg');
            if (svg) svg.innerHTML = iconCollapse; 
        });
    }

    setTimeout(() => {
        if (activeTableInstance) {
            activeTableInstance.redraw(true);
        }
    }, 200); 
}

function handleSearchTable() {
    const searchTableInput = document.getElementById('input-search-table');
    const searchTerm = searchTableInput.value.toLowerCase();
    
    if (tabulatorInstance) {
        if (!searchTerm) {
            tabulatorInstance.clearFilter();
        } else {
            tabulatorInstance.setFilter(function(data){
                for(let col of columnasVisibles){ 
                    let dataToSearch;
                    if (col === '_row_id') {
                        dataToSearch = data[col] + 1; 
                    } else {
                        dataToSearch = data[col];
                    }
                    if(dataToSearch && String(dataToSearch).toLowerCase().includes(searchTerm)){
                        return true; 
                    }
                }
                return false; 
            });
        }
    }
}

async function handleDownloadExcel() {
    if (!currentFileId) { 
        alert(i18n['no_data_to_download'] || "No hay datos para descargar."); 
        return; 
    }
    const colsToDownload = columnasVisibles.filter(col => col !== 'Priority');
    
    try {
        const response = await fetch('/api/download_excel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file_id: currentFileId, 
                filtros_activos: activeFilters, 
                columnas_visibles: colsToDownload 
            })
        });
        if (!response.ok) throw new Error('Error del servidor al generar Excel.');
        
        const blob = await response.blob(); 
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; 
        a.download = 'datos_filtrados_detallado.xlsx';
        document.body.appendChild(a); 
        a.click(); 
        document.body.removeChild(a); 
        URL.revokeObjectURL(url);
        
    } catch (error) { 
        console.error('Error en fetch /api/download_excel:', error); 
        alert('Error al descargar el archivo: ' + error.message); 
    }
}

async function handleDownloadExcelGrouped() {
    const select = document.getElementById('select-columna-agrupar');
    const colAgrupar = select ? select.value : null;

    if (!currentFileId || !colAgrupar) {
        alert("Por favor seleccione una columna para agrupar antes de descargar.");
        return;
    }
    
    try {
        const response = await fetch('/api/download_excel_grouped', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file_id: currentFileId, 
                filtros_activos: activeFilters, 
                columna_agrupar: colAgrupar
            })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Error del servidor al generar Excel.');
        }
        
        const blob = await response.blob(); 
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; 
        a.download = `datos_agrupados_por_${colAgrupar}.xlsx`;
        document.body.appendChild(a); 
        a.click(); 
        document.body.removeChild(a); 
        URL.revokeObjectURL(url);
        
    } catch (error) { 
        console.error('Error en fetch /api/download_excel_grouped:', error); 
        alert('Error al descargar el archivo: ' + error.message); 
    }
}

// ============================================================
// SECCIÓN 6: GESTIÓN DE LISTAS (MODAL) v15.3
// ============================================================

/**
 * @description Abre el modal para administrar listas de autocompletado.
 * Reemplaza el antiguo sistema de 'prompt'.
 */
function openManageListsModal() {
    const overlay = document.getElementById('modal-overlay');
    const modalLists = document.getElementById('manage-lists-modal');
    const modalBulk = document.getElementById('bulk-edit-modal'); 
    const selectCol = document.getElementById('manage-list-column');

    // Asegurar que otros modales estén cerrados
    if (modalBulk) modalBulk.style.display = 'none';
    overlay.style.display = 'flex';
    modalLists.style.display = 'flex';

    // Cargar el dropdown
    selectCol.innerHTML = '<option value="">Seleccione una columna...</option>';
    
    // Obtener las columnas que tienen autocompletado
    const columnasConListas = Object.keys(autocompleteOptions).sort();

    columnasConListas.forEach(col => {
        const option = document.createElement('option');
        option.value = col;
        option.textContent = col;
        selectCol.appendChild(option);
    });

    // Limpiar campos
    document.getElementById('manage-list-input').value = '';
    document.getElementById('current-list-values').innerHTML = '<em>Selecciona una columna para ver sus valores...</em>';
}

function closeManageListsModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('manage-lists-modal').style.display = 'none';
}

/**
 * @description Actualiza la caja de texto con los valores actuales de la lista.
 */
function updateManageListsCurrentValues() {
    const col = document.getElementById('manage-list-column').value;
    const displayBox = document.getElementById('current-list-values');
    
    if (!col || !autocompleteOptions[col]) {
        displayBox.innerHTML = '<em>(Lista vacía o no seleccionada)</em>';
        return;
    }

    const values = autocompleteOptions[col];
    if (values.length > 0) {
        // Mostrar los valores como etiquetas pequeñas
        const html = values.map(v => `<span style="display:inline-block; background:#eee; padding:2px 6px; margin:2px; border-radius:4px; border:1px solid #ddd;">${v}</span>`).join('');
        displayBox.innerHTML = html;
    } else {
        displayBox.innerHTML = '<em>(Lista vacía)</em>';
    }
}

/**
 * @description Guarda los cambios realizados en las listas (Añadir/Eliminar).
 */
async function handleManageListsSave() {
    const colToEdit = document.getElementById('manage-list-column').value;
    const modificationsStr = document.getElementById('manage-list-input').value;

    if (!colToEdit) {
        alert("Por favor, selecciona qué columna quieres editar.");
        return;
    }

    if (!modificationsStr.trim()) {
        alert("No escribiste ningún cambio.");
        return;
    }

    const currentValues = autocompleteOptions[colToEdit] || [];
    const valuesSet = new Set(currentValues);

    const modificationsArray = modificationsStr.split(',') 
        .map(val => val.trim())   
        .filter(val => val);      

    let addedCount = 0;
    let removedCount = 0;

    modificationsArray.forEach(mod => {
        if (mod.startsWith('-')) {
            const valueToRemove = mod.substring(1).trim(); 
            if (valuesSet.has(valueToRemove)) {
                valuesSet.delete(valueToRemove);
                removedCount++; 
            }
        } else {
            const valueToAdd = mod.trim();
            if (valueToAdd && !valuesSet.has(valueToAdd)) {
                valuesSet.add(valueToAdd);
                addedCount++; 
            }
        }
    });

    const newValuesArray = Array.from(valuesSet).sort();
    autocompleteOptions[colToEdit] = newValuesArray;

    try {
        const response = await fetch('/api/save_autocomplete_lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(autocompleteOptions) 
        });
        
        if (!response.ok) throw new Error('Error del servidor al guardar');
        
        alert(`¡Listas guardadas para '${colToEdit}'!\n\n` +
              `Añadidos: ${addedCount}\n` +
              `Eliminados: ${removedCount}\n\n` +
              `Los cambios se aplicarán la próxima vez que cargues un archivo.`);
        
        closeManageListsModal();
        
        if (currentView === 'detailed' && tabulatorInstance) {
            renderTable();
        }

    } catch (error) {
        console.error("Error al guardar las listas:", error);
        alert("Error al guardar las listas: " + error.message);
        autocompleteOptions[colToEdit] = currentValues;
    }
}


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

// ---
// FUNCIONES DE EDICIÓN (INDIVIDUAL)
// ---
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

        if (result.affected_row_id && tabulatorInstance) {
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

// ---
// FUNCIONES DE GESTIÓN DE VISTAS (JSON)
// ---
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

// ---
// SECCIÓN 4: LÓGICA DE DATOS Y RENDERIZADO
// ---
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
    
    document.getElementById('active-filters-list').innerHTML = '';
    document.getElementById('active-filters-list-grouped').innerHTML = '';
    document.getElementById('btn-clear-filters').style.display = 'none';
    document.getElementById('btn-clear-filters-grouped').style.display = 'none';
    
    if (!filtersListDiv || !btnClear) return; 

    if (activeFilters.length === 0) { 
        btnClear.style.display = 'none';
        return; 
    }
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

/**
 * @description Renderiza la tabla DETALLADA.
 * (Versión 15.2: Corrección de selectores Tabulator v5)
 */
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
            formatter: "rowSelection", 
            titleFormatter: "rowSelection", // Checkbox en el header
            width: 40,
            hozAlign: "center",
            headerSort: false,
            frozen: true 
        },
        {
            title: "", 
            field: "delete",
            width: 40,
            hozAlign: "center",
            headerSort: false,
            frozen: true,
            formatter: function(cell){ return '<i class="fas fa-trash-alt delete-icon"></i>'; },
            cellClick: function(e, cell){
                if (!confirm("¿Estás seguro de que quieres eliminar esta fila?")) return; 
                const rowId = cell.getRow().getData()._row_id;
                handleDeleteRow(rowId);
            }
        },
        {
            title: "N°",
            field: "_row_id", 
            width: 70,
            hozAlign: "right",
            headerSort: true,
            frozen: true, 
            formatter: function(cell) { return cell.getValue() + 1; }
        },
        {
            title: "Prioridad",
            field: "_priority",
            width: 100,
            hozAlign: "left",
            headerSort: true,
            editable: false, 
            frozen: true, 
            sorter: function(a, b, aRow, bRow, column, dir, sorterParams){
                const priorityMap = { "Alta": 3, "Media": 2, "Baja": 1, "": 0, null: 0 };
                const aPrioVal = priorityMap[a] || 0;
                const bPrioVal = priorityMap[b] || 0;
                const prioDiff = aPrioVal - bPrioVal;
                if (prioDiff !== 0) return prioDiff;
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
            tabulatorInstance.setPlaceholder(placeholderText);
        }

    } else {
        tabulatorInstance = new Tabulator(resultsTableDiv, {
            // (Documentación de Google: Corrección Tabulator v5)
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

        tabulatorInstance.on("rowSelectionChanged", function(data, rows){
            const btnBulk = document.getElementById('btn-bulk-edit');
            if (rows.length > 0) {
                btnBulk.style.display = 'inline-block';
                btnBulk.textContent = `Editar (${rows.length})`;
            } else {
                btnBulk.style.display = 'none';
            }
        });

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
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        file_id: currentFileId,
                        row_id: rowId,
                        columna: colField,
                        valor: newValue
                    })
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


// ---
// SECCIÓN 5: LÓGICA DE VISTAS
// ---
function updateActionButtonsVisibility() {
    const btnUndo = document.getElementById('btn-undo-change');
    const btnCommit = document.getElementById('btn-commit-changes');
    const btnAddRow = document.getElementById('btn-add-row'); 
    
    if (!btnUndo || !btnCommit || !btnAddRow) return;
    
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
    } else {
         btnAddRow.style.display = 'none';
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
        currentData = []; 
        tableData = []; 
        renderFilters(); 
        renderTable(null, true); 
        resetResumenCard(); 
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file_id: currentFileId, 
                filtros_activos: activeFilters,
                columna_agrupar: colAgrupar
            })
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
// NUEVAS FUNCIONES DE EDICIÓN MASIVA (BULK EDIT) v15.2
// ============================================================

// 1. Abrir el Modal de Bulk Edit
function openBulkEditModal() {
    if (!tabulatorInstance) return;
    
    const selectedRows = tabulatorInstance.getSelectedData();
    if (selectedRows.length === 0) {
        alert("No hay filas seleccionadas.");
        return;
    }

    const countText = document.getElementById('bulk-edit-count');
    countText.textContent = `Vas a editar ${selectedRows.length} filas seleccionadas.`;

    const colSelect = document.getElementById('bulk-edit-column');
    colSelect.innerHTML = '<option value="">Seleccione una columna...</option>';
    
    todasLasColumnas.forEach(col => {
        if (col.startsWith('_') || col === 'Priority') return; 
        const option = document.createElement('option');
        option.value = col;
        option.textContent = col;
        colSelect.appendChild(option);
    });

    document.getElementById('bulk-edit-value').value = '';
    document.getElementById('bulk-edit-value-list').innerHTML = '';

    // Aseguramos que el otro modal esté oculto
    const manageModal = document.getElementById('manage-lists-modal');
    if (manageModal) manageModal.style.display = 'none';

    document.getElementById('bulk-edit-modal').style.display = 'flex';
    document.getElementById('modal-overlay').style.display = 'flex';
}

// 2. Cerrar el Modal de Bulk Edit
function closeBulkEditModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('bulk-edit-modal').style.display = 'none';
}

// 3. Actualizar Autocompletado del Modal (UX)
function updateBulkEditAutocomplete() {
    const col = document.getElementById('bulk-edit-column').value;
    const list = document.getElementById('bulk-edit-value-list');
    list.innerHTML = '';
    
    if (autocompleteOptions[col]) {
        autocompleteOptions[col].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            list.appendChild(opt);
        });
    }
}

// 4. Aplicar Cambios de Bulk Edit
async function handleBulkEditApply() {
    if (!tabulatorInstance || !currentFileId) return;

    const selectedRows = tabulatorInstance.getSelectedData();
    const col = document.getElementById('bulk-edit-column').value;
    const val = document.getElementById('bulk-edit-value').value;

    if (!col) {
        alert("Por favor, seleccione una columna.");
        return;
    }
    
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
        
        // (Corrección Tabulator v5)
        tabulatorInstance.deselectRow(); 
        
        await getFilteredData();

    } catch (error) {
        console.error("Error en Bulk Update:", error);
        alert("Error al aplicar los cambios: " + error.message);
    }
}
// ---
// ¡BLOQUE DE INICIALIZACIÓN!
// ---
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