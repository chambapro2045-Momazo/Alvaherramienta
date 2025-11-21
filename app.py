"""
app.py (Versión 7.0 - Vistas con Lógica de Negocio)
--------------------------------------------------------------------------------
Controlador principal de la aplicación Flask.
Coordina la interacción entre el Frontend (Tabulator) y los Módulos de Lógica.
"""

# ==============================================================================
# 1. IMPORTACIONES & CONFIGURACIÓN
# ==============================================================================
import os
import io
import uuid
import json
from datetime import datetime

import pandas as pd
import numpy as np
from flask import Flask, request, jsonify, render_template, send_file, session
from flask_cors import CORS
from flask_session import Session

# --- Módulos Propios ---
from modules.loader import cargar_datos
from modules.filters import aplicar_filtros_dinamicos
from modules.translator import get_text, LANGUAGES
from modules.json_manager import guardar_json, cargar_json, USER_LISTS_FILE
from modules.autocomplete import get_autocomplete_options
# ATENCIÓN: Se añadió replace_all_rules a las importaciones
from modules.priority_manager import (
    save_rule, load_rules, delete_rule, apply_priority_rules,
    load_settings, save_settings, toggle_rule, replace_all_rules
)

# --- Constantes ---
UNDO_STACK_LIMIT = 15
UPLOAD_FOLDER = 'temp_uploads'

# --- Configuración Flask ---
app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

app.config['SECRET_KEY'] = 'mi-llave-secreta-para-el-buscador-12345'
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
app.config["SESSION_FILE_DIR"] = os.path.join(UPLOAD_FOLDER, 'flask_session')

# Asegurar directorios
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(app.config["SESSION_FILE_DIR"], exist_ok=True)

Session(app)


# ==============================================================================
# 2. FUNCIONES AUXILIARES (HELPERS)
# ==============================================================================

def _check_file_id(request_file_id: str) -> None:
    """Valida que la petición venga de la sesión activa del usuario."""
    session_file_id = session.get('file_id')
    if not session_file_id:
        session.clear()
        raise Exception("Sesión expirada. Por favor, cargue un archivo.")
    if session_file_id != request_file_id:
        session.clear() # Seguridad: Invalidar si hay mismatch
        raise Exception("El ID del archivo no coincide. Recargue la página.")

def _get_df_from_session_as_df(key: str = 'df_staging') -> pd.DataFrame:
    """Recupera los datos de sesión y devuelve un DataFrame."""
    data = session.get(key)
    if not data:
        session.clear()
        raise Exception("Datos de sesión no encontrados.")
    return pd.DataFrame.from_records(data)

def _find_monto_column(df: pd.DataFrame) -> str | None:
    """Heurística para encontrar la columna de dinero."""
    possible_names = ['monto', 'total', 'amount', 'total amount']
    for col in df.columns:
        if str(col).lower() in possible_names:
            return col
    return None

def _find_invoice_column(df: pd.DataFrame) -> str | None:
    """Heurística para encontrar el número de factura."""
    possible_names = ['invoice #', 'invoice number', 'n° factura', 'factura', 'invoice id']
    for col in df.columns:
        if str(col).lower().strip() in possible_names:
            return col
    return None

def _check_row_completeness(fila: dict) -> str:
    """Valida si una fila tiene celdas vacías críticas."""
    for key, value in fila.items():
        if key.startswith('_'): continue # Ignorar columnas internas
        val_str = str(value).strip()
        if val_str == "" or val_str == "0":
            return "Incompleto"
    return "Completo"

def _calculate_kpis(df: pd.DataFrame) -> dict:
    """Calcula totales financieros seguros."""
    monto_total = 0.0
    monto_promedio = 0.0
    total_facturas = len(df)
    monto_col = _find_monto_column(df)

    if monto_col and not df.empty:
        try:
            clean_series = df[monto_col].astype(str).str.replace(r'[$,]', '', regex=True)
            nums = pd.to_numeric(clean_series, errors='coerce').fillna(0)
            monto_total = nums.sum()
            monto_promedio = nums.mean()
        except Exception as e:
            print(f"Advertencia KPIs: {e}")

    return {
        "total_facturas": total_facturas,
        "monto_total": f"${monto_total:,.2f}",
        "monto_promedio": f"${monto_promedio:,.2f}"
    }

