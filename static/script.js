// script.js (Versión 7.7 - Con Gestión de Listas de Autocompletado)
// NOTA:
// 1. Añadido un listener para '#btn-manage-lists'.
// 2. Añadida la nueva función 'handleManageLists' para
//    editar, guardar y recargar las listas de autocompletado.

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
    // ... (Sin cambios desde v7.6) ...
    const wrapper = document.getElementById('column-selector-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = ''; 
    if (todasLasColumnas.length === 0) { 
        wrapper.innerHTML = `<p>${i18n['info_upload'] || 'Upload file'}</p>`; 
        return; 
    }
    todasLasColumnas.forEach(columnName => {
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
    // ... (Sin cambios desde v7.6) ...
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    columnasVisibles = [];
    checkboxes.forEach(cb => {
        if (cb.checked) {
            columnasVisibles.push(cb.value);
        }
    });
    renderTable();
}
function handleColumnVisibilityChange(event) {
    if (event.target.type !== 'checkbox') return;
    updateVisibleColumnsFromCheckboxes();
}
function handleCheckAllColumns() {
    // ... (Sin cambios desde v7.6) ...
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    updateVisibleColumnsFromCheckboxes();
}
function handleUncheckAllColumns() {
    // ... (Sin cambios desde v7.6) ...
    const checkboxes = document.querySelectorAll('#column-selector-wrapper input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    updateVisibleColumnsFromCheckboxes();
}
// ---
// SECCIÓN 2: CONFIGURACIÓN INICIAL Y LISTENERS (¡MODIFICADO!)
// ---
async function loadTranslations() {
    // ... (Sin cambios desde v7.6) ...
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
 * ¡MODIFICADO! Añadido listener para '#btn-manage-lists'.
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
    
    // Listeners Vista Agrupada
    addSafeListener(document.getElementById('btn-view-detailed'), 'click', () => toggleView('detailed'));
    addSafeListener(document.getElementById('btn-view-grouped'), 'click', () => toggleView('grouped'));
    addSafeListener(document.getElementById('select-columna-agrupar'), 'change', handleGroupColumnChange);
    
    // Listeners Botones Duplicados
    addSafeListener(document.getElementById('btn-clear-filters-grouped'), 'click', handleClearFilters);
    addSafeListener(document.getElementById('btn-fullscreen-grouped'), 'click', handleFullscreen);
    addSafeListener(document.getElementById('btn-download-excel-grouped'), 'click', handleDownloadExcelGrouped);
    addSafeListener(document.getElementById('active-filters-list-grouped'), 'click', handleRemoveFilter);

    // --- ¡NUEVO LISTENER! ---
    addSafeListener(document.getElementById('btn-manage-lists'), 'click', handleManageLists);
    // --- FIN DEL CAMBIO ---

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
    // ... (Sin cambios desde v7.6) ...
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
    // ... (Sin cambios desde v7.6) ...
    try { 
        await fetch(`/api/set_language/${langCode}`); 
        location.reload();
    }
    catch (error) { console.error('Error al cambiar idioma:', error); }
}
// ---
// SECCIÓN 3: MANEJO DE EVENTOS PRINCIPALES
// ---

async function handleFileUpload(event) {
    // ... (Sin cambios desde v7.6) ...
    const file = event.target.files[0]; if (!file) return;
    const fileUploadList = document.getElementById('file-upload-list');
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    fileUploadList.innerHTML = `
        <div class="file-list-item">
            <svg class="file-icon" ...></svg>
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

        toggleView('detailed', true); 

    } catch (error) { 
        console.error('Error en fetch /api/upload:', error); 
        todasLasColumnas = []; 
        columnasVisibles = []; 
        autocompleteOptions = {};
        fileUploadList.innerHTML = `<p style="color: red;">Error al cargar el archivo.</p>`;
        renderColumnSelector();
        resetResumenCard(); 
    }
}

async function handleAddFilter() {
    // ... (Sin cambios desde v7.6) ...
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
    // ... (Sin cambios desde v7.6) ...
    activeFilters = []; 
    if (currentView === 'detailed') {
        document.getElementById('input-search-table').value = ''; 
    }
    await refreshActiveView(); 
}

async function handleRemoveFilter(event) {
    // ... (Sin cambios desde v7.6) ...
    if (!event.target.classList.contains('remove-filter-btn')) return;
    const indexToRemove = parseInt(event.target.dataset.index, 10);
    activeFilters.splice(indexToRemove, 1);
    await refreshActiveView(); 
}

function handleFullscreen(event) {
    // ... (Sin cambios desde v7.6) ...
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
    // ... (Sin cambios desde v7.6) ...
    const searchTableInput = document.getElementById('input-search-table');
    const searchTerm = searchTableInput.value.toLowerCase();
    
    if (tabulatorInstance) {
        if (!searchTerm) {
            tabulatorInstance.clearFilter();
        } else {
            tabulatorInstance.setFilter(function(data){
                for(let col of columnasVisibles){
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
    // ... (Sin cambios desde v7.6) ...
    if (currentData.length === 0 || !currentFileId) { 
        alert(i18n['no_data_to_download'] || "No hay datos para descargar."); 
        return; 
    }
    
    try {
        const response = await fetch('/api/download_excel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file_id: currentFileId, 
                filtros_activos: activeFilters, 
                columnas_visibles: columnasVisibles
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
    // ... (Sin cambios desde v7.6) ...
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

// --- ¡NUEVA FUNCIÓN! ---
/**
 * @description Muestra prompts para que el usuario edite las
 * listas de autocompletado y las guarda en el servidor.
 */
async function handleManageLists() {
    // 1. Pregunta al usuario qué columna quiere editar
    // Usa las claves de 'i18n' que añadimos a translator.py
    const colToEdit = prompt(i18n['prompt_col_to_edit'] || "Qué lista de columna quieres editar?\n(Ej: Status, Assignee)");
    
    // Si el usuario presiona Cancelar, sal de la función
    if (!colToEdit) return; 

    // Verifica si esa columna existe en nuestras listas
    if (!autocompleteOptions[colToEdit]) {
        alert(i18n['alert_col_not_found'] || "Columna no válida o no tiene autocompletado.");
        return;
    }

    // 2. Muestra los valores actuales y pide los nuevos
    const currentValues = autocompleteOptions[colToEdit].join(', ');
    const promptText = (i18n['prompt_edit_list'] || "Editando lista para '{col}':\n\nValores actuales: {vals}\n\nIntroduce los nuevos valores separados por coma:")
        .replace('{col}', colToEdit)
        .replace('{vals}', currentValues);
        
    const newValuesStr = prompt(promptText);
    
    // Si el usuario presiona Cancelar
    if (newValuesStr === null) return; 

    // 3. Convierte el string del usuario en un array limpio
    const newValuesArray = newValuesStr.split(',') // Separa por comas
        .map(val => val.trim())   // Limpia espacios en blanco
        .filter(val => val);      // Elimina valores vacíos

    // 4. Actualiza el objeto de opciones local
    autocompleteOptions[colToEdit] = newValuesArray;

    // 5. ¡Envía el objeto COMPLETO al servidor para guardarlo!
    try {
        const response = await fetch('/api/save_autocomplete_lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Envía el objeto 'autocompleteOptions' global
            body: JSON.stringify(autocompleteOptions) 
        });
        
        if (!response.ok) throw new Error('Error del servidor al guardar');
        
        alert(i18n['alert_save_success'] || "¡Listas guardadas! Los cambios se aplicarán la próxima vez que cargues un archivo.");
        
        // 6. Vuelve a renderizar la tabla detallada para que
        // los nuevos dropdowns/autocomplete se actualicen INMEDIATAMENTE.
        if (currentView === 'detailed' && tabulatorInstance) {
            renderTable();
        }

    } catch (error) {
        console.error("Error al guardar las listas:", error);
        alert(i18n['alert_save_error'] || "Error al guardar las listas.");
    }
}
// --- FIN DE LA NUEVA FUNCIÓN ---


// ---
// SECCIÓN 4: LÓGICA DE DATOS Y RENDERIZADO (¡MODIFICADO!)
// ---

function resetResumenCard() {
    // ... (Sin cambios desde v7.6) ...
    const totalFacturas = document.getElementById('resumen-total-facturas');
    const montoTotal = document.getElementById('resumen-monto-total');
    const montoPromedio = document.getElementById('resumen-monto-promedio');

    if (totalFacturas) totalFacturas.textContent = '0';
    if (montoTotal) montoTotal.textContent = '$0.00';
    if (montoPromedio) montoPromedio.textContent = '$0.00';
}


function renderFilters() {
    // ... (Sin cambios desde v7.6) ...
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
 * ¡MODIFICADO! Ahora usa 'autocompleteOptions' para definir los editores.
 */
function renderTable(data = null, forceClear = false) {
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

    // --- 1. Definir las Columnas para Tabulator (¡LÓGICA MEJORADA!) ---
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
        
        let editorType = "input"; // Editor por defecto
        let editorParams = {};
        
        // --- ¡LÓGICA DE EDITOR MEJORADA! ---
        // Comprueba si tenemos opciones para esta columna en nuestro objeto global
        if (autocompleteOptions && autocompleteOptions[colName]) {
            const options = autocompleteOptions[colName];
            
            if (options.length > 50) {
                // Si hay MUCHAS opciones (ej. >50 Nombres de Vendedor),
                // usa 'autocomplete' que es un <input> con sugerencias.
                editorType = "autocomplete";
                editorParams = {
                    values: options,         // Lista de opciones
                    showListOnEmpty: true,   // Mostrar lista al hacer clic
                    freetext: true,          // Permitir escribir valores nuevos
                };
            } else {
                // Si hay POCAS opciones (ej. "Paid", "Pending"),
                // usa 'select' que es un <select> dropdown.
                editorType = "select";
                editorParams = {
                    // Añade una opción vacía al principio
                    values: ["", ...options] 
                };
            }
        }
        // --- FIN DE LA LÓGICA MEJORADA ---

        columnDefs.push({
            title: colTitle,
            field: colName,
            editor: editorType,           // 'input', 'select', o 'autocomplete'
            editorParams: editorParams,   // Parámetros para el editor
            minWidth: 150, 
        });
    });

    // --- 2. Comprobar si la instancia ya existe ---
    if (tabulatorInstance) {
        console.log("Tabulator (Detallada): Actualizando datos...");
        tabulatorInstance.setColumns(columnDefs); // Actualiza columnas (por si cambiaron las opciones)
        tabulatorInstance.setData(dataToRender);
        
        if(dataToRender.length === 0) {
            const placeholderText = (activeFilters.length > 0 || document.getElementById('input-search-table').value)
                ? (i18n['no_filters_applied'] || 'No results for these filters.')
                : (i18n['info_upload'] || 'No data found.');
            tabulatorInstance.setPlaceholder(placeholderText);
        }

    } else {
        // --- 3. Crear la NUEVA instancia de Tabulator ---
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

        // --- 4. Listeners de Edición (Sin cambios) ---
        tabulatorInstance.on("cellEdited", function(cell){
            console.log(`CELDA EDITADA: Fila ${cell.getRow().getPosition()}, Columna ${cell.getField()}, Nuevo Valor: ${cell.getValue()}`);
            cell.getRow().getElement().style.backgroundColor = "#FFF9E5";
        });
        
        tabulatorInstance.on("renderComplete", function(){
            console.log("Tabulator (Detallada): Renderizado completo.");
        });
    }
}


// ---
// SECCIÓN 5: LÓGICA DE VISTAS (Sin Cambios)
// ---

async function refreshActiveView() {
    // ... (Sin cambios desde v7.6) ...
    if (currentView === 'detailed') {
        renderGroupedTable(null, null, true); 
        await getFilteredData();
    } 
    else if (currentView === 'grouped') {
        renderTable(null, true); 
        await getGroupedData();
    }
}

async function getFilteredData() {
    // ... (Sin cambios desde v7.6) ...
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
            document.getElementById('resumen-total-facturas').textContent = result.resumen.total_facturas;
            document.getElementById('resumen-monto-total').textContent = result.resumen.monto_total;
            document.getElementById('resumen-monto-promedio').textContent = result.resumen.monto_promedio;
        }

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
    // ... (Sin cambios desde v7.6) ...
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
    // ... (Sin cambios desde v7.6) ...
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
}

function populateGroupDropdown() {
    // ... (Sin cambios desde v7.6) ...
    const select = document.getElementById('select-columna-agrupar');
    if (!select) return; 
    
    const valorActual = select.value;
    select.innerHTML = `<option value="">${i18n['group_by_placeholder'] || 'Select column...'}</option>`;

    const opcionesValidas = COLUMNAS_AGRUPABLES.filter(col => 
        todasLasColumnas.includes(col)
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
    // ... (Sin cambios desde v7.6) ...
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
    // ... (Sin cambios desde v7.6) ...
    const colSelect = document.getElementById('select-columna');
    if (!colSelect) return; 
    
    colSelect.innerHTML = `<option value="">${i18n['column_select'] || 'Select col...'}</option>`;
    todasLasColumnas.forEach(col => {
        const option = document.createElement('option'); 
        option.value = col; 
        option.textContent = (col === '_row_status') ? "Row Status" : col;
        colSelect.appendChild(option);
    });

    populateGroupDropdown();
}


// ---
// ¡BLOQUE DE INICIALIZACIÓN! (Sin cambios desde v7.6)
// ---
document.addEventListener('DOMContentLoaded', async (event) => {
    
    await loadTranslations();
    
    try {
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
            
            refreshActiveView(); 
            
        } else {
            console.log("No se encontró sesión activa.");
            renderColumnSelector();
        }
        
        setupEventListeners(); 
        
    } catch (e) {
        console.error("Error fatal al inicializar:", e);
    }
});