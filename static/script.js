// script.js (Versión 12.0 - Ordenamiento Multi-Nivel)
// NOTA:
// 1. (¡NUEVO v12.0!) Se actualiza el 'sorter' de la columna
//    '_priority' en 'renderTable'.
// 2. (¡NUEVO v12.0!) El 'sorter' ahora ordena primero por
//    Prioridad (DESC) y, si son iguales, por
//    'Invoice Date Age' (DESC).
// 3. (v11.0) Implementación de Guardar/Cargar Vistas JSON.
// 4. (v10.1) Columna '_row_status' ahora es móvil.
// 5. (v9.0) Implementación de Hotkeys.

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

// (Columnas agrupables ¡MODIFICADO v8.0!)
const COLUMNAS_AGRUPABLES = [
    "Vendor Name", "Status", "Assignee", 
    "Operating Unit Name", "Pay Status", "Document Type", 
    "_row_status", "_priority", // <-- ¡NUEVO v8.0!
    "Pay group", "WEC Email Inbox", "Sender Email", "Currency Code", "payment method"
];

// ---
// SECCIÓN 1: MANEJO DE COLUMNAS (¡MODIFICADO v8.1!)
// ---
function renderColumnSelector() {
    // ... (Sin cambios desde v7.30) ...
    const wrapper = document.getElementById('column-selector-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = ''; 
    if (todasLasColumnas.length === 0) { 
        wrapper.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    
    // (Documentación de Google: Inicio de la Solución 3 - Ocultar Columna)
    // (¡MODIFICADO v8.1!) Filtra las columnas internas que el
    // usuario no debe tocar Y la columna "Priority" original.
    todasLasColumnas.filter(col => 
        col !== '_row_id' && 
        col !== '_priority' && 
        col !== 'Priority' // <-- SOLUCIÓN: Oculta "Priority" original
    ).forEach(columnName => {
    // (Documentación de Google: Fin de la Solución 3)
        
        const isChecked = columnasVisibles.includes(columnName);
        
        // (¡MODIFICADO v8.0!) Formatea el nombre de _row_status
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
    // ... (Sin cambios desde v7.30) ...
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    columnasVisibles = [];
    checkboxes.forEach(cb => {
        if (cb.checked) {
            columnasVisibles.push(cb.value);
        }
    });
    // (¡MODIFICADO v8.0!) Asegura que las columnas internas siempre estén
    if (todasLasColumnas.includes('_row_id')) {
        columnasVisibles.push('_row_id');
    }
    if (todasLasColumnas.includes('_priority')) {
        columnasVisibles.push('_priority');
    }
    
    // (Documentación de Google: Solución 3 - Ocultar Columna)
    // Nos aseguramos de que "Priority" (la original) NUNCA
    // esté en la lista de visibles, pero SÍ esté en
    // 'todasLasColumnas' (para filtrarla en el render).
    if (columnasVisibles.includes('Priority')) {
        columnasVisibles = columnasVisibles.filter(col => col !== 'Priority');
    }
    // (Documentación de Google: Fin de la Solución 3)
    
    renderTable();
}
function handleColumnVisibilityChange(event) {
    if (event.target.type !== 'checkbox') return;
    updateVisibleColumnsFromCheckboxes();
}
function handleCheckAllColumns() {
    // ... (Sin cambios desde v7.30) ...
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    updateVisibleColumnsFromCheckboxes();
}
function handleUncheckAllColumns() {
    // ... (Sin cambios desde v7.30) ...
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    updateVisibleColumnsFromCheckboxes();
}
// ---
// SECCIÓN 2: CONFIGURACIÓN INICIAL Y LISTENERS (¡MODIFICADO v11.0!)
// ---
async function loadTranslations() {
    // ... (Sin cambios desde v7.30) ...
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

function setupEventListeners() {
    // ... (Sin cambios desde v7.30) ...
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

    // (Documentación de Google: Inicio de la Solución v9.0 - Hotkeys)
    // Añade el listener de teclado global a todo el documento
    addSafeListener(document, 'keydown', handleGlobalKeydown);
    // (Documentación de Google: Fin de la Solución v9.0)

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
    
    // Listeners de Edición
    addSafeListener(document.getElementById('btn-add-row'), 'click', handleAddRow);
    addSafeListener(document.getElementById('btn-undo-change'), 'click', handleUndoChange);
    addSafeListener(document.getElementById('btn-commit-changes'), 'click', handleCommitChanges);

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

    // (Documentación de Google: INICIO DE NUEVOS LISTENERS v11.0)
    addSafeListener(document.getElementById('btn-save-view'), 'click', handleSaveView);
    addSafeListener(document.getElementById('input-load-view'), 'change', handleLoadView);
    // (Documentación de Google: FIN DE NUEVOS LISTENERS v11.0)

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
    // ... (Sin cambios desde v7.30) ...
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
    // ... (Sin cambios desde v7.30) ...
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
    // ... (Sin cambios desde v7.30) ...
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
        
        // (¡MODIFICADO v8.0!) Setea todas las columnas como base
        columnasVisibles = [...todasLasColumnas];
        
        autocompleteOptions = result.autocomplete_options || {};
        console.log("Opciones de Autocompletado recibidas:", autocompleteOptions);

        populateColumnDropdowns(); 
        renderColumnSelector(); 
        
        // (¡NUEVO v8.1!) Llama a update para asegurar que las
        // columnas internas se añadan Y la "Priority" original se quite
        updateVisibleColumnsFromCheckboxes();
        
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
        autocompleteOptions = {};
        undoHistoryCount = 0;
        updateActionButtonsVisibility();
        fileUploadList.innerHTML = `<p style="color: red;">Error al cargar el archivo.</p>`;
        renderColumnSelector();
        resetResumenCard(); 
    }
}

async function handleAddFilter() {
    // ... (Sin cambios desde v7.30) ...
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
    // ... (Sin cambios desde v7.30) ...
    activeFilters = []; 
    if (currentView === 'detailed') {
        document.getElementById('input-search-table').value = ''; 
    }
    await refreshActiveView(); 
}

async function handleRemoveFilter(event) {
    // ... (Sin cambios desde v7.30) ...
    if (!event.target.classList.contains('remove-filter-btn')) return;
    const indexToRemove = parseInt(event.target.dataset.index, 10);
    activeFilters.splice(indexToRemove, 1);
    await refreshActiveView(); 
}

/**
 * @description Alterna el modo de pantalla completa.
 * (v7.30 - Sin 'setHeight', solo 'redraw')
 */
function handleFullscreen(event) {
    // ... (Sin cambios desde v7.31) ...
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
            console.log("Refrescando el tamaño de Tabulator después de la transición CSS.");
            activeTableInstance.redraw(true);
        }
    }, 200); 
}


function handleSearchTable() {
    // ... (Sin cambios desde v7.30) ...
    const searchTableInput = document.getElementById('input-search-table');
    const searchTerm = searchTableInput.value.toLowerCase();
    
    if (tabulatorInstance) {
        if (!searchTerm) {
            tabulatorInstance.clearFilter();
        } else {
            tabulatorInstance.setFilter(function(data){
                for(let col of columnasVisibles){ // Busca en _row_id también
                    let dataToSearch;
                    
                    if (col === '_row_id') {
                        dataToSearch = data[col] + 1; // Busca N° Fila
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
    } else {
        console.warn("handleSearchTable: tabulatorInstance no está listo.");
    }
}


async function handleDownloadExcel() {
    // ... (¡MODIFICADO v8.1!) ...
    if (!currentFileId) { 
        alert(i18n['no_data_to_download'] || "No hay datos para descargar."); 
        return; 
    }
    
    // (Documentación de Google: Inicio de la Solución 3 - Ocultar Columna)
    // (¡MODIFICADO!) Filtra la columna "Priority" original (del Excel)
    // pero MANTIENE nuestra columna "_priority" (la generada).
    const colsToDownload = columnasVisibles.filter(col => col !== 'Priority');
    // (Documentación de Google: Fin de la Solución 3)
    
    try {
        const response = await fetch('/api/download_excel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file_id: currentFileId, 
                filtros_activos: activeFilters, 
                columnas_visibles: colsToDownload // <-- Usa la lista filtrada
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
    // ... (Sin cambios desde v7.30) ...
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

// --- (handleManageLists sin cambios desde v7.30) ---
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


// (Documentación de Google: Inicio de la Solución v9.0 - Hotkeys)
/**
 * @description Gestiona los atajos de teclado globales.
 * (¡NUEVO v9.0!)
 */
function handleGlobalKeydown(event) {
    // (Documentación de Google: 1. El "Guardia")
    // Si el usuario está escribiendo en un input, select, o
    // un editor de celda de Tabulator, NO activamos los hotkeys.
    const target = event.target;
    const isTyping = target.tagName === 'INPUT' || 
                     target.tagName === 'SELECT' || 
                     target.tagName === 'TEXTAREA' ||
                     target.isContentEditable ||
                     (target.classList && target.classList.contains('tabulator-editing'));

    // Si el usuario está escribiendo, ignoramos todos los atajos
    if (isTyping) {
        return; 
    }

    // (Documentación de Google: 2. El "Mapeo" según lo acordado)
    let handled = true; // Para prevenir la acción por defecto

    switch (event.key) {
        case 'a': // minúscula
        case 'A': // mayúscula
            console.log("Hotkey: 'A' - Añadir Fila");
            // Solo añade fila si hay un archivo cargado
            if (currentFileId && currentView === 'detailed') {
                handleAddRow();
            }
            break;
        
        case 'z':
        case 'Z':
            console.log("Hotkey: 'Z' - Deshacer");
            // Solo deshace si hay historial
            if (undoHistoryCount > 0 && currentView === 'detailed') {
                handleUndoChange();
            }
            break;

        case 's':
        case 'S':
            console.log("Hotkey: 'S' - Consolidar");
            // Solo consolida si hay historial
            if (undoHistoryCount > 0 && currentView === 'detailed') {
                handleCommitChanges();
            }
            break;

        case 'Delete': // Tecla "Suprimir"
            console.log("Hotkey: 'Delete' - Limpiar Filtros");
            // Solo limpia si hay filtros activos
            if (activeFilters.length > 0) {
                handleClearFilters();
            }
            break;
        
        case 'f':
        case 'F':
            console.log("Hotkey: 'F' - Foco en Búsqueda");
            // Solo funciona en la vista detallada
            if (currentView === 'detailed') {
                const searchInput = document.getElementById('input-search-table');
                if (searchInput) {
                    searchInput.focus();
                }
            }
            break;

        case 'g': // Usando G para Fullscreen
        case 'G':
            console.log("Hotkey: 'G' - Pantalla Completa");
            // Funciona en ambas vistas
            handleFullscreen();
            break;

        default:
            handled = false; // No era un hotkey, no hacemos nada
            break;
    }

    if (handled) {
        // Si fue un hotkey que manejamos, prevenimos la acción por defecto
        // (ej. que la 'f' se escriba en la barra de búsqueda del navegador)
        event.preventDefault();
    }
}
// (Documentación de Google: Fin de la Solución v9.0)


// ---
// --- FUNCIONES DE EDICIÓN ---
// ---

/**
 * @description Llama a la API para AÑADIR una nueva fila en blanco.
 * (¡MODIFICADO v8.4!)
 */
async function handleAddRow() {
    if (!currentFileId) {
        alert("Por favor, cargue un archivo primero.");
        return;
    }
    
    console.log("Añadiendo nueva fila...");
    
    try {
        // 1. Llama a la nueva API /api/add_row
        const response = await fetch('/api/add_row', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        console.log(result.message);
        
        // 2. Actualiza el contador de deshacer
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 
        
        // 3. Llama a getFilteredData() para repintar CON los filtros
        await getFilteredData();
        
        // 4. Haz scroll a la fila recién creada
        if (result.new_row_id && tabulatorInstance) {
            setTimeout(() => {
                tabulatorInstance.scrollToRow(result.new_row_id, "bottom", false);
                const row = tabulatorInstance.getRow(result.new_row_id);
                if (row) {
                    // (Documentación de Google: Solución v8.4)
                    // Añade una comprobación 'if (rowElement)'
                    const rowElement = row.getElement();
                    if (rowElement) {
                        // (v8.0) La fila nueva tendrá 'priority-media' por defecto
                        // por el rowFormatter, pero la resaltamos temporalmente.
                        // (v8.5) El resaltado debe ser sobre el 'rowElement'
                        rowElement.style.backgroundColor = "#FFF9E5"; 
                        setTimeout(() => {
                            // (v8.0) Quita el resaltado.
                            if (rowElement) {
                                // (v8.5) El CSS de prioridad lo gestiona el
                                // rowFormatter, solo quitamos el resaltado.
                                rowElement.style.backgroundColor = ""; 
                            }
                            // (v8.0) Fuerza un redibujado de la fila para que
                            // el rowFormatter aplique el color de prioridad
                            if(row) {
                                row.reformat();
                            }
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

/**
 * @description Llama a la API para ELIMINAR una fila específica.
 * (Sin cambios desde v7.30)
 */
async function handleDeleteRow(row_id) {
    if (!currentFileId) {
        alert("Error: No hay archivo cargado.");
        return;
    }
    
    console.log(`Eliminando fila con ID: ${row_id}`);
    
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
        
        console.log(result.message);
        
        // 1. Actualiza el contador de deshacer
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 

        // 2. Llama a getFilteredData() para repintar CON los filtros
        await getFilteredData();

    } catch (error) {
        console.error("Error al eliminar fila:", error);
        alert("Error al eliminar fila: " + error.message);
    }
}

/**
 * @description Llama a la API para DESHACER el último cambio.
 * (¡MODIFICADO v8.4! - Corrección de Race Condition)
 */
async function handleUndoChange() {
    // (Documentación de Google: Inicio de la función)
    // Propósito: Deshace la última acción del usuario (update, add, delete).
    // (Fin de la documentación de Google)

    // 1. (Sin cambios) Verificaciones iniciales.
    if (undoHistoryCount === 0 || !currentFileId) {
        // (v9.0) Alerta silenciosa para hotkeys
        console.warn("No hay nada que deshacer.");
        return;
    }
    console.log("Deshaciendo último cambio...");
    
    try {
        // 2. (Sin cambios) Llama a la API de deshacer del backend.
        const response = await fetch('/api/undo_change', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ file_id: currentFileId }) 
        });

        // 3. (Sin cambios) Obtiene el resultado (que incluye 'affected_row_id').
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        console.log(result.message); 
        
        // 4. (Sin cambios) Actualiza el contador de deshacer en la UI.
        undoHistoryCount = result.history_count;
        updateActionButtonsVisibility(); 

        // --- ¡INICIO DE LA LÓGICA DE SCROLL (v7.27/v7.28)! ---
        
        // 5. (Modificado) Comprueba SI NECESITAMOS hacer scroll.
        if (result.affected_row_id && tabulatorInstance) {
            
            // 6. (Nuevo) Guarda el ID de la fila y define los contadores.
            const rowId = result.affected_row_id;
            let renderAttempts = 0;      
            const maxAttempts = 3;       
            
            console.log("Deshacer completado, programando scroll a la fila:", rowId);

            // 7. (Nuevo) Define el listener "inteligente" de un solo uso.
            const scrollOnce = () => {
                renderAttempts++;
                console.log(`Intento de render [${renderAttempts}/${maxAttempts}], intentando scroll a:`, rowId);
                
                const row = tabulatorInstance.getRow(rowId);
                
                if (row) {
                    // --- ÉXITO ---
                    console.log("Fila encontrada, haciendo scroll y resaltando.");
                    
                    // 1. Desconecta el listener.
                    tabulatorInstance.off("renderComplete", scrollOnce); 
                    
                    // 2. Ejecuta el scroll y el resaltado.
                    tabulatorInstance.scrollToRow(row, "center", false)
                    .then(() => {
                        
                        // (Documentación de Google: Inicio de la Solución v8.4)
                        // Añade una comprobación de seguridad antes de
                        // intentar acceder a .style.backgroundColor
                        const rowElement = row.getElement();
                        if (rowElement) {
                            // (v8.5) El resaltado debe ser sobre el 'rowElement'
                            rowElement.style.backgroundColor = "#FFF9E5"; 
                            
                            setTimeout(() => {
                                // Comprueba de nuevo dentro del timeout
                                if (rowElement) {
                                    // (v8.5) El CSS de prioridad lo gestiona el
                                    // rowFormatter, solo quitamos el resaltado.
                                    rowElement.style.backgroundColor = ""; 
                                }
                                // Fuerza un redibujado de la fila para que
                                // el rowFormatter aplique el color de prioridad
                                if(row) {
                                    row.reformat();
                                }
                            }, 2000);
                        } else {
                            console.warn(`scrollOnce.then: Fila ${rowId} encontrada, pero su elemento DOM no está renderizado para el resaltado.`);
                        }
                        // (Documentación de Google: Fin de la Solución v8.4)
                        
                    })
                    .catch(err => {
                        // (SOLUCIÓN v8.4) Maneja el error si scrollToRow falla
                        console.warn(`scrollToRow falló para la fila ${rowId} (probablemente está filtrada).`, err);
                    });
                    
                } else if (renderAttempts >= maxAttempts) {
                    // --- FALLO FINAL ---
                    console.warn(`Falló el scroll a la fila ${rowId} (probablemente está filtrada). Abandonando.`);
                    tabulatorInstance.off("renderComplete", scrollOnce); 
                    
                } else {
                    // --- FALLO TEMPORAL ---
                    console.warn(`Intento de scroll falló, la fila ${rowId} aún no está (esperando próximo render)...`);
                }
            };
            
            // 8. (Nuevo) ¡CRÍTICO! Adjunta el listener AHORA
            tabulatorInstance.on("renderComplete", scrollOnce);

        } // Fin de if(necesitamos-scroll)

        // 9. (Modificado) AHORA llama a getFilteredData().
        await getFilteredData();
        
        // --- FIN DE LA LÓGICA DE SCROLL ---

    } catch (error) {
        // (Sin cambios) Captura de errores
        console.error("Error al deshacer el cambio:", error);
        alert("Error al deshacer: " + error.message);
    }
}


/**
 * @description Llama a la API para CONSOLIDAR los cambios.
 * (Sin cambios desde v7.30)
 */
async function handleCommitChanges() {
    // (v9.0) Comprobación de hotkey
    if (undoHistoryCount === 0 || !currentFileId) {
        console.warn("No hay cambios que consolidar.");
        return;
    }
    
    if (!confirm("¿Estás seguro de que quieres consolidar todos los cambios?\n\nEsta acción guardará el estado actual y limpiará el historial de deshacer.")) {
        return;
    }
    if (!currentFileId) {
        alert("No hay un archivo cargado.");
        return;
    }
    console.log("Consolidando cambios...");
    
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
// --- FIN DE FUNCIONES DE EDICIÓN ---


// (Documentación de Google: INICIO DE NUEVAS FUNCIONES v11.0)
/**
 * @description Guarda la configuración de la vista actual en un
 * archivo JSON.
 * (¡NUEVO v11.0!)
 */
function handleSaveView() {
    // (Documentación de Google: 1. Comprueba si hay un archivo
    //  cargado, sino no hay nada que guardar)
    if (!currentFileId) {
        alert(i18n['no_data_to_save_view'] || "Cargue un archivo primero para guardar una vista.");
        return;
    }

    console.log("Guardando la configuración de la vista...");

    // (Documentación de Google: 2. Recopila el estado actual
    //  de las variables globales)
    const groupByColElement = document.getElementById('select-columna-agrupar');
    const viewConfig = {
        viewType: currentView,
        activeFilters: activeFilters,
        visibleColumns: columnasVisibles,
        groupByColumn: groupByColElement ? groupByColElement.value : ""
    };

    // (Documentación de Google: 3. Crea el archivo JSON en memoria)
    const jsonString = JSON.stringify(viewConfig, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    // (Documentación de Google: 4. Crea un enlace temporal
    //  para activar la descarga)
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mi_vista_config.json';
    document.body.appendChild(a);
    a.click();
    
    // (Documentación de Google: 5. Limpia el enlace temporal)
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * @description Carga la configuración de la vista desde un
 * archivo JSON.
 * (¡NUEVO v11.0!)
 */
function handleLoadView(event) {
    const file = event.target.files[0];
    
    // (Documentación de Google: 1. Valida que sea un
    //  archivo JSON y que haya un archivo de Excel
    //  cargado en la sesión)
    if (!file || file.type !== 'application/json') {
        alert(i18n['invalid_json_file'] || "Por favor, seleccione un archivo .json válido.");
        event.target.value = null; // Resetea el input
        return;
    }
    
    if (!currentFileId) {
        alert(i18n['load_excel_first'] || "Por favor, cargue primero un archivo Excel antes de cargar una vista.");
        event.target.value = null; // Resetea el input
        return;
    }

    console.log("Cargando configuración de vista desde JSON...");

    // (Documentación de Google: 2. Usa FileReader para leer
    //  el contenido del JSON)
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        try {
            // (Documentación de Google: 3. Parsea el JSON)
            const config = JSON.parse(e.target.result);

            // (Documentación de Google: 4. Aplica la configuración
            //  a las variables globales)
            activeFilters = config.activeFilters || [];
            
            // (Documentación de Google: 4.1. Valida que las columnas
            //  del JSON existan en el archivo actual)
            const loadedVisibleCols = config.visibleColumns || todasLasColumnas;
            columnasVisibles = loadedVisibleCols.filter(col => todasLasColumnas.includes(col));

            const viewType = config.viewType || 'detailed';
            const groupByCol = config.groupByColumn || '';

            // (Documentación de Google: 5. Actualiza la UI
            //  con la nueva configuración)
            
            // Actualiza las checkboxes de columnas visibles
            const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = columnasVisibles.includes(cb.value);
            });
            
            // Actualiza el dropdown de agrupar
            const groupBySelect = document.getElementById('select-columna-agrupar');
            if (groupBySelect) {
                // Comprueba si la opción cargada es válida
                if (groupBySelect.querySelector(`option[value="${groupByCol}"]`)) {
                    groupBySelect.value = groupByCol;
                } else {
                    groupBySelect.value = ""; // Resetea si no es válida
                }
            }

            // (Documentación de Google: 6. Refresca la vista.
            //  Llama a toggleView con 'force=true' para forzar
            //  un repintado completo (refreshActiveView))
            toggleView(viewType, true); 

            console.log("Configuración de vista cargada y aplicada.");

        } catch (error) {
            console.error("Error al parsear el archivo JSON:", error);
            alert(i18n['json_parse_error'] || "Error al leer el archivo JSON. El formato podría ser inválido.");
        }
    };
    
    reader.onerror = () => {
        console.error("Error al leer el archivo:", reader.error);
        alert(i18n['file_read_error'] || "No se pudo leer el archivo.");
    };

    // (Documentación de Google: 7. Inicia la lectura y resetea
    //  el input para poder cargar el mismo archivo dos veces)
    reader.readAsText(file);
    event.target.value = null;
}
// (Documentación de Google: FIN DE NUEVAS FUNCIONES v11.0)


// ---
// SECCIÓN 4: LÓGICA DE DATOS Y RENDERIZADO (¡MODIFICADO!)
// ---

/**
 * @description Actualiza las tarjetas de KPI con nuevos datos.
 */
function updateResumenCard(resumen_data) {
    // ... (Sin cambios desde v7.30) ...
    if (!resumen_data) return; 
    
    const totalFacturas = document.getElementById('resumen-total-facturas');
    const montoTotal = document.getElementById('resumen-monto-total');
    const montoPromedio = document.getElementById('resumen-monto-promedio');

    if (totalFacturas) totalFacturas.textContent = resumen_data.total_facturas;
    if (montoTotal) montoTotal.textContent = resumen_data.monto_total;
    if (montoPromedio) montoPromedio.textContent = resumen_data.monto_promedio;
    
    console.log("KPIs actualizados.", resumen_data);
}

function resetResumenCard() {
    // ... (Sin cambios desde v7.30) ...
    updateResumenCard({
        total_facturas: '0',
        monto_total: '$0.00',
        monto_promedio: '$0.00'
    });
}


function renderFilters() {
    // ... (¡MODIFICADO v8.0!) ...
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
        // (¡MODIFICADO v8.0!) Muestra nombres amigables para columnas internas
        let colName = filtro.columna;
        if (filtro.columna === '_row_id') { colName = 'N° Fila'; }
        if (filtro.columna === '_row_status') { colName = 'Row Status'; }
        if (filtro.columna === '_priority') { colName = 'Prioridad'; }
        
        // (SOLUCIÓN v8.1) Oculta la columna "Priority" original si se filtra
        if (filtro.columna === 'Priority') { return; }
        
        const filterItemHTML = `
            <div class="filtro-chip">
                <span>${colName}: <strong>${filtro.valor}</strong></span>
                <button class="remove-filter-btn" data-index="${index}">&times;</button>
            </div>
        `;
        filtersListDiv.innerHTML += filterItemHTML;
    });
}


/**
 * @description Renderiza la tabla DETALLADA.
 * ¡FUNCIÓN MODIFICADA! (v12.0)
 */
function renderTable(data = null, forceClear = false) {
    // (Documentación de Google: Inicio de la función)
    // Propósito: Renderiza la tabla principal de Tabulator.
    // v12.0: 'sorter' de _priority ahora incluye 'Invoice Date Age'
    //      como segundo nivel de ordenamiento.
    // v10.1: '_row_status' es una columna móvil.
    // v8.x: Sorter de prioridad, ocultar "Priority", etc.
    // (Fin de la documentación de Google)
    
    // 1. (Sin cambios) Obtiene el contenedor de la tabla.
    const resultsTableDiv = document.getElementById('results-table');
    if (!resultsTableDiv) {
        console.error("ERROR: No se encontró el div '#results-table'.");
        return; 
    }

    // 2. (Sin cambios) Limpia la instancia si es necesario (ej. al cargar archivo).
    if (forceClear && tabulatorInstance) {
        console.log("Tabulator (Detallada): Destruyendo instancia.");
        tabulatorInstance.destroy();
        tabulatorInstance = null;
    }
    
    // 3. (Sin cambios) Define qué datos usar.
    const dataToRender = data || tableData;

    // 4. (Sin cambios) Maneja el estado sin archivo cargado.
    if (!currentFileId) { 
        if (tabulatorInstance) {
            tabulatorInstance.destroy();
            tabulatorInstance = null;
        }
        resultsTableDiv.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    
    // 5. (Sin cambios) Definir las Columnas de Fecha.
    const dateColumns = new Set([
        "Invoice Date",
        "Intake Date",
        "Assigned Date",
        "Due Date",
        "Terms Date",
        "GL Date",
        "Updated Date",
        "Batch Matching Date"
    ]);
    
    // 6. (¡MODIFICADO v10.1!) Definir las Columnas de la Tabla (Base).
    // (Documentación de Google: Se elimina el bloque
    //  de '_row_status' de esta sección)
    const columnDefs = [
        // Columna de Eliminar
        {
            title: "", 
            field: "delete",
            width: 40,
            hozAlign: "center",
            headerSort: false,
            frozen: true,
            formatter: function(cell, formatterParams, onRendered){
                return '<i class="fas fa-trash-alt delete-icon"></i>';
            },
            cellClick: function(e, cell){
                if (!confirm("¿Estás seguro de que quieres eliminar esta fila?")) {
                    return; 
                }
                const rowData = cell.getRow().getData();
                const rowId = rowData._row_id;
                handleDeleteRow(rowId);
            }
        },
        // Columna de N° Fila
        {
            title: "N°",
            field: "_row_id", 
            width: 70,
            hozAlign: "right",
            headerSort: true,
            frozen: true, 
            formatter: function(cell) {
                return cell.getValue() + 1; // 0-indexed a 1-indexed
            }
        },
        // (¡NUEVO v8.0! ¡MODIFICADO v12.0!) Columna de Prioridad
        {
            title: "Prioridad",
            field: "_priority",
            width: 100,
            hozAlign: "left",
            headerSort: true,
            editable: false, 
            frozen: true, 
            
            // (Documentación de Google: INICIO DE LA MODIFICACIÓN v12.0)
            // Sorter multi-nivel:
            // Nivel 1: Prioridad (Alta > Media > Baja)
            // Nivel 2: Antigüedad (Mayor > Menor)
            sorter: function(a, b, aRow, bRow, column, dir, sorterParams){
                // a y b son los valores de la celda (ej. "Alta", "Media")
                
                // (Documentación de Google: Nivel 1 - Comparar Prioridad)
                const priorityMap = { "Alta": 3, "Media": 2, "Baja": 1, "": 0, null: 0 };
                const aPrioVal = priorityMap[a] || 0;
                const bPrioVal = priorityMap[b] || 0;
                
                const prioDiff = aPrioVal - bPrioVal;
                
                if (prioDiff !== 0) {
                    // (Documentación de Google: Las prioridades son
                    //  diferentes, devuelve la diferencia)
                    // (ej. 3 - 2 = 1. A > B)
                    return prioDiff;
                }
                
                // (Documentación de Google: Nivel 2 - Prioridades Iguales)
                // Las prioridades son iguales,
                // comparar por 'Invoice Date Age'.
                
                // (Documentación de Google: Obtiene los datos de
                //  ambas filas)
                const aData = aRow.getData();
                const bData = bRow.getData();

                // (Documentación de Google: Obtiene la antigüedad.
                //  Convierte a Número)
                const aAge = Number(aData['Invoice Date Age']) || 0;
                const bAge = Number(bData['Invoice Date Age']) || 0;
                
                // (Documentación de Google: Devuelve la diferencia
                //  de antigüedad. El usuario quiere Mayor > Menor,
                //  así que (A - B) es correcto.)
                // (ej. 10 - 5 = 5. A (10) > B (5))
                return aAge - bAge; 
            }
            // (Documentación de Google: FIN DE LA MODIFICACIÓN v12.0)
        }
    ];


    // 7. (¡MODIFICADO v10.1!) Añade dinámicamente el resto de las columnas visibles.
    columnasVisibles.forEach(colName => {
        // (Documentación de Google: Omite las columnas ya
        //  añadidas manualmente Y la "Priority" original)
        // (¡MODIFICADO v10.1! Se quita '_row_status' de esta
        //  condición para que SÍ se renderice aquí)
        if (colName === '_row_id' || 
            colName === '_priority' || 
            colName === 'Priority') {
            return; 
        }
        
        // (Documentación de Google: ¡MODIFICADO v10.1!
        //  Se restaura la lógica de formateo de título
        //  para '_row_status')
        const colTitle = (colName === '_row_status') ? "Row Status" : colName;
        
        // --- (Inicio Lógica de Editor - Sin cambios v7.25) ---
        let editorType = "input"; 
        let editorParams = {};
        let formatter = undefined;
        let mutatorEdit = undefined;
        let isEditable = true; 
        
        // (Documentación de Google: ¡MODIFICADO v10.1!
        //  Añade una regla para que '_row_status'
        //  no sea editable)
        if (colName === '_row_status') {
            isEditable = false;
            editorType = undefined;
        }
        else if (dateColumns.has(colName)) {
            editorType = "date";
            mutatorEdit = function(value, data, type, params, component) {
                if (!value) { return null; }
                if (typeof value.split === 'function') {
                    return value.split(" ")[0];
                }
                return value; 
            }
            formatter = function(cell, formatterParams, onRendered) {
                const value = cell.getValue();
                if (!value) { return ""; }
                if (typeof value.split === 'function') {
                    return value.split(" ")[0];
                }
                return value;
            }
        }
        else if (colName === 'Sender Email') {
            editorType = "autocomplete";
            const options = (autocompleteOptions && autocompleteOptions[colName]) 
                ? autocompleteOptions[colName] 
                : [];
            editorParams = {
                values: options,
                showListOnEmpty: true,
                freetext: true 
            };
        } 
        else if (autocompleteOptions && autocompleteOptions[colName] && autocompleteOptions[colName].length > 0) {
            const options = autocompleteOptions[colName];
            if (options.length > 50) {
                editorType = "autocomplete";
                editorParams = {
                    values: options,
                    showListOnEmpty: true,
                    freetext: true,
                };
            } else {
                editorType = "select";
                editorParams = { 
                    values: ["", ...options]
                };
            }
        }
        // --- (Fin Lógica de Editor) ---

        // 8. (Sin cambios) Añade la definición de la columna a la lista.
        columnDefs.push({
            title: colTitle,
            field: colName,
            editor: isEditable ? editorType : undefined, 
            editable: isEditable, 
            editorParams: editorParams,
            mutatorEdit: mutatorEdit, // Asigna el mutator
            formatter: formatter,     // Asigna el formateador
            minWidth: 150, 
            visible: true, 
        });
    });
    // --- FIN DE LA DEFINICIÓN DE COLUMNAS ---


    // --- 9. (Sin cambios) Comprobar si la instancia ya existe ---
    if (tabulatorInstance) {
        // Si la instancia existe, solo actualiza columnas y datos.
        console.log("Tabulator (Detallada): Actualizando datos...");
        
        // (Documentación de Google: Causa 'renderComplete' #1)
        tabulatorInstance.setColumns(columnDefs); 
        // (Documentación de Google: Causa 'renderComplete' #2)
        tabulatorInstance.setData(dataToRender);
        
        // (Sin cambios) Lógica del placeholder.
        if(dataToRender.length === 0) {
            const placeholderText = (activeFilters.length > 0 || document.getElementById('input-search-table').value)
                ? (i18n['no_filters_applied'] || 'No results for these filters.')
                : (i18n['info_upload'] || 'No data found.');
            tabulatorInstance.setPlaceholder(placeholderText);
        }

    } else {
        // --- 10. (¡MODIFICADO!) Crear la NUEVA instancia de Tabulator ---
        console.log("Tabulator (Detallada): Creando nueva instancia...");
        
        tabulatorInstance = new Tabulator(resultsTableDiv, {
            // (Documentación de Google: Inicio de la configuración)
            
            // --- ¡INICIO DEL BLOQUE DE PRIORIDAD v8.0! ---
            // (v8.5) Usa 'div.tabulator-row'
            rowFormatter: function(row) {
                const data = row.getData();
                const element = row.getElement(); // Esto es el div.tabulator-row
                
                element.classList.remove('priority-alta', 'priority-media', 'priority-baja');
                
                if (data._priority === 'Alta') {
                    element.classList.add('priority-alta');
                } else if (data._priority === 'Media') {
                    element.classList.add('priority-media');
                } else if (data._priority === 'Baja') {
                    element.classList.add('priority-baja');
                }
            },
            // --- FIN DEL BLOQUE DE PRIORIDAD ---
            
            // (v7.28) Le dice a Tabulator que use el campo '_row_id'
            // como la clave primaria.
            index: "_row_id", 
            
            virtualDom: true, // (Sin cambios) Optimización de renderizado
            
            // (v7.31) Altura controlada por CSS
            
            data: dataToRender, // (Sin cambios) Datos iniciales
            columns: columnDefs, // (Sin cambios) Columnas definidas arriba
            layout: "fitData", // (Sin cambios) Ajuste de columnas
            movableColumns: true, // (Sin cambios) Permitir mover columnas
            placeholder: `<p>${i18n['info_upload'] || 'Upload file'}</p>`, // (Sin cambios)
            // (Documentación de Google: Fin de la configuración)
        });

        // --- 11. LISTENER DE EDICIÓN (¡MODIFICADO! v10.0) ---
        // (Documentación de Google: Se activa DESPUÉS de que el usuario
        // edita una celda en la UI).
        tabulatorInstance.on("cellEdited", async function(cell){
            
            // (Sin cambios) Obtiene los datos del cambio.
            const newValue = cell.getValue();
            const oldValue = cell.getOldValue(); 
            const colField = cell.getField();
            const rowData = cell.getRow().getData();
            const rowId = rowData._row_id; // (Ahora se obtiene el ID correcto)

            // (Sin cambios) Lógica de corrección de fecha/sin cambios
            if (dateColumns.has(colField) && 
                (newValue === null || newValue === "") && 
                (oldValue !== null && oldValue !== "")) 
            {
                console.log("Cancelación de editor de fecha detectada. Revirtiendo.");
                cell.restoreOldValue(); 
                return; 
            }
            if (newValue === oldValue) {
                console.log("El valor no cambió. No se guarda.");
                return; 
            }
            // --- (Fin de la lógica de corrección) ---

            // (Sin cambios) Llama a la API de actualización.
            console.log(`Guardando... Fila ID: ${rowId}, Col: ${colField}, Nuevo Valor: ${newValue}`);
            
            // (Documentación de Google: Solución v8.4)
            // Añade una comprobación 'if (rowElement)'
            const rowElement = cell.getRow().getElement();
            if (rowElement) {
                // (v8.5) El resaltado debe ser sobre el 'rowElement'
                rowElement.style.backgroundColor = "#FFF9E5";
            }
            
            try {
                // (Sin cambios) Llama a la API del backend.
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
                
                if (result.resumen) {
                    updateResumenCard(result.resumen);
                }

                undoHistoryCount = result.history_count;
                updateActionButtonsVisibility();

                // (Documentación de Google: Obtiene la fila y
                //  el elemento una vez)
                const row = cell.getRow();

                // --- ¡INICIO BLOQUE PRIORIDAD v8.0! ---
                if (result.new_priority) {
                    console.log(`Actualizando prioridad a: ${result.new_priority}`);
                    if (rowElement) {
                        rowElement.classList.remove('priority-alta', 'priority-media', 'priority-baja');
                        
                        if (result.new_priority === 'Alta') {
                            rowElement.classList.add('priority-alta');
                        } else if (result.new_priority === 'Media') {
                            rowElement.classList.add('priority-media');
                        } else if (result.new_priority === 'Baja') {
                            rowElement.classList.add('priority-baja');
                        }
                    }
                    row.update({_priority: result.new_priority});
                }
                // --- FIN BLOQUE PRIORIDAD ---

                // --- ¡INICIO BLOQUE ROW STATUS v10.0! ---
                // (Documentación de Google: Comprueba si la API
                //  devolvió un nuevo estado de fila)
                if (result.new_row_status) {
                    console.log(`Actualizando Row Status a: ${result.new_row_status}`);
                    // (Documentación de Google: Actualiza el dato
                    //  en la celda '_row_status' de Tabulator)
                    row.update({_row_status: result.new_row_status});
                }
                // --- FIN BLOQUE ROW STATUS ---

                // --- ¡INICIO BLOQUE LIMPIEZA v10.0! ---
                // (Documentación de Google: Quita el resaltado
                //  amarillo DESPUÉS de que todas las
                //  actualizaciones (prioridad, status) se apliquen)
                if (rowElement) {
                    rowElement.style.backgroundColor = "";
                    // (Documentación de Google: Vuelve a formatear
                    //  la fila para aplicar el color de prioridad
                    //  (por si el status cambió pero la prioridad no))
                    row.reformat();
                }
                // --- FIN BLOQUE LIMPIEZA ---


            } catch (error) {
                // (Sin cambios) Manejo de error de API.
                console.error("Error al guardar celda:", error);
                alert("Error al guardar el cambio: " + error.message + "\n\nEl cambio será revertido localmente.");
                cell.restoreOldValue();
                
                // (Documentación de Google: Solución v8.4)
                if (rowElement) {
                    rowElement.style.backgroundColor = ""; 
                }
            }
        });
        
        // (Sin cambios) Listener de completado de renderizado.
        tabulatorInstance.on("renderComplete", function(){
            console.log("Tabulator (Detallada): Renderizado completo.");
        });
    }
}


// ---
// SECCIÓN 5: LÓGICA DE VISTAS (¡MODIFICADO v8.0!)
// ---

/**
 * @description Muestra/Oculta "Deshacer", "Consolidar" y "Añadir Fila".
 */
function updateActionButtonsVisibility() {
    // ... (Sin cambios desde v7.30) ...
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
    // ... (Sin cambios desde v7.30) ...
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

/**
 * @description Llama a /api/filter y actualiza los KPIs
 * (Sin cambios desde v7.30)
 */
async function getFilteredData() {
    // ... (Sin cambios desde v7.30) ...
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

        if (result.resumen) {
            updateResumenCard(result.resumen);
        }

        renderFilters(); 
        
        // ¡Forzar repintado con los datos filtrados!
        renderTable(result.data); 

        if (resultsHeader) resultsHeader.textContent = i18n['results_header']?.replace('{num_filas}', result.num_filas) || `Results (${result.num_filas})`;

    } catch (error) { 
        // ... (Sin cambios desde v7.30) ...
        console.error('Error en fetch /api/filter:', error); 
        alert('Error al filtrar: ' + error.message);
        resetResumenCard(); 
        renderTable(null, true);
    }
}


async function getGroupedData() {
    // ... (Sin cambios desde v7.30) ...
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
    // ... (Sin cambios desde v7.30) ...
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
    
    updateActionButtonsVisibility();
}

function populateGroupDropdown() {
    // ... (¡MODIFICADO v8.0!) ...
    const select = document.getElementById('select-columna-agrupar');
    if (!select) return; 
    
    const valorActual = select.value;
    select.innerHTML = `<option value="">${i18n['group_by_placeholder'] || 'Select column...'}</option>`;

    // Filtra usando la constante COLUMNAS_AGRUPABLES
    const opcionesValidas = COLUMNAS_AGRUPABLES.filter(col => 
        todasLasColumnas.includes(col) && col !== '_row_id'
    );

    opcionesValidas.forEach(colName => {
        const option = document.createElement('option');
        option.value = colName;
        // (¡MODIFICADO v8.0!) Formatea nombres internos
        if (colName === '_row_status') {
            option.textContent = "Row Status";
        } else if (colName === '_priority') {
            option.textContent = "Prioridad";
        } else {
            option.textContent = colName;
        }
        select.appendChild(option);
    });

    // Intenta restaurar el valor si todavía es válido.
    if (opcionesValidas.includes(valorActual)) {
        select.value = valorActual;
    }
}

async function handleGroupColumnChange() {
    await getGroupedData();
}

/**
 * @description Renderiza la tabla AGRUPADA.
 * (¡MODIFICADO v8.0!)
 */
function renderGroupedTable(data, colAgrupada, forceClear = false) {
    // (Documentación de Google: Inicio de la función)
    // v8.0: Añade formateo para el nombre de la columna _priority
    // (Fin de la documentación de Google)
    
    // 1. (Sin cambios) Obtiene el contenedor.
    const resultsTableDiv = document.getElementById('results-table-grouped');
    if (!resultsTableDiv) {
         console.error("ERROR: No se encontró el div '#results-table-grouped'.");
        return;
    }

    // 2. (Sin cambios) Limpia la instancia si es necesario.
    if (forceClear && groupedTabulatorInstance) {
        console.log("Tabulator (Agrupada): Destruyendo instancia.");
        groupedTabulatorInstance.destroy();
        groupedTabulatorInstance = null;
    }

    // 3. (Sin cambios) Maneja el estado sin datos.
    if (!data || data.length === 0) {
        if (groupedTabulatorInstance) {
             groupedTabulatorInstance.destroy();
             groupedTabulatorInstance = null;
        }
        resultsTableDiv.innerHTML = `<p>${i18n['info_upload'] || 'Please upload a file and select a grouping column.'}</p>`;
        return;
    }

    // 4. (¡MODIFICADO v8.0!) Mapea los encabezados para traducción.
    const headersMap = {};
    if (colAgrupada) { 
        headersMap[colAgrupada] = (colAgrupada === '_row_status') ? "Row Status" : colAgrupada;
        // (¡NUEVO v8.0!)
        if (colAgrupada === '_priority') { headersMap[colAgrupada] = "Prioridad"; }
    }
    headersMap["Total_sum"] = i18n['group_total_amount'] || "Total Amount";
    headersMap["Total_mean"] = i18n['group_avg_amount'] || "Avg Amount";
    headersMap["Total_min"] = i18n['group_min_amount'] || "Min Amount";
    headersMap["Total_max"] = i18n['group_max_amount'] || "Max Amount";
    headersMap["Total_count"] = i18n['group_invoice_count'] || "Invoice Count";
    
    const headerOrder = [colAgrupada, "Total_sum", "Total_mean", "Total_min", "Total_max", "Total_count"];

    // 5. (Sin cambios) Define las columnas.
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

    // 6. (Sin cambios) Destruye la instancia anterior si existe.
    if (groupedTabulatorInstance) {
        groupedTabulatorInstance.destroy();
    }
    
    // 7. (Sin cambios v7.31) Crea la NUEVA instancia.
    console.log("Tabulator (Agrupada): Creando nueva instancia.");
    groupedTabulatorInstance = new Tabulator(resultsTableDiv, {
        data: data, // (Sin cambios)
        columns: columnDefs, // (Sin cambios)
        layout: "fitData", // (Sin cambios)
        // (v7.31) Altura controlada por CSS
        movableColumns: true, // (Sin cambios)
    });
}

/**
 * @description (¡MODIFICADO v8.1!)
 * Añade "N° Fila", "Row Status" y "Prioridad" al dropdown de filtros.
 */
function populateColumnDropdowns() {
    const colSelect = document.getElementById('select-columna');
    if (!colSelect) return; 
    
    colSelect.innerHTML = `<option value="">${i18n['column_select'] || 'Select col...'}</option>`;
    
    todasLasColumnas.forEach(col => {
        
        // (SOLUCIÓN v8.1) Oculta la columna "Priority" original
        if (col === 'Priority') {
            return;
        }
        
        const option = document.createElement('option'); 
        option.value = col; 
        
        // (¡MODIFICADO v8.0!) Formatea nombres internos
        if (col === '_row_id') {
            option.textContent = "N° Fila"; // Texto amigable
        } else if (col === '_row_status') {
            option.textContent = "Row Status";
        } else if (col === '_priority') {
            option.textContent = "Prioridad";
        } else {
            option.textContent = col;
        }
        
        colSelect.appendChild(option);
    });

    populateGroupDropdown();
}


// ---
// ¡BLOQUE DE INICIALIZACIÓN! (¡MODIFICADO v11.0!)
// ---
document.addEventListener('DOMContentLoaded', async (event) => {
    
    await loadTranslations();
    
    try {
        if (typeof SESSION_DATA !== 'undefined' && SESSION_DATA.file_id) {
            console.log("Sesión activa encontrada:", SESSION_DATA.file_id);
            currentFileId = SESSION_DATA.file_id;
            todasLasColumnas = SESSION_DATA.columnas;
            
            // (¡MODIFICADO v8.0!) Setea todas las columnas como base
            columnasVisibles = [...todasLasColumnas];
            
            if (SESSION_DATA.autocomplete_options) {
                 autocompleteOptions = SESSION_DATA.autocomplete_options;
            }

            populateColumnDropdowns();
            
            // (v11.0) Llama a renderColumnSelector() ANTES
            // de updateVisible...
            renderColumnSelector();
            
            // (¡NUEVO v8.1!) Llama a update para asegurar que las
            // columnas internas se añadan Y la "Priority" original se quite
            updateVisibleColumnsFromCheckboxes();
            
            undoHistoryCount = SESSION_DATA.history_count || 0;
            console.log(`Historial de deshacer cargado: ${undoHistoryCount} cambios.`);
            updateActionButtonsVisibility();
            
            refreshActiveView(); 
            
        } else {
            console.log("No se encontró sesión activa.");
            renderColumnSelector();
            undoHistoryCount = 0;
            updateActionButtonsVisibility();
        }
        
        // (¡MODIFICADO v9.0!)
        // Mueve setupEventListeners aquí para que se llame
        // SIN IMPORTAR si hay sesión o no (así el 'drag' funciona)
        setupEventListeners(); 
        
    } catch (e) {
        console.error("Error fatal al inicializar:", e);
    }
});