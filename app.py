"""
app.py
------

Controlador principal de la aplicación Flask "Mi Nuevo Buscador Web".

Este módulo gestiona:
1. La configuración del servidor y sesiones.
2. Las rutas para renderizar la interfaz (HTML).
3. La API REST para manipulación de datos (Upload, Filtros, Edición, Bulk Update).
4. La lógica de negocio para el cálculo de KPIs y gestión del historial de deshacer.
"""

import os
import io
import uuid
import json
import pandas as pd
from flask import Flask, request, jsonify, render_template, send_file, session
from flask_cors import CORS
from flask_session import Session

# --- Módulos del Proyecto ---
from modules.loader import cargar_datos, _assign_priority
from modules.filters import aplicar_filtros_dinamicos
from modules.translator import get_text, LANGUAGES
from modules.json_manager import guardar_json, USER_LISTS_FILE
from modules.autocomplete import get_autocomplete_options

# --- Constantes Globales ---
UNDO_STACK_LIMIT = 15
UPLOAD_FOLDER = 'temp_uploads'

# ==============================================================================
# FUNCIONES AUXILIARES (HELPERS)
# ==============================================================================

def _find_monto_column(df: pd.DataFrame) -> str | None:
    """Busca una columna candidata para representar el monto/dinero.

    Args:
        df (pd.DataFrame): El DataFrame a inspeccionar.

    Returns:
        str | None: El nombre de la columna encontrada o None.
    """
    possible_names = ['monto', 'total', 'amount', 'total amount']
    for col in df.columns:
        if str(col).lower() in possible_names:
            return col
    return None


def _check_file_id(request_file_id: str) -> None:
    """Valida que el ID del archivo de la petición coincida con la sesión activa.

    Args:
        request_file_id (str): El ID enviado por el cliente.

    Raises:
        Exception: Si no hay sesión o los IDs no coinciden.
    """
    session_file_id = session.get('file_id')
    if not session_file_id:
        session.clear()
        raise Exception("No hay file_id en la sesión. Por favor, cargue un archivo.")
    if session_file_id != request_file_id:
        session.clear()
        raise Exception("El file_id no coincide con la sesión. Recargue el archivo.")


def _calculate_kpis(df: pd.DataFrame) -> dict:
    """Calcula los indicadores clave (KPIs) del DataFrame actual.

    Args:
        df (pd.DataFrame): Datos actuales (filtrados o totales).

    Returns:
        dict: Diccionario con 'total_facturas', 'monto_total' y 'monto_promedio'.
    """
    monto_total = 0.0
    monto_promedio = 0.0
    total_facturas = len(df)

    monto_col_name = _find_monto_column(df)

    if monto_col_name and not df.empty:
        try:
            # Limpieza básica de caracteres de moneda
            monto_col_str_limpia = df[monto_col_name].astype(str).str.replace(r'[$,]', '', regex=True)
            monto_numerico = pd.to_numeric(monto_col_str_limpia, errors='coerce').fillna(0)
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
    """Recupera el dataset de la sesión como una lista de diccionarios.

    Args:
        key (str): La clave de sesión donde se guardan los datos.

    Returns:
        list[dict]: La lista de filas (registros).

    Raises:
        Exception: Si no hay datos en la sesión.
    """
    data_list_of_dicts = session.get(key)
    if not data_list_of_dicts:
        session.clear()
        raise Exception(f"Sesión expirada o vacía para '{key}'. Recargue el archivo.")
    return data_list_of_dicts


def _get_df_from_session_as_df(key: str = 'df_staging') -> pd.DataFrame:
    """Recupera el dataset de la sesión como un DataFrame de Pandas."""
    data_list_of_dicts = _get_df_from_session(key)
    return pd.DataFrame.from_records(data_list_of_dicts)


