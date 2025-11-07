// script.js (Versión 7.11 - KPIs Dinámicos, Consolidar y Persistencia)
// NOTA:
// 1. (Tu Punto 1) 'cellEdited', 'handleUndoChange', 'handleRevertToOriginal'
//    y 'getFilteredData' ahora actualizan los KPIs dinámicamente.
// 2. (Tu Punto 2) Añadido 'btn-commit-changes' (Consolidar) y
//    'btn-revert-original' movido a la sidebar.
// 3. (Tu Punto 3) 'DOMContentLoaded' ahora lee 'SESSION_DATA.history_count'
//    para persistencia de la Pila de Deshacer.

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
// Rastrea *cuántos* cambios hay en la pila de deshacer
let undoHistoryCount = 0;

// --- Variable para Autocompletado ---
let autocompleteOptions = {};

// --- Instancias de Tabulator ---
let tabulatorInstance = null;
let groupedTabulatorInstance = null; 

const COLUMNAS_AGRUPABLES = [
    "Vendor Name", "Status", "Assignee", 
    "Operating Unit Name", "Pay Status", "Document Type", "_row_status"
];

// ---
// SECCIÓN 1: MANEJO DE COLUMNAS (Sin Cambios)
// ---
function renderColumnSelector() {
    // ... (Sin cambios desde v7.10) ...
    const wrapper = document.getElementById('column-selector-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = ''; 
    if (todasLasColumnas.length === 0) { 
        wrapper.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    todasLasColumnas.filter(col => col !== '_row_id').forEach(columnName => {
        const isChecked = columnasVisibles.includes(columnName);
        const itemHTML = `
            <div class="column-selector-item">
                <label>
                    <input type="checkbox" value="${columnName}" ${isChecked ? 'checked' : ''}>
                    ${(columnName === '_row_status') ? "Row Status" : columnName}
                </label>
            </div>`;
        wrapper.innerHTML += itemHTML;
    });
}
function updateVisibleColumnsFromCheckboxes() {
    // ... (Sin cambios desde v7.10) ...
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
    renderTable();
}
function handleColumnVisibilityChange(event) {
    if (event.target.type !== 'checkbox') return;
    updateVisibleColumnsFromCheckboxes();
}
function handleCheckAllColumns() {
    // ... (Sin cambios desde v7.10) ...
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    updateVisibleColumnsFromCheckboxes();
}
function handleUncheckAllColumns() {
    // ... (Sin cambios desde v7.10) ...
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    updateVisibleColumnsFromCheckboxes();
}
// ---
// SECCIÓN 2: CONFIGURACIÓN INICIAL Y LISTENERS (¡MODIFICADO!)
// ---
async function loadTranslations() {
    // ... (Sin cambios desde v7.10) ...
    try {
        const response = await fetch('/api/get_translations');
        if (!response.ok) throw new Error('Network response was not ok');
        i18n = await response.json();
    } catch (error) { 
        console.error('Error cargando traducciones:', error); 
        i18n = { /* Fallbacks */ }; 
    }
    updateDynamicText();
}

/**
 * @description Configura todos los event listeners de la página.
 * ¡MODIFICADO! Conectado a 'btn-commit-changes' (Tu Punto 2).
 */
function setupEventListeners() {
    // ... (Selectores de elementos sin cambios) ...
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

    // Listeners Generales
    addSafeListener(fileUploader, 'change', handleFileUpload);
    addSafeListener(btnAdd, 'click', handleAddFilter);
    addSafeListener(btnLangEs, 'click', () => setLanguage('es'));
    addSafeListener(btnLangEn, 'click', () => setLanguage('en'));
    addSafeListener(columnSelectorWrapper, 'change', handleColumnVisibilityChange);
    addSafeListener(btnCheckAllCols, 'click', handleCheckAllColumns);
    addSafeListener(btnUncheckAllCols, 'click', handleUncheckAllColumns);

    // Listeners Vista Detallada
    addSafeListener(document.getElementById('btn-clear-filters'), 'click', handleClearFilters);
    addSafeListener(document.getElementById('btn-fullscreen'), 'click', handleFullscreen);
    addSafeListener(document.getElementById('btn-download-excel'), 'click', handleDownloadExcel);
    addSafeListener(document.getElementById('input-search-table'), 'keyup', handleSearchTable);
    addSafeListener(document.getElementById('active-filters-list'), 'click', handleRemoveFilter);
    
    // --- ¡NUEVOS LISTENERS DE EDICIÓN! (Tu Punto 2) ---
    addSafeListener(document.getElementById('btn-undo-change'), 'click', handleUndoChange);
    addSafeListener(document.getElementById('btn-commit-changes'), 'click', handleCommitChanges); // ¡Nuevo!
    addSafeListener(document.getElementById('btn-revert-original'), 'click', handleRevertToOriginal); // Movido
    // --- FIN DEL CAMBIO ---

    // Listeners Vista Agrupada
    addSafeListener(document.getElementById('btn-view-detailed'), 'click', () => toggleView('detailed'));
    addSafeListener(document.getElementById('btn-view-grouped'), 'click', () => toggleView('grouped'));
    addSafeListener(document.getElementById('select-columna-agrupar'), 'change', handleGroupColumnChange);
    
    // Listeners Botones Duplicados (Vista Agrupada)
    addSafeListener(document.getElementById('btn-clear-filters-grouped'), 'click', handleClearFilters);
    addSafeListener(document.getElementById('btn-fullscreen-grouped'), 'click', handleFullscreen);
    addSafeListener(document.getElementById('btn-download-excel-grouped'), 'click', handleDownloadExcelGrouped);
    addSafeListener(document.getElementById('active-filters-list-grouped'), 'click', handleRemoveFilter);

    // Listener de Gestión de Listas
    addSafeListener(document.getElementById('btn-manage-lists'), 'click', handleManageLists);

    // Listeners Drag and Drop
    if (dragDropArea) {
        // ... (código de drag/drop sin cambios) ...
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
    } else {
        console.warn("Elemento 'dragDropArea' no encontrado.");
    }
}
function updateDynamicText() {
    // ... (Sin cambios desde v7.10) ...
    const valInput = document.getElementById('input-valor');
    const searchTableInput = document.getElementById('input-search-table');
    const resultsTableDiv = document.getElementById('results-table');
    const resultsTableGrouped = document.getElementById('results-table-grouped');

    if (valInput) valInput.placeholder = i18n['search_text'] || "Texto a buscar...";
    if (searchTableInput) searchTableInput.placeholder = (i18n['search_text'] || "Buscar...") + "...";
    
    if (resultsTableDiv && !tabulatorInstance && !currentFileId) {
        resultsTableDiv.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`;
    }
    if (resultsTableGrouped && !groupedTabulatorInstance && !currentFileId) { 
        resultsTableGrouped.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`;
    }
}
async function setLanguage(langCode) {
    // ... (Sin cambios desde v7.10) ...
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
    // ... (Sin cambios desde v7.10) ...
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
        console.log("Opciones de Autocompletado recibidas:", autocompleteOptions);

        populateColumnDropdowns(); 
        renderColumnSelector(); 
        resetResumenCard(); 
        
        activeFilters = []; 
        document.getElementById('input-search-table').value = ''; 
        
        // Resetea el estado de cambios
        undoHistoryCount = 0; 
        updateActionButtonsVisibility(); // Oculta los botones "Deshacer" y "Consolidar"
        
        toggleView('detailed', true); 

    } catch (error) { 
        console.error('Error en fetch /api/upload:', error); 
        todasLasColumnas = []; 
        columnasVisibles = []; 
        autocompleteOptions = {};
        undoHistoryCount = 0;
        updateActionButtonsVisibility();
        fileUploadList.innerHTML = `<p style="color: red;">Error al cargar el archivo.</p>`;
        renderColumnSelector();
        resetResumenCard(); 
    }
}

async function handleAddFilter() {
    // ... (Sin cambios desde v7.10) ...
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
    // ... (Sin cambios desde v7.10) ...
    activeFilters = []; 
    if (currentView === 'detailed') {
        document.getElementById('input-search-table').value = ''; 
    }
    await refreshActiveView(); 
}

async function handleRemoveFilter(event) {
    // ... (Sin cambios desde v7.10) ...
    if (!event.target.classList.contains('remove-filter-btn')) return;
    const indexToRemove = parseInt(event.target.dataset.index, 10);
    activeFilters.splice(indexToRemove, 1);
    await refreshActiveView(); 
}

function handleFullscreen(event) {
    // ... (Sin cambios desde v7.10) ...
    const viewContainerId = (currentView === 'detailed') 
        ? 'view-container-detailed' 
        : 'view-container-grouped';
    
    const viewContainer = document.getElementById(viewContainerId);

    const activeTableInstance = (currentView === 'detailed') 
        ? tabulatorInstance 
        : groupedTabulatorInstance;

    if (document.body.classList.contains('fullscreen-mode')) {
        document.body.classList.remove('fullscreen-mode');
        if (viewContainer) viewContainer.classList.remove('in-fullscreen');
        
        document.querySelectorAll('.icon-button[title="Pantalla Completa"]').forEach(btn => {
            const svg = btn.querySelector('svg');
            if (svg) svg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />`;
        });

        setTimeout(() => {
            if (activeTableInstance) {
                activeTableInstance.setHeight("65vh"); 
            }
        }, 200); 

    } else {
        document.body.classList.add('fullscreen-mode');
        if (viewContainer) viewContainer.classList.add('in-fullscreen');

        const icon = event.currentTarget.querySelector('svg');
        if (icon) {
            icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />`;
        }

        setTimeout(() => {
            if (activeTableInstance) {
                activeTableInstance.setHeight("100%"); 
            }
        }, 200); 
    }
}

function handleSearchTable() {
    // ... (Sin cambios desde v7.10) ...
    const searchTableInput = document.getElementById('input-search-table');
    const searchTerm = searchTableInput.value.toLowerCase();
    
    if (tabulatorInstance) {
        if (!searchTerm) {
            tabulatorInstance.clearFilter();
        } else {
            tabulatorInstance.setFilter(function(data){
                for(let col of columnasVisibles.filter(c => c !== '_row_id')){
                    if(data[col] && String(data[col]).toLowerCase().includes(searchTerm)){
                        return true; 
                    }
                }
                return false; 
            });
        }
    } else {
        console.warn("handleSearchTable: tabulatorInstance no está listo.");
    }
}


async function handleDownloadExcel() {
    // ... (Sin cambios desde v7.10) ...
    if (!currentFileId) { 
        alert(i18n['no_data_to_download'] || "No hay datos para descargar."); 
        return; 
    }
    
    const colsToDownload = columnasVisibles.filter(c => c !== '_row_id');
    
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
    // ... (Sin cambios desde v7.10) ...
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

// --- (handleManageLists sin cambios desde v7.10) ---
async function handleManageLists() {
    // ... (Esta es la función de "Añadir/Quitar con -") ...
    
    const colToEdit = prompt(i18n['prompt_col_to_edit'] || "Qué lista de columna quieres editar?\n(Ej: Status, Assignee)");
    if (!colToEdit) return; 
    if (!(colToEdit in autocompleteOptions)) {
        alert(i18n['alert_col_not_found'] || "Columna no válida o no tiene autocompletado.");
        return;
    }

    const currentValues = autocompleteOptions[colToEdit] || [];
    const valuesSet = new Set(currentValues);
    const currentValuesStr = currentValues.length > 0 ? currentValues.join(', ') : "(Lista vacía)";
    
    const promptText = `Editando lista para '${colToEdit}':\n\n` +
                       `Valores actuales: ${currentValuesStr}\n\n` +
                       `Escriba los valores que desea AÑADIR.\n` +
                       `Para ELIMINAR un valor, escríbalo con un guion (-) delante.\n\n` +
                       `Ejemplo: Nuevo Valor, -Valor Antiguo, Otro Valor`;
        
    const modificationsStr = prompt(promptText);
    if (modificationsStr === null) return; 

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
            if (!valuesSet.has(valueToAdd)) {
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
        
        if (currentView === 'detailed' && tabulatorInstance) {
            renderTable();
        }

    } catch (error) {
        console.error("Error al guardar las listas:", error);
        alert(i18n['alert_save_error'] || "Error al guardar las listas.");
        autocompleteOptions[colToEdit] = currentValues;
    }
}

// ---
// --- ¡FUNCIONES DE EDICIÓN MODIFICADAS Y NUEVAS! ---
// ---

/**
 * @description Llama a la API para DESHACER el último cambio de celda.
 * ¡MODIFICADO! (Tu Punto 1) Ahora también actualiza los KPIs.
 */
async function handleUndoChange() {
    if (undoHistoryCount === 0 || !currentFileId) {
        alert("No hay nada que deshacer.");
        return;
    }
    console.log("Deshaciendo último cambio...");
    
    try {
        // 1. Llama a la API de deshacer
        const response = await fetch('/api/undo_change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        // 2. ¡Éxito!
        console.log(result.message);
        
        // 3. Actualiza los datos locales y repinta la tabla
        currentData = result.data;
        tableData = [...currentData];
        renderTable(); // Repinta la tabla con los datos "deshechos"
        
        // 4. ¡NUEVO! Actualiza los KPIs (Tu Punto 1)
        if (result.resumen) {
            updateResumenCard(result.resumen);
        }
        
        // 5. Actualiza el estado de la pila de deshacer
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); // Oculta botones si el contador es 0

    } catch (error) {
        console.error("Error al deshacer el cambio:", error);
        alert("Error al deshacer: " + error.message);
    }
}

/**
 * @description Llama a la API para REVERTIR TODOS los cambios al original.
 * ¡MODIFICADO! (Tu Punto 1) Ahora también actualiza los KPIs.
 */
async function handleRevertToOriginal() {
    // 1. Pide confirmación (Opción Nuclear)
    if (!confirm("¿Estás seguro de que quieres REVERTIR TODOS los cambios al archivo original?\n\nEsta acción no se puede deshacer.")) {
        return;
    }
    if (!currentFileId) {
        alert("No hay un archivo cargado.");
        return;
    }
    console.log("Revirtiendo al original...");
    
    try {
        // 2. Llama a la API de revertir
        const response = await fetch('/api/revert_changes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        // 3. ¡Éxito!
        alert(result.message);
        
        // 4. Actualiza los datos locales y repinta la tabla
        currentData = result.data;
        tableData = [...currentData];
        renderTable(); 
        
        // 5. ¡NUEVO! Actualiza los KPIs (Tu Punto 1)
        if (result.resumen) {
            updateResumenCard(result.resumen);
        }
        
        // 6. Resetea el estado de la pila de deshacer
        undoHistoryCount = 0; 
        updateActionButtonsVisibility(); // Oculta los botones

    } catch (error) {
        console.error("Error al revertir al original:", error);
        alert("Error al revertir: " + error.message);
    }
}

/**
 * @description ¡NUEVA FUNCIÓN! (Tu Punto 2)
 * Llama a la API para CONSOLIDAR los cambios (borrador -> estable).
 */
async function handleCommitChanges() {
    // 1. Pide confirmación
    if (!confirm("¿Estás seguro de que quieres consolidar todos los cambios?\n\nEsta acción guardará el estado actual como la nueva versión 'estable' y limpiará el historial de deshacer.")) {
        return;
    }
    if (!currentFileId) {
        alert("No hay un archivo cargado.");
        return;
    }
    console.log("Consolidando cambios...");
    
    try {
        // 2. Llama a la nueva API /api/commit_changes
        const response = await fetch('/api/commit_changes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        // 3. ¡Éxito!
        alert(result.message);
        
        // 4. Resetea el estado de la pila de deshacer
        undoHistoryCount = 0; 
        updateActionButtonsVisibility(); // Oculta los botones

    } catch (error) {
        console.error("Error al consolidar cambios:", error);
        alert("Error al consolidar: " + error.message);
    }
}
// --- FIN DE LAS NUEVAS FUNCIONES ---


// ---
// SECCIÓN 4: LÓGICA DE DATOS Y RENDERIZADO (¡MODIFICADO!)
// ---

/**
 * @description ¡NUEVA FUNCIÓN HELPER! (Tu Punto 1)
 * Actualiza las tarjetas de KPI con nuevos datos.
 * @param {object} resumen_data - El objeto {total_facturas, monto_total, ...}
 */
function updateResumenCard(resumen_data) {
    if (!resumen_data) return; // No hacer nada si no hay datos
    
    const totalFacturas = document.getElementById('resumen-total-facturas');
    const montoTotal = document.getElementById('resumen-monto-total');
    const montoPromedio = document.getElementById('resumen-monto-promedio');

    if (totalFacturas) totalFacturas.textContent = resumen_data.total_facturas;
    if (montoTotal) montoTotal.textContent = resumen_data.monto_total;
    if (montoPromedio) montoPromedio.textContent = resumen_data.monto_promedio;
    
    console.log("KPIs actualizados.", resumen_data);
}

function resetResumenCard() {
    // Esta función ahora es un alias de updateResumenCard con datos vacíos
    updateResumenCard({
        total_facturas: '0',
        monto_total: '$0.00',
        monto_promedio: '$0.00'
    });
}


function renderFilters() {
    // ... (Sin cambios desde v7.10) ...
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
        const filterItemHTML = `
            <div class="filtro-chip">
                <span>${filtro.columna}: <strong>${filtro.valor}</strong></span>
                <button class="remove-filter-btn" data-index="${index}">&times;</button>
            </div>
        `;
        filtersListDiv.innerHTML += filterItemHTML;
    });
}


/**
 * @description Renderiza o actualiza la tabla DETALLADA (principal).
 * ¡MODIFICADO! Conecta 'cellEdited' (Tu Punto 1).
 */
function renderTable(data = null, forceClear = false) {
    // ... (Lógica de renderizado de columnas sin cambios desde v7.10) ...
    const resultsTableDiv = document.getElementById('results-table');

    if (!resultsTableDiv) {
        console.error("ERROR: No se encontró el div '#results-table'.");
        return; 
    }

    if (forceClear && tabulatorInstance) {
        console.log("Tabulator (Detallada): Destruyendo instancia.");
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

    // 1. Definir las Columnas
    const columnDefs = [
        {
            title: "#",
            formatter: "rownum",
            width: 60,
            hozAlign: "right",
            headerSort: false,
            frozen: true, 
        }
    ];

    columnasVisibles.forEach(colName => {
        const colTitle = (colName === '_row_status') ? "Row Status" : colName;
        
        let editorType = "input"; 
        let editorParams = {};
        
        if (autocompleteOptions && autocompleteOptions[colName] && autocompleteOptions[colName].length > 0) {
            const options = autocompleteOptions[colName];
            
            if (options.length > 50) {
                editorType = "autocomplete";
                editorParams = {
                    values: options, showListOnEmpty: true, freetext: true,
                };
            } else {
                editorType = "select";
                editorParams = { values: ["", ...options] };
            }
        }
        
        const isVisible = (colName !== '_row_id'); // Oculta _row_id

        columnDefs.push({
            title: colTitle,
            field: colName,
            editor: editorType,          
            editorParams: editorParams,  
            minWidth: 150, 
            visible: isVisible, 
        });
    });

    // 2. Comprobar si la instancia ya existe
    if (tabulatorInstance) {
        console.log("Tabulator (Detallada): Actualizando datos...");
        tabulatorInstance.setColumns(columnDefs); 
        tabulatorInstance.setData(dataToRender);
        
        if(dataToRender.length === 0) {
            const placeholderText = (activeFilters.length > 0 || document.getElementById('input-search-table').value)
                ? (i18n['no_filters_applied'] || 'No results for these filters.')
                : (i18n['info_upload'] || 'No data found.');
            tabulatorInstance.setPlaceholder(placeholderText);
        }

    } else {
        // 3. Crear la NUEVA instancia de Tabulator
        console.log("Tabulator (Detallada): Creando nueva instancia...");
        
        tabulatorInstance = new Tabulator(resultsTableDiv, {
            virtualDom: true, 
            height: "65vh",   
            data: dataToRender,
            columns: columnDefs,
            layout: "fitData", 
            movableColumns: true,
            placeholder: `<p>${i18n['info_upload'] || 'Upload file'}</p>`,
        });

        // --- 4. ¡LISTENER DE EDICIÓN CONECTADO A KPIs! (Tu Punto 1) ---
        tabulatorInstance.on("cellEdited", async function(cell){
            
            const newValue = cell.getValue();
            const colField = cell.getField();
            const rowData = cell.getRow().getData();
            const rowId = rowData._row_id; 

            // No guardar si el valor no cambió
            if (newValue === cell.getOldValue()) {
                return; 
            }

            console.log(`Guardando... Fila ID: ${rowId}, Col: ${colField}, Nuevo Valor: ${newValue}`);
            cell.getRow().getElement().style.backgroundColor = "#FFF9E5"; 
            
            try {
                // Llama a la API de guardado
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
                
                console.log(result.message);
                
                // ¡NUEVO! Actualiza los KPIs (Tu Punto 1)
                if (result.resumen) {
                    updateResumenCard(result.resumen);
                }

                // Actualiza el contador de "deshacer" y muestra los botones
                undoHistoryCount = result.history_count;
                updateActionButtonsVisibility();

            } catch (error) {
                console.error("Error al guardar celda:", error);
                alert("Error al guardar el cambio: " + error.message + "\n\nEl cambio será revertido localmente.");
                cell.restoreOldValue();
                cell.getRow().getElement().style.backgroundColor = ""; 
            }
        });
        
        tabulatorInstance.on("renderComplete", function(){
            console.log("Tabulator (Detallada): Renderizado completo.");
        });
    }
}


// ---
// SECCIÓN 5: LÓGICA DE VISTAS (MODIFICADA)
// ---

/**
 * @description Muestra/Oculta "Deshacer", "Consolidar" y "Revertir Original"
 * basado en 'undoHistoryCount'. (Tu Punto 2 y 3)
 */
function updateActionButtonsVisibility() {
    const btnUndo = document.getElementById('btn-undo-change');
    const btnCommit = document.getElementById('btn-commit-changes');
    const btnRevert = document.getElementById('btn-revert-original');
    
    if (!btnUndo || !btnCommit || !btnRevert) return;
    
    // Si hay cambios en la pila Y estamos en la vista detallada
    if (undoHistoryCount > 0 && currentView === 'detailed') {
        // Muestra los botones de la tabla
        btnUndo.style.display = 'inline-block';
        btnCommit.style.display = 'inline-block';
        // Muestra el botón de la sidebar
        btnRevert.style.display = 'block'; // 'block' para botones de ancho completo
        
        // Actualiza el texto del botón Deshacer
        btnUndo.textContent = `Deshacer (${undoHistoryCount})`;
    } else {
        // Oculta todos los botones de acción
        btnUndo.style.display = 'none';
        btnCommit.style.display = 'none';
        btnRevert.style.display = 'none';
    }
}


async function refreshActiveView() {
    // ... (Sin cambios desde v7.10) ...
    if (currentView === 'detailed') {
        renderGroupedTable(null, null, true); 
        await getFilteredData(); // Esta función ya actualiza los KPIs (Punto 1)
    } 
    else if (currentView === 'grouped') {
        renderTable(null, true); 
        await getGroupedData();
    }
    
    // Actualiza la visibilidad de los botones
    updateActionButtonsVisibility();
}

/**
 * @description ¡MODIFICADO! (Tu Punto 1)
 * Llama a /api/filter y actualiza los KPIs con la respuesta.
 */
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

        // --- ¡LÓGICA DE KPI ACTUALIZADA! (Tu Punto 1) ---
        // Llama al helper para actualizar las tarjetas de resumen
        if (result.resumen) {
            updateResumenCard(result.resumen);
        }
        // --- FIN DEL CAMBIO ---

        renderFilters(); 
        renderTable(); 

        if (resultsHeader) resultsHeader.textContent = i18n['results_header']?.replace('{num_filas}', result.num_filas) || `Results (${result.num_filas})`;

    } catch (error) { 
        console.error('Error en fetch /api/filter:', error); 
        alert('Error al filtrar: ' + error.message);
        resetResumenCard(); 
        renderTable(null, true);
    }
}


async function getGroupedData() {
    // ... (Sin cambios desde v7.10) ...
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
    // ... (Sin cambios desde v7.10) ...
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

        if (!selectAgrupar) {
            console.error("ERROR: No se encontró 'select-columna-agrupar' en tu index.html.");
        } else {
            const firstOption = selectAgrupar.querySelector('option[value!=""]');
            if (firstOption && !selectAgrupar.value) { 
                selectAgrupar.value = firstOption.value;
            }
        }
    }
    
    if (force && view === 'detailed') {
        refreshActiveView();
    } else if (!force) {
        refreshActiveView();
    }
    
    // Actualiza la visibilidad de los botones al cambiar de vista
    updateActionButtonsVisibility();
}

function populateGroupDropdown() {
    // ... (Sin cambios desde v7.10) ...
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
        option.textContent = (colName === '_row_status') ? "Row Status" : colName;
        select.appendChild(option);
    });

    select.value = valorActual;
}

