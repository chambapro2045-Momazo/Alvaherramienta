# Proyecto: Buscador y Editor Dinámico de Excel
## VERSIÓN: 7.33 (Edición Avanzada, Añadir/Eliminar y Deshacer con Scroll)

***

## 1. DESCRIPCIÓN GENERAL

Esta es una aplicación web de análisis de datos construida con **Flask (Python)** y **JavaScript puro (Tabulator.js)**. Permite a los usuarios cargar cualquier archivo Excel (`.xlsx`) y realizar las siguientes acciones:

* Filtrar datos dinámicamente con lógica avanzada.
* Analizar resúmenes (KPIs) y agrupar datos.
* Editar celdas directamente en la interfaz web.
* Añadir y Eliminar filas.
* Deshacer cambios (Undo) uno por uno.
* Consolidar los cambios realizados.

La aplicación está diseñada con una arquitectura de sesión robusta que mantiene el estado del trabajo del usuario, permitiendo un flujo de edición no destructivo.

***

## 2. FUNCIONALIDADES CLAVE

### A. CARGA Y VISUALIZACIÓN

* **Carga de Archivos:** Acepta archivos `.xlsx` mediante un explorador de archivos o "Arrastrar y Soltar" (Drag and Drop).
* **Validación de Filas:** Al cargar, el backend (`loader.py`) añade automáticamente la columna `_row_status`, marcando las filas como "Completo" o "Incompleto".
* **Asignación de ID:** El backend (`app.py`) añade una columna `_row_id` (basada en el índice) a cada fila para un seguimiento único y robusto en la edición.
* **Tabla Interactiva:** Utiliza la librería **Tabulator.js (v5.6)** para renderizar la tabla, permitiendo ordenar por columnas y congelar la primera columna y los encabezados.
* **Multi-idioma:** La interfaz soporta Inglés y Español, guardando la preferencia del usuario en la sesión.

### B. FILTRADO Y ANÁLISIS

* **Lógica de Filtro Avanzada:** El motor de filtros (`filters.py`) aplica lógica "Y" (AND) entre diferentes columnas y lógica "O" (OR) para múltiples valores en la misma columna.
* **KPIs Dinámicos:** 3 tarjetas de resumen (Total de Facturas, Monto Total, Monto Promedio) se actualizan en tiempo real con cada acción:
    * Al aplicar/limpiar filtros.
    * Al editar una celda de monto.
    * Al Añadir, Eliminar o Deshacer una fila.
* **Vista Agrupada:** Permite al usuario seleccionar una columna (ej. "Status") para ver un resumen agregado (Suma, Promedio, Conteo, Min, Max).

### C. EDICIÓN DE DATOS (ARQUITECTURA DE "BORRADOR")

* **Edición en Celda:** El usuario puede hacer doble clic en cualquier celda de la "Vista Detallada" para editar su contenido.
* **Añadir Fila:** (v7.0) El botón "Añadir Fila" (API `/api/add_row`) crea una nueva fila en blanco al final de la cuadrícula y le asigna un `_row_id` secuencial (max + 1).
* **Eliminar Fila:** (v7.0) Un icono de papelera en cada fila (API `/api/delete_row`) permite eliminar filas del "borrador".
* **Guardado en Borrador:** Cada edición, añadido o borrado se envía automáticamente a una API y se guarda en el "borrador" (`df_staging`) en la sesión del servidor. El cambio persiste incluso si se aplican filtros.
* **Pila de Deshacer (Undo):** El sistema implementa una pila de deshacer (`session['history']`) con un límite de 15 cambios.
    * El botón "Deshacer (X)" aparece después de la primera acción (Editar, Añadir o Eliminar).
    * Llama a la API `/api/undo_change` para revertir la última acción del "borrador".
    * **Restauración de Posición (v7.7):** Al deshacer un 'borrado', la API re-inserta la fila en su posición (índice) original en la cuadrícula, no al final de la lista.
    * **Scroll Inteligente (v7.28):** Al deshacer cualquier acción, la vista de la tabla se desplaza automáticamente a la fila afectada (`affected_row_id`), incluso si está fuera de la vista.
* **Consolidar Cambios:** El botón "Consolidar Cambios" (API `/api/commit_changes`) limpia la pila de deshacer, "aceptando" todos los cambios realizados en el borrador como el nuevo estado base.

### D. PERSONALIZACIÓN

* **Listas de Autocompletado:** La edición de celdas usa `select` o `autocomplete` basado en las opciones.
* **Gestión de Listas:** El usuario puede editar estas listas (añadir/quitar valores) usando la sintaxis de prefijo (`-`).
* **Persistencia de Listas:** Las listas personalizadas se guardan en el servidor en el archivo `user_autocomplete.json`.

