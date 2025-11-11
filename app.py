# app.py (Versión 7.7 - Restaurar fila en la posición original)

import os
import pandas as pd
import uuid
import io 
import json 
from flask import Flask, request, jsonify, render_template, send_file, session, redirect, url_for
from flask_cors import CORS
from flask_session import Session 

# --- Importar tus módulos ---
from modules.loader import cargar_datos
from modules.filters import aplicar_filtros_dinamicos
from modules.translator import get_text, LANGUAGES
from modules.json_manager import cargar_json, guardar_json 

# Ruta al archivo de autocompletado
USER_LISTS_FILE = 'user_autocomplete.json'
# Límite de la Pila de Deshacer (Undo Stack)
UNDO_STACK_LIMIT = 15

# --- (Función _find_monto_column sin cambios) ---
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

# --- (Función _calculate_kpis sin cambios) ---
def _calculate_kpis(df: pd.DataFrame) -> dict:
    """
    Calcula los KPIs (Monto Total, Promedio, Conteo) desde un DataFrame.
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
            print(f"Error al calcular resumen: {e}")

    return {
        "total_facturas": total_facturas,
        "monto_total": f"${monto_total:,.2f}", 
        "monto_promedio": f"${monto_promedio:,.2f}"
    }

# --- (Función cargar_listas_usuario sin cambios) ---
def cargar_listas_usuario():
    """Carga las listas personalizadas desde user_autocomplete.json"""
    return cargar_json(USER_LISTS_FILE)

# --- (Función get_autocomplete_options v7.5 sin cambios) ---
def get_autocomplete_options(df: pd.DataFrame) -> dict:
    """
    Toma un DataFrame y genera las opciones de autocompletado
    fusionándolas con las listas guardadas por el usuario.
    
    ¡NUEVO! Esta lógica (v7.5) usa dict.get() para ser 100%
    segura contra KeyErrors, incluso si el archivo JSON
    no tiene las claves.

    Args:
        df (pd.DataFrame): El DataFrame del cual extraer los valores únicos.

    Returns:
        dict: Un diccionario donde la clave es el nombre REAL de la columna
              del DataFrame (ej. "Pay Group") y el valor es la lista de opciones.
    """
    # 1. Carga las listas que el usuario haya guardado permanentemente.
    #    (Garantizado por cargar_json() que esto es un dict).
    listas_de_usuario = cargar_json(USER_LISTS_FILE)
    
    # 2. Prepara el diccionario de respuesta.
    autocomplete_options = {}

    # 3. Define la lista "CANÓNICA" de columnas que queremos con autocompletado.
    #    (Estos son los nombres "ideales" que buscaremos en el JSON).
    columnas_target_canonicas = [
        "Vendor Name", "Status", "Assignee", 
        "Operating Unit Name", "Pay Status", "Document Type", "_row_status",
        "Pay group", "WEC Email Inbox", "Sender Email", 
        "Currency Code", "payment method"
    ]
    
    # 4. Crea un mapa de las columnas *reales* del Excel (en minúsculas)
    #    a su nombre real (con mayúsculas).
    #    (Ej: {"pay group": "Pay Group", "status": "Status"})
    df_cols_lower_map = {col.lower(): col for col in df.columns}

    # 5. Itera sobre la lista "CANÓNICA" (nuestra lista de deseos).
    for canonical_name in columnas_target_canonicas:
        
        # 6. Prepara el 'set' para combinar opciones para esta columna.
        opciones_combinadas = set()
        
        # --- ¡LÓGICA DE CORRECCIÓN (INICIO)! ---
        # 7. (Prioridad 1) Obtiene las listas del JSON de forma segura.
        #    Usa .get() para buscar la lista. Si "Pay group" no existe
        #    en el JSON, .get() devuelve 'None' (o una lista vacía).
        #    Esto NUNCA lanzará un KeyError.
        lista_guardada = listas_de_usuario.get(canonical_name)
        
        # 8. Si la lista guardada existe (no es None) y es una lista,
        #    añade su contenido.
        if isinstance(lista_guardada, list):
            opciones_combinadas.update(lista_guardada)
        # --- ¡LÓGICA DE CORRECCIÓN (FIN)! ---

        # 9. (Prioridad 2) Busca la columna correspondiente en el Excel,
        #    ignorando mayúsculas/minúsculas.
        #    (Ej. busca "pay group" en el mapa de columnas del Excel).
        df_col_name_real = df_cols_lower_map.get(canonical_name.lower())
        
        # 10. Si encontramos la columna en el Excel (ej. "Pay Group")...
        if df_col_name_real:
            # Escanea el DataFrame usando el nombre REAL (ej. "Pay Group").
            valores_unicos_excel = df[df_col_name_real].astype(str).unique()
            opciones_limpias_excel = [
                val for val in valores_unicos_excel 
                if val and pd.notna(val) and val.strip() != ""
            ]
            # Añade los valores del Excel al 'set'.
            opciones_combinadas.update(opciones_limpias_excel)
        
        # 11. Si al final tenemos opciones (del JSON o del Excel)...
        if opciones_combinadas:
            # 12. Asigna la lista de opciones al diccionario final.
            #     Usamos el nombre real del Excel si existe, si no,
            #     usamos el nombre canónico (para listas solo-JSON).
            key_name = df_col_name_real if df_col_name_real else canonical_name
            autocomplete_options[key_name] = sorted(list(opciones_combinadas))
             
    # 13. Devuelve el diccionario completo.
    return autocomplete_options

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


# --- (API de carga sin cambios) ---
@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    file.save(file_path)
    
    try:
        session.clear()
        df = cargar_datos(file_path)
        if df.empty: raise Exception("File is empty or corrupt")
        
        df = df.reset_index().rename(columns={'index': '_row_id'})
        session.clear()
        data_dict_list = df.to_dict('records')
        
        session['df_staging'] = data_dict_list  
        session['history'] = []                 
        session['file_id'] = file_id

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

# --- (API /api/update_cell sin cambios) ---
@app.route('/api/update_cell', methods=['POST'])
def update_cell():
    """
    Actualiza una celda en 'df_staging', guarda en 'history'
    y recalcula los KPIs.
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
                        "resumen": resumen_kpis 
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

                fila[columna] = nuevo_valor
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
            "resumen": resumen_kpis 
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
    Deshace la última acción (update, add, o delete) de 'history'
    y la revierte en 'df_staging'.
    
    Versión 7.7:
    - 'undo update': (Sin cambios) revierte el valor de la celda.
    - 'undo add': (Sin cambios) elimina la fila añadida.
    - 'undo delete': (¡MODIFICADO!) Re-inserta la fila eliminada
      en su 'original_index' (posición original en la lista),
      en lugar de añadirla al final.
    
    Devuelve:
    - JSON con el estado, KPIs, y el 'affected_row_id' para
      que el frontend pueda hacer scroll a la fila modificada.
    (Documentación de Google: Fin de la función)
    """
    try:
        # --- (Inicio de la función sin cambios) ---
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        history_stack = session.get('history', [])
        if not history_stack:
            return jsonify({"error": "No hay nada que deshacer."}), 404
            
        last_action = history_stack.pop()
        action_type = last_action.get('action')
        
        datos_staging_lista = _get_df_from_session('df_staging')
        # --- (Fin de la parte sin cambios) ---
        
        affected_row_id = None
        
        if action_type == 'update':
            # --- (Lógica de 'update' sin cambios) ---
            row_id_to_revert = last_action.get('row_id')
            col_to_revert = last_action.get('columna')
            value_to_restore = last_action.get('old_val') 
            
            fila_revertida = False
            for fila in datos_staging_lista:
                if str(fila.get('_row_id')) == str(row_id_to_revert):
                    fila[col_to_revert] = value_to_restore 
                    fila_revertida = True
                    break
            if not fila_revertida:
                raise Exception(f"Error de consistencia: no se encontró la fila {row_id_to_revert} para deshacer update.")
            
            affected_row_id = row_id_to_revert

        elif action_type == 'add':
            # --- (Lógica de 'add' sin cambios) ---
            row_id_to_remove = last_action.get('row_id')
            datos_staging_lista = [fila for fila in datos_staging_lista if str(fila.get('_row_id')) != str(row_id_to_remove)]
            
        elif action_type == 'delete':
            # --- ¡INICIO DE LA CORRECCIÓN (v7.7)! ---
            # (Documentación de Google: Lógica de 'undo delete')
            
            # 1. (Sin cambios) Obtiene la fila que guardamos.
            row_to_restore = last_action.get('deleted_row')
            # 2. (NUEVO v7.7) Obtiene el índice original que guardamos.
            original_index = last_action.get('original_index')
            
            # 3. (Sin cambios) Validación.
            if not row_to_restore:
                raise Exception("Error de consistencia: no se encontró 'deleted_row' para deshacer delete.")

            # 4. (¡MODIFICADO! v7.7)
            #    Comprueba si tenemos un índice válido.
            if original_index is not None and original_index >= 0:
                # Si tenemos el índice (ej. 19), re-inserta la fila
                # en esa posición exacta.
                datos_staging_lista.insert(original_index, row_to_restore)
            else:
                # Si no (por ej. una acción de borrado antigua
                # antes de v7.7), usa el método antiguo (append).
                datos_staging_lista.append(row_to_restore)
            # (Documentación de Google: Fin de la lógica 'undo delete')

            # 5. (Sin cambios) Obtiene el ID de la fila restaurada.
            affected_row_id = row_to_restore.get('_row_id')
            # --- FIN DE LA CORRECCIÓN (v7.7) ---
            
        else:
            raise Exception(f"Tipo de acción desconocida en el historial: {action_type}")
        
        # --- (Lógica de guardado en sesión sin cambios) ---
        session['history'] = history_stack
        session['df_staging'] = datos_staging_lista
        
        df_staging_revertido = pd.DataFrame.from_records(datos_staging_lista)
        resumen_kpis = _calculate_kpis(df_staging_revertido)
        # --- (Fin de la parte sin cambios) ---
        
        # --- (Devolución del JSON sin cambios) ---
        return jsonify({
            "status": "success",
            "message": f"Acción '{action_type}' deshecha.",
            "data": datos_staging_lista, 
            "history_count": len(history_stack),
            "resumen": resumen_kpis,
            "affected_row_id": affected_row_id # ¡Devuelve el ID!
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

# --- (API /api/add_row sin cambios) ---
@app.route('/api/add_row', methods=['POST'])
def add_row():
    """
    Añade una nueva fila en blanco a 'df_staging' y
    registra la acción en 'history'.
    ¡NUEVO! Asigna un ID secuencial (max_id + 1).
    ¡NUEVO! Devuelve el 'new_row_id' para el scroll.
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)
        
        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        
        if not datos_staging_lista:
            return jsonify({"error": "No hay datos cargados para añadir una fila."}), 400
            
        # 1. Determina las columnas
        columnas = list(datos_staging_lista[0].keys())
        # 2. Crea una fila nueva (diccionario)
        nueva_fila = {col: "" for col in columnas}
        
        # --- ¡NUEVA LÓGICA DE ID! (Tu Punto 1) ---
        # 3. Asigna un ID secuencial (max_id + 1)
        #    Esto asegura que sea el siguiente número (ej. 6115)
        max_id = max([int(fila.get('_row_id', 0)) for fila in datos_staging_lista])
        nuevo_id = max_id + 1
        
        nueva_fila['_row_id'] = nuevo_id
        # --- FIN DE LA LÓGICA DE ID ---
        
        # 4. Añade la fila al "borrador"
        datos_staging_lista.append(nueva_fila)
        
        # 5. Guarda la acción en el historial
        change_obj = {
            'action': 'add',
            'row_id': nuevo_id # Guardamos el ID para poder deshacerlo
        }
        history_stack.append(change_obj)
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)
            
        # 6. Guardar todo de vuelta en la sesión
        session['df_staging'] = datos_staging_lista
        session['history'] = history_stack
        
        # 7. Recalcular KPIs
        df_staging_modificado = pd.DataFrame.from_records(datos_staging_lista)
        resumen_kpis = _calculate_kpis(df_staging_modificado)
        
        # 8. Responder
        return jsonify({
            "status": "success", 
            "message": f"Nueva fila añadida (ID: {nuevo_id}).",
            "data": datos_staging_lista,
            "history_count": len(history_stack),
            "resumen": resumen_kpis,
            "new_row_id": nuevo_id # ¡Devuelve el ID para el scroll! (Tu Punto 2)
        })
        
    except Exception as e:
        print(f"Error en /api/add_row: {e}") 
        return jsonify({"error": str(e)}), 500

