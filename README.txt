=================================================
PROYECTO: Buscador y Editor Dinámico de Excel
VERSIÓN:  6.8 (Con Edición en Celda y Pila de Deshacer)
=================================================

1. DESCRIPCIÓN GENERAL
----------------------
Esta es una aplicación web de análisis de datos construida con Flask (Python) y JavaScript puro. Permite a los usuarios cargar cualquier archivo Excel (.xlsx) y realizar las siguientes acciones:

* Filtrar datos dinámicamente con lógica avanzada.
* Analizar resúmenes (KPIs) y agrupar datos.
* ¡NUEVO! Editar celdas directamente en la interfaz web.
* ¡NUEVO! Deshacer cambios (Undo) uno por uno.
* ¡NUEVO! Consolidar cambios o revertir todo al estado original.

La aplicación está diseñada con una arquitectura de sesión robusta que mantiene el estado del trabajo del usuario, permitiendo un flujo de edición no destructivo.


2. FUNCIONALIDADES CLAVE
-------------------------

A. CARGA Y VISUALIZACIÓN
    - Carga de Archivos: Acepta archivos .xlsx mediante un explorador de archivos o "Arrastrar y Soltar" (Drag and Drop).
    - Validación de Filas: Al cargar, el backend (loader.py) añade automáticamente la columna `_row_status`, marcando las filas como "Completo" o "Incompleto".
    - Tabla Interactiva: Utiliza la librería Tabulator.js para renderizar la tabla, permitiendo ordenar por columnas y congelar la primera columna y los encabezados.
    - Multi-idioma: La interfaz soporta Inglés y Español, guardando la preferencia del usuario en la sesión.

B. FILTRADO Y ANÁLISIS
    - Lógica de Filtro Avanzada: El motor de filtros (filters.py) aplica lógica "Y" (AND) entre diferentes columnas y lógica "O" (OR) para múltiples valores en la misma columna.
    - KPIs Dinámicos: 3 tarjetas de resumen (Total de Facturas, Monto Total, Monto Promedio) se actualizan en tiempo real con cada acción:
        - Al aplicar/limpiar filtros.
        - Al editar una celda de monto.
        - Al Deshacer (Undo) un cambio.
        - Al Revertir al Original.
    - Vista Agrupada: Permite al usuario seleccionar una columna (ej. "Status") para ver un resumen agregado (Suma, Promedio, Conteo, Min, Max).

C. EDICIÓN DE DATOS (ARQUITECTURA DE "BORRADOR")
    - Edición en Celda: El usuario puede hacer doble clic en cualquier celda de la "Vista Detallada" para editar su contenido.
    - Guardado en Borrador: Cada edición se envía automáticamente a la API `/api/update_cell` y se guarda en el "borrador" (`df_staging`) en la sesión del servidor. El cambio persiste incluso si se aplican filtros.
    - Pila de Deshacer (Undo): El sistema implementa una pila de deshacer (`session['history']`) con un límite de 15 cambios.
        - El botón "Deshacer (X)" aparece después de la primera edición.
        - Llama a la API `/api/undo_change` para revertir el último cambio del "borrador" y restaurar el valor anterior.
    - Consolidar Cambios: El botón "Consolidar Cambios" (API `/api/commit_changes`) limpia la pila de deshacer, "aceptando" todos los cambios realizados en el borrador como el nuevo estado base.
    - Revertir a Original (Opción Nuclear): Un botón en la barra lateral (API `/api/revert_changes`) permite al usuario descartar TODOS los cambios (incluidos los consolidados) y recargar el archivo original (`df_pristine`).

D. PERSONALIZACIÓN
    - Listas de Autocompletado: La edición de celdas usa `select` o `autocomplete` basado en las opciones.
    - Gestión de Listas: El usuario puede editar estas listas (añadir/quitar valores) usando la sintaxis de prefijo (`-`).
    - Persistencia de Listas: Las listas personalizadas se guardan en el servidor en el archivo `user_autocomplete.json`.

E. EXPORTACIÓN
    - Exportar a Excel: Permite descargar los datos de la "Vista Detallada" o "Vista Agrupada".
    - Exportación de Borrador: La descarga de la "Vista Detallada" exporta el estado actual del "borrador" (`df_staging`), incluyendo todas las ediciones que el usuario haya realizado.


