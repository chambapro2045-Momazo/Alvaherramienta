"""
app.py (Versión 17.3 - Añadida Eliminación Masiva (Bulk Delete))
------------------------------------------------
Controlador principal de la aplicación Flask.
Integra la lógica de recálculo inmediato de prioridades para sincronización con el frontend v16.6.
(Modificado 2025-11-14 para v16.7)
(Modificado 2025-11-14 para v16.8 - Añadido Log de Auditoría)
(Modificado 2025-11-14 para v16.9 - Cambiado reporte a TXT legible)
(Modificado 2025-11-14 para v17.0 - Añadida API de Control de Duplicados Genérico)
(Modificado 2025-11-17 para v17.1 - Añadido Flujo Específico de Duplicados de Facturas)
(Modificado 2025-11-17 para v17.2 - Añadido 'Sort by Invoice' y 'Undo' a la limpieza)
(Modificado 2025-11-17 para v17.3 - Añadida Eliminación Masiva (Bulk Delete) con 'Undo')

Autor: Gemini
Fecha: 2025-11-05
(Modificado 2025-11-17 para v17.3)
"""

# --- Importaciones de Librerías Estándar ---
import os  # Provee funcionalidad dependiente del sistema operativo (rutas, directorios).
import io  # Permite manejar flujos de entrada/salida en memoria (BytesIO).
import uuid  # Generación de identificadores únicos universales (para IDs de archivo).
import json  # Codificación y decodificación de JSON.
from datetime import datetime  # (v16.8) Necesario para estampar la hora en el log.

# --- Importaciones de Librerías de Terceros ---
import pandas as pd  # Manipulación y análisis de datos estructurados (DataFrames).
from flask import Flask, request, jsonify, render_template, send_file, session  # Framework web y utilidades HTTP.
from flask_cors import CORS  # Manejo de Cross-Origin Resource Sharing.
from flask_session import Session  # Manejo de sesiones de usuario en el lado del servidor.

# --- Módulos del Proyecto (Nuestra Lógica de Negocio) ---
from modules.loader import cargar_datos, _assign_priority  # Carga inicial y lógica base de prioridad.
# Importamos todas las funciones necesarias del gestor de prioridades.
from modules.priority_manager import (
    save_rule, load_rules, delete_rule, apply_priority_rules,
    load_settings, save_settings, toggle_rule
)
from modules.filters import aplicar_filtros_dinamicos  # Motor de filtrado avanzado.
from modules.translator import get_text, LANGUAGES  # Sistema de internacionalización.
from modules.json_manager import guardar_json, USER_LISTS_FILE  # Gestión segura de archivos JSON.
from modules.autocomplete import get_autocomplete_options  # Generador de opciones para inputs.

# --- Constantes Globales de Configuración ---
UNDO_STACK_LIMIT = 15  # Número máximo de acciones que se pueden deshacer.
UPLOAD_FOLDER = 'temp_uploads'  # Carpeta temporal para almacenar archivos subidos.

# ==============================================================================
# FUNCIONES AUXILIARES (HELPERS)
# Lógica interna reutilizable por los endpoints.
# ==============================================================================

def _find_monto_column(df: pd.DataFrame) -> str | None:
    """
    (Documentación de Google: Inicio)
    Busca heurísticamente una columna que parezca contener montos monetarios.
    
    Itera sobre los nombres de columna y los compara (en minúsculas)
    contra una lista predefinida de candidatos.
    
    Args:
        df (pd.DataFrame): El DataFrame a inspeccionar.

    Returns:
        str | None: El nombre de la columna detectada (ej. "Monto") o None.
    (Documentación de Google: Fin)
    """
    # Lista de posibles nombres de columna (en minúsculas) para identificar dinero.
    possible_names = ['monto', 'total', 'amount', 'total amount']
    # Iteramos sobre todas las columnas del DataFrame.
    for col in df.columns:
        # Comparamos el nombre de la columna en minúsculas con nuestra lista.
        if str(col).lower() in possible_names:
            return col  # Retornamos la primera coincidencia encontrada.
    return None  # No se encontró ninguna columna candidata.


def _find_invoice_column(df: pd.DataFrame) -> str | None:
    """
    (Documentación de Google: Inicio - v17.1)
    Busca heurísticamente la columna que parece contener el N° de Factura.
    
    Compara (en minúsculas) los nombres de columna contra una lista
    predefinida de candidatos (ej. 'invoice #', 'factura').
    
    Args:
        df (pd.DataFrame): El DataFrame a inspeccionar.

    Returns:
        str | None: El nombre de la columna detectada (ej. "Invoice #") o None.
    (Documentación de Google: Fin)
    """
    # (Documentación de Google: Lista de posibles nombres para el N° de Factura.)
    possible_names = ['invoice #', 'invoice number', 'n° factura', 'factura', 'invoice id']
    # (Documentación de Google: Iterar sobre las columnas del DataFrame.)
    for col in df.columns:
        # (Documentación de Google: Comparar en minúsculas y sin espacios.)
        if str(col).lower().strip() in possible_names:
            # (Documentación de Google: Retornar la primera coincidencia.)
            return col
    # (Documentación de Google: Retornar None si no se encuentra.)
    return None


def _check_file_id(request_file_id: str) -> None:
    """
    (Documentación de Google: Inicio)
    Verifica la integridad de la sesión comparando el ID del archivo.
    
    Evita que acciones en pestañas antiguas (con un file_id diferente)
    afecten o corrompan la sesión actual del usuario.

    Args:
        request_file_id (str): El ID enviado por el cliente en la petición.

    Raises:
        Exception: Si la sesión es inválida o los IDs no coinciden.
    (Documentación de Google: Fin)
    """
    # Obtenemos el ID del archivo almacenado en la sesión del servidor.
    session_file_id = session.get('file_id')
    
    # Si no hay sesión activa, limpiamos y lanzamos error.
    if not session_file_id:
        session.clear()
        raise Exception("No hay file_id en la sesión. Por favor, cargue un archivo.")
    
    # Si los IDs no coinciden, forzamos una recarga para evitar corrupción de datos.
    if session_file_id != request_file_id:
        session.clear()
        raise Exception("El file_id no coincide con la sesión. Recargue el archivo.")


def _calculate_kpis(df: pd.DataFrame) -> dict:
    """
    (Documentación de Google: Inicio)
    Calcula los Indicadores Clave de Rendimiento (KPIs) para un conjunto de datos.
    
    Usado para actualizar el dashboard del frontend. Busca la columna de
    monto, la limpia (quita '$', ',') y calcula la suma y el promedio.

    Args:
        df (pd.DataFrame): Datos sobre los cuales calcular (filtrados o totales).

    Returns:
        dict: Diccionario con 'total_facturas', 'monto_total' y 'monto_promedio'.
    (Documentación de Google: Fin)
    """
    # Inicializamos los contadores en cero.
    monto_total = 0.0
    monto_promedio = 0.0
    total_facturas = len(df)  # El conteo simple de filas.

    # Buscamos la columna de dinero para sumar valores.
    monto_col_name = _find_monto_column(df)

    # Solo calculamos montos si existe la columna y el DF no está vacío.
    if monto_col_name and not df.empty:
        try:
            # Limpiamos el string de moneda: quitamos '$' y ',' para poder convertir a número.
            monto_col_str_limpia = df[monto_col_name].astype(str).str.replace(r'[$,]', '', regex=True)
            # Convertimos a numérico, convirtiendo errores (texto) a NaN y luego a 0.
            monto_numerico = pd.to_numeric(monto_col_str_limpia, errors='coerce').fillna(0)
            # Sumamos el total.
            monto_total = monto_numerico.sum()
            # Calculamos el promedio.
            monto_promedio = monto_numerico.mean()
        except Exception as e:
            # Logueamos el error pero no detenemos la ejecución; devolvemos 0.
            print(f"Advertencia al calcular KPIs: {e}")

    # Retornamos el diccionario formateado para el frontend.
    return {
        "total_facturas": total_facturas,
        "monto_total": f"${monto_total:,.2f}",  # Formato moneda (ej. $1,234.56)
        "monto_promedio": f"${monto_promedio:,.2f}"
    }


def _get_df_from_session(key: str = 'df_staging') -> list[dict]:
    """
    (Documentación de Google: Inicio)
    Recupera los datos crudos (lista de diccionarios) desde la sesión.

    Args:
        key (str): La clave de sesión donde se guardan los datos.

    Returns:
        list[dict]: La lista de filas.

    Raises:
        Exception: Si la sesión ha expirado o está vacía.
    (Documentación de Google: Fin)
    """
    # Intentamos obtener los datos.
    data_list_of_dicts = session.get(key)
    # Validación estricta de existencia.
    if not data_list_of_dicts:
        session.clear()
        raise Exception(f"Sesión expirada o vacía para '{key}'. Recargue el archivo.")
    return data_list_of_dicts