def _check_row_completeness(fila: dict) -> str:
    """Evalúa si una fila está completa basándose en sus valores.

    Args:
        fila (dict): La fila a evaluar.

    Returns:
        str: 'Completo' si no hay celdas vacías, 'Incompleto' en caso contrario.
    """
    for key, value in fila.items():
        if key.startswith('_'):
            continue
        val_str = str(value).strip()
        if val_str == "" or val_str == "0":
            return "Incompleto"
    return "Completo"


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
    """Inyecta funciones de traducción en todas las plantillas."""
    lang = session.get('language', 'es')
    return dict(get_text=get_text, lang=lang)


# ==============================================================================
# RUTAS PRINCIPALES
# ==============================================================================

@app.route('/')
def home():
    """Renderiza la página principal de la aplicación."""
    session_data = {
        "file_id": session.get('file_id'),
        "columnas": [],
        "autocomplete_options": {},
        "history_count": len(session.get('history', []))
    }

    df_staging_data = session.get('df_staging')

    if df_staging_data and isinstance(df_staging_data, list) and len(df_staging_data) > 0:
        session_data["columnas"] = list(df_staging_data[0].keys())
        df_para_escanear = pd.DataFrame.from_records(df_staging_data)
        session_data["autocomplete_options"] = get_autocomplete_options(df_para_escanear)

    return render_template('index.html', session_data=session_data)


@app.route('/api/set_language/<string:lang_code>')
def set_language(lang_code):
    """Establece el idioma de la sesión."""
    if lang_code in LANGUAGES:
        session['language'] = lang_code
    return jsonify({"status": "success", "language": lang_code})


@app.route('/api/get_translations')
def get_translations():
    """Devuelve el diccionario de traducciones para el idioma actual."""
    lang = session.get('language', 'es')
    return jsonify(LANGUAGES.get(lang, LANGUAGES['es']))