async function handleGroupColumnChange() {
    await getGroupedData();
}

function renderGroupedTable(data, colAgrupada, forceClear = false) {
    // ... (Sin cambios desde v7.10) ...
    const resultsTableDiv = document.getElementById('results-table-grouped');
    if (!resultsTableDiv) {
         console.error("ERROR: No se encontró el div '#results-table-grouped'.");
        return;
    }

    if (forceClear && groupedTabulatorInstance) {
        console.log("Tabulator (Agrupada): Destruyendo instancia.");
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
                formatterParams: isMoney ? {
                    decimal: ".",
                    thousand: ",",
                    symbol: "$",
                    precision: 2,
                } : {}
            });
        }
    });

    if (groupedTabulatorInstance) {
        groupedTabulatorInstance.destroy();
    }
    
    console.log("Tabulator (Agrupada): Creando nueva instancia.");
    groupedTabulatorInstance = new Tabulator(resultsTableDiv, {
        data: data,
        columns: columnDefs,
        layout: "fitData", 
        height: "65vh",    
        movableColumns: true,
    });
}

function populateColumnDropdowns() {
    // ... (Sin cambios desde v7.10) ...
    const colSelect = document.getElementById('select-columna');
    if (!colSelect) return; 
    
    colSelect.innerHTML = `<option value="">${i18n['column_select'] || 'Select col...'}</option>`;
    todasLasColumnas.filter(col => col !== '_row_id').forEach(col => {
        const option = document.createElement('option'); 
        option.value = col; 
        option.textContent = (col === '_row_status') ? "Row Status" : col;
        colSelect.appendChild(option);
    });

    populateGroupDropdown();
}