def _get_df_from_session_as_df(key: str = 'df_staging') -> pd.DataFrame:
    """
    (Documentación de Google: Inicio)
    Wrapper que convierte los datos de la sesión directamente a un DataFrame.
    
    Llama a `_get_df_from_session` y pasa el resultado (lista de dicts)
    al constructor de pd.DataFrame.from_records.

    Args:
        key (str): La clave de sesión (usualmente 'df_staging').

    Returns:
        pd.DataFrame: Un DataFrame de Pandas con los datos de la sesión.
    (Documentación de Google: Fin)
    """
    data_list_of_dicts = _get_df_from_session(key)
    return pd.DataFrame.from_records(data_list_of_dicts)


def _check_row_completeness(fila: dict) -> str:
    """
    (Documentación de Google: Inicio)
    Evalúa si una fila (dict) tiene celdas vacías críticas.

    Se usa para asignar la columna interna '_row_status'.
    Ignora columnas internas (que empiezan con '_').

    Args:
        fila (dict): La fila (registro) a evaluar.

    Returns:
        str: 'Completo' o 'Incompleto'.
    (Documentación de Google: Fin)
    """
    # Iteramos sobre cada celda de la fila.
    for key, value in fila.items():
        # Ignoramos columnas internas del sistema (empiezan con _).
        if key.startswith('_'):
            continue
        # Convertimos a string y quitamos espacios.
        val_str = str(value).strip()
        # Si está vacío o es "0" (según lógica de negocio), es incompleto.
        if val_str == "" or val_str == "0":
            return "Incompleto"
    return "Completo"


def _recalculate_priorities(df: pd.DataFrame) -> pd.DataFrame:
    """
    (Documentación de Google: Inicio)
    Función CORE para la reactividad: Recalcula TODAS las prioridades del DataFrame.
    
    Se llama cada vez que el usuario guarda una regla, cambia una configuración
    o (v16.7) edita una celda.
    
    Proceso:
    1. Carga la configuración global (ej. ¿SCF habilitado?).
    2. Aplica la lógica de prioridad Base (hardcoded, ej. SCF='Alta').
    3. Aplica la lógica de reglas dinámicas (del JSON) encima de la base.

    Args:
        df (pd.DataFrame): El DataFrame con los datos actuales.

    Returns:
        pd.DataFrame: El DataFrame con las columnas '_priority' y
                      '_priority_reason' actualizadas.
    (Documentación de Google: Fin)
    """
    # 1. Cargamos la configuración global actual (ej. ¿SCF habilitado?).
    settings = load_settings()
    # Recuperamos el nombre de la columna 'Pay Group' detectada al inicio.
    pay_col = session.get('pay_group_col_name')
    
    # 2. Aplicar Lógica Base (Hardcoded)
    # Si existe la columna de Pay Group y la configuración global lo permite:
    if pay_col and pay_col in df.columns and settings.get('enable_scf_intercompany', True):
        # Aplicamos la función _assign_priority (importada de loader) a toda la columna.
        df['_priority'] = df[pay_col].apply(_assign_priority)
        
        # Asignamos las razones por defecto basadas en el resultado.
        df['_priority_reason'] = "Prioridad base (Estándar)" # Razón default.
        df.loc[df['_priority'] == 'Alta', '_priority_reason'] = "Prioridad base (SCF/Intercompany)"
        df.loc[df['_priority'] == 'Baja', '_priority_reason'] = "Prioridad base (Pay Group)"
    else:
        # Si la lógica base está deshabilitada o no hay columna, todo es 'Media'.
        df['_priority'] = 'Media'
        df['_priority_reason'] = "Prioridad base (Desactivada)"
    
    # 3. Aplicar Reglas Personalizadas (Dinámicas)
    # Llamamos al gestor de prioridades para sobrescribir con las reglas del usuario.
    # Esto respeta el orden: Base -> Sobrescrito por Reglas.
    df = apply_priority_rules(df)
    
    return df


# ==============================================================================
# CONFIGURACIÓN DE FLASK Y SESIÓN
# ==============================================================================

app = Flask(__name__, template_folder='templates', static_folder='static')  # Instancia Flask.
CORS(app)  # Habilitamos CORS para permitir peticiones externas si fuera necesario.

app.config['SECRET_KEY'] = 'mi-llave-secreta-para-el-buscador-12345'  # Llave para firmar cookies.
app.config["SESSION_PERMANENT"] = False  # La sesión expira al cerrar el navegador.
app.config["SESSION_TYPE"] = "filesystem"  # Guardamos sesiones en archivos en el servidor.
app.config["SESSION_FILE_DIR"] = os.path.join(UPLOAD_FOLDER, 'flask_session')  # Ruta de sesiones.

# Aseguramos que existan los directorios necesarios.
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(app.config["SESSION_FILE_DIR"], exist_ok=True)

Session(app)  # Inicializamos la extensión de sesiones.


@app.context_processor
def inject_translator():
    """
    (Documentación de Google: Inicio)
    Inyecta la función 'get_text' y el idioma actual en todas las plantillas Jinja2.
    
    Permite usar `{{ get_text(...) }}` y `{{ lang }}` directamente en el HTML
    para la internacionalización.
    (Documentación de Google: Fin)
    """
    lang = session.get('language', 'es')  # Idioma por defecto español.
    return dict(get_text=get_text, lang=lang)


# ==============================================================================
# RUTAS PRINCIPALES (Vistas)
# ==============================================================================

@app.route('/')
def home():
    """
    (Documentación de Google: Inicio)
    Renderiza la página principal (SPA - Single Page Application).
    
    Prepara los datos iniciales de la sesión (si existen) para inyectarlos
    en el objeto `SESSION_DATA` de JavaScript, evitando 'parpadeos'
    en la carga del frontend.
    (Documentación de Google: Fin)
    """
    # Objeto de datos iniciales para el frontend.
    session_data = {
        "file_id": session.get('file_id'),
        "columnas": [],
        "autocomplete_options": {},
        "history_count": len(session.get('history', []))
    }

    # Si hay datos cargados, preparamos metdatos.
    df_staging_data = session.get('df_staging')
    if df_staging_data and isinstance(df_staging_data, list) and len(df_staging_data) > 0:
        session_data["columnas"] = list(df_staging_data[0].keys())
        # Generamos opciones de autocompletado para agilizar la UI.
        df_para_escanear = pd.DataFrame.from_records(df_staging_data)
        session_data["autocomplete_options"] = get_autocomplete_options(df_para_escanear)

    return render_template('index.html', session_data=session_data)


@app.route('/api/set_language/<string:lang_code>')
def set_language(lang_code):
    """
    (Documentación de Google: Inicio)
    Endpoint para cambiar el idioma de la sesión.
    Valida que el código de idioma exista en el módulo 'translator'.
    (Documentación de Google: Fin)
    """
    if lang_code in LANGUAGES:
        session['language'] = lang_code
    return jsonify({"status": "success", "language": lang_code})


@app.route('/api/get_translations')
def get_translations():
    """
    (Documentación de Google: Inicio)
    Devuelve todo el diccionario de traducciones al frontend (JSON).
    Permite al frontend (JavaScript) acceder a las mismas traducciones
    que el backend (Jinja2).
    (Documentación de Google: Fin)
    """
    lang = session.get('language', 'es')
    return jsonify(LANGUAGES.get(lang, LANGUAGES['es']))


