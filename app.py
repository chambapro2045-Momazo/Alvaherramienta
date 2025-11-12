# app.py (Versión 10.0 - Estado de Fila Dinámico)

import os
import pandas as pd
import uuid
import io 
import json 
from flask import Flask, request, jsonify, render_template, send_file, session, redirect, url_for
from flask_cors import CORS
from flask_session import Session 

# --- Importar tus módulos ---
# (MODIFICADO v8.0) Importa la lógica de asignación de prioridad
from modules.loader import cargar_datos, _assign_priority 
from modules.filters import aplicar_filtros_dinamicos
from modules.translator import get_text, LANGUAGES
from modules.json_manager import cargar_json, guardar_json, USER_LISTS_FILE 
from modules.autocomplete import get_autocomplete_options

# Límite de la Pila de Deshacer (Undo Stack)
UNDO_STACK_LIMIT = 15

# --- (Función _find_monto_column sin cambios v7.9) ---
def _find_monto_column(df):
    """Intenta encontrar la columna de monto en el DataFrame."""
    possible_names = ['monto', 'total', 'amount', 'total amount']
    for col in df.columns:
        if str(col).lower() in possible_names:
            return col 
    return None 

# --- (Función _check_file_id sin cambios) ---
def _check_file_id(request_file_id):
    """Verifica que el file_id de la petición coincida con el de la sesión."""
    session_file_id = session.get('file_id')
    if not session_file_id:
        session.clear()
        raise Exception("No hay file_id en la sesión. Por favor, cargue un archivo.")
    if session_file_id != request_file_id:
        session.clear()
        raise Exception("El file_id no coincide con la sesión. Por favor, recargue el archivo.")

# --- (Función _calculate_kpis sin cambios v7.9) ---
def _calculate_kpis(df: pd.DataFrame) -> dict:
    """
    Calcula los KPIs (Monto Total, Promedio, Conteo) desde un DataFrame.
    (Lógica "on-the-fly" v7.7/v7.9)
    """
    monto_total = 0.0
    monto_promedio = 0.0
    total_facturas = len(df)
    
    monto_col_name = _find_monto_column(df)

    if monto_col_name and not df.empty:
        try:
            monto_col_str_limpia = df[monto_col_name].astype(str).str.replace(r'[$,]', '', regex=True)
            monto_numerico = pd.to_numeric(monto_col_str_limpia, errors='coerce').fillna(0)
            monto_total = monto_numerico.sum()
            monto_promedio = monto_numerico.mean()
        except Exception as e:
            print(f"Error al calcular resumen (lógica v7.7): {e}")

    return {
        "total_facturas": total_facturas,
        "monto_total": f"${monto_total:,.2f}", 
        "monto_promedio": f"${monto_promedio:,.2f}"
    }

# --- (Funciones _get_df_from_session, _get_df_from_session_as_df sin cambios) ---
def _get_df_from_session(key='df_staging'):
    """Obtiene un DataFrame (en formato lista) desde la sesión de Flask."""
    data_list_of_dicts = session.get(key) 
    if not data_list_of_dicts:
        session.clear() 
        raise Exception(f"No se encontraron datos en la sesión para '{key}'. La sesión se ha limpiado, por favor recargue el archivo.")
    return data_list_of_dicts

def _get_df_from_session_as_df(key='df_staging') -> pd.DataFrame:
    """
    Obtiene un DataFrame (como objeto Pandas) desde la sesión de Flask.
    """
    data_list_of_dicts = _get_df_from_session(key)
    return pd.DataFrame.from_records(data_list_of_dicts)


