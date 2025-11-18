"""
app.py (Versión 18.0 - Optimizado)
------------------------------------------------
Controlador principal de la aplicación Flask.
Integra lógica de negocio para gestión de facturas, control de prioridades y auditoría.

Estándares: Google Python Style Guide.
Optimizaciones:
- Documentación exhaustiva.
- Tipado estático en funciones auxiliares.
- Refactorización de recálculo de KPIs para robustez numérica.
"""

# --- Importaciones de Librerías Estándar ---
import os       # Funcionalidad del sistema operativo (rutas, archivos).
import io       # Manejo de flujos de bytes en memoria (BytesIO, StringIO).
import uuid     # Generación de IDs únicos.
import json     # Serialización JSON.
from datetime import datetime  # Manejo de fechas y horas.

# --- Importaciones de Librerías de Terceros ---
import pandas as pd  # Análisis y manipulación de datos.
from flask import Flask, request, jsonify, render_template, send_file, session
from flask_cors import CORS       # Permite peticiones de orígenes cruzados.
from flask_session import Session # Gestión de sesiones en servidor.

# --- Módulos del Proyecto ---
# Loader: Carga inicial optimizada.
from modules.loader import cargar_datos
# Priority Manager: Gestión de reglas y configuración.
from modules.priority_manager import (
    save_rule, load_rules, delete_rule, apply_priority_rules,
    load_settings, save_settings, toggle_rule
)
# Filters: Motor de filtrado.
from modules.filters import aplicar_filtros_dinamicos
# Translator: Internacionalización.
from modules.translator import get_text, LANGUAGES
# JSON Manager: Utilidades de persistencia.
from modules.json_manager import guardar_json, USER_LISTS_FILE
# Autocomplete: Generación de sugerencias.
from modules.autocomplete import get_autocomplete_options

# --- Constantes Globales ---
UNDO_STACK_LIMIT = 15            # Límite de acciones reversibles.
UPLOAD_FOLDER = 'temp_uploads'   # Directorio temporal.


# ==============================================================================
# FUNCIONES AUXILIARES (HELPERS)
# ==============================================================================

def _find_monto_column(df: pd.DataFrame) -> str | None:
    """
    Busca heurísticamente la columna que contiene montos monetarios.

    Args:
        df (pd.DataFrame): DataFrame a inspeccionar.

    Returns:
        str | None: Nombre de la columna o None.
    """
    possible_names = ['monto', 'total', 'amount', 'total amount']
    for col in df.columns:
        if str(col).lower() in possible_names:
            return col
    return None


def _find_invoice_column(df: pd.DataFrame) -> str | None:
    """
    Busca heurísticamente la columna de Número de Factura.

    Args:
        df (pd.DataFrame): DataFrame a inspeccionar.

    Returns:
        str | None: Nombre de la columna o None.
    """
    possible_names = ['invoice #', 'invoice number', 'n° factura', 'factura', 'invoice id']
    for col in df.columns:
        if str(col).lower().strip() in possible_names:
            return col
    return None


def _check_file_id(request_file_id: str) -> None:
    """
    Valida que el ID del archivo de la petición coincida con la sesión activa.
    Evita corrupción de datos si el usuario tiene múltiples pestañas.

    Args:
        request_file_id (str): ID enviado desde el frontend.

    Raises:
        Exception: Si la sesión es inválida o no coincide.
    """
    session_file_id = session.get('file_id')
    if not session_file_id:
        session.clear()
        raise Exception("Sesión expirada. Por favor, cargue un archivo.")
    
    if session_file_id != request_file_id:
        session.clear()
        raise Exception("El ID del archivo no coincide. Recargue la página.")


def _calculate_kpis(df: pd.DataFrame) -> dict:
    """
    Calcula KPIs (Total, Suma, Promedio) de forma segura y vectorizada.

    Args:
        df (pd.DataFrame): Datos a procesar.

    Returns:
        dict: Diccionario con los KPIs formateados.
    """
    monto_total = 0.0
    monto_promedio = 0.0
    total_facturas = len(df)

    monto_col_name = _find_monto_column(df)

    if monto_col_name and not df.empty:
        try:
            # Convertimos a string, limpiamos '$' y ',', y luego a numérico.
            # Usamos .copy() para evitar Warnings de SettingWithCopy.
            series_limpia = df[monto_col_name].astype(str).str.replace(r'[$,]', '', regex=True)
            
            # coerce convierte errores a NaN, fillna(0) los hace sumables.
            monto_numerico = pd.to_numeric(series_limpia, errors='coerce').fillna(0)
            
            monto_total = monto_numerico.sum()
            monto_promedio = monto_numerico.mean()
        except Exception as e:
            print(f"Advertencia al calcular KPIs: {e}")

    return {
        "total_facturas": total_facturas,
        "monto_total": f"${monto_total:,.2f}",
        "monto_promedio": f"${monto_promedio:,.2f}"
    }