# ==============================================================================
# API: GESTIÓN DE ARCHIVOS Y LISTAS
# ==============================================================================

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """
    (Documentación de Google: Inicio)
    Procesa la carga (upload) inicial de un archivo Excel.
    
    Pasos:
    1. Guarda el archivo temporalmente.
    2. Limpia la sesión anterior.
    3. Llama a `cargar_datos` (de loader.py) que lee el Excel y aplica
       la lógica inicial de prioridades (Base + Dinámicas).
    4. Asigna IDs únicos (`_row_id`) a cada fila.
    5. Guarda el DataFrame (como lista de dicts) en la sesión.
    6. Elimina el archivo temporal.
    7. Devuelve metadatos (columnas, autocompletado) al frontend.
    (Documentación de Google: Fin)
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    # Generamos un ID único para este archivo y sesión.
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    file.save(file_path)

    try:
        session.clear()  # Limpiamos cualquier sesión anterior.
        
        # 'cargar_datos' (en loader.py) ya aplica la lógica inicial de prioridades.
        df, pay_group_col_name = cargar_datos(file_path)

        if df.empty:
            raise Exception("El archivo está vacío o corrupto.")

        # Asignamos IDs de fila internos (_row_id) para control.
        df = df.reset_index().rename(columns={'index': '_row_id'})
        
        # Guardamos en sesión como lista de diccionarios (serializable).
        session.clear()
        data_dict_list = df.to_dict('records')

        session['df_staging'] = data_dict_list
        session['history'] = []  # Pila de deshacer vacía.
        session['file_id'] = file_id
        session['pay_group_col_name'] = pay_group_col_name
        
        # (v16.8) Inicializamos el log de auditoría.
        session['audit_log'] = []

        # Eliminamos el archivo físico temporal (ya está en memoria RAM/Sesión).
        if os.path.exists(file_path):
            os.remove(file_path)

        todas_las_columnas = [col for col in df.columns]
        autocomplete_options = get_autocomplete_options(df)

        return jsonify({
            "file_id": file_id,
            "columnas": todas_las_columnas,
            "autocomplete_options": autocomplete_options
        })

    except Exception as e:
        print(f"Error en /api/upload: {e}")
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({"error": str(e)}), 500


@app.route('/api/save_autocomplete_lists', methods=['POST'])
def save_autocomplete_lists():
    """
    (Documentación de Google: Inicio)
    Guarda las listas de autocompletado editadas por el usuario.
    
    Recibe un JSON del modal 'Administrar Autocompletado' y lo
    guarda en `USER_LISTS_FILE` usando `json_manager`.
    (Documentación de Google: Fin)
    """
    try:
        nuevas_listas = request.json
        if not isinstance(nuevas_listas, dict):
            return jsonify({"error": "El formato debe ser un JSON object"}), 400
        
        success = guardar_json(USER_LISTS_FILE, nuevas_listas)
        
        if success:
            return jsonify({"status": "success", "message": "Listas guardadas."})
        else:
            return jsonify({"error": "Error interno al guardar el archivo."}), 500
    except Exception as e:
        print(f"Error en /api/save_autocomplete_lists: {e}")
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: REGLAS DE PRIORIDAD Y SETTINGS (REACTIVO v16.6)
# ==============================================================================

@app.route('/api/priority_rules/get', methods=['GET'])
def get_priority_rules():
    """
    (Documentación de Google: Inicio)
    Devuelve la lista actual de reglas Y la configuración global.
    Usado para poblar el modal de 'Configurar Reglas'.
    (Documentación de Google: Fin)
    """
    return jsonify({
        "rules": load_rules(),
        "settings": load_settings()
    })

@app.route('/api/priority_rules/save_settings', methods=['POST'])
def api_save_settings():
    """
    (Documentación de Google: Inicio)
    Guarda configuraciones globales (ej. desactivar SCF) y RECALCULA prioridades.
    
    Si hay datos en la sesión, llama a `_recalculate_priorities`
    para aplicar el nuevo setting (ej. deshabilitar lógica SCF)
    inmediatamente.
    (Documentación de Google: Fin)
    """
    try:
        new_settings = request.json
        save_settings(new_settings)
        
        # -- Lógica Reactiva: Refrescar sesión actual --
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            # Recalculamos todo con los nuevos settings.
            df = _recalculate_priorities(df) 
            # Guardamos el resultado actualizado en la sesión.
            session['df_staging'] = df.to_dict('records')
            # Calculamos nuevos KPIs.
            resumen = _calculate_kpis(df)
            return jsonify({"status": "success", "message": "Configuración guardada.", "resumen": resumen})
            
        return jsonify({"status": "success", "message": "Configuración guardada."})
    except Exception as e:
        print(f"Error saving settings: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/priority_rules/save', methods=['POST'])
def api_save_rule():
    """
    (Documentación de Google: Inicio)
    Guarda una nueva regla y RECALCULA prioridades inmediatamente.
    
    Llama a `_recalculate_priorities` para que la nueva regla
    se refleje en la sesión actual.
    (Documentación de Google: Fin)
    """
    try:
        new_rule = request.json
        save_rule(new_rule)
        
        # -- Lógica Reactiva --
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            # Aplicamos la nueva regla al dataset en memoria.
            df = _recalculate_priorities(df) 
            session['df_staging'] = df.to_dict('records')
            resumen = _calculate_kpis(df)
            
            # (v16.8) Registramos el cambio de regla en el log de auditoría
            try:
                audit_log = session.get('audit_log', [])
                log_entry = {
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'action': 'Regla Guardada',
                    'row_id': 'N/A',
                    'columna': new_rule.get('column', 'N/A'),
                    'valor_anterior': 'N/A',
                    'valor_nuevo': f"Prioridad {new_rule.get('priority', 'N/A')} si valor es {new_rule.get('value', 'N/A')}"
                }
                audit_log.append(log_entry)
                session['audit_log'] = audit_log
            except Exception as log_e:
                print(f"Error al escribir en audit_log (save_rule): {log_e}")
            
            return jsonify({"status": "success", "message": "Regla guardada y aplicada.", "resumen": resumen})
            
        return jsonify({"status": "success", "message": "Regla guardada."})
        
    except Exception as e:
        print(f"Error saving rule: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/priority_rules/toggle', methods=['POST'])
def api_toggle_rule():
    """
    (Documentación de Google: Inicio)
    Activa o Desactiva una regla y RECALCULA prioridades.
    
    Llama a `_recalculate_priorities`. El estado 'active' (True/False)
    de la regla será leído por `apply_priority_rules`.
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        # toggle_rule modifica el archivo JSON (flag 'active').
        success = toggle_rule(data.get('column'), data.get('value'), data.get('active'))
        
        if not success:
            return jsonify({"error": "Regla no encontrada"}), 404
            
        # -- Lógica Reactiva --
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            # El recálculo leerá el nuevo estado 'active' de las reglas.
            df = _recalculate_priorities(df) 
            session['df_staging'] = df.to_dict('records')
            resumen = _calculate_kpis(df)
            
            # (v16.8) Registramos el cambio de estado en el log de auditoría
            try:
                audit_log = session.get('audit_log', [])
                estado = "Activada" if data.get('active') else "Desactivada"
                log_entry = {
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'action': f"Regla {estado}",
                    'row_id': 'N/A',
                    'columna': data.get('column', 'N/A'),
                    'valor_anterior': not data.get('active'),
                    'valor_nuevo': data.get('active')
                }
                audit_log.append(log_entry)
                session['audit_log'] = audit_log
            except Exception as log_e:
                print(f"Error al escribir en audit_log (toggle_rule): {log_e}")
            
            return jsonify({"status": "success", "message": "Regla actualizada.", "resumen": resumen})

        return jsonify({"status": "success", "message": "Regla actualizada."})

    except Exception as e:
        print(f"Error toggling rule: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/priority_rules/delete', methods=['POST'])
def api_delete_rule():
    """
    (Documentación de Google: Inicio)
    Elimina una regla permanentemente y RECALCULA prioridades.
    
    Llama a `_recalculate_priorities`. La regla eliminada ya no
    se aplicará.
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        col = data.get('column')
        val = data.get('value')
        
        delete_rule(col, val)
        
        # -- Lógica Reactiva --
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            # Al recalcular, la regla eliminada ya no se aplicará.
            df = _recalculate_priorities(df) 
            session['df_staging'] = df.to_dict('records')
            resumen = _calculate_kpis(df)
            
            # (v16.8) Registramos la eliminación en el log de auditoría
            try:
                audit_log = session.get('audit_log', [])
                log_entry = {
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'action': "Regla Eliminada",
                    'row_id': 'N/A',
                    'columna': col,
                    'valor_anterior': val,
                    'valor_nuevo': 'N/A'
                }
                audit_log.append(log_entry)
                session['audit_log'] = audit_log
            except Exception as log_e:
                print(f"Error al escribir en audit_log (delete_rule): {log_e}")

            return jsonify({"status": "success", "message": "Regla eliminada.", "resumen": resumen})

        return jsonify({"status": "success", "message": "Regla eliminada."})

    except Exception as e:
        print(f"Error deleting rule: {e}")
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: EDICIÓN Y MANIPULACIÓN DE DATOS (v16.7 - Corregido)
# (MODIFICADO v17.3 - Añadido Bulk Delete)
# ==============================================================================

@app.route('/api/update_cell', methods=['POST'])
def update_cell():
    """
    (Documentación de Google: Inicio - v16.7)
    Actualiza una celda individual en el DataFrame de la sesión.
    ...
    (v16.8: Registra en 'audit_log')
    ...
    (Documentación de Google: Fin)
    """
    try:
        # --- 1. Obtener y Validar Datos ---
        data = request.json
        file_id = data.get('file_id')
        row_id = data.get('row_id')         # (Nota: puede venir como string o int)
        columna = data.get('columna')
        nuevo_valor = data.get('valor')

        _check_file_id(file_id)
        if row_id is None or columna is None:
            return jsonify({"error": "Faltan row_id o columna"}), 400

        row_id_str = str(row_id)
        
        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        
        # (v16.8) Obtenemos el log de auditoría
        audit_log = session.get('audit_log', []) 

        # --- 2. Buscar y Modificar la Fila (en la lista de dicts) ---
        fila_modificada = False
        new_status_for_frontend = None
        target_fila_dict = None

        for fila in datos_staging_lista:
            if str(fila.get('_row_id')) == row_id_str:
                old_val = fila.get(columna)

                # --- 2a. Manejar 'No Cambio' ---
                if old_val == nuevo_valor:
                    df_no_change = pd.DataFrame.from_records(datos_staging_lista)
                    return jsonify({
                        "status": "no_change", "message": "El valor es el mismo.",
                        "history_count": len(history_stack),
                        "resumen": _calculate_kpis(df_no_change),
                        "new_priority": fila.get('_priority'),
                        "new_row_status": fila.get('_row_status')
                    })

                # --- 2b. Registrar para UNDO ---
                change_obj = {
                    'action': 'update', 'row_id': row_id_str, 'columna': columna,
                    'old_val': old_val, 'new_val': nuevo_valor
                }
                history_stack.append(change_obj)
                if len(history_stack) > UNDO_STACK_LIMIT:
                    history_stack.pop(0)
                
                # (v16.8) Registrar para AUDITORÍA
                log_entry = {
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'action': 'Celda Actualizada',
                    'row_id': row_id_str,
                    'columna': columna,
                    'valor_anterior': old_val,
                    'valor_nuevo': nuevo_valor
                }
                audit_log.append(log_entry)

                # --- 2c. Aplicar el Cambio Simple ---
                fila[columna] = nuevo_valor

                # --- 2d. Recalcular Completitud ---
                fila['_row_status'] = _check_row_completeness(fila)
                new_status_for_frontend = fila['_row_status']
                
                fila_modificada = True
                target_fila_dict = fila
                break

        if not fila_modificada:
            return jsonify({"error": f"No se encontró la fila con _row_id {row_id_str}"}), 404

        # --- 3. (NUEVA LÓGICA v16.7) Recálculo Reactivo de Prioridades ---
        df_modificado = pd.DataFrame.from_records(datos_staging_lista)
        df_recalculado = _recalculate_priorities(df_modificado)
        
        session['df_staging'] = df_recalculado.to_dict('records')
        session['history'] = history_stack
        
        # (v16.8) Guardamos el log de auditoría actualizado
        session['audit_log'] = audit_log

        # --- 4. Obtener Resultados y Devolver ---
        fila_actualizada_en_df = df_recalculado[df_recalculado['_row_id'].astype(str) == row_id_str]
        
        new_priority_for_frontend = None
        if not fila_actualizada_en_df.empty:
            new_priority_for_frontend = fila_actualizada_en_df.iloc[0]['_priority']
        else:
            if target_fila_dict:
                 new_priority_for_frontend = target_fila_dict.get('_priority') 

        resumen_kpis_actualizado = _calculate_kpis(df_recalculado)
        
        return jsonify({
            "status": "success", "message": f"Fila {row_id_str} actualizada.",
            "history_count": len(history_stack),
            "resumen": resumen_kpis_actualizado,
            "new_priority": new_priority_for_frontend,
            "new_row_status": new_status_for_frontend
        })

    except Exception as e:
        print(f"Error en /api/update_cell (v16.7): {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/bulk_update', methods=['POST'])
def bulk_update():
    """
    (Documentación de Google: Inicio - v16.7)
    Edición masiva de celdas para múltiples filas.
    ...
    (v16.8: Registra múltiples eventos en 'audit_log').
    ...
    (Documentación de Google: Fin)
    """
    try:
        # --- 1. Obtener y Validar Datos ---
        data = request.json
        file_id = data.get('file_id')
        row_ids_to_update = data.get('row_ids', [])
        columna = data.get('column')
        nuevo_valor = data.get('new_value')

        _check_file_id(file_id)
        if not row_ids_to_update or not columna:
            return jsonify({"error": "Faltan row_ids o columna"}), 400

        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        
        # (v16.8) Obtenemos el log de auditoría
        audit_log = session.get('audit_log', [])
        
        changes_list = []
        
        # (v16.8) Lista de logs para la auditoría
        audit_log_entries = []
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        count_updated = 0
        target_ids = set(str(rid) for rid in row_ids_to_update)

        # --- 2. Modificar Filas (en la lista de dicts) ---
        for fila in datos_staging_lista:
            rid = str(fila.get('_row_id'))
            if rid in target_ids:
                old_val = fila.get(columna)

                if old_val != nuevo_valor:
                    changes_list.append({'row_id': rid, 'old_val': old_val})
                    
                    # (v16.8) Creamos una entrada de log por cada fila afectada
                    log_entry = {
                        'timestamp': timestamp,
                        'action': 'Actualización Masiva',
                        'row_id': rid,
                        'columna': columna,
                        'valor_anterior': old_val,
                        'valor_nuevo': nuevo_valor
                    }
                    audit_log_entries.append(log_entry)
                    
                    fila[columna] = nuevo_valor
                    fila['_row_status'] = _check_row_completeness(fila)
                    count_updated += 1

        # --- 3. Manejar Cambios y Recálculo ---
        if count_updated > 0:
            bulk_action_obj = {
                'action': 'bulk_update', 'columna': columna,
                'new_val': nuevo_valor, 'changes': changes_list
            }
            history_stack.append(bulk_action_obj)
            if len(history_stack) > UNDO_STACK_LIMIT:
                history_stack.pop(0)
            
            # (v16.8) Añadimos todas las entradas al log de auditoría
            audit_log.extend(audit_log_entries)

            # --- 3b. (NUEVA LÓGICA v16.7) Recálculo Reactivo ---
            df_modificado = pd.DataFrame.from_records(datos_staging_lista)
            df_recalculado = _recalculate_priorities(df_modificado)
            
            session['df_staging'] = df_recalculado.to_dict('records')
            session['history'] = history_stack
            
            # (v16.8) Guardamos el log de auditoría
            session['audit_log'] = audit_log

            resumen_kpis_actualizado = _calculate_kpis(df_recalculado)
            
            return jsonify({
                "status": "success", "message": f"Se actualizaron {count_updated} filas.",
                "history_count": len(history_stack),
                "resumen": resumen_kpis_actualizado
            })
        else:
            return jsonify({
                "status": "no_change", "message": "No se realizaron cambios.",
                "history_count": len(history_stack)
            })

    except Exception as e:
        print(f"Error en /api/bulk_update (v16.7): {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/undo_change', methods=['POST'])
def undo_change():
    """
    (Documentación de Google: Inicio)
    Revierte la última acción realizada por el usuario.
    (NOTA v16.8) - Se registra la acción de "Deshacer" en sí misma.
    (NOTA v17.2) - Añadido soporte para 'bulk_delete_duplicates'.
    (NOTA v17.3) - Añadido soporte para 'bulk_delete'.
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        history_stack = session.get('history', [])
        if not history_stack:
            return jsonify({"error": "No hay nada que deshacer."}), 404

        last_action = history_stack.pop()
        action_type = last_action.get('action')

        datos_staging_lista = _get_df_from_session('df_staging')
        affected_row_id = None
        
        # (v16.8) Registramos el "Deshacer" en el log de auditoría.
        audit_log = session.get('audit_log', [])
        log_entry = {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'action': f"Deshacer Acción: '{action_type}'",
            'row_id': last_action.get('row_id', 'N/A'),
            'columna': last_action.get('columna', 'N/A'),
            'valor_anterior': 'N/A',
            'valor_nuevo': 'N/A'
        }
        audit_log.append(log_entry)


        # --- 1. Revertir la Acción (en la lista de dicts) ---
        if action_type == 'update':
            row_id = last_action.get('row_id')
            col = last_action.get('columna')
            old_val = last_action.get('old_val')
            for fila in datos_staging_lista:
                if str(fila.get('_row_id')) == str(row_id):
                    fila[col] = old_val
                    fila['_row_status'] = _check_row_completeness(fila)
                    affected_row_id = row_id
                    break

        elif action_type == 'bulk_update':
            col = last_action.get('columna')
            changes = last_action.get('changes', [])
            changes_map = {c['row_id']: c['old_val'] for c in changes}
            for fila in datos_staging_lista:
                rid = str(fila.get('_row_id'))
                if rid in changes_map:
                    val_restore = changes_map[rid]
                    fila[col] = val_restore
                    fila['_row_status'] = _check_row_completeness(fila)

        elif action_type == 'add':
            rid_remove = last_action.get('row_id')
            datos_staging_lista = [f for f in datos_staging_lista if str(f.get('_row_id')) != str(rid_remove)]

        elif action_type == 'delete':
            row_restore = last_action.get('deleted_row')
            orig_idx = last_action.get('original_index')
            if orig_idx is not None and 0 <= orig_idx <= len(datos_staging_lista):
                datos_staging_lista.insert(orig_idx, row_restore)
            else:
                datos_staging_lista.append(row_restore)
            affected_row_id = row_restore.get('_row_id')
        
        # --- (INICIO - LÓGICA MODIFICADA v17.3) ---
        # (Documentación de Google: Lógica unificada para 'bulk_delete' y 'bulk_delete_duplicates')
        elif action_type in ('bulk_delete_duplicates', 'bulk_delete'):
            # (Documentación de Google: Obtenemos la lista de dicts de filas que borramos)
            rows_to_restore = last_action.get('deleted_rows', [])
            if rows_to_restore:
                # (Documentación de Google: Las añadimos de nuevo a la lista)
                datos_staging_lista.extend(rows_to_restore)
                
                # (Documentación de Google: Convertimos a DF para re-ordenar por el ID original)
                df_temp = pd.DataFrame.from_records(datos_staging_lista)
                # (Documentación de Google: Ordenamos y eliminamos duplicados (por si acaso))
                df_temp = df_temp.sort_values(by='_row_id').drop_duplicates(subset=['_row_id'], keep='first')
                
                # (Documentación de Google: Re-asignamos la variable local 'datos_staging_lista')
                # (Documentación de Google: para que el código de abajo la procese)
                datos_staging_lista = df_temp.to_dict('records')
            
            # (Documentación de Google: Indicamos que fue una acción masiva)
            affected_row_id = 'bulk'
        # --- (FIN - LÓGICA MODIFICADA v17.3) ---

        else:
            history_stack.append(last_action)
            # (v16.8) Quitamos el log de auditoría que acabamos de poner
            audit_log.pop()
            raise Exception(f"Acción desconocida: {action_type}")

        # --- 2. (NUEVA LÓGICA v16.7) Recálculo Reactivo ---
        df_revertido = pd.DataFrame.from_records(datos_staging_lista)
        
        if not df_revertido.empty:
            df_recalculado = _recalculate_priorities(df_revertido)
        else:
            df_recalculado = df_revertido

        # --- 3. Guardar y Devolver ---
        session['history'] = history_stack
        session['df_staging'] = df_recalculado.to_dict('records')
        
        # (v16.8) Guardamos el log de auditoría con la acción 'Deshacer'
        session['audit_log'] = audit_log

        return jsonify({
            "status": "success", "message": f"Acción '{action_type}' deshecha.",
            "history_count": len(history_stack),
            "resumen": _calculate_kpis(df_recalculado),
            "affected_row_id": affected_row_id
        })

    except Exception as e:
        print(f"Error en /api/undo_change (v17.3): {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/commit_changes', methods=['POST'])
def commit_changes():
    """
    (Documentación de Google: Inicio)
    Limpia el historial de deshacer (punto de guardado lógico).
    ...
    (NOTA v16.8) - Registra "Consolidar" en el 'audit_log'.
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)
        _get_df_from_session('df_staging') 
        
        session['history'] = []
        
        # (v16.8) Registramos la consolidación en el log de auditoría
        try:
            audit_log = session.get('audit_log', [])
            log_entry = {
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'action': 'Cambios Consolidados',
                'row_id': 'N/A',
                'columna': 'N/A',
                'valor_anterior': 'N/A',
                'valor_nuevo': 'N/A'
            }
            audit_log.append(log_entry)
            session['audit_log'] = audit_log
        except Exception as log_e:
            print(f"Error al escribir en audit_log (commit_changes): {log_e}")
        
        return jsonify({
            "status": "success", "message": "Cambios consolidados.",
            "history_count": 0
        })
    except Exception as e:
        print(f"Error en /api/commit_changes: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/add_row', methods=['POST'])
def add_row():
    """
    (Documentación de Google: Inicio)
    Añade una fila vacía al final del DataFrame de la sesión.
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        
        # (v16.8) Obtenemos el log de auditoría
        audit_log = session.get('audit_log', [])

        if not datos_staging_lista:
            return jsonify({"error": "No hay datos para añadir fila."}), 400

        columnas = list(datos_staging_lista[0].keys())
        nueva_fila = {col: "" for col in columnas}

        max_id = 0
        if datos_staging_lista:
             max_id = max([int(f.get('_row_id', 0)) for f in datos_staging_lista])
        nuevo_id = max_id + 1

        nueva_fila['_row_id'] = nuevo_id
        nueva_fila['_row_status'] = _check_row_completeness(nueva_fila)
        
        nueva_fila['_priority'] = _assign_priority(None) 
        nueva_fila['_priority_reason'] = "Prioridad base (Estándar)"

        datos_staging_lista.append(nueva_fila)
        
        history_stack.append({'action': 'add', 'row_id': nuevo_id})
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)
            
        # (v16.8) Guardamos en log de auditoría
        log_entry = {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'action': 'Fila Añadida',
            'row_id': nuevo_id,
            'columna': 'N/A',
            'valor_anterior': 'N/A',
            'valor_nuevo': 'N/A'
        }
        audit_log.append(log_entry)

        session['df_staging'] = datos_staging_lista
        session['history'] = history_stack
        
        # (v16.8) Guardamos el log de auditoría
        session['audit_log'] = audit_log

        df_mod = pd.DataFrame.from_records(datos_staging_lista)
        return jsonify({
            "status": "success", "message": f"Fila añadida (ID: {nuevo_id}).",
            "history_count": len(history_stack),
            "resumen": _calculate_kpis(df_mod),
            "new_row_id": nuevo_id
        })

    except Exception as e:
        print(f"Error en /api/add_row: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/delete_row', methods=['POST'])
def delete_row():
    """
    (Documentación de Google: Inicio)
    Elimina una fila del DataFrame de la sesión.
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        row_id = data.get('row_id')
        _check_file_id(file_id)

        if row_id is None:
            return jsonify({"error": "Falta row_id"}), 400

        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        
        # (v16.8) Obtenemos el log de auditoría
        audit_log = session.get('audit_log', [])

        fila_eliminada = None
        indice_eliminado = -1
        nuevos_datos = [] 

        for i, fila in enumerate(datos_staging_lista):
            if str(fila.get('_row_id')) == str(row_id):
                fila_eliminada = fila
                indice_eliminado = i
            else:
                nuevos_datos.append(fila)

        if not fila_eliminada:
            return jsonify({"error": f"No se encontró la fila {row_id}"}), 404

        history_stack.append({
            'action': 'delete', 'deleted_row': fila_eliminada,
            'original_index': indice_eliminado
        })
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)
            
        # (v16.8) Guardamos en log de auditoría
        try:
            fila_serializable = {k: str(v) for k, v in fila_eliminada.items()}
            valor_anterior_log = json.dumps(fila_serializable)
        except Exception:
            valor_anterior_log = f"Fila {row_id} eliminada (datos no serializables)"

        log_entry = {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'action': 'Fila Eliminada',
            'row_id': row_id,
            'columna': 'N/A',
            'valor_anterior': valor_anterior_log,
            'valor_nuevo': 'N/A'
        }
        audit_log.append(log_entry)

        session['df_staging'] = nuevos_datos
        session['history'] = history_stack
        
        # (v16.8) Guardamos el log de auditoría
        session['audit_log'] = audit_log

        df_mod = pd.DataFrame.from_records(nuevos_datos)
        return jsonify({
            "status": "success", "message": f"Fila {row_id} eliminada.",
            "history_count": len(history_stack),
            "resumen": _calculate_kpis(df_mod)
        })

    except Exception as e:
        print(f"Error en /api/delete_row: {e}")
        return jsonify({"error": str(e)}), 500


# --- (INICIO - NUEVO ENDPOINT v17.3) ---
@app.route('/api/bulk_delete_rows', methods=['POST'])
def bulk_delete_rows():
    """
    (Documentación de Google: Inicio - v17.3)
    Elimina un conjunto de filas seleccionadas por el usuario.
    
    Esta acción es 'undoable'. Guarda todas las filas eliminadas
    en el historial de deshacer.
    
    Args:
        request.json (dict): Un JSON conteniendo:
            - 'file_id' (str): ID de la sesión.
            - 'row_ids' (list[int]): Lista de _row_id a eliminar.

    Returns:
        JSON: Un objeto con el estado de la operación y el nuevo resumen.
    (DocumentACIÓN DE GOOGLE: FIN)
    """
    try:
        # (Documentación de Google: 1. Obtener y validar datos de la petición.)
        data = request.json
        file_id = data.get('file_id')
        row_ids_to_delete = data.get('row_ids', [])

        # (Documentación de Google: 2. Validar sesión y datos de entrada.)
        _check_file_id(file_id)
        if not row_ids_to_delete or not isinstance(row_ids_to_delete, list):
            return jsonify({"error": "Debe seleccionar al menos una fila para eliminar."}), 400

        # (Documentación de Google: 3. Obtener DataFrame, historial y logs.)
        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        audit_log = session.get('audit_log', [])

        # (Documentación de Google: 4. Preparar listas para la operación.)
        
        # (Documentación de Google: Convertir los IDs a string para comparación.)
        target_ids_str = set(str(rid) for rid in row_ids_to_delete)
        
        filas_eliminadas = []
        filas_conservadas = []
        
        # (Documentación de Google: 5. Iterar y separar las filas.)
        for fila in datos_staging_lista:
            rid = str(fila.get('_row_id'))
            if rid in target_ids_str:
                # (Documentación de Google: Guardar esta fila para el 'undo'.)
                filas_eliminadas.append(fila)
            else:
                # (Documentación de Google: Esta fila se queda.)
                filas_conservadas.append(fila)

        if not filas_eliminadas:
            return jsonify({"status": "no_change", "message": "No se encontraron las filas a eliminar.", "history_count": len(history_stack)})

        # (Documentación de Google: 6. Registrar en Log de Auditoría (v16.8).)
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        for fila in filas_eliminadas:
            log_entry = {
                'timestamp': timestamp,
                'action': 'Fila Eliminada (Masiva)',
                'row_id': fila.get('_row_id'),
                'columna': 'N/A',
                'valor_anterior': 'Fila completa eliminada',
                'valor_nuevo': 'N/A'
            }
            audit_log.append(log_entry)

        # (Documentación de Google: 7. Registrar en Historial de Deshacer.)
        undo_obj = {
            'action': 'bulk_delete',
            'deleted_rows': filas_eliminadas
        }
        history_stack.append(undo_obj)
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)

        # (Documentación de Google: 8. Guardar los datos actualizados en la sesión.)
        session['df_staging'] = filas_conservadas
        session['audit_log'] = audit_log
        session['history'] = history_stack

        # (Documentación de Google: 9. Devolver éxito y nuevos KPIs.)
        df_limpio = pd.DataFrame.from_records(filas_conservadas)
        
        return jsonify({
            "status": "success",
            "message": f"Se eliminaron {len(filas_eliminadas)} filas. Esta acción se puede deshacer.",
            "resumen": _calculate_kpis(df_limpio),
            "history_count": len(history_stack)
        })

    except Exception as e:
        # (Documentación de Google: Manejo de errores genérico.)
        print(f"Error en /api/bulk_delete_rows (v17.3): {e}")
        return jsonify({"error": str(e)}), 500
# --- (FIN - NUEVO ENDPOINT v17.3) ---


# ==============================================================================
# API: CONTROL DE DUPLICADOS (NUEVO v17.0 - Genérico)
# ==============================================================================

@app.route('/api/find_duplicates', methods=['POST'])
def find_duplicates():
    """
    (Documentación de Google: Inicio - v17.0)
    Busca filas duplicadas basándose en un subconjunto de columnas.
    
    Utiliza pandas.DataFrame.duplicated para encontrar todas las filas
    que tienen valores idénticos en las columnas especificadas por el usuario.
    
    Args:
        request.json (dict): Un JSON conteniendo:
            - 'file_id' (str): ID de la sesión.
            - 'columnas_subset' (list[str]): Lista de nombres de columnas
                                             para comprobar duplicados.

    Returns:
        JSON: Un objeto con:
            - 'status' (str): "success".
            - 'duplicate_row_ids' (list[int]): Una lista de los _row_id
                                               de todas las filas duplicadas.
    (Documentación de Google: Fin)
    """
    try:
        # (Documentación de Google: 1. Obtener y validar datos de la petición.)
        data = request.json
        file_id = data.get('file_id')
        columnas_subset = data.get('columnas_subset')

        # (Documentación de Google: 2. Validar sesión y datos de entrada.)
        _check_file_id(file_id)
        if not columnas_subset or not isinstance(columnas_subset, list):
            return jsonify({"error": "Debe seleccionar al menos una columna para buscar duplicados."}), 400

        # (Documentación de Google: 3. Obtener el DataFrame completo de la sesión.)
        df = _get_df_from_session_as_df('df_staging')
        if df.empty:
            return jsonify({"status": "success", "duplicate_row_ids": []})

        # (Documentación de Google: 4. Usar pd.duplicated para encontrar duplicados.)
        # (Usamos 'keep=False' para marcar TODAS las instancias de un duplicado,
        # no solo la segunda o tercera aparición.)
        mask_duplicados = df.duplicated(subset=columnas_subset, keep=False)

        # (Documentación de Google: 5. Filtrar el DataFrame para obtener solo esas filas.)
        df_duplicados = df[mask_duplicados]

        if df_duplicados.empty:
            # (Documentación de Google: No se encontraron duplicados.)
            return jsonify({"status": "success", "duplicate_row_ids": []})

        # (Documentación de Google: 6. Extraer los _row_id de las filas duplicadas.)
        # (Nos aseguramos de que sean enteros estándar de Python para JSON.)
        ids_duplicados = [int(row_id) for row_id in df_duplicados['_row_id'].tolist()]

        # (Documentación de Google: 7. Devolver la lista de IDs.)
        return jsonify({
            "status": "success",
            "duplicate_row_ids": ids_duplicados
        })

    except KeyError as e:
        # (Documentación de Google: Error si una columna enviada no existe en el DF.)
        return jsonify({"error": f"La columna '{e}' no se encontró en los datos."}), 404
    except Exception as e:
        # (Documentación de Google: Manejo de errores genérico.)
        print(f"Error en /api/find_duplicates (v17.0): {e}")
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: GESTIÓN DE DUPLICADOS (NUEVO v17.1 - Flujo Específico de Facturas)
# (MODIFICADO v17.2 - Añadido Sort by Invoice y 'Undo')
# ==============================================================================

@app.route('/api/get_duplicate_invoices', methods=['POST'])
def get_duplicate_invoices():
    """
    (Documentación de Google: Inicio - v17.1)
    Busca y devuelve TODAS las filas que tienen un 'Invoice #' duplicado.
    (MODIFICADO v17.2) - Ahora ordena los resultados por 'Invoice #'
    para agrupar visualmente los duplicados.
    
    Args:
        request.json (dict): Un JSON conteniendo:
            - 'file_id' (str): ID de la sesión.

    Returns:
        JSON: Un objeto con:
            - 'data' (list[dict]): La lista de filas duplicadas (ordenadas).
            - 'num_filas' (int): El conteo de filas duplicadas.
    (DocumentACIÓN DE GOOGLE: FIN)
    """
    try:
        # (Documentación de Google: 1. Obtener y validar datos de la petición.)
        data = request.json
        file_id = data.get('file_id')

        # (Documentación de Google: 2. Validar sesión y obtener DataFrame.)
        _check_file_id(file_id)
        df = _get_df_from_session_as_df('df_staging')

        if df.empty:
            # (Documentación de Google: Si no hay datos, no hay duplicados.)
            return jsonify({"data": [], "num_filas": 0})

        # (Documentación de Google: 3. Usar el helper para encontrar la columna de factura.)
        invoice_col = _find_invoice_column(df)
        
        if not invoice_col:
            # (Documentación de Google: Error si no se encuentra la columna.)
            return jsonify({"error": "No se pudo encontrar una columna de 'Invoice #' (N° de Factura) en el archivo."}), 404

        # (Documentación de Google: 4. Usar pd.duplicated para encontrar TODAS las instancias.)
        # (keep=False marca todas las filas que son parte de un grupo duplicado.)
        mask = df.duplicated(subset=[invoice_col], keep=False)
        df_duplicados = df[mask]

        # --- (INICIO - NUEVA LÓGICA v17.2) ---
        if not df_duplicados.empty:
            # (Documentación de Google: Ordenar por la columna de factura y luego por ID)
            # (Documentación de Google: para agrupar duplicados en la vista.)
            df_duplicados = df_duplicados.sort_values(by=[invoice_col, '_row_id'])
        # --- (FIN - NUEVA LÓGICA v17.2) ---

        # (Documentación de Google: 5. Devolver los datos filtrados, similar a /api/filter.)
        return jsonify({
            "data": df_duplicados.to_dict(orient="records"),
            "num_filas": len(df_duplicados)
        })

    except Exception as e:
        # (Documentación de Google: Manejo de errores genérico.)
        print(f"Error en /api/get_duplicate_invoices (v17.2): {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/cleanup_duplicate_invoices', methods=['POST'])
def cleanup_duplicate_invoices():
    """
    (Documentación de Google: Inicio - v17.1)
    Elimina filas duplicadas por 'Invoice #', conservando la primera.
    (MODIFICADO v17.2) - Esta acción ahora se puede 'Deshacer'.
    Guarda las filas eliminadas en el historial de 'undo'.
    
    Args:
        request.json (dict): Un JSON conteniendo:
            - 'file_id' (str): ID de la sesión.

    Returns:
        JSON: Un objeto con el estado de la operación y el nuevo resumen.
    (DocumentACIÓN DE GOOGLE: FIN)
    """
    try:
        # (Documentación de Google: 1. Obtener y validar datos de la petición.)
        data = request.json
        file_id = data.get('file_id')

        # (Documentación de Google: 2. Validar sesión y obtener DataFrame y logs.)
        _check_file_id(file_id)
        df = _get_df_from_session_as_df('df_staging')
        audit_log = session.get('audit_log', [])
        # --- (INICIO - NUEVA LÓGICA v17.2) ---
        # (Documentación de Google: Obtener el historial de 'undo')
        history_stack = session.get('history', [])
        # --- (FIN - NUEVA LÓGICA v17.2) ---


        if df.empty:
            # (Documentación de Google: No hay nada que limpiar.)
            return jsonify({"status": "no_change", "message": "No hay datos para limpiar.", "resumen": _calculate_kpis(df), "history_count": len(history_stack)})

        # (Documentación de Google: 3. Usar el helper para encontrar la columna de factura.)
        invoice_col = _find_invoice_column(df)
        
        if not invoice_col:
            # (Documentación de Google: Error si no se encuentra la columna.)
            return jsonify({"error": "No se pudo encontrar una columna de 'Invoice #' (N° de Factura) para la limpieza."}), 404

        # (Documentación de Google: 4. Usar pd.duplicated para marcar filas a ELIMINAR.)
        # (keep='first' marca todas las apariciones *excepto* la primera como True.)
        mask_to_delete = df.duplicated(subset=[invoice_col], keep='first')
        
        # (Documentación de Google: 5. Seleccionar las filas que serán eliminadas.)
        df_to_delete = df[mask_to_delete]
        
        if df_to_delete.empty:
            # (Documentación de Google: No se encontraron duplicados para eliminar.)
            return jsonify({"status": "no_change", "message": "No se encontraron duplicados para eliminar.", "resumen": _calculate_kpis(df), "history_count": len(history_stack)})

        # (Documentación de Google: 6. Registrar en Log de Auditoría (v16.8).)
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # (Documentación de Google: Iterar sobre cada fila a eliminar para registrarla.)
        for _, row in df_to_delete.iterrows():
            # (Documentación de Google: Crear la entrada de log.)
            log_entry = {
                'timestamp': timestamp,
                'action': 'Fila Duplicada Eliminada',
                'row_id': row['_row_id'],
                'columna': invoice_col,
                'valor_anterior': row[invoice_col], # (Registra el N° de factura.)
                'valor_nuevo': 'N/A'
            }
            # (Documentación de Google: Añadir la entrada al log en memoria.)
            audit_log.append(log_entry)

        # (Documentación de Google: 7. Filtrar el DataFrame principal.)
        # (El símbolo '~' invierte la máscara, seleccionando las filas a CONSERVAR.)
        df_limpio = df[~mask_to_delete]

        # --- (INICIO - NUEVA LÓGICA v17.2) ---
        # (Documentación de Google: 8. Guardar las filas eliminadas en el 'undo' stack.)
        
        # (Documentación de Google: Convertir el DF de filas eliminadas a una lista de dicts.)
        deleted_rows_list = df_to_delete.to_dict('records')
        
        # (Documentación de Google: Crear el objeto de 'undo'.)
        undo_obj = {
            'action': 'bulk_delete_duplicates',
            'deleted_rows': deleted_rows_list
        }
        # (Documentación de Google: Añadirlo al historial.)
        history_stack.append(undo_obj)
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)
        # --- (FIN - NUEVA LÓGICA v17.2) ---


        # (Documentación de Google: 9. Guardar los datos actualizados en la sesión.)
        session['df_staging'] = df_limpio.to_dict('records')
        # (Documentación de Google: Guardar el log de auditoría actualizado.)
        session['audit_log'] = audit_log
        # (Documentación de Google: (v17.2) Guardar el historial de 'undo' actualizado.)
        session['history'] = history_stack

        # (Documentación de Google: 10. Devolver éxito y nuevos KPIs.)
        return jsonify({
            "status": "success",
            "message": f"Se eliminaron {len(df_to_delete)} filas duplicadas. Esta acción se puede deshacer.",
            "resumen": _calculate_kpis(df_limpio),
            # (Documentación de Google: (v17.2) Devolver el nuevo conteo de historial)
            "history_count": len(history_stack)
        })

    except Exception as e:
        # (Documentación de Google: Manejo de errores genérico.)
        print(f"Error en /api/cleanup_duplicate_invoices (v17.2): {e}")
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: FILTRADO Y EXPORTACIÓN
# ==============================================================================

@app.route('/api/filter', methods=['POST'])
def filter_data():
    """
    (Documentación de Google: Inicio)
    Aplica filtros dinámicos.
    
    Este es el endpoint clave que llama el frontend para obtener
    los datos que se mostrarán en la tabla Tabulator.
    Llama a `aplicar_filtros_dinamicos` (de filters.py).
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros = data.get('filtros_activos')

        _check_file_id(file_id)
        df = _get_df_from_session_as_df('df_staging')

        df_filtrado = aplicar_filtros_dinamicos(df, filtros)
        resumen = _calculate_kpis(df_filtrado)

        return jsonify({
            "data": df_filtrado.to_dict(orient="records"),
            "num_filas": len(df_filtrado),
            "resumen": resumen
        })

    except Exception as e:
        print(f"Error en /api/filter: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/download_excel', methods=['POST'])
def download_excel():
    """
    (Documentación de Google: Inicio)
    Genera y descarga un archivo Excel con los datos filtrados.
    
    Toma los filtros activos y las columnas visibles del frontend,
    aplica el filtrado, y genera un archivo .xlsx en memoria
    usando `io.BytesIO` y `xlsxwriter`.
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros = data.get('filtros_activos')
        columnas_visibles = data.get('columnas_visibles')

        _check_file_id(file_id)
        df = _get_df_from_session_as_df('df_staging')

        df_filtrado = aplicar_filtros_dinamicos(df, filtros)
        df_exportar = df_filtrado.copy()

        # Filtrar columnas si el usuario seleccionó específicas.
        if columnas_visibles and isinstance(columnas_visibles, list):
            # (Aseguramos que _row_id se incluya si existe)
            if '_row_id' in df_exportar.columns and '_row_id' not in columnas_visibles:
                columnas_visibles.append('_row_id')
            
            # (Filtramos solo por columnas que realmente existen)
            cols_existentes = [c for c in columnas_visibles if c in df_exportar.columns]
            if cols_existentes:
                df_exportar = df_exportar[cols_existentes]

        # Ajuste visual de índice (+1 para que sea 1-based).
        if '_row_id' in df_exportar.columns:
            df_exportar['_row_id'] = df_exportar['_row_id'].astype(int) + 1
            df_exportar = df_exportar.rename(columns={'_row_id': 'N° Fila'})
            # Mover N° Fila al inicio.
            cols = list(df_exportar.columns)
            cols.insert(0, cols.pop(cols.index('N° Fila')))
            df_exportar = df_exportar[cols]

        # Escritura en memoria.
        output_buffer = io.BytesIO()
        with pd.ExcelWriter(output_buffer, engine='xlsxwriter') as writer:
            df_exportar.to_excel(writer, sheet_name='Resultados', index=False)
        output_buffer.seek(0) # (Regresamos al inicio del buffer)

        return send_file(
            output_buffer,
            as_attachment=True,
            download_name='facturas_filtradas.xlsx',
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        print(f"Error en /api/download_excel: {e}")
        return "Error al generar el Excel", 500


# (INICIO - FUNCIÓN MODIFICADA v16.9)
@app.route('/api/download_audit_log', methods=['POST'])
def download_audit_log():
    """
    (Documentación de Google: Inicio - v16.9)
    Genera y descarga un reporte de auditoría LEGIBLE (TXT) de la sesión.
    (MODIFICADO v17.2) - Añadida entrada para 'Fila Duplicada Eliminada'.
    (MODIFICADO v17.3) - Añadida entrada para 'Fila Eliminada (Masiva)'.
    
    Args:
        request.json (dict): Un JSON conteniendo:
            - 'file_id' (str): ID de la sesión para validación.

    Returns:
        send_file: Un archivo 'reporte_auditoria.txt' para descargar.
    (Documentación de Google: Fin)
    """
    try:
        # (Documentación de Google: 1. Validar la sesión del usuario.)
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        # (Documentación de Google: 2. Recuperar el log de auditoría.)
        audit_log_lista = session.get('audit_log', [])

        if not audit_log_lista:
            return jsonify({"error": "No hay cambios registrados en el reporte de auditoría."}), 404

        # (Documentación de Google: 3. Construir el reporte en formato TXT.)
        reporte_string_io = io.StringIO()
        
        reporte_string_io.write("==================================================\n")
        reporte_string_io.write(" REPORTE DE AUDITORÍA DE SESIÓN\n")
        reporte_string_io.write(f" Fecha de Generación: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        reporte_string_io.write(f" ID de Sesión (File ID): {file_id}\n")
        reporte_string_io.write("==================================================\n\n")

        # (Documentación de Google: 4. Iterar sobre cada log y formatear la frase.)
        for entry in audit_log_lista:
            timestamp = entry.get('timestamp', 'N/A')
            action = entry.get('action', 'Acción Desconocida')
            row_id = entry.get('row_id', 'N/A')
            columna = entry.get('columna', 'N/A')
            val_ant = entry.get('valor_anterior', 'N/A')
            val_nue = entry.get('valor_nuevo', 'N/A')

            linea_log = f"[{timestamp}] "
            
            if action == 'Celda Actualizada':
                try:
                    display_row_id = int(row_id) + 1
                except (ValueError, TypeError):
                    display_row_id = row_id
                linea_log += f"CELDA MODIFICADA: Fila [{display_row_id}], Columna [{columna}]. Valor anterior: '{val_ant}', Valor nuevo: '{val_nue}'\n"
            
            elif action == 'Actualización Masiva':
                try:
                    display_row_id = int(row_id) + 1
                except (ValueError, TypeError):
                    display_row_id = row_id
                linea_log += f"ACTUALIZACIÓN MASIVA: Fila [{display_row_id}], Columna [{columna}]. Valor anterior: '{val_ant}', Valor nuevo: '{val_nue}'\n"

            elif action == 'Fila Añadida':
                try:
                    display_row_id = int(row_id) + 1
                except (ValueError, TypeError):
                    display_row_id = row_id
                linea_log += f"FILA AÑADIDA: Se agregó la nueva Fila [{display_row_id}]\n"

            elif action == 'Fila Eliminada':
                try:
                    display_row_id = int(row_id) + 1
                except (ValueError, TypeError):
                    display_row_id = row_id
                linea_log += f"FILA ELIMINADA: Se eliminó la Fila [{display_row_id}]\n"
            
            # (INICIO - MODIFICACIÓN v17.3)
            elif action == 'Fila Duplicada Eliminada':
                try:
                    display_row_id = int(row_id) + 1
                except (ValueError, TypeError):
                    display_row_id = row_id
                # (Documentación de Google: Usamos 'val_ant' que guardó el N° de Factura)
                linea_log += f"DUPLICADO ELIMINADO: Fila [{display_row_id}], N° Factura: '{val_ant}'\n"
            
            elif action == 'Fila Eliminada (Masiva)':
                try:
                    display_row_id = int(row_id) + 1
                except (ValueError, TypeError):
                    display_row_id = row_id
                linea_log += f"ELIMINACIÓN MASIVA: Se eliminó la Fila [{display_row_id}]\n"
            # (FIN - MODIFICACIÓN v17.3)

            elif action == 'Cambios Consolidados':
                linea_log += "--- CAMBIOS CONSOLIDADOS (Historial de 'Deshacer' limpiado) ---\n"
            
            elif action.startswith('Deshacer Acción'):
                linea_log += f"ACCIÓN DESHECHA: Se revirtió la última acción ({action})\n"
                
            elif action.startswith('Regla'):
                linea_log += f"REGLA MODIFICADA: {action} - Columna: [{columna}], Valor: [{val_ant}], Nuevo Estado: [{val_nue}]\n"
                
            else:
                linea_log += f"ACCIÓN: {action} - Detalles: {json.dumps(entry)}\n"

            reporte_string_io.write(linea_log)
        
        reporte_string_io.write("\n--- Fin del Reporte ---")

        # (Documentación de Google: 5. Convertir el StringIO a BytesIO para send_file)
        output_buffer = io.BytesIO(reporte_string_io.getvalue().encode('utf-8'))
        output_buffer.seek(0)

        # (Documentación de Google: 6. Enviar el archivo TXT al usuario.)
        return send_file(
            output_buffer,
            as_attachment=True,
            download_name='reporte_auditoria_sesion.txt',
            mimetype='text/plain'
        )
    except Exception as e:
        print(f"Error en /api/download_audit_log (v17.3): {e}")
        return jsonify({"error": f"Error al generar el reporte de auditoría: {e}"}), 500
# (FIN - FUNCIÓN MODIFICADA v16.9)


@app.route('/api/group_by', methods=['POST'])
def group_data():
    """
    (Documentación de Google: Inicio)
    Genera una vista agrupada (Pivot table simplificada).
    ...
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros = data.get('filtros_activos')
        col_agrupar = data.get('columna_agrupar')

        _check_file_id(file_id)
        df = _get_df_from_session_as_df('df_staging')

        if not col_agrupar:
            return jsonify({"error": "Missing 'columna_agrupar'"}), 400

        df_filtrado = aplicar_filtros_dinamicos(df, filtros)

        if df_filtrado.empty:
            return jsonify({"data": []})

        monto_col = _find_monto_column(df_filtrado)
        if monto_col:
            df_filtrado[monto_col] = pd.to_numeric(
                df_filtrado[monto_col].astype(str).str.replace(r'[$,]', '', regex=True), 
                errors='coerce'
            ).fillna(0)
            df_filtrado = df_filtrado.rename(columns={monto_col: 'Total'})
        elif 'Total' not in df_filtrado.columns:
            df_filtrado['Total'] = 0
        else:
             df_filtrado['Total'] = pd.to_numeric(df_filtrado['Total'], errors='coerce').fillna(0)

        df_agrupado = df_filtrado.groupby(col_agrupar).agg({
            'Total': ['sum', 'mean', 'min', 'max', 'count']
        })
        df_agrupado.columns = [f"{c[0]}_{c[1]}" for c in df_agrupado.columns]
        df_agrupado = df_agrupado.reset_index().sort_values(by='Total_sum', ascending=False)

        return jsonify({"data": df_agrupado.to_dict(orient="records")})

    except KeyError as e:
        return jsonify({"error": f"Columna '{e}' no encontrada."}), 404
    except Exception as e:
        print(f"Error en /api/group_by: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/download_excel_grouped', methods=['POST'])
def download_excel_grouped():
    """
    (Documentación de Google: Inicio)
    Descarga un Excel de la vista agrupada.
    ...
    (Documentación de Google: Fin)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros = data.get('filtros_activos')
        col_agrupar = data.get('columna_agrupar')

        _check_file_id(file_id)
        df = _get_df_from_session_as_df('df_staging')

        if not col_agrupar:
            return jsonify({"error": "Missing 'columna_agrupar'"}), 400

        df_filtrado = aplicar_filtros_dinamicos(df, filtros)

        if df_filtrado.empty:
            return jsonify({"error": "No data found"}), 404

        monto_col = _find_monto_column(df_filtrado)
        if monto_col:
            df_filtrado[monto_col] = pd.to_numeric(
                df_filtrado[monto_col].astype(str).str.replace(r'[$,]', '', regex=True), 
                errors='coerce'
            ).fillna(0)
            df_filtrado = df_filtrado.rename(columns={monto_col: 'Total'})
        elif 'Total' not in df_filtrado.columns:
            df_filtrado['Total'] = 0
        else:
             df_filtrado['Total'] = pd.to_numeric(df_filtrado['Total'], errors='coerce').fillna(0)

        df_agrupado = df_filtrado.groupby(col_agrupar).agg({
            'Total': ['sum', 'mean', 'min', 'max', 'count']
        })
        df_agrupado.columns = [f"{c[0]}_{c[1]}" for c in df_agrupado.columns]
        df_agrupado = df_agrupado.reset_index().sort_values(by='Total_sum', ascending=False)

        lang = session.get('language', 'es')
        df_agrupado = df_agrupado.rename(columns={
            col_agrupar: col_agrupado.replace('_row_status', 'Row Status').replace('_priority', 'Prioridad'),
            'Total_sum': get_text(lang, 'group_total_amount'),
            'Total_mean': get_text(lang, 'group_avg_amount'),
            'Total_min': get_text(lang, 'group_min_amount'),
            'Total_max': get_text(lang, 'group_max_amount'),
            'Total_count': get_text(lang, 'group_invoice_count')
        })

        output_buffer = io.BytesIO()
        with pd.ExcelWriter(output_buffer, engine='xlsxwriter') as writer:
            df_agrupado.to_excel(writer, sheet_name='Resultados Agrupados', index=False)
        output_buffer.seek(0)

        return send_file(
            output_buffer,
            as_attachment=True,
            download_name=f'agrupado_por_{col_agrupar}.xlsx',
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        print(f"Error en /api/download_excel_grouped: {e}")
        return jsonify({"error": str(e)}), 500


# Punto de entrada para ejecución local.
if __name__ == '__main__':
    # (debug=True permite recarga automática en cambios)
    app.run(debug=True, port=5000, reloader_type="stat")