# --- ¡NUEVA FUNCIÓN v10.0! ---
def _check_row_completeness(fila: dict) -> str:
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Revisa una fila (dict) para determinar si está
    'Completo' o 'Incompleto'. (Lógica v10.0)
    
    La lógica replica la de 'loader.py': una fila es
    incompleta si CUALQUIER celda (que no sea interna)
    está vacía ("") o es cero ("0").
    
    Args:
        fila (dict): El diccionario de la fila.
        
    Returns:
        str: "Completo" o "Incompleto".
    (Documentación de Google: Fin de la función)
    """
    # (Documentación de Google: Itera sobre las celdas)
    for key, value in fila.items():
        # (Documentación de Google: Ignora las columnas internas)
        if key.startswith('_'):
            continue
        
        # (Documentación de Google: Limpia el valor para la comprobación)
        val_str = str(value).strip()
        
        # (Documentación de Google: Comprueba la condición
        #  de "incompleto")
        if val_str == "" or val_str == "0":
            return "Incompleto"
    
    # (Documentación de Google: Si el bucle termina,
    #  la fila está completa)
    return "Completo"
# --- FIN DE NUEVA FUNCIÓN ---


# --- Configuración de Flask (Sin cambios) ---
app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app) 
app.config['SECRET_KEY'] = 'mi-llave-secreta-para-el-buscador-12345'
UPLOAD_FOLDER = 'temp_uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
app.config["SESSION_FILE_DIR"] = os.path.join(UPLOAD_FOLDER, 'flask_session') 
os.makedirs(app.config["SESSION_FILE_DIR"], exist_ok=True)
Session(app)
# --- (Fin de Configuración de Flask) ---


# --- (Context Processor sin cambios) ---
@app.context_processor
def inject_translator():
    lang = session.get('language', 'es') 
    return dict(get_text=get_text, lang=lang)


# --- (Ruta '/' sin cambios) ---
@app.route('/')
def home():
    """
    Renderiza la página principal.
    Pasa el conteo del historial (history_count)
    """
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


# --- (APIs de Idioma sin cambios) ---
@app.route('/api/set_language/<string:lang_code>')
def set_language(lang_code):
    if lang_code in LANGUAGES:
        session['language'] = lang_code 
    return jsonify({"status": "success", "language": lang_code})

@app.route('/api/get_translations')
def get_translations():
    lang = session.get('language', 'es')
    return jsonify(LANGUAGES.get(lang, LANGUAGES['es']))
# --- (Fin de APIs de Idioma) ---


# --- (API /api/upload MODIFICADA v8.0) ---
@app.route('/api/upload', methods=['POST'])
def upload_file():
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Carga el archivo.
    
    Versión 8.0:
    - (¡MODIFICADO!) Ahora `cargar_datos` devuelve (df, pay_group_col_name).
    - (¡MODIFICADO!) Almacena `pay_group_col_name` en la sesión
      para que la API de edición sepa qué columna recalcular.
    (Documentación de Google: Fin de la función)
    """
    if 'file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    file.save(file_path)
    
    try:
        session.clear()
        
        # (Documentación de Google: 1. Llama a cargar_datos)
        df, pay_group_col_name = cargar_datos(file_path)
        
        if df.empty: raise Exception("File is empty or corrupt")
        
        df = df.reset_index().rename(columns={'index': '_row_id'})
        session.clear()
        data_dict_list = df.to_dict('records')
        
        session['df_staging'] = data_dict_list  
        session['history'] = []                 
        session['file_id'] = file_id
        
        # (Documentación de Google: 2. Guarda el nombre de la
        #     columna "Pay Group" en la sesión)
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

# --- (API de Guardado de Listas sin cambios) ---
@app.route('/api/save_autocomplete_lists', methods=['POST'])
def save_autocomplete_lists():
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

# ---
# --- APIS DE EDICIÓN ---
# ---