def _get_df_from_session(key: str = 'df_staging') -> list[dict]:
    """
    Recupera la lista de registros crudos desde la sesión.

    Args:
        key (str): Clave de sesión.

    Returns:
        list[dict]: Lista de filas.

    Raises:
        Exception: Si la clave no existe.
    """
    data = session.get(key)
    if not data:
        session.clear()
        raise Exception("Datos de sesión no encontrados.")
    return data


def _get_df_from_session_as_df(key: str = 'df_staging') -> pd.DataFrame:
    """
    Recupera los datos de sesión y los convierte a DataFrame.

    Args:
        key (str): Clave de sesión.

    Returns:
        pd.DataFrame: Datos estructurados.
    """
    data = _get_df_from_session(key)
    return pd.DataFrame.from_records(data)


def _check_row_completeness(fila: dict) -> str:
    """
    Evalúa si una fila está completa (sin celdas vacías críticas).
    Nota: Esta función es iterativa (celda por celda) para filas individuales.

    Args:
        fila (dict): Registro a evaluar.

    Returns:
        str: 'Completo' o 'Incompleto'.
    """
    for key, value in fila.items():
        # Saltamos columnas de sistema.
        if key.startswith('_'):
            continue
        
        val_str = str(value).strip()
        if val_str == "" or val_str == "0":
            return "Incompleto"
    return "Completo"


def _recalculate_priorities(df: pd.DataFrame) -> pd.DataFrame:
    """
    Recalcula prioridades aplicando lógica base + reglas dinámicas.
    Usado para reactividad (cuando cambian reglas o datos).

    Args:
        df (pd.DataFrame): Datos actuales.

    Returns:
        pd.DataFrame: Datos con '_priority' actualizada.
    """
    settings = load_settings()
    pay_col = session.get('pay_group_col_name')
    
    # 1. Reiniciar a valores base o aplicar lógica hardcoded si está activa.
    # (Para optimizar, podríamos mover la lógica vectorial de loader aquí también,
    #  pero por ahora usamos un enfoque simplificado para mantener consistencia).
    
    if pay_col and pay_col in df.columns and settings.get('enable_scf_intercompany', True):
        # Re-aplicamos lógica base (Idealmente importaríamos la lógica vectorial,
        # pero aquí usamos apply para simplificar la integración con código existente
        # o copiamos la lógica np.select de loader.py si el rendimiento es crítico).
        
        # Usamos una lambda simple para evitar dependencia circular con loader.
        # (Nota: Para máxima eficiencia, duplicar lógica np.select de loader aquí).
        def _temp_priority(val):
            v = str(val).strip().upper()
            if v in ['SCF', 'INTERCOMPANY']: return 'Alta'
            if v.startswith('PAY GROUP'): return 'Baja'
            return 'Media'
            
        df['_priority'] = df[pay_col].apply(_temp_priority)
        
        # Actualizar razones por defecto.
        mask_alta = df['_priority'] == 'Alta'
        mask_baja = df['_priority'] == 'Baja'
        df['_priority_reason'] = "Prioridad base (Estándar)"
        df.loc[mask_alta, '_priority_reason'] = "Prioridad base (SCF/Intercompany)"
        df.loc[mask_baja, '_priority_reason'] = "Prioridad base (Pay Group)"
        
    else:
        df['_priority'] = 'Media'
        df['_priority_reason'] = "Prioridad base (Desactivada)"
    
    # 2. Aplicar reglas de usuario (Ahora optimizado vectorialmente en priority_manager).
    df = apply_priority_rules(df)
    
    return df


# ==============================================================================
# CONFIGURACIÓN DE FLASK
# ==============================================================================

app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

app.config['SECRET_KEY'] = 'mi-llave-secreta-para-el-buscador-12345'
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
app.config["SESSION_FILE_DIR"] = os.path.join(UPLOAD_FOLDER, 'flask_session')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(app.config["SESSION_FILE_DIR"], exist_ok=True)

Session(app)


@app.context_processor
def inject_translator():
    """Inyecta utilidades de traducción en las plantillas."""
    lang = session.get('language', 'es')
    return dict(get_text=get_text, lang=lang)