# --- ¡API /api/delete_row MODIFICADA! ---
@app.route('/api/delete_row', methods=['POST'])
def delete_row():
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Elimina una fila de 'df_staging' (basado en _row_id).
    
    Versión 7.7:
    - (¡MODIFICADO!) Ahora usa 'enumerate' para encontrar el
      índice (la posición) de la fila en la lista.
    - (¡MODIFICADO!) Guarda tanto la 'deleted_row' (la fila)
      como el 'original_index' (la posición) en el historial
      para poder deshacer la acción correctamente.
    (Documentación de Google: Fin de la función)
    """
    try:
        # 1. (Sin cambios) Obtener datos de la petición.
        data = request.json
        file_id = data.get('file_id')
        row_id_to_delete = data.get('row_id')
        _check_file_id(file_id)
        
        if row_id_to_delete is None:
            return jsonify({"error": "Falta row_id"}), 400
            
        # 2. (Sin cambios) Obtener datos de la sesión.
        datos_staging_lista = _get_df_from_session('df_staging')
        history_stack = session.get('history', [])
        
        # --- ¡INICIO DE LA CORRECCIÓN (v7.7)! ---
        # (Documentación de Google: Lógica de 'delete_row')
        
        fila_eliminada = None
        nuevos_datos_staging = []
        # 3. (NUEVO v7.7) Variable para guardar el índice de la lista.
        indice_eliminado = -1 
        
        # 4. (¡MODIFICADO! v7.7) Itera usando 'enumerate'
        #    para obtener tanto el índice (i) como la fila (fila).
        for i, fila in enumerate(datos_staging_lista):
            # Compara el _row_id (ej. 19)
            if str(fila.get('_row_id')) == str(row_id_to_delete):
                # Si coincide, guarda la fila completa.
                fila_eliminada = fila
                # (NUEVO v7.7) Y guarda el índice de la lista (ej. 19).
                indice_eliminado = i 
            else:
                # Si no coincide, la añade a la nueva lista.
                nuevos_datos_staging.append(fila)
        # (Documentación de Google: Fin de la lógica 'delete_row')
        # --- FIN DE LA CORRECCIÓN (v7.7) ---
                
        # 5. (Sin cambios) Validación.
        if not fila_eliminada:
            return jsonify({"error": f"No se encontró la fila con _row_id {row_id_to_delete}"}), 404
            
        # 6. (¡MODIFICADO! v7.7)
        #    Crea el objeto de historial guardando AMBAS cosas.
        change_obj = {
            'action': 'delete',
            'deleted_row': fila_eliminada,  # La fila completa
            'original_index': indice_eliminado # El índice donde estaba
        }
        # 7. (Sin cambios) Añade al historial y maneja el límite.
        history_stack.append(change_obj)
        if len(history_stack) > UNDO_STACK_LIMIT:
            history_stack.pop(0)
            
        # 8. (Sin cambios) Guarda la *nueva* lista (sin la fila) en la sesión.
        session['df_staging'] = nuevos_datos_staging
        session['history'] = history_stack
        
        # 9. (Sin cambios) Recalcula KPIs y responde.
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

# --- (API /api/filter sin cambios) ---
@app.route('/api/filter', methods=['POST'])
def filter_data():
    """
    Filtra el 'df_staging' y devuelve los resultados Y los KPIs.
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')

        _check_file_id(file_id)
        df_staging = _get_df_from_session_as_df('df_staging')

        # ¡Usa la nueva lógica de 'aplicar_filtros_dinamicos' (v3)!
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

# --- (API /api/download_excel sin cambios) ---
@app.route('/api/download_excel', methods=['POST'])
def download_excel():
    """
    Descarga la vista detallada (filtrada) actual.
    ¡NUEVO! Renombra '_row_id' a 'N° Fila' y le suma 1.
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

        # --- ¡LÓGICA DE 'N° Fila' SIMPLIFICADA! (Tu Punto 1) ---
        if '_row_id' in df_a_exportar.columns:
            # Suma 1 a TODOS los IDs (ya sean originales o nuevos)
            df_a_exportar['_row_id'] = df_a_exportar['_row_id'].astype(int) + 1
            # Renombra la columna
            df_a_exportar = df_a_exportar.rename(columns={'_row_id': 'N° Fila'})
            
            # Mover la columna al principio
            cols = list(df_a_exportar.columns)
            cols.insert(0, cols.pop(cols.index('N° Fila')))
            df_a_exportar = df_a_exportar[cols]
        # --- Fin de la modificación ---

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

# --- (API /api/group_by sin cambios) ---
@app.route('/api/group_by', methods=['POST'])
def group_data():
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
    
# --- (API /api/download_excel_grouped sin cambios) ---
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
            columna_agrupar: columna_agrupar.replace('_row_status', 'Row Status'),
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