# --- ¡API /api/update_cell MODIFICADA! ---
@app.route('/api/update_cell', methods=['POST'])
def update_cell():
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Actualiza una celda en 'df_staging', guarda en 'history'
    y recalcula los KPIs.
    
    Versión 10.0:
    - (¡MODIFICADO!) Llama a `_check_row_completeness`
      para recalcular el `_row_status` dinámicamente.
    - (¡MODIFICADO!) Devuelve `new_row_status` al frontend.
    
    Versión 8.0:
    - (¡MODIFICADO!) Recalcula `_priority` si la columna
      "Pay Group" es editada.
    - (¡MODIFICADO!) Devuelve `new_priority`.
    (Documentación de Google: Fin de la función)
    """
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
        
        # (Documentación de Google: Variables para los
        #  nuevos valores dinámicos)
        new_priority_for_frontend = None
        new_status_for_frontend = None
        
        fila_modificada = False
        for fila in datos_staging_lista:
            if str(fila.get('_row_id')) == str(row_id): 
                
                old_val = fila.get(columna)
                
                if old_val == nuevo_valor:
                    df_staging_actual = pd.DataFrame.from_records(datos_staging_lista)
                    resumen_kpis = _calculate_kpis(df_staging_actual)
                    return jsonify({
                        "status": "no_change", 
                        "message": "El valor es el mismo, no se guardó.",
                        "history_count": len(history_stack),
                        "resumen": resumen_kpis,
                        "new_priority": fila.get('_priority'),
                        "new_row_status": fila.get('_row_status') # (v10.0)
                    })

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

                # (Documentación de Google: 1. Actualiza el valor)
                fila[columna] = nuevo_valor
                
                # --- (INICIO LÓGICA DE PRIORIDAD v8.0) ---
                # (Documentación de Google: 2. Obtiene el nombre de la
                #     columna "Pay Group" de la sesión)
                pay_group_col_name = session.get('pay_group_col_name')
                
                # (Documentación de Google: 3. Comprueba si la columna
                #     que acabamos de editar ES la columna "Pay Group")
                if pay_group_col_name and columna == pay_group_col_name:
                    # (Documentación de Google: 4. Sí lo es.
                    #     Recalcula la prioridad de esta fila)
                    fila['_priority'] = _assign_priority(nuevo_valor)
                
                # (Documentación de Google: 5. Guarda la prioridad
                #     actual (nueva o antigua) para devolverla)
                new_priority_for_frontend = fila.get('_priority')
                # --- (FIN LÓGICA DE PRIORIDAD v8.0) ---
                
                # --- (INICIO LÓGICA DE ROW STATUS v10.0) ---
                # (Documentación de Google: 6. Recalcula el estado
                #     de la fila (Completo/Incompleto))
                fila['_row_status'] = _check_row_completeness(fila)
                new_status_for_frontend = fila['_row_status']
                # --- (FIN LÓGICA DE ROW STATUS v10.0) ---
                
                fila_modificada = True
                break 
        
        if not fila_modificada:
            return jsonify({"error": f"No se encontró la fila con _row_id {row_id}"}), 404
            
        session['df_staging'] = datos_staging_lista
        session['history'] = history_stack
        
        df_staging_modificado = pd.DataFrame.from_records(datos_staging_lista)
        resumen_kpis = _calculate_kpis(df_staging_modificado)
        
        return jsonify({
            "status": "success", 
            "message": f"Fila {row_id} actualizada.",
            "history_count": len(history_stack),
            "resumen": resumen_kpis,
            "new_priority": new_priority_for_frontend, # (v8.0)
            "new_row_status": new_status_for_frontend  # (v10.0)
        })

    except Exception as e:
        print(f"Error en /api/update_cell: {e}") 
        return jsonify({"error": str(e)}), 500

# --- ¡API /api/undo_change MODIFICADA! ---
@app.route('/api/undo_change', methods=['POST'])
def undo_change():
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Deshace la última acción.
    
    Versión 10.0:
    - (¡MODIFICADO!) Al deshacer un 'update', también
      recalcula el `_row_status`.
      
    Versión 8.0:
    - (¡MODIFICADO!) Al deshacer un 'update', también
      recalcula la prioridad si la columna afectada
      era la de "Pay Group".
    (Documentación de Google: Fin de la función)
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
        
        if action_type == 'update':
            row_id_to_revert = last_action.get('row_id')
            col_to_revert = last_action.get('columna')
            value_to_restore = last_action.get('old_val') 
            
            fila_revertida = False
            for fila in datos_staging_lista:
                if str(fila.get('_row_id')) == str(row_id_to_revert):
                    # (Documentación de Google: 1. Restaura el valor)
                    fila[col_to_revert] = value_to_restore 
                    
                    # --- (INICIO LÓGICA DE PRIORIDAD v8.0) ---
                    # (Documentación de Google: 2. Comprueba si la
                    #     columna restaurada era la de "Pay Group")
                    pay_group_col_name = session.get('pay_group_col_name')
                    if pay_group_col_name and col_to_revert == pay_group_col_name:
                        # (Documentación de Google: 3. Sí lo era.
                        #     Recalcula la prioridad con el valor antiguo)
                        fila['_priority'] = _assign_priority(value_to_restore)
                    # --- (FIN LÓGICA DE PRIORIDAD v8.0) ---
                    
                    # --- (INICIO LÓGICA DE ROW STATUS v10.0) ---
                    # (Documentación de Google: 4. Recalcula el
                    #     estado de la fila)
                    fila['_row_status'] = _check_row_completeness(fila)
                    # --- (FIN LÓGICA DE ROW STATUS v10.0) ---
                        
                    fila_revertida = True
                    break
            if not fila_revertida:
                raise Exception(f"Error de consistencia: no se encontró la fila {row_id_to_revert} para deshacer update.")
            
            affected_row_id = row_id_to_revert

        elif action_type == 'add':
            # (Documentación de Google: Lógica sin cambios)
            row_id_to_remove = last_action.get('row_id')
            datos_staging_lista = [fila for fila in datos_staging_lista if str(fila.get('_row_id')) != str(row_id_to_remove)]
            
        elif action_type == 'delete':
            # (Documentación de Google: Lógica v7.7 sin cambios.
            # La fila restaurada ya tiene su prioridad y status
            # correctos.)
            row_to_restore = last_action.get('deleted_row')
            original_index = last_action.get('original_index')
            
            if not row_to_restore:
                raise Exception("Error de consistencia: no se encontró 'deleted_row' para deshacer delete.")

            if original_index is not None and original_index >= 0:
                datos_staging_lista.insert(original_index, row_to_restore)
            else:
                datos_staging_lista.append(row_to_restore)
            
            affected_row_id = row_to_restore.get('_row_id')
            
        else:
            raise Exception(f"Tipo de acción desconocida en el historial: {action_type}")
        
        session['history'] = history_stack
        session['df_staging'] = datos_staging_lista
        
        df_staging_revertido = pd.DataFrame.from_records(datos_staging_lista)
        resumen_kpis = _calculate_kpis(df_staging_revertido)
        
        return jsonify({
            "status": "success",
            "message": f"Acción '{action_type}' deshecha.",
            "data": datos_staging_lista, # (Documentación de Google: Devuelve la data actualizada)
            "history_count": len(history_stack),
            "resumen": resumen_kpis,
            "affected_row_id": affected_row_id
        })

    except Exception as e:
        print(f"Error en /api/undo_change: {e}") 
        return jsonify({"error": str(e)}), 500

# --- (API /api/commit_changes sin cambios) ---
@app.route('/api/commit_changes', methods=['POST'])
def commit_changes():
    """
    Consolida los cambios. Limpia el historial de deshacer.
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)
        
        _get_df_from_session('df_staging')
             
        session['history'] = []
        
        return jsonify({
            "status": "success", 
            "message": "Cambios consolidados. El historial de deshacer ha sido limpiado.",
            "history_count": 0
        })
        
    except Exception as e:
        print(f"Error en /api/commit_changes: {e}") 
        return jsonify({"error": str(e)}), 500