3. ARQUITECTURA Y FLUJO DE DATOS
-------------------------------
La aplicación utiliza una arquitectura de sesión en el servidor (Flask-Session) para gestionar los datos del usuario de forma no destructiva.

  A. Backend (Flask):
    - `app.py`: Es el servidor principal. Maneja todas las rutas API (carga, filtrado, edición, deshacer, etc.) y la gestión de la sesión.
    - `modules/`: Contiene la lógica de negocio desacoplada:
        - `loader.py`: Carga y valida el Excel.
        - `filters.py`: Lógica de filtrado AND/OR.
        - `translator.py`: Diccionarios de idiomas.
        - `json_manager.py`: Lógica para leer/escribir `user_autocomplete.json`.

  B. Frontend (JavaScript):
    - `index.html`: La plantilla principal de la aplicación.
    - `script.js`: Controla toda la interactividad del cliente.
        - Gestiona el estado local (filtros activos, vista actual, `undoHistoryCount`).
        - Dibuja la tabla usando Tabulator.js.
        - Llama a las APIs del backend de Flask (fetch).
    - `style.css`: Define el diseño moderno tipo dashboard.

  C. GESTIÓN DE ESTADO (EN SESIÓN):
    Al cargar un archivo, el backend crea 3 copias de los datos en la sesión:
    
    1. session['df_pristine'] (El Original-Original)
       - Propósito: Es la copia 100% virgen del Excel original.
       - Modificado: NUNCA, solo se lee.
       - Usado por: La API "Revertir a Original" (`/api/revert_changes`).
       
    2. session['df_staging'] (El Borrador)
       - Propósito: Es la versión de trabajo activa.
       - Modificado: SÍ. Cada edición (`/api/update_cell`) y deshacer (`/api/undo_change`) se aplica a esta copia.
       - Usado por: Todas las operaciones (`/api/filter`, `/api/group_by`, `/api/download_excel`).
       
    3. session['history'] (La Pila de Deshacer)
       - Propósito: Es una lista de "objetos de cambio" (con old_val, new_val) que registra cada edición.
       - Modificado: SÍ. `/api/update_cell` añade (push) un cambio. `/api/undo_change` quita (pop) un cambio.
       - Usado por: "Deshacer", "Consolidar" y "Revertir a Original" (que la limpia).

  D. PERSISTENCIA DE SESIÓN (Tu Punto 3):
    - Al recargar la página (`/`), el backend lee el `session['history']` y pasa el conteo (`history_count`) al frontend.
    - El `script.js` usa este conteo para mostrar u ocultar los botones "Deshacer" y "Consolidar". Esto asegura que si la página se recarga, el usuario no pierde su capacidad de deshacer los cambios guardados en la sesión.


4. INSTALACIÓN Y EJECUCIÓN
---------------------------

1.  Asegúrese de tener Python 3.7+ instalado.
2.  Abra una terminal en la carpeta raíz (`Mi_Nuevo_Buscador_Web`).
3.  Cree un entorno virtual (opcional pero recomendado):
    `python -m venv venv`
    `.\venv\Scripts\activate` (en Windows)
4.  Instale las dependencias:
    `pip install -r requirements.txt`
5.  Ejecute la aplicación:
    `python app.py`
6.  Abra su navegador y vaya a:
    `http://127.0.0.1:5000`


5. LIBRERÍAS Y TECNOLOGÍAS
---------------------------

  A. Backend (Python):
    - Flask: Servidor web y framework de API.
    - Flask-Session: Para la gestión de sesiones del lado del servidor (basadas en sistema de archivos).
    - Flask-Cors: Para permitir la comunicación entre el frontend y el backend.
    - pandas: Para la carga de datos (`read_excel`), manipulación (DataFrame) y filtrado.
    - openpyxl / xlsxwriter: Motores para que pandas pueda leer y escribir archivos .xlsx.

  B. Frontend (Navegador):
    - HTML5 / CSS3: Estructura y estilos.
    - JavaScript (ES6+): Lógica del cliente, manejo de eventos DOM y llamadas `fetch`.
    - Tabulator.js (v5.6): Librería para crear la tabla interactiva y editable.