# ==============================================================================
# RUTAS PRINCIPALES
# ==============================================================================

@app.route('/')
def home():
    """Renderiza la página principal e inyecta estado inicial."""
    session_data = {
        "file_id": session.get('file_id'),
        "columnas": [],
        "autocomplete_options": {},
        "history_count": len(session.get('history', []))
    }

    df_staging_data = session.get('df_staging')
    if df_staging_data and isinstance(df_staging_data, list) and len(df_staging_data) > 0:
        session_data["columnas"] = list(df_staging_data[0].keys())
        # Optimizamos evitando crear DF completo solo para esto si es posible,
        # pero el autocompletado necesita DF.
        df_scan = pd.DataFrame.from_records(df_staging_data)
        session_data["autocomplete_options"] = get_autocomplete_options(df_scan)

    return render_template('index.html', session_data=session_data)


@app.route('/api/set_language/<string:lang_code>')
def set_language(lang_code):
    """Cambia el idioma de la sesión."""
    if lang_code in LANGUAGES:
        session['language'] = lang_code
    return jsonify({"status": "success", "language": lang_code})


@app.route('/api/get_translations')
def get_translations():
    """Devuelve el diccionario de traducciones."""
    lang = session.get('language', 'es')
    return jsonify(LANGUAGES.get(lang, LANGUAGES['es']))