# --- (API /api/add_row MODIFICADA v8.0) ---
@app.route('/api/add_row', methods=['POST'])
def add_row():
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Añade una nueva fila en blanco.
    
    Versión 8.0:
    - (¡MODIFICADO!) Asigna `_priority = 'Media'` (default)
      a la nueva fila.
      
    (Documentación de Google: `_row_status` se asigna
     automáticamente como "Incompleto" por la lógica v10.0)
    (Documentación de Google: Fin de la función)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)
        
        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        
        if not datos_staging_lista:
            return jsonify({"error": "No hay datos cargados para añadir una fila."}), 400
            
        columnas = list(datos_staging_lista[0].keys())
        nueva_fila = {col: "" for col in columnas}
        
        max_id = max([int(fila.get('_row_id', 0)) for fila in datos_staging_lista])
        nuevo_id = max_id + 1
        
        nueva_fila['_row_id'] = nuevo_id
        
        # (Documentación de Google: Asigna valores por defecto
        # a las columnas internas)
        
        # (v10.0) Llama a la lógica de status
        nueva_fila['_row_status'] = _check_row_completeness(nueva_fila) 
        # (v8.0) Llama a la lógica de prioridad
        nueva_fila['_priority'] = _assign_priority(None)
        
        datos_staging_lista.append(nueva_fila)
        
        change_obj = {
            'action': 'add',
            'row_id': nuevo_id
        }
        history_stack.append(change_obj)
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)
            
        session['df_staging'] = datos_staging_lista
        session['history'] = history_stack
        
        df_staging_modificado = pd.DataFrame.from_records(datos_staging_lista)
        resumen_kpis = _calculate_kpis(df_staging_modificado)
        
        return jsonify({
            "status": "success", 
            "message": f"Nueva fila añadida (ID: {nuevo_id}).",
            "data": datos_staging_lista,
            "history_count": len(history_stack),
            "resumen": resumen_kpis,
            "new_row_id": nuevo_id
        })
        
    except Exception as e:
        print(f"Error en /api/add_row: {e}") 
        return jsonify({"error": str(e)}), 500