// ---
// ¡BLOQUE DE INICIALIZACIÓN! (MODIFICADO - Tu Punto 3)
// ---
document.addEventListener('DOMContentLoaded', async (event) => {
    
    // 1. Carga las traducciones primero
    await loadTranslations();
    
    try {
        // 2. Comprueba si hay datos de sesión inyectados desde el HTML
        if (typeof SESSION_DATA !== 'undefined' && SESSION_DATA.file_id) {
            console.log("Sesión activa encontrada:", SESSION_DATA.file_id);
            currentFileId = SESSION_DATA.file_id;
            todasLasColumnas = SESSION_DATA.columnas;
            columnasVisibles = [...todasLasColumnas];
            
            if (SESSION_DATA.autocomplete_options) {
                 autocompleteOptions = SESSION_DATA.autocomplete_options;
            }

            populateColumnDropdowns();
            renderColumnSelector();
            
            // --- ¡NUEVO! Persistencia de la Pila de Deshacer (Tu Punto 3) ---
            // Lee el conteo del historial que nos pasó el backend
            undoHistoryCount = SESSION_DATA.history_count || 0;
            console.log(`Historial de deshacer cargado: ${undoHistoryCount} cambios.`);
            // Muestra/Oculta los botones "Deshacer" etc. INMEDIATAMENTE
            updateActionButtonsVisibility();
            // --- FIN DEL CAMBIO ---
            
            // Refresca la vista (esto llamará a getFilteredData)
            refreshActiveView(); 
            
        } else {
            // No se encontró sesión
            console.log("No se encontró sesión activa.");
            renderColumnSelector();
            undoHistoryCount = 0;
            updateActionButtonsVisibility();
        }
        
        // 3. Configura todos los listeners
        setupEventListeners(); 
        
    } catch (e) {
        console.error("Error fatal al inicializar:", e);
    }
});