### E. EXPORTACIÓN

* **Exportar a Excel:** Permite descargar los datos de la "Vista Detallada" o "Vista Agrupada".
* **Exportación de Borrador:** La descarga de la "Vista Detallada" exporta el estado actual del "borrador" (`df_staging`), incluyendo todas las ediciones, añadidos o eliminaciones que el usuario haya realizado.

***

## 3. ARQUITECTURA Y FLUJO DE DATOS

La aplicación utiliza una arquitectura de sesión en el servidor (Flask-Session) para gestionar los datos del usuario de forma no destructiva.

### A. Backend (Flask):

* `app.py`: Es el servidor principal. Maneja todas las rutas API (carga, filtrado, edición, deshacer, etc.) y la gestión de la sesión.
* `modules/`: Contiene la lógica de negocio desacoplada:
    * `loader.py`: Carga y valida el Excel.
    * `filters.py`: Lógica de filtrado AND/OR.
    * `translator.py`: Diccionarios de idiomas.
    * `json_manager.py`: Lógica para leer/escribir `user_autocomplete.json`.

### B. Frontend (JavaScript):

* `index.html`: La plantilla principal de la aplicación.
* `script.js`: Controla toda la interactividad del cliente.
    * Gestiona el estado local (filtros activos, vista actual, `undoHistoryCount`).
    * Dibuja la tabla usando **Tabulator.js** (configurado con `index: "_row_id"` para un seguimiento de filas robusto, v7.28).
    * Llama a las APIs del backend de Flask (`fetch`).
* `style.css`: Define el diseño moderno tipo dashboard.

### C. GESTIÓN DE ESTADO (EN SESIÓN):

Al cargar un archivo, el backend crea 2 elementos principales en la sesión:

1.  **`session['df_staging']` (El Borrador)**
    * **Propósito:** Es la versión de trabajo activa (una lista de diccionarios).
    * **Modificado:** SÍ. Cada edición, añadido, borrado y deshacer se aplica a esta copia.
    * **Usado por:** Todas las operaciones (`/api/filter`, `/api/group_by`, `/api/download_excel`).

2.  **`session['history']` (La Pila de Deshacer)**
    * **Propósito:** Es una lista de "objetos de acción" que registra cada cambio.
    * **Ejemplos de objetos:**
        ```json
        {"action": "update", "row_id": 22, "columna": "Status", "old_val": "A", "new_val": "B"}
        {"action": "delete", "deleted_row": {...}, "original_index": 19}
        {"action": "add", "row_id": 6115}
        ```
    * **Modificado:** SÍ. Las APIs de edición añaden (push) un cambio. `/api/undo_change` quita (pop) un cambio.
    * **Usado por:** "Deshacer" y "Consolidar".

### D. PERSISTENCIA DE SESIÓN:

* Al recargar la página (`/`), el backend lee el `session['history']` y pasa el conteo (`history_count`) al frontend.
* El `script.js` usa este conteo para mostrar u ocultar los botones "Deshacer" y "Consolidar". Esto asegura que si la página se recarga, el usuario no pierde su capacidad de deshacer los cambios guardados en la sesión.

***

## 4. INSTALACIÓN Y EJECUCIÓN

1.  Asegúrese de tener Python 3.7+ instalado.
2.  Abra una terminal en la carpeta raíz (`Mi_Nuevo_Buscador_Web`).
3.  Cree un entorno virtual (opcional pero recomendado):
    ```bash
    python -m venv venv
    .\venv\Scripts\activate
    ```
    *(Use `source venv/bin/activate` en macOS/Linux)*
4.  Instale las dependencias:
    ```bash
    pip install -r requirements.txt
    ```
5.  Ejecute la aplicación:
    ```bash
    python app.py
    ```
6.  Abra su navegador y vaya a: `http://127.0.0.1:5000`

***

## 5. LIBRERÍAS Y TECNOLOGÍAS

### A. Backend (Python):

* **Flask:** Servidor web y framework de API.
* **Flask-Session:** Para la gestión de sesiones del lado del servidor (basadas en sistema de archivos).
* **Flask-Cors:** Para permitir la comunicación entre el frontend y el backend.
* **pandas:** Para la carga de datos (`read_excel`), manipulación (DataFrame) y filtrado.
* **openpyxl / xlsxwriter:** Motores para que pandas pueda leer y escribir archivos `.xlsx`.

### B. Frontend (Navegador):

* **HTML5 / CSS3:** Estructura y estilos.
* **JavaScript (ES6+):** Lógica del cliente, manejo de eventos DOM y llamadas `fetch`.
* **Tabulator.js (v5.6):** Librería para crear la tabla interactiva y editable.