# --- (API /api/delete_row v7.7 sin cambios) ---
@app.route('/api/delete_row', methods=['POST'])
def delete_row():
    """
    Elimina una fila de 'df_staging' (basado en _row_id).
    (Lógica v7.7 sin cambios)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        row_id_to_delete = data.get('row_id')
        _check_file_id(file_id)
        
        if row_id_to_delete is None:
            return jsonify({"error": "Falta row_id"}), 400
            
        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        
        fila_eliminada = None
        nuevos_datos_staging = []
        indice_eliminado = -1 
        
        for i, fila in enumerate(datos_staging_lista):
            if str(fila.get('_row_id')) == str(row_id_to_delete):
                fila_eliminada = fila
                indice_eliminado = i 
            else:
                nuevos_datos_staging.append(fila)
                
        if not fila_eliminada:
            return jsonify({"error": f"No se encontró la fila con _row_id {row_id_to_delete}"}), 404
            
        change_obj = {
            'action': 'delete',
            'deleted_row': fila_eliminada,
            'original_index': indice_eliminado
        }
        history_stack.append(change_obj)
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)
            
        session['df_staging'] = nuevos_datos_staging
        session['history'] = history_stack
        
        df_staging_modificado = pd.DataFrame.from_records(nuevos_datos_staging)
        resumen_kpis = _calculate_kpis(df_staging_modificado)
        
        return jsonify({
            "status": "success", 
            "message": f"Fila {row_id_to_delete} eliminada.",
            "data": nuevos_datos_staging, 
            "history_count": len(history_stack),
            "resumen": resumen_kpis 
        })

    except Exception as e:
        print(f"Error en /api/delete_row: {e}") 
        return jsonify({"error": str(e)}), 500

# --- (API /api/filter sin cambios v7.9) ---
@app.route('/api/filter', methods=['POST'])
def filter_data():
    """
    Filtra el 'df_staging' y devuelve los resultados Y los KPIs.
    (Documentación de Google: Esta API filtrará por _priority
     y _row_status automáticamente si el frontend lo envía)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')

        _check_file_id(file_id)
        df_staging = _get_df_from_session_as_df('df_staging')

        resultado_df_filtrado = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)

        resumen_stats = _calculate_kpis(resultado_df_filtrado)

        resultado_json = resultado_df_filtrado.to_dict(orient="records") 
        return jsonify({ 
            "data": resultado_json, 
            "num_filas": len(resultado_df_filtrado),
            "resumen": resumen_stats
        })

    except Exception as e:
        print(f"Error en /api/filter: {e}") 
        return jsonify({"error": str(e)}), 500