# ==============================================================================
# API: GESTIÓN DE ARCHIVOS Y LISTAS
# ==============================================================================

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Procesa la carga de un archivo Excel inicial."""
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
        df, pay_group_col_name = cargar_datos(file_path)

        if df.empty:
            raise Exception("El archivo está vacío o corrupto.")

        # Añadir ID interno de fila
        df = df.reset_index().rename(columns={'index': '_row_id'})
        
        session.clear()
        data_dict_list = df.to_dict('records')

        session['df_staging'] = data_dict_list
        session['history'] = []
        session['file_id'] = file_id
        session['pay_group_col_name'] = pay_group_col_name

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
    """Guarda las listas de autocompletado personalizadas del usuario."""
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
# API: EDICIÓN Y MANIPULACIÓN DE DATOS
# ==============================================================================

@app.route('/api/update_cell', methods=['POST'])
def update_cell():
    """Actualiza el valor de una celda individual y registra el cambio en historial."""
    try:
        data = request.json
        file_id = data.get('file_id')
        row_id = data.get('row_id')
        columna = data.get('columna')
        nuevo_valor = data.get('valor')

        _check_file_id(file_id)
        if row_id is None or columna is None:
            return jsonify({"error": "Faltan row_id o columna"}), 400

        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])

        new_priority_for_frontend = None
        new_status_for_frontend = None

        fila_modificada = False
        for fila in datos_staging_lista:
            if str(fila.get('_row_id')) == str(row_id):
                old_val = fila.get(columna)

                if old_val == nuevo_valor:
                    # Sin cambios reales, recalcula KPIs y retorna
                    df_staging_actual = pd.DataFrame.from_records(datos_staging_lista)
                    return jsonify({
                        "status": "no_change",
                        "message": "El valor es el mismo.",
                        "history_count": len(history_stack),
                        "resumen": _calculate_kpis(df_staging_actual),
                        "new_priority": fila.get('_priority'),
                        "new_row_status": fila.get('_row_status')
                    })

                # Registrar cambio para deshacer
                change_obj = {
                    'action': 'update',
                    'row_id': row_id,
                    'columna': columna,
                    'old_val': old_val,
                    'new_val': nuevo_valor
                }
                history_stack.append(change_obj)
                if len(history_stack) > UNDO_STACK_LIMIT:
                    history_stack.pop(0)

                # Aplicar cambio
                fila[columna] = nuevo_valor

                # Recalcular lógica de negocio (Prioridad y Status)
                pay_group_col_name = session.get('pay_group_col_name')
                if pay_group_col_name and columna == pay_group_col_name:
                    fila['_priority'] = _assign_priority(nuevo_valor)
                new_priority_for_frontend = fila.get('_priority')

                fila['_row_status'] = _check_row_completeness(fila)
                new_status_for_frontend = fila['_row_status']

                fila_modificada = True
                break

        if not fila_modificada:
            return jsonify({"error": f"No se encontró la fila con _row_id {row_id}"}), 404

        session['df_staging'] = datos_staging_lista
        session['history'] = history_stack

        df_staging_modificado = pd.DataFrame.from_records(datos_staging_lista)
        
        return jsonify({
            "status": "success",
            "message": f"Fila {row_id} actualizada.",
            "history_count": len(history_stack),
            "resumen": _calculate_kpis(df_staging_modificado),
            "new_priority": new_priority_for_frontend,
            "new_row_status": new_status_for_frontend
        })

    except Exception as e:
        print(f"Error en /api/update_cell: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/bulk_update', methods=['POST'])
def bulk_update():
    """Actualiza múltiples filas con el mismo valor (Edición Masiva)."""
    try:
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
        pay_group_col_name = session.get('pay_group_col_name')

        changes_list = []
        count_updated = 0
        target_ids = set(str(rid) for rid in row_ids_to_update)

        for fila in datos_staging_lista:
            rid = str(fila.get('_row_id'))
            if rid in target_ids:
                old_val = fila.get(columna)

                if old_val != nuevo_valor:
                    # Guardar estado anterior para deshacer
                    changes_list.append({'row_id': rid, 'old_val': old_val})

                    # Actualizar
                    fila[columna] = nuevo_valor

                    # Recalcular lógica de negocio
                    if pay_group_col_name and columna == pay_group_col_name:
                        fila['_priority'] = _assign_priority(nuevo_valor)
                    fila['_row_status'] = _check_row_completeness(fila)
                    
                    count_updated += 1

        if count_updated > 0:
            bulk_action_obj = {
                'action': 'bulk_update',
                'columna': columna,
                'new_val': nuevo_valor,
                'changes': changes_list
            }
            history_stack.append(bulk_action_obj)
            if len(history_stack) > UNDO_STACK_LIMIT:
                history_stack.pop(0)

            session['df_staging'] = datos_staging_lista
            session['history'] = history_stack

            df_mod = pd.DataFrame.from_records(datos_staging_lista)
            return jsonify({
                "status": "success",
                "message": f"Se actualizaron {count_updated} filas.",
                "history_count": len(history_stack),
                "resumen": _calculate_kpis(df_mod)
            })
        else:
            return jsonify({
                "status": "no_change",
                "message": "No se realizaron cambios.",
                "history_count": len(history_stack)
            })

    except Exception as e:
        print(f"Error en /api/bulk_update: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/undo_change', methods=['POST'])
def undo_change():
    """Deshace la última acción registrada en el historial (individual, bulk, add, delete)."""
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
        pay_group_col_name = session.get('pay_group_col_name')
        affected_row_id = None

        if action_type == 'update':
            # Revertir edición individual
            row_id = last_action.get('row_id')
            col = last_action.get('columna')
            old_val = last_action.get('old_val')

            for fila in datos_staging_lista:
                if str(fila.get('_row_id')) == str(row_id):
                    fila[col] = old_val
                    if pay_group_col_name and col == pay_group_col_name:
                        fila['_priority'] = _assign_priority(old_val)
                    fila['_row_status'] = _check_row_completeness(fila)
                    affected_row_id = row_id
                    break

        elif action_type == 'bulk_update':
            # Revertir edición masiva
            col = last_action.get('columna')
            changes = last_action.get('changes', [])
            changes_map = {c['row_id']: c['old_val'] for c in changes}

            for fila in datos_staging_lista:
                rid = str(fila.get('_row_id'))
                if rid in changes_map:
                    val_restore = changes_map[rid]
                    fila[col] = val_restore
                    if pay_group_col_name and col == pay_group_col_name:
                        fila['_priority'] = _assign_priority(val_restore)
                    fila['_row_status'] = _check_row_completeness(fila)

        elif action_type == 'add':
            # Revertir añadir fila (eliminarla)
            rid_remove = last_action.get('row_id')
            datos_staging_lista = [f for f in datos_staging_lista if str(f.get('_row_id')) != str(rid_remove)]

        elif action_type == 'delete':
            # Revertir eliminar fila (restaurarla)
            row_restore = last_action.get('deleted_row')
            orig_idx = last_action.get('original_index')
            if orig_idx is not None and 0 <= orig_idx <= len(datos_staging_lista):
                datos_staging_lista.insert(orig_idx, row_restore)
            else:
                datos_staging_lista.append(row_restore)
            affected_row_id = row_restore.get('_row_id')

        else:
            raise Exception(f"Acción desconocida: {action_type}")

        session['history'] = history_stack
        session['df_staging'] = datos_staging_lista

        df_rev = pd.DataFrame.from_records(datos_staging_lista)
        return jsonify({
            "status": "success",
            "message": f"Acción '{action_type}' deshecha.",
            "history_count": len(history_stack),
            "resumen": _calculate_kpis(df_rev),
            "affected_row_id": affected_row_id
        })

    except Exception as e:
        print(f"Error en /api/undo_change: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/commit_changes', methods=['POST'])
def commit_changes():
    """Limpia el historial de deshacer, consolidando el estado actual."""
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)
        _get_df_from_session('df_staging') # Verifica que existan datos
        session['history'] = []
        return jsonify({
            "status": "success",
            "message": "Cambios consolidados. Historial limpiado.",
            "history_count": 0
        })
    except Exception as e:
        print(f"Error en /api/commit_changes: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/add_row', methods=['POST'])
def add_row():
    """Añade una nueva fila vacía al final del dataset."""
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])

        if not datos_staging_lista:
            return jsonify({"error": "No hay datos para añadir fila."}), 400

        columnas = list(datos_staging_lista[0].keys())
        nueva_fila = {col: "" for col in columnas}

        # Generar nuevo ID (max + 1)
        max_id = max([int(f.get('_row_id', 0)) for f in datos_staging_lista])
        nuevo_id = max_id + 1

        nueva_fila['_row_id'] = nuevo_id
        nueva_fila['_row_status'] = _check_row_completeness(nueva_fila)
        nueva_fila['_priority'] = _assign_priority(None)

        datos_staging_lista.append(nueva_fila)

        history_stack.append({'action': 'add', 'row_id': nuevo_id})
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)

        session['df_staging'] = datos_staging_lista
        session['history'] = history_stack

        df_mod = pd.DataFrame.from_records(datos_staging_lista)
        return jsonify({
            "status": "success",
            "message": f"Nueva fila añadida (ID: {nuevo_id}).",
            "history_count": len(history_stack),
            "resumen": _calculate_kpis(df_mod),
            "new_row_id": nuevo_id
        })

    except Exception as e:
        print(f"Error en /api/add_row: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/delete_row', methods=['POST'])
def delete_row():
    """Elimina una fila específica por su ID."""
    try:
        data = request.json
        file_id = data.get('file_id')
        row_id = data.get('row_id')
        _check_file_id(file_id)

        if row_id is None:
            return jsonify({"error": "Falta row_id"}), 400

        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])

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
            'action': 'delete',
            'deleted_row': fila_eliminada,
            'original_index': indice_eliminado
        })
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)

        session['df_staging'] = nuevos_datos
        session['history'] = history_stack

        df_mod = pd.DataFrame.from_records(nuevos_datos)
        return jsonify({
            "status": "success",
            "message": f"Fila {row_id} eliminada.",
            "history_count": len(history_stack),
            "resumen": _calculate_kpis(df_mod)
        })

    except Exception as e:
        print(f"Error en /api/delete_row: {e}")
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# API: FILTRADO Y EXPORTACIÓN
# ==============================================================================

@app.route('/api/filter', methods=['POST'])
def filter_data():
    """Aplica filtros dinámicos a los datos y devuelve el resultado y KPIs."""
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
    """Genera y descarga un Excel con los datos filtrados actuales."""
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros = data.get('filtros_activos')
        columnas_visibles = data.get('columnas_visibles')

        _check_file_id(file_id)
        df = _get_df_from_session_as_df('df_staging')

        df_filtrado = aplicar_filtros_dinamicos(df, filtros)
        df_exportar = df_filtrado.copy()

        # Filtrar columnas visibles si se especifican
        if columnas_visibles and isinstance(columnas_visibles, list):
            if '_row_id' in df_exportar.columns and '_row_id' not in columnas_visibles:
                columnas_visibles.append('_row_id')
            
            cols_existentes = [c for c in columnas_visibles if c in df_exportar.columns]
            if cols_existentes:
                df_exportar = df_exportar[cols_existentes]

        # Formatear N° Fila para exportación (1-based)
        if '_row_id' in df_exportar.columns:
            df_exportar['_row_id'] = df_exportar['_row_id'].astype(int) + 1
            df_exportar = df_exportar.rename(columns={'_row_id': 'N° Fila'})
            # Mover al principio
            cols = list(df_exportar.columns)
            cols.insert(0, cols.pop(cols.index('N° Fila')))
            df_exportar = df_exportar[cols]

        output_buffer = io.BytesIO()
        with pd.ExcelWriter(output_buffer, engine='xlsxwriter') as writer:
            df_exportar.to_excel(writer, sheet_name='Resultados', index=False)
        output_buffer.seek(0)

        return send_file(
            output_buffer,
            as_attachment=True,
            download_name='facturas_filtradas.xlsx',
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        print(f"Error en /api/download_excel: {e}")
        return "Error al generar el Excel", 500


@app.route('/api/group_by', methods=['POST'])
def group_data():
    """Agrupa los datos por una columna y devuelve estadísticas agregadas."""
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

        # Preparar columna de monto para agregación
        monto_col = _find_monto_column(df_filtrado)
        if monto_col:
            df_filtrado = df_filtrado.rename(columns={monto_col: 'Total'})
        elif 'Total' not in df_filtrado.columns:
            df_filtrado['Total'] = 0
        
        df_filtrado['Total'] = pd.to_numeric(df_filtrado['Total'], errors='coerce').fillna(0)

        # Agregación
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
    """Descarga el Excel de la vista agrupada."""
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
            df_filtrado = df_filtrado.rename(columns={monto_col: 'Total'})
        elif 'Total' not in df_filtrado.columns:
            df_filtrado['Total'] = 0
        
        df_filtrado['Total'] = pd.to_numeric(df_filtrado['Total'], errors='coerce').fillna(0)

        df_agrupado = df_filtrado.groupby(col_agrupar).agg({
            'Total': ['sum', 'mean', 'min', 'max', 'count']
        })
        df_agrupado.columns = [f"{c[0]}_{c[1]}" for c in df_agrupado.columns]
        df_agrupado = df_agrupado.reset_index().sort_values(by='Total_sum', ascending=False)

        # Traducir encabezados para el Excel
        lang = session.get('language', 'es')
        df_agrupado = df_agrupado.rename(columns={
            col_agrupar: col_agrupar.replace('_row_status', 'Row Status').replace('_priority', 'Prioridad'),
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


if __name__ == '__main__':
    app.run(debug=True, port=5000, reloader_type="stat")