def _recalculate_priorities(df: pd.DataFrame) -> pd.DataFrame:
    """
    Recalcula 'Priority' aplicando lógica base + reglas de usuario.
    Se llama después de cualquier edición que pueda afectar reglas.
    """
    settings = load_settings()
    pay_col = session.get('pay_group_col_name')
    
    # 1. Reiniciar a lógica base (Hardcoded Business Logic)
    if pay_col and pay_col in df.columns and settings.get('enable_scf_intercompany', True):
        # Optimizamos usando vectorización simple
        pg_series = df[pay_col].astype(str).str.strip().str.upper()
        
        cond_alta = pg_series.isin(['SCF', 'INTERCOMPANY'])
        cond_baja = pg_series.str.startswith('PAY GROUP', na=False)
        
        df['_priority'] = np.select([cond_alta, cond_baja], ['Alta', 'Baja'], default='Media')
        df['_priority_reason'] = np.select(
            [cond_alta, cond_baja], 
            ['Prioridad base (SCF/Intercompany)', 'Prioridad base (Pay Group)'], 
            default="Prioridad base (Estándar)"
        )
    else:
        df['_priority'] = 'Media'
        df['_priority_reason'] = "Prioridad base (Desactivada/No encontrada)"
    
    # 2. Sobrescribir con Reglas de Usuario
    df = apply_priority_rules(df)
    return df


# ==============================================================================
# 3. RUTAS: VISTAS & SISTEMA
# ==============================================================================

@app.context_processor
def inject_translator():
    return dict(get_text=get_text, lang=session.get('language', 'es'))

@app.route('/')
def home():
    """Carga la SPA (Single Page Application)."""
    session_data = {
        "file_id": session.get('file_id'),
        "columnas": [],
        "autocomplete_options": {},
        "history_count": len(session.get('history', []))
    }
    
    # Si hay datos previos, intentar restaurar columnas para UI
    df_data = session.get('df_staging')
    if df_data and len(df_data) > 0:
        session_data["columnas"] = list(df_data[0].keys())
        # Reconstruir autocomplete ligero
        session_data["autocomplete_options"] = get_autocomplete_options(pd.DataFrame.from_records(df_data))

    return render_template('index.html', session_data=session_data)

@app.route('/api/set_language/<string:lang_code>')
def set_language(lang_code):
    if lang_code in LANGUAGES: session['language'] = lang_code
    return jsonify({"status": "success", "language": lang_code})

@app.route('/api/get_translations')
def get_translations():
    return jsonify(LANGUAGES.get(session.get('language', 'es'), LANGUAGES['es']))


# ==============================================================================
# 4. RUTAS: GESTIÓN DE ARCHIVOS
# ==============================================================================

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selection"}), 400

    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    file.save(file_path)

    try:
        session.clear() # Limpieza fresca
        
        # Loader Inteligente
        df, pay_group_col = cargar_datos(file_path)
        if df.empty: raise Exception("Archivo vacío o corrupto.")

        # Añadir ID interno para trazabilidad
        df = df.reset_index().rename(columns={'index': '_row_id'})

        # Guardar Estado
        session['df_staging'] = df.to_dict('records')
        session['history'] = []
        session['audit_log'] = []
        session['file_id'] = file_id
        session['pay_group_col_name'] = pay_group_col
        
        if os.path.exists(file_path): os.remove(file_path)

        return jsonify({
            "file_id": file_id,
            "columnas": list(df.columns),
            "autocomplete_options": get_autocomplete_options(df)
        })

    except Exception as e:
        if os.path.exists(file_path): os.remove(file_path)
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# 5. RUTAS: LECTURA & AGRUPACIÓN
# ==============================================================================

@app.route('/api/filter', methods=['POST'])
def filter_data():
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