# --- (API /api/download_excel sin cambios v7.9) ---
@app.route('/api/download_excel', methods=['POST'])
def download_excel():
    """
    Descarga la vista detallada (filtrada) actual.
    (Documentación de Google: Exportará las columnas _priority
     y _row_status si están visibles)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')
        columnas_visibles = data.get('columnas_visibles') 

        _check_file_id(file_id)
        df_staging = _get_df_from_session_as_df('df_staging')

        resultado_df = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)
        
        df_a_exportar = resultado_df
        if columnas_visibles and isinstance(columnas_visibles, list):
             if '_row_id' in resultado_df.columns and '_row_id' not in columnas_visibles:
                 columnas_visibles.append('_row_id')
                 
             columnas_existentes = [col for col in columnas_visibles if col in resultado_df.columns]
             if columnas_existentes:
                 df_a_exportar = resultado_df[columnas_existentes]

        if '_row_id' in df_a_exportar.columns:
            df_a_exportar['_row_id'] = df_a_exportar['_row_id'].astype(int) + 1
            df_a_exportar = df_a_exportar.rename(columns={'_row_id': 'N° Fila'})
            
            cols = list(df_a_exportar.columns)
            cols.insert(0, cols.pop(cols.index('N° Fila')))
            df_a_exportar = df_a_exportar[cols]

        output_buffer = io.BytesIO()
        with pd.ExcelWriter(output_buffer, engine='xlsxwriter') as writer:
            df_a_exportar.to_excel(writer, sheet_name='Resultados', index=False)
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

# --- (API /api/group_by sin cambios v7.9) ---
@app.route('/api/group_by', methods=['POST'])
def group_data():
    """
    (Documentación de Google: Esta API agrupará por _priority
     y _row_status automáticamente si el frontend lo envía)
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')
        columna_agrupar = data.get('columna_agrupar') 

        _check_file_id(file_id)
        df_staging = _get_df_from_session_as_df('df_staging')
        
        if not columna_agrupar: return jsonify({"error": "Missing 'columna_agrupar'"}), 400
        
        resultado_df = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)

        if resultado_df.empty:
            return jsonify({ "data": [] }) 

        monto_col_name = _find_monto_column(resultado_df)
        if monto_col_name:
            resultado_df = resultado_df.rename(columns={monto_col_name: 'Total'})
        elif 'Total' not in resultado_df.columns:
            resultado_df['Total'] = 0
        
        resultado_df['Total'] = pd.to_numeric(resultado_df['Total'], errors='coerce')
        resultado_df['Total'] = resultado_df['Total'].fillna(0)

        agg_operations = {
            'Total': ['sum', 'mean', 'min', 'max', 'count']
        }

        df_agrupado = resultado_df.groupby(columna_agrupar).agg(agg_operations)
        df_agrupado.columns = [f"{col[0]}_{col[1]}" for col in df_agrupado.columns]
        df_agrupado = df_agrupado.reset_index()
        df_agrupado = df_agrupado.sort_values(by='Total_sum', ascending=False)

        resultado_json = df_agrupado.to_dict(orient="records")
        return jsonify({ "data": resultado_json })

    except KeyError as e:
        print(f"Error en /api/group_by: Columna '{e}' no encontrada.")
        return jsonify({"error": f"La columna '{e}' no se encontró en el archivo."}), 404
    except Exception as e:
        print(f"Error en /api/group_by: {e}") 
        return jsonify({"error": str(e)}), 500
    
# --- (API /api/download_excel_grouped sin cambios v7.9) ---
@app.route('/api/download_excel_grouped', methods=['POST'])
def download_excel_grouped():
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')
        columna_agrupar = data.get('columna_agrupar')

        _check_file_id(file_id)
        df_staging = _get_df_from_session_as_df('df_staging')

        if not columna_agrupar: return jsonify({"error": "Missing 'columna_agrupar'"}), 400
        
        resultado_df = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)

        if resultado_df.empty:
            return jsonify({"error": "No data found for these filters"}), 404

        monto_col_name = _find_monto_column(resultado_df)
        if monto_col_name:
            resultado_df = resultado_df.rename(columns={monto_col_name: 'Total'})
        elif 'Total' not in resultado_df.columns:
            resultado_df['Total'] = 0
                
        resultado_df['Total'] = pd.to_numeric(resultado_df['Total'], errors='coerce').fillna(0)

        agg_operations = {
            'Total': ['sum', 'mean', 'min', 'max', 'count']
        }
        df_agrupado = resultado_df.groupby(columna_agrupar).agg(agg_operations)
        df_agrupado.columns = [f"{col[0]}_{col[1]}" for col in df_agrupado.columns]
        df_agrupado = df_agrupado.reset_index()
        df_agrupado = df_agrupado.sort_values(by='Total_sum', ascending=False)

        lang = session.get('language', 'es')
        df_agrupado = df_agrupado.rename(columns={
            columna_agrupar: columna_agrupar.replace('_row_status', 'Row Status').replace('_priority', 'Prioridad'), # (Traduce la columna)
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
            download_name=f'agrupado_por_{columna_agrupar}.xlsx',
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        print(f"Error en /api/download_excel_grouped: {e}") 
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000, reloader_type="stat")