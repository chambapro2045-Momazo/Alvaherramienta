=================================================
 PROYECTO: Buscador de Facturas Dinámico
 VERSIÓN:  4.0
=================================================

Este documento describe las capacidades, arquitectura y tecnologías utilizadas en la Versión 4.0 de la aplicación.

1. DESCRIPCIÓN GENERAL
----------------------
Es una aplicación web (cliente-servidor) que permite a los usuarios cargar archivos Excel (.xlsx), aplicar un conjunto de filtros dinámicos y ver, analizar y exportar los resultados en una interfaz de usuario moderna estilo "dashboard".

La aplicación está diseñada para ser modular, con una separación clara entre el 'backend' (lógica del servidor en Python/Flask) y el 'frontend' (interfaz de usuario en HTML/CSS/JS).

2. CAPACIDADES (FEATURES)
-------------------------

La Versión 4.0 incluye las siguientes funcionalidades:

  A. Interfaz de Usuario (UI):
    - Diseño moderno tipo "dashboard" con un fondo gris claro y "tarjetas" blancas de contenido.
    - Una barra lateral (sidebar) para cargar archivos y crear filtros.
    - Soporte multi-idioma (Inglés/Español) con botones de selección en la barra lateral.
    - Modo de "Pantalla Completa" que oculta la barra lateral.

  B. Carga de Archivos:
    - Acepta archivos .xlsx.
    - Soporta dos métodos de carga:
        1. Haciendo clic en el botón "Browse files".
        2. Arrastrando y soltando (Drag and Drop) el archivo sobre la zona designada. (Arreglar)
    - Muestra el archivo cargado y su tamaño en la barra lateral.

  C. Filtrado de Datos:
    - El usuario añade filtros desde la barra lateral (Seleccionar Columna + Escribir Valor).
    - Lógica de filtrado avanzada (Backend):
        - Múltiples filtros en DIFERENTES columnas se aplican con lógica "Y" (AND).
        - Múltiples filtros en la MISMA columna se aplican con lógica "O" (OR).
    - Los filtros activos se muestran como "chips" (píldoras) rojas sobre la tabla de resultados.
    - Se pueden eliminar filtros individualmente (haciendo clic en la 'x' del chip) o todos a la vez con el botón "Limpiar todos los filtros".

  D. Visualización de Resultados:
    - La tabla de resultados está contenida en una "ventana" flotante con bordes redondeados.
    - Soporta scroll horizontal (para muchas columnas) y vertical (para muchas filas).
    - Los encabezados (TH) son "sticky" (se quedan fijos) al hacer scroll vertical.
    - La columna de número de fila ("#") es "sticky" (se queda fija) al hacer scroll horizontal.
    - Permite ordenar (asc/desc) haciendo clic en cualquier encabezado de columna.
    - Incluye una barra de búsqueda rápida (lupa) que filtra los resultados *ya visibles* en la tabla (filtrado local).

  E. Exportación:
    - Un botón de icono permite "Descargar resultados como Excel".
    - El archivo Excel generado contiene únicamente las filas que coinciden con los filtros activos en ese momento.
    - (NOTA: La descarga también respeta las columnas visibles, que en esta versión son todas las columnas).

3. CÓMO FUNCIONA (ARQUITECTURA)
-------------------------------

  A. Backend (Servidor):
    - Se ejecuta un servidor Flask (`app.py`).
    - Cuando se sube un archivo, se guarda en una carpeta temporal (`temp_uploads`) con un ID único (UUID).
    - El servidor expone varias APIs RESTful (ej. `/api/upload`, `/api/filter`, `/api/download_excel`) que el frontend consume.
    - El servidor es "sin estado" (stateless): en cada solicitud de filtro o descarga, vuelve a cargar el archivo Excel original desde la carpeta temporal usando `pandas` (`loader.py`) y le aplica los filtros (`filters.py`).
    - El servidor también maneja las sesiones para recordar el idioma seleccionado por el usuario.

  B. Frontend (Cliente/Navegador):
    - Carga una única página (`index.html`).
    - Todo el dinamismo es controlado por `script.js` (JavaScript puro, sin frameworks externos).
    - Utiliza la API `fetch` para comunicarse con el backend de forma asíncrona (sin recargar la página).
    - El estado (filtros activos, datos actuales, estado de ordenamiento) se mantiene en variables globales de JavaScript.
    - La tabla de resultados se genera y dibuja dinámicamente en el DOM (función `renderTable()`).

4. LIBRERÍAS Y TECNOLOGÍAS
---------------------------

  A. Backend (Python):
    - Flask:          Para el servidor web y manejo de APIs.
    - pandas:         Para la carga de datos (`read_excel`), manipulación (DataFrame) y filtrado.
    - xlsxwriter:     Motor usado por pandas para escribir el archivo Excel de descarga.
    - collections:    Uso de `defaultdict` para agrupar filtros por columna.
    - Librerías estándar: `os`, `uuid`, `io`.

  B. Frontend (Navegador):
    - HTML5:          Estructura semántica de la página.
    - CSS3:           Estilos, layout (Flexbox), posicionamiento (Sticky) y diseño responsivo (implícito).
    - JavaScript (ES6+):Interactividad, manejo de eventos (DOM), llamadas a API (`fetch`) y renderizado dinámico.