@app.route('/api/group_by', methods=['POST'])
def group_by_data():
    try:
        data = request.json
        _check_file_id(data.get('file_id'))
        
        df = _get_df_from_session_as_df()
        df = aplicar_filtros_dinamicos(df, data.get('filtros_activos'))
        
        col_agrupar = data.get('columna_agrupar')
        if col_agrupar not in df.columns: return jsonify({"error": "Columna inválida"}), 400

        # Preparar agregaciones
        col_monto = _find_monto_column(df)
        
        if col_monto:
            # Limpieza numérica para agregación
            clean = df[col_monto].astype(str).str.replace(r'[$,]', '', regex=True)
            df['_tm'] = pd.to_numeric(clean, errors='coerce').fillna(0)
            
            gb = df.groupby(col_agrupar)['_tm'].agg(['sum', 'mean', 'min', 'max', 'count']).reset_index()
            gb = gb.rename(columns={
                'sum': 'Total_sum', 'mean': 'Total_mean', 
                'min': 'Total_min', 'max': 'Total_max', 'count': 'Total_count'
            })
            # Redondeo
            gb[['Total_sum','Total_mean','Total_min','Total_max']] = gb[['Total_sum','Total_mean','Total_min','Total_max']].round(2)
        else:
            gb = df.groupby(col_agrupar).size().reset_index(name='Total_count')
            # Rellenar vacíos financieros
            for c in ['Total_sum','Total_mean','Total_min','Total_max']: gb[c] = 0

        return jsonify({"data": gb.fillna(0).to_dict('records')})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# 6. RUTAS: EDICIÓN (FILA INDIVIDUAL)
# ==============================================================================