# ==============================================================================
# API: GESTIÓN DE ARCHIVOS
# ==============================================================================

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """
    Maneja la carga del archivo Excel inicial.
    Llama a `loader.cargar_datos` para procesamiento optimizado.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    file.save(file_path)

    try:
        session.clear()
        
        # Carga optimizada (ver loader.py).
        df, pay_group_col_name = cargar_datos(file_path)

        if df.empty:
            raise Exception("El archivo está vacío o corrupto.")

        # Asignación de ID interno.
        df = df.reset_index().rename(columns={'index': '_row_id'})
        
        # Guardar en sesión.
        session['df_staging'] = df.to_dict('records')
        session['history'] = []
        session['file_id'] = file_id
        session['pay_group_col_name'] = pay_group_col_name
        session['audit_log'] = []

        if os.path.exists(file_path):
            os.remove(file_path)

        return jsonify({
            "file_id": file_id,
            "columnas": [col for col in df.columns],
            "autocomplete_options": get_autocomplete_options(df)
        })

    except Exception as e:
        print(f"Error en /api/upload: {e}")
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({"error": str(e)}), 500


@app.route('/api/save_autocomplete_lists', methods=['POST'])
def save_autocomplete_lists():
    """Guarda listas de autocompletado personalizadas."""
    try:
        nuevas_listas = request.json
        if not isinstance(nuevas_listas, dict):
            return jsonify({"error": "Formato inválido"}), 400
        
        if guardar_json(USER_LISTS_FILE, nuevas_listas):
            return jsonify({"status": "success", "message": "Listas guardadas."})
        return jsonify({"error": "Error interno."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: REGLAS DE PRIORIDAD
# ==============================================================================

@app.route('/api/priority_rules/get', methods=['GET'])
def get_priority_rules():
    """Devuelve reglas y configuración."""
    return jsonify({
        "rules": load_rules(),
        "settings": load_settings()
    })


@app.route('/api/priority_rules/save_settings', methods=['POST'])
def api_save_settings():
    """Guarda configuración global y recalcula."""
    try:
        save_settings(request.json)
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            return jsonify({"status": "success", "resumen": _calculate_kpis(df)})
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/priority_rules/save', methods=['POST'])
def api_save_rule():
    """Guarda regla y recalcula."""
    try:
        new_rule = request.json
        save_rule(new_rule)
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            
            # Log de auditoría
            audit_log = session.get('audit_log', [])
            audit_log.append({
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'action': 'Regla Guardada',
                'row_id': 'N/A',
                'columna': new_rule.get('column', 'N/A'),
                'valor_anterior': 'N/A',
                'valor_nuevo': f"Prio {new_rule.get('priority')} si {new_rule.get('value')}"
            })
            session['audit_log'] = audit_log
            
            return jsonify({"status": "success", "resumen": _calculate_kpis(df)})
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/priority_rules/toggle', methods=['POST'])
def api_toggle_rule():
    """Activa/Desactiva regla y recalcula."""
    try:
        data = request.json
        toggle_rule(data.get('column'), data.get('value'), data.get('active'))
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            return jsonify({"status": "success", "resumen": _calculate_kpis(df)})
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/priority_rules/delete', methods=['POST'])
def api_delete_rule():
    """Elimina regla y recalcula."""
    try:
        data = request.json
        delete_rule(data.get('column'), data.get('value'))
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            return jsonify({"status": "success", "resumen": _calculate_kpis(df)})
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: EDICIÓN DE DATOS
# ==============================================================================

@app.route('/api/update_cell', methods=['POST'])
def update_cell():
    """Actualiza una celda individual."""
    try:
        data = request.json
        file_id = data.get('file_id')
        row_id_str = str(data.get('row_id'))
        columna = data.get('columna')
        nuevo_valor = data.get('valor')

        _check_file_id(file_id)
        datos_list = _get_df_from_session('df_staging')
        history = session.get('history', [])
        audit = session.get('audit_log', [])

        target_fila = None
        fila_modificada = False

        # Iteramos sobre la lista (más rápido que crear DF para un solo cambio).
        for fila in datos_list:
            if str(fila.get('_row_id')) == row_id_str:
                old_val = fila.get(columna)
                if old_val == nuevo_valor:
                    return jsonify({"status": "no_change"})

                # Registro Undo
                history.append({
                    'action': 'update', 'row_id': row_id_str, 'columna': columna,
                    'old_val': old_val, 'new_val': nuevo_valor
                })
                if len(history) > UNDO_STACK_LIMIT: history.pop(0)

                # Registro Auditoría
                audit.append({
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'action': 'Celda Actualizada',
                    'row_id': row_id_str, 'columna': columna,
                    'valor_anterior': old_val, 'valor_nuevo': nuevo_valor
                })

                # Aplicar cambio
                fila[columna] = nuevo_valor
                fila['_row_status'] = _check_row_completeness(fila)
                fila_modificada = True
                target_fila = fila
                break

        if not fila_modificada:
            return jsonify({"error": "Fila no encontrada"}), 404

        # Recálculo reactivo (Necesario pasar a DF).
        df = pd.DataFrame.from_records(datos_list)
        df = _recalculate_priorities(df)
        
        # Actualizamos la prioridad en el frontend para la fila específica.
        new_prio = df.loc[df['_row_id'].astype(str) == row_id_str, '_priority'].iloc[0]

        session['df_staging'] = df.to_dict('records')
        session['history'] = history
        session['audit_log'] = audit

        return jsonify({
            "status": "success",
            "history_count": len(history),
            "resumen": _calculate_kpis(df),
            "new_priority": new_prio,
            "new_row_status": target_fila.get('_row_status')
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/bulk_update', methods=['POST'])
def bulk_update():
    """Edición masiva de filas."""
    try:
        data = request.json
        _check_file_id(data.get('file_id'))
        
        row_ids = set(str(r) for r in data.get('row_ids', []))
        col = data.get('column')
        new_val = data.get('new_value')

        datos_list = _get_df_from_session('df_staging')
        history = session.get('history', [])
        audit = session.get('audit_log', [])
        
        changes = []
        audit_entries = []
        ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        count = 0

        for fila in datos_list:
            rid = str(fila.get('_row_id'))
            if rid in row_ids:
                old = fila.get(col)
                if old != new_val:
                    changes.append({'row_id': rid, 'old_val': old})
                    audit_entries.append({
                        'timestamp': ts, 'action': 'Actualización Masiva',
                        'row_id': rid, 'columna': col,
                        'valor_anterior': old, 'valor_nuevo': new_val
                    })
                    fila[col] = new_val
                    fila['_row_status'] = _check_row_completeness(fila)
                    count += 1

        if count > 0:
            history.append({'action': 'bulk_update', 'columna': col, 'new_val': new_val, 'changes': changes})
            if len(history) > UNDO_STACK_LIMIT: history.pop(0)
            audit.extend(audit_entries)

            df = pd.DataFrame.from_records(datos_list)
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            session['history'] = history
            session['audit_log'] = audit

            return jsonify({"status": "success", "message": f"{count} filas actualizadas.", "resumen": _calculate_kpis(df), "history_count": len(history)})
        
        return jsonify({"status": "no_change"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/find_replace_in_selection', methods=['POST'])
def find_replace_in_selection():
    """Buscar y reemplazar en selección."""
    try:
        data = request.json
        _check_file_id(data.get('file_id'))
        
        row_ids = set(str(r) for r in data.get('row_ids', []))
        col = data.get('columna')
        find_txt = str(data.get('find_text'))
        repl_txt = data.get('replace_text')

        datos_list = _get_df_from_session('df_staging')
        history = session.get('history', [])
        audit = session.get('audit_log', [])
        
        changes = []
        audit_entries = []
        ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        count = 0

        for fila in datos_list:
            rid = str(fila.get('_row_id'))
            if rid in row_ids:
                old_val = fila.get(col)
                # Coincidencia exacta (convertida a string).
                if str(old_val) == find_txt:
                    changes.append({'row_id': rid, 'old_val': old_val})
                    audit_entries.append({
                        'timestamp': ts, 'action': 'Reemplazo Masivo',
                        'row_id': rid, 'columna': col,
                        'valor_anterior': old_val, 'valor_nuevo': repl_txt
                    })
                    fila[col] = repl_txt
                    fila['_row_status'] = _check_row_completeness(fila)
                    count += 1

        if count > 0:
            history.append({'action': 'find_replace', 'columna': col, 'new_val': repl_txt, 'changes': changes})
            if len(history) > UNDO_STACK_LIMIT: history.pop(0)
            audit.extend(audit_entries)

            df = pd.DataFrame.from_records(datos_list)
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            session['history'] = history
            session['audit_log'] = audit

            return jsonify({"status": "success", "message": f"{count} reemplazos.", "resumen": _calculate_kpis(df), "history_count": len(history)})
        
        return jsonify({"status": "no_change", "message": "No se encontraron coincidencias."})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/undo_change', methods=['POST'])
def undo_change():
    """Deshacer última acción."""
    try:
        _check_file_id(request.json.get('file_id'))
        history = session.get('history', [])
        if not history:
            return jsonify({"error": "Nada que deshacer"}), 404

        last = history.pop()
        action = last.get('action')
        datos_list = _get_df_from_session('df_staging')
        affected_id = None

        # Log Auditoría
        audit = session.get('audit_log', [])
        audit.append({
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'action': f"Deshacer: {action}", 'row_id': 'N/A', 'columna': 'N/A', 'valor_anterior': 'N/A', 'valor_nuevo': 'N/A'
        })

        if action == 'update':
            rid = str(last.get('row_id'))
            col = last.get('columna')
            for f in datos_list:
                if str(f.get('_row_id')) == rid:
                    f[col] = last.get('old_val')
                    f['_row_status'] = _check_row_completeness(f)
                    affected_id = rid
                    break

        elif action in ('bulk_update', 'find_replace'):
            col = last.get('columna')
            # Mapa de restauración {row_id: old_value}
            restore_map = {c['row_id']: c['old_val'] for c in last.get('changes', [])}
            for f in datos_list:
                rid = str(f.get('_row_id'))
                if rid in restore_map:
                    f[col] = restore_map[rid]
                    f['_row_status'] = _check_row_completeness(f)
            affected_id = 'bulk'

        elif action == 'add':
            rid = str(last.get('row_id'))
            datos_list = [f for f in datos_list if str(f.get('_row_id')) != rid]

        elif action == 'delete':
            datos_list.insert(last.get('original_index', 0), last.get('deleted_row'))
            affected_id = last.get('deleted_row').get('_row_id')

        elif action in ('bulk_delete', 'bulk_delete_duplicates'):
            rows = last.get('deleted_rows', [])
            datos_list.extend(rows)
            # Reordenar es necesario tras re-insertar.
            # (Convertimos a DF solo para ordenar, un poco costoso pero necesario).
            df_temp = pd.DataFrame.from_records(datos_list)
            df_temp['_row_id_int'] = df_temp['_row_id'].astype(int)
            df_temp = df_temp.sort_values('_row_id_int').drop(columns=['_row_id_int'])
            datos_list = df_temp.to_dict('records')
            affected_id = 'bulk'

        # Recálculo y Guardado
        df = pd.DataFrame.from_records(datos_list)
        # Solo recalculamos prioridades si la acción pudo afectarlas
        df = _recalculate_priorities(df)
        
        session['df_staging'] = df.to_dict('records')
        session['history'] = history
        session['audit_log'] = audit

        return jsonify({
            "status": "success",
            "history_count": len(history),
            "resumen": _calculate_kpis(df),
            "affected_row_id": affected_id
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/commit_changes', methods=['POST'])
def commit_changes():
    """Limpia historial."""
    try:
        _check_file_id(request.json.get('file_id'))
        session['history'] = []
        # Log simple
        audit = session.get('audit_log', [])
        audit.append({'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'action': 'Cambios Consolidados'})
        session['audit_log'] = audit
        return jsonify({"status": "success", "history_count": 0})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: OPERACIONES DE FILAS (Añadir/Eliminar)
# ==============================================================================

@app.route('/api/add_row', methods=['POST'])
def add_row():
    """Añade fila vacía."""
    try:
        _check_file_id(request.json.get('file_id'))
        datos_list = _get_df_from_session('df_staging')
        history = session.get('history', [])

        # Calcular nuevo ID
        max_id = max([int(f.get('_row_id', 0)) for f in datos_list]) if datos_list else 0
        nuevo_id = max_id + 1

        cols = list(datos_list[0].keys()) if datos_list else ['_row_id', '_priority']
        nueva_fila = {col: "" for col in cols}
        nueva_fila.update({
            '_row_id': nuevo_id,
            '_row_status': 'Incompleto',
            '_priority': 'Media',
            '_priority_reason': 'Prioridad base (Estándar)'
        })

        datos_list.append(nueva_fila)
        
        history.append({'action': 'add', 'row_id': nuevo_id})
        if len(history) > UNDO_STACK_LIMIT: history.pop(0)

        audit = session.get('audit_log', [])
        audit.append({'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'action': 'Fila Añadida', 'row_id': nuevo_id})
        session['audit_log'] = audit

        session['df_staging'] = datos_list
        session['history'] = history

        return jsonify({
            "status": "success", "new_row_id": nuevo_id,
            "history_count": len(history),
            "resumen": _calculate_kpis(pd.DataFrame.from_records(datos_list))
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/delete_row', methods=['POST'])
def delete_row():
    """Elimina una fila."""
    try:
        row_id = request.json.get('row_id')
        _check_file_id(request.json.get('file_id'))
        
        datos_list = _get_df_from_session('df_staging')
        history = session.get('history', [])

        fila_del = None
        idx_del = -1

        for i, f in enumerate(datos_list):
            if str(f.get('_row_id')) == str(row_id):
                fila_del = f
                idx_del = i
                break

        if fila_del:
            datos_list.pop(idx_del)
            history.append({'action': 'delete', 'deleted_row': fila_del, 'original_index': idx_del})
            if len(history) > UNDO_STACK_LIMIT: history.pop(0)
            
            audit = session.get('audit_log', [])
            audit.append({'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'action': 'Fila Eliminada', 'row_id': row_id})
            session['audit_log'] = audit
            
            session['df_staging'] = datos_list
            session['history'] = history
            
            return jsonify({"status": "success", "history_count": len(history), "resumen": _calculate_kpis(pd.DataFrame.from_records(datos_list))})
        
        return jsonify({"error": "Fila no encontrada"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/bulk_delete_rows', methods=['POST'])
def bulk_delete_rows():
    """Eliminación masiva."""
    try:
        row_ids = set(str(r) for r in request.json.get('row_ids', []))
        _check_file_id(request.json.get('file_id'))
        
        datos_list = _get_df_from_session('df_staging')
        history = session.get('history', [])
        audit = session.get('audit_log', [])

        kept = []
        deleted = []
        ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        for f in datos_list:
            if str(f.get('_row_id')) in row_ids:
                deleted.append(f)
                audit.append({'timestamp': ts, 'action': 'Fila Eliminada (Masiva)', 'row_id': f.get('_row_id')})
            else:
                kept.append(f)

        if deleted:
            history.append({'action': 'bulk_delete', 'deleted_rows': deleted})
            if len(history) > UNDO_STACK_LIMIT: history.pop(0)
            
            session['df_staging'] = kept
            session['history'] = history
            session['audit_log'] = audit
            
            return jsonify({"status": "success", "message": f"{len(deleted)} filas eliminadas.", "history_count": len(history), "resumen": _calculate_kpis(pd.DataFrame.from_records(kept))})
        
        return jsonify({"status": "no_change"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: DUPLICADOS (Facturas)
# ==============================================================================

@app.route('/api/get_duplicate_invoices', methods=['POST'])
def get_duplicate_invoices():
    """Devuelve filas con Invoice # duplicado."""
    try:
        _check_file_id(request.json.get('file_id'))
        df = _get_df_from_session_as_df()
        
        inv_col = _find_invoice_column(df)
        if not inv_col: return jsonify({"error": "No se encontró columna de Factura"}), 404

        dupes = df[df.duplicated(subset=[inv_col], keep=False)]
        if not dupes.empty:
            dupes = dupes.sort_values(by=[inv_col, '_row_id'])

        return jsonify({"data": dupes.to_dict('records'), "num_filas": len(dupes)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/cleanup_duplicate_invoices', methods=['POST'])
def cleanup_duplicate_invoices():
    """Elimina duplicados conservando el primero."""
    try:
        _check_file_id(request.json.get('file_id'))
        df = _get_df_from_session_as_df()
        inv_col = _find_invoice_column(df)
        
        if not inv_col: return jsonify({"error": "No se encontró columna de Factura"}), 404

        mask_del = df.duplicated(subset=[inv_col], keep='first')
        df_del = df[mask_del]
        
        if df_del.empty: return jsonify({"status": "no_change"})

        # Historial y Auditoría
        history = session.get('history', [])
        history.append({'action': 'bulk_delete_duplicates', 'deleted_rows': df_del.to_dict('records')})
        if len(history) > UNDO_STACK_LIMIT: history.pop(0)

        audit = session.get('audit_log', [])
        ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        for _, row in df_del.iterrows():
            audit.append({'timestamp': ts, 'action': 'Fila Duplicada Eliminada', 'row_id': row['_row_id'], 'valor_anterior': row[inv_col]})
        
        df_clean = df[~mask_del]
        session['df_staging'] = df_clean.to_dict('records')
        session['history'] = history
        session['audit_log'] = audit

        return jsonify({"status": "success", "message": f"{len(df_del)} eliminados.", "history_count": len(history), "resumen": _calculate_kpis(df_clean)})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: FILTRADO Y EXPORTACIÓN
# ==============================================================================

@app.route('/api/filter', methods=['POST'])
def filter_data():
    """Aplica filtros dinámicos."""
    try:
        data = request.json
        _check_file_id(data.get('file_id'))
        df = _get_df_from_session_as_df()
        
        df_filt = aplicar_filtros_dinamicos(df, data.get('filtros_activos'))
        return jsonify({
            "data": df_filt.to_dict('records'),
            "num_filas": len(df_filt),
            "resumen": _calculate_kpis(df_filt)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/download_audit_log', methods=['POST'])
def download_audit_log():
    """Genera TXT del log de auditoría."""
    try:
        _check_file_id(request.json.get('file_id'))
        logs = session.get('audit_log', [])
        
        sio = io.StringIO()
        sio.write(f"REPORTE DE AUDITORÍA - {datetime.now()}\n")
        sio.write("========================================\n")
        
        for log in logs:
            sio.write(f"[{log.get('timestamp')}] {log.get('action')} | Row: {log.get('row_id')} | Col: {log.get('columna')} | Val: {log.get('valor_anterior')} -> {log.get('valor_nuevo')}\n")
            
        output = io.BytesIO(sio.getvalue().encode('utf-8'))
        output.seek(0)
        
        return send_file(output, as_attachment=True, download_name='audit_log.txt', mimetype='text/plain')
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/download_excel', methods=['POST'])
def download_excel():
    """Exporta resultados a Excel."""
    try:
        data = request.json
        _check_file_id(data.get('file_id'))
        df = _get_df_from_session_as_df()
        
        df = aplicar_filtros_dinamicos(df, data.get('filtros_activos'))
        
        # Filtrar columnas
        visibles = data.get('columnas_visibles')
        if visibles:
            cols = [c for c in visibles if c in df.columns]
            if '_row_id' in df.columns and '_row_id' not in cols: cols.insert(0, '_row_id')
            df = df[cols]

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            df.to_excel(writer, index=False)
        output.seek(0)

        return send_file(output, as_attachment=True, download_name='resultados.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: AGRUPACIÓN (NUEVO)
# ==============================================================================

@app.route('/api/group_by', methods=['POST'])
def group_by_data():
    """
    Agrupa los datos según una columna y calcula agregados (KPIs).
    """
    try:
        data = request.json
        _check_file_id(data.get('file_id'))
        
        # 1. Obtener y filtrar datos
        df = _get_df_from_session_as_df()
        df_filt = aplicar_filtros_dinamicos(df, data.get('filtros_activos'))
        
        col_agrupar = data.get('columna_agrupar')
        if not col_agrupar or col_agrupar not in df_filt.columns:
            return jsonify({"error": f"Columna '{col_agrupar}' no encontrada"}), 400

        # 2. Detectar columna de montos para operaciones matemáticas
        col_monto = _find_monto_column(df_filt)
        
        # 3. Preparar agregaciones
        # Siempre contamos las facturas
        agregaciones = {
            col_agrupar: ('_row_id', 'count') # Usamos cualquier col para contar
        }
        
        # Si hay columna de monto, calculamos métricas financieras
        if col_monto:
            # Limpieza numérica robusta
            series_limpia = df_filt[col_monto].astype(str).str.replace(r'[$,]', '', regex=True)
            df_filt['_temp_monto'] = pd.to_numeric(series_limpia, errors='coerce').fillna(0)
            
            # Definimos qué calcular
            agg_funcs = {
                'Total_sum': ('_temp_monto', 'sum'),
                'Total_mean': ('_temp_monto', 'mean'),
                'Total_min': ('_temp_monto', 'min'),
                'Total_max': ('_temp_monto', 'max')
            }
        else:
            agg_funcs = {}

        # 4. Ejecutar agrupación (Pandas GroupBy)
        # reset_index para que la columna agrupada vuelva a ser columna normal
        # Hacemos el groupby y calculamos todo de una vez
        if col_monto:
            # Agrupar y aplicar múltiples funciones a la columna de monto
            gb = df_filt.groupby(col_agrupar)['_temp_monto'].agg(['sum', 'mean', 'min', 'max', 'count']).reset_index()
            
            # Renombrar columnas para que coincidan con lo que espera el JS (script.js)
            gb = gb.rename(columns={
                'sum': 'Total_sum',
                'mean': 'Total_mean',
                'min': 'Total_min',
                'max': 'Total_max',
                'count': 'Total_count'
            })
        else:
            # Si no hay montos, solo contamos
            gb = df_filt.groupby(col_agrupar).size().reset_index(name='Total_count')
            # Rellenar con 0 los valores monetarios para que la tabla no falle
            gb['Total_sum'] = 0
            gb['Total_mean'] = 0
            gb['Total_min'] = 0
            gb['Total_max'] = 0

        # 5. Formateo y Limpieza
        # Redondear a 2 decimales
        cols_num = ['Total_sum', 'Total_mean', 'Total_min', 'Total_max']
        gb[cols_num] = gb[cols_num].round(2)
        
        # Reemplazar NaN con 0 o vacíos
        gb = gb.fillna(0)

        # Convertir a diccionario
        data_grouped = gb.to_dict('records')

        return jsonify({
            "data": data_grouped,
            "num_filas": len(data_grouped)
            # No enviamos kpis globales (resumen) aquí porque la vista agrupada muestra sus propios totales
        })

    except Exception as e:
        print(f"ERROR en group_by: {e}")
        return jsonify({"error": str(e)}), 500

# También agregamos la ruta de descarga agrupada que se menciona en tu JS
@app.route('/api/download_excel_grouped', methods=['POST'])
def download_excel_grouped():
    """Descarga la vista agrupada tal como se ve en pantalla."""
    try:
        # Reutilizamos la lógica de agrupación llamando a la función interna (simulado)
        # Ojo: Para hacerlo rápido, copiamos la lógica clave.
        data = request.json
        _check_file_id(data.get('file_id'))
        
        df = _get_df_from_session_as_df()
        df_filt = aplicar_filtros_dinamicos(df, data.get('filtros_activos'))
        col_agrupar = data.get('columna_agrupar')
        col_monto = _find_monto_column(df_filt)
        
        if col_monto:
            series_limpia = df_filt[col_monto].astype(str).str.replace(r'[$,]', '', regex=True)
            df_filt['_temp_monto'] = pd.to_numeric(series_limpia, errors='coerce').fillna(0)
            gb = df_filt.groupby(col_agrupar)['_temp_monto'].agg(['sum', 'mean', 'min', 'max', 'count']).reset_index()
            gb = gb.rename(columns={'sum': 'Total Monto', 'mean': 'Promedio', 'min': 'Mínimo', 'max': 'Máximo', 'count': 'Cantidad Facturas'})
        else:
            gb = df_filt.groupby(col_agrupar).size().reset_index(name='Cantidad Facturas')

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            gb.to_excel(writer, index=False, sheet_name="Agrupado")
            # Ajustar ancho de columnas (opcional)
            worksheet = writer.sheets['Agrupado']
            for idx, col in enumerate(gb.columns):
                max_len = max(gb[col].astype(str).map(len).max(), len(col)) + 2
                worksheet.set_column(idx, idx, max_len)

        output.seek(0)
        filename = f"agrupado_por_{col_agrupar}.xlsx"
        return send_file(output, as_attachment=True, download_name=filename, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)