@app.route('/api/update_cell', methods=['POST'])
def update_cell():
    try:
        data = request.json
        _check_file_id(data.get('file_id'))
        row_id_str = str(data.get('row_id'))
        
        # Trabajamos con lista de diccionarios (más rápido para 1 celda)
        datos = session.get('df_staging')
        history = session.get('history', [])
        audit = session.get('audit_log', [])

        changed_row = None
        new_prio = None
        
        for fila in datos:
            if str(fila.get('_row_id')) == row_id_str:
                old = fila.get(data['columna'])
                if old == data['valor']: return jsonify({"status": "no_change"})

                # Historial
                history.append({
                    'action': 'update', 'row_id': row_id_str, 'columna': data['columna'],
                    'old_val': old, 'new_val': data['valor']
                })
                if len(history) > UNDO_STACK_LIMIT: history.pop(0)

                # Auditoría
                audit.append({
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'action': 'Celda Actualizada', 'row_id': row_id_str,
                    'columna': data['columna'], 'valor_anterior': old, 'valor_nuevo': data['valor']
                })

                # Aplicar
                fila[data['columna']] = data['valor']
                fila['_row_status'] = _check_row_completeness(fila)
                changed_row = fila
                break
        
        if not changed_row: return jsonify({"error": "Fila no encontrada"}), 404

        # Recalcular Prioridad (Solo si necesario)
        df = pd.DataFrame.from_records(datos)
        df = _recalculate_priorities(df)
        
        # Extraer la nueva prioridad específica de esta fila
        new_prio_data = df.loc[df['_row_id'].astype(str) == row_id_str]
        if not new_prio_data.empty:
            new_prio = new_prio_data['_priority'].iloc[0]
            
        session['df_staging'] = df.to_dict('records')
        session['history'] = history
        session['audit_log'] = audit

        return jsonify({
            "status": "success",
            "history_count": len(history),
            "resumen": _calculate_kpis(df),
            "new_priority": new_prio,
            "new_row_status": changed_row.get('_row_status')
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/add_row', methods=['POST'])
def add_row():
    try:
        _check_file_id(request.json.get('file_id'))
        data = session.get('df_staging')
        
        # ID Auto-incremental
        max_id = max([int(r.get('_row_id', 0)) for r in data]) if data else 0
        new_id = max_id + 1
        
        # Crear fila vacía con claves existentes
        cols = list(data[0].keys()) if data else ['_row_id', '_priority']
        new_row = {c: "" for c in cols}
        new_row.update({
            '_row_id': new_id, 
            '_row_status': 'Incompleto',
            '_priority': 'Media',
            '_priority_reason': 'Nueva Fila'
        })
        
        data.append(new_row)
        
        # Historial
        hist = session.get('history', [])
        hist.append({'action': 'add', 'row_id': new_id})
        if len(hist) > UNDO_STACK_LIMIT: hist.pop(0)
        
        session['df_staging'] = data
        session['history'] = hist
        
        return jsonify({
            "status": "success", "new_row_id": new_id,
            "history_count": len(hist),
            "resumen": _calculate_kpis(pd.DataFrame.from_records(data))
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/delete_row', methods=['POST'])
def delete_row():
    try:
        rid = str(request.json.get('row_id'))
        _check_file_id(request.json.get('file_id'))
        data = session.get('df_staging')
        
        # Buscar y eliminar
        idx = next((i for i, r in enumerate(data) if str(r.get('_row_id')) == rid), -1)
        if idx == -1: return jsonify({"error": "Fila no encontrada"}), 404
        
        deleted = data.pop(idx)
        
        # Historial
        hist = session.get('history', [])
        hist.append({'action': 'delete', 'deleted_row': deleted, 'original_index': idx})
        if len(hist) > UNDO_STACK_LIMIT: hist.pop(0)
        
        session['df_staging'] = data
        session['history'] = hist
        
        return jsonify({"status": "success", "history_count": len(hist), "resumen": _calculate_kpis(pd.DataFrame.from_records(data))})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# 7. RUTAS: EDICIÓN MASIVA & HERRAMIENTAS
# ==============================================================================

@app.route('/api/bulk_update', methods=['POST'])
def bulk_update():
    try:
        d = request.json
        _check_file_id(d.get('file_id'))
        target_ids = set(str(i) for i in d.get('row_ids', []))
        
        data = session.get('df_staging')
        changes = []
        count = 0
        
        for r in data:
            rid = str(r.get('_row_id'))
            if rid in target_ids:
                old = r.get(d['column'])
                if old != d['new_value']:
                    changes.append({'row_id': rid, 'old_val': old})
                    r[d['column']] = d['new_value']
                    r['_row_status'] = _check_row_completeness(r)
                    count += 1
        
        if count > 0:
            hist = session.get('history', [])
            hist.append({'action': 'bulk_update', 'columna': d['column'], 'new_val': d['new_value'], 'changes': changes})
            session['history'] = hist
            
            df = pd.DataFrame.from_records(data)
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            
            return jsonify({"status": "success", "message": f"{count} filas editadas.", "history_count": len(hist), "resumen": _calculate_kpis(df)})
            
        return jsonify({"status": "no_change"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/find_replace_in_selection', methods=['POST'])
def find_replace():
    try:
        d = request.json
        _check_file_id(d.get('file_id'))
        target_ids = set(str(i) for i in d.get('row_ids', []))
        find_txt = str(d.get('find_text'))
        
        data = session.get('df_staging')
        changes = []
        count = 0
        
        for r in data:
            rid = str(r.get('_row_id'))
            if rid in target_ids:
                old = r.get(d['columna'])
                if str(old) == find_txt: # Coincidencia exacta
                    changes.append({'row_id': rid, 'old_val': old})
                    r[d['columna']] = d['replace_text']
                    r['_row_status'] = _check_row_completeness(r)
                    count += 1
                    
        if count > 0:
            hist = session.get('history', [])
            hist.append({'action': 'find_replace', 'columna': d['columna'], 'new_val': d['replace_text'], 'changes': changes})
            session['history'] = hist
            
            df = pd.DataFrame.from_records(data)
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            
            return jsonify({"status": "success", "message": f"{count} reemplazos.", "history_count": len(hist), "resumen": _calculate_kpis(df)})
            
        return jsonify({"status": "no_change", "message": "Sin coincidencias."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/bulk_delete_rows', methods=['POST'])
def bulk_delete():
    try:
        ids = set(str(i) for i in request.json.get('row_ids', []))
        _check_file_id(request.json.get('file_id'))
        data = session.get('df_staging')
        
        kept = []
        deleted = []
        
        for r in data:
            if str(r.get('_row_id')) in ids: deleted.append(r)
            else: kept.append(r)
            
        if deleted:
            hist = session.get('history', [])
            hist.append({'action': 'bulk_delete', 'deleted_rows': deleted})
            session['history'] = hist
            session['df_staging'] = kept
            
            return jsonify({"status": "success", "message": f"{len(deleted)} eliminadas.", "history_count": len(hist), "resumen": _calculate_kpis(pd.DataFrame.from_records(kept))})
            
        return jsonify({"status": "no_change"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/get_duplicate_invoices', methods=['POST'])
def get_duplicates():
    try:
        _check_file_id(request.json.get('file_id'))
        df = _get_df_from_session_as_df()
        col = _find_invoice_column(df)
        if not col: return jsonify({"error": "No se detectó columna de Factura"}), 400
        
        dupes = df[df.duplicated(subset=[col], keep=False)].sort_values(by=[col])
        return jsonify({"data": dupes.to_dict('records'), "num_filas": len(dupes)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/cleanup_duplicate_invoices', methods=['POST'])
def cleanup_duplicates():
    try:
        _check_file_id(request.json.get('file_id'))
        df = _get_df_from_session_as_df()
        col = _find_invoice_column(df)
        
        mask = df.duplicated(subset=[col], keep='first')
        deleted = df[mask]
        
        if not deleted.empty:
            hist = session.get('history', [])
            hist.append({'action': 'bulk_delete_duplicates', 'deleted_rows': deleted.to_dict('records')})
            session['history'] = hist
            
            df_clean = df[~mask]
            session['df_staging'] = df_clean.to_dict('records')
            
            return jsonify({"status": "success", "message": f"{len(deleted)} eliminados.", "history_count": len(hist), "resumen": _calculate_kpis(df_clean)})
        return jsonify({"status": "no_change"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# 8. RUTAS: REGLAS DE NEGOCIO & LISTAS
# ==============================================================================

@app.route('/api/priority_rules/get', methods=['GET'])
def get_rules():
    return jsonify({"rules": load_rules(), "settings": load_settings()})

@app.route('/api/priority_rules/save_settings', methods=['POST'])
def api_save_settings():
    save_settings(request.json)
    if session.get('df_staging'):
        df = _recalculate_priorities(_get_df_from_session_as_df())
        session['df_staging'] = df.to_dict('records')
    return jsonify({"status": "success"})

@app.route('/api/priority_rules/save', methods=['POST'])
def api_save_rule():
    save_rule(request.json)
    resumen = None
    if session.get('df_staging'):
        df = _recalculate_priorities(_get_df_from_session_as_df())
        session['df_staging'] = df.to_dict('records')
        resumen = _calculate_kpis(df)
    return jsonify({"status": "success", "resumen": resumen})

@app.route('/api/priority_rules/toggle', methods=['POST'])
def api_toggle_rule():
    d = request.json
    toggle_rule(d.get('column'), d.get('value'), d.get('active'))
    if session.get('df_staging'):
        df = _recalculate_priorities(_get_df_from_session_as_df())
        session['df_staging'] = df.to_dict('records')
    return jsonify({"status": "success"})

@app.route('/api/priority_rules/delete', methods=['POST'])
def api_delete_rule():
    d = request.json
    delete_rule(d.get('column'), d.get('value'))
    resumen = None
    if session.get('df_staging'):
        df = _recalculate_priorities(_get_df_from_session_as_df())
        session['df_staging'] = df.to_dict('records')
        resumen = _calculate_kpis(df)
    return jsonify({"status": "success", "resumen": resumen})

@app.route('/api/save_autocomplete_lists', methods=['POST'])
def api_save_lists():
    guardar_json(USER_LISTS_FILE, request.json)
    return jsonify({"status": "success"})

@app.route('/api/import_autocomplete_values', methods=['POST'])
def api_import_autocomplete():
    try:
        data = request.json
        _check_file_id(data.get('file_id'))
        col_name = data.get('column')
        
        df = _get_df_from_session_as_df()
        
        if col_name not in df.columns:
            return jsonify({"error": f"La columna '{col_name}' no existe."}), 400
            
        valores = df[col_name].dropna().astype(str).unique()
        nuevos_valores = sorted([
            v.strip() for v in valores 
            if v.strip() not in ["", "nan", "None"]
        ])
        
        if not nuevos_valores:
            return jsonify({"error": "Columna vacía."}), 400

        current_lists = cargar_json(USER_LISTS_FILE)
        existing_vals = set(current_lists.get(col_name, []))
        existing_vals.update(nuevos_valores)
        
        current_lists[col_name] = sorted(list(existing_vals))
        guardar_json(USER_LISTS_FILE, current_lists)
        
        new_options = get_autocomplete_options(df)
        
        return jsonify({
            "status": "success", 
            "message": f"Importados {len(nuevos_valores)} valores.",
            "autocomplete_options": new_options
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- NUEVA RUTA: IMPORTAR REGLAS MASIVAS (PARA VISTAS) ---
@app.route('/api/priority_rules/import_view', methods=['POST'])
def api_import_view_rules():
    try:
        data = request.json
        rules = data.get('rules', [])
        settings = data.get('settings', {})
        
        # Sobrescribir reglas actuales con las de la vista
        replace_all_rules(rules, settings)
        
        # Recalcular prioridades si hay datos cargados
        df_result = None
        if session.get('df_staging'):
            df = _get_df_from_session_as_df()
            df = _recalculate_priorities(df)
            session['df_staging'] = df.to_dict('records')
            df_result = df
            
        return jsonify({
            "status": "success", 
            "resumen": _calculate_kpis(df_result) if df_result is not None else None
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# 9. RUTAS: HISTORIAL & EXPORTACIÓN
# ==============================================================================

@app.route('/api/undo_change', methods=['POST'])
def undo_change():
    try:
        _check_file_id(request.json.get('file_id'))
        hist = session.get('history', [])
        if not hist: return jsonify({"error": "Nada que deshacer"}), 404
        
        last = hist.pop()
        data = session.get('df_staging')
        affected_id = None
        
        # Restaurar según tipo de acción
        if last['action'] == 'update':
            for r in data:
                if str(r['_row_id']) == str(last['row_id']):
                    r[last['columna']] = last['old_val']
                    r['_row_status'] = _check_row_completeness(r)
                    affected_id = last['row_id']
                    break
        
        elif last['action'] in ('bulk_update', 'find_replace'):
            restore_map = {c['row_id']: c['old_val'] for c in last['changes']}
            for r in data:
                if str(r['_row_id']) in restore_map:
                    r[last['columna']] = restore_map[str(r['_row_id'])]
            affected_id = 'bulk'
            
        elif last['action'] == 'add':
            data = [r for r in data if str(r['_row_id']) != str(last['row_id'])]
            
        elif last['action'] == 'delete':
            data.insert(last['original_index'], last['deleted_row'])
            affected_id = last['deleted_row']['_row_id']
            
        elif last['action'] in ('bulk_delete', 'bulk_delete_duplicates'):
            data.extend(last['deleted_rows'])
            data.sort(key=lambda x: int(x['_row_id']))
            affected_id = 'bulk'

        # Recálculo final
        df = pd.DataFrame.from_records(data)
        df = _recalculate_priorities(df)
        session['df_staging'] = df.to_dict('records')
        session['history'] = hist
        
        return jsonify({
            "status": "success", "history_count": len(hist),
            "resumen": _calculate_kpis(df), "affected_row_id": affected_id
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/commit_changes', methods=['POST'])
def commit_changes():
    _check_file_id(request.json.get('file_id'))
    session['history'] = []
    return jsonify({"status": "success", "message": "Historial limpiado."})

@app.route('/api/download_audit_log', methods=['POST'])
def download_audit():
    _check_file_id(request.json.get('file_id'))
    logs = session.get('audit_log', [])
    sio = io.StringIO()
    sio.write(f"TIMESTAMP\tACCION\tFILA\tCOLUMNA\tVAL_ANT\tVAL_NUEVO\n")
    for l in logs:
        sio.write(f"{l.get('timestamp')}\t{l.get('action')}\t{l.get('row_id')}\t{l.get('columna')}\t{l.get('valor_anterior')}\t{l.get('valor_nuevo')}\n")
    out = io.BytesIO(sio.getvalue().encode('utf-8'))
    out.seek(0)
    return send_file(out, as_attachment=True, download_name='audit_log.txt', mimetype='text/plain')

@app.route('/api/download_excel', methods=['POST'])
def download_excel():
    return _generic_download(request.json, grouped=False)

@app.route('/api/download_excel_grouped', methods=['POST'])
def download_excel_grouped():
    return _generic_download(request.json, grouped=True)

def _generic_download(data, grouped):
    _check_file_id(data.get('file_id'))
    df = _get_df_from_session_as_df()
    df = aplicar_filtros_dinamicos(df, data.get('filtros_activos'))
    
    out = io.BytesIO()
    with pd.ExcelWriter(out, engine='xlsxwriter') as writer:
        if grouped:
            col = data.get('columna_agrupar')
            gb = df.groupby(col).size().reset_index(name='count') # Placeholder simple
            gb.to_excel(writer, index=False)
        else:
            cols = data.get('columnas_visibles', df.columns)
            df[[c for c in cols if c in df.columns]].to_excel(writer, index=False)
            
    out.seek(0)
    name = 'agrupado.xlsx' if grouped else 'filtrado.xlsx'
    return send_file(out, as_attachment=True, download_name=name, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


# ==============================================================================
# 10. ARRANQUE
# ==============================================================================
if __name__ == '__main__':
    app.run(debug=True, port=5000)