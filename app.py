# app.py (Versión 6.6 - ¡Con Pila de Deshacer 'Undo'!)

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

# --- (Funciones _find_monto_column, _check_file_id sin cambios) ---
def _find_monto_column(df):
    """Intenta encontrar la columna de monto en el DataFrame."""
    possible_names = ['monto', 'total', 'amount', 'total amount']
    for col in df.columns:
        if str(col).lower() in possible_names:
            return col 
    return None 

def _check_file_id(request_file_id):
    """Verifica que el file_id de la petición coincida con el de la sesión."""
    session_file_id = session.get('file_id')
    if not session_file_id:
        session.clear()
        raise Exception("No hay file_id en la sesión. Por favor, cargue un archivo.")
    if session_file_id != request_file_id:
        session.clear()
        raise Exception("El file_id no coincide con la sesión. Por favor, recargue el archivo.")

# --- (Funciones cargar_listas_usuario, get_autocomplete_options sin cambios) ---
def cargar_listas_usuario():
    """Carga las listas personalizadas desde user_autocomplete.json"""
    return cargar_json(USER_LISTS_FILE)

def get_autocomplete_options(df: pd.DataFrame) -> dict:
    """
    Toma un DataFrame y genera las opciones de autocompletado
    fusionándolas con las listas guardadas por el usuario.
    """
    listas_de_usuario = cargar_listas_usuario()
    autocomplete_options = {}
    columnas_para_autocompletar = [
        "Vendor Name", "Status", "Assignee", 
        "Operating Unit Name", "Pay Status", "Document Type", "_row_status"
    ]
    for col in columnas_para_autocompletar:
        opciones_combinadas = set()
        if col in listas_de_usuario:
            opciones_combinadas.update(listas_de_usuario[col])
        if col in df.columns:
            valores_unicos_excel = df[col].astype(str).unique()
            opciones_limpias_excel = [val for val in valores_unicos_excel if val and pd.notna(val) and val.strip() != ""]
            opciones_combinadas.update(opciones_limpias_excel)
        if opciones_combinadas:
             autocomplete_options[col] = sorted(list(opciones_combinadas))
    return autocomplete_options

# --- (Función _get_df_from_session sin cambios) ---
def _get_df_from_session(key='df_staging'):
    """Obtiene un DataFrame desde la sesión de Flask."""
    data_list_of_dicts = session.get(key) 
    if not data_list_of_dicts:
        session.clear() 
        raise Exception(f"No se encontraron datos en la sesión para '{key}'. La sesión se ha limpiado, por favor recargue el archivo.")
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
    Carga opciones de autocompletado si ya existe una sesión.
    """
    session_data = {
        "file_id": session.get('file_id'),
        "columnas": [],
        "autocomplete_options": {} 
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


# --- ¡API DE CARGA MODIFICADA! ---
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
        
        # Añadimos el ID único
        df = df.reset_index().rename(columns={'index': '_row_id'})
        
        session.clear()
        
        data_dict_list = df.to_dict('records')
        
        # --- ¡NUEVA LÓGICA DE 2 VERSIONES + HISTORIAL! ---
        # 1. El original, virgen. Nunca se toca.
        session['df_pristine'] = data_dict_list 
        # 2. El "borrador" de trabajo.
        session['df_staging'] = data_dict_list  
        # 3. La Pila de Deshacer (Undo Stack), inicializada vacía.
        session['history'] = []
        # --- FIN DE LA LÓGICA ---
        
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
    """
    Recibe un JSON del frontend y lo guarda en 'user_autocomplete.json'
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

# ---
# --- ¡APIS DE EDICIÓN MODIFICADAS! ---
# ---
@app.route('/api/update_cell', methods=['POST'])
def update_cell():
    """
    Actualiza una celda en 'df_staging' y guarda el
    cambio anterior en la pila de deshacer 'history'.
    """
    try:
        # 1. Obtener los datos del frontend
        data = request.json
        file_id = data.get('file_id')
        row_id = data.get('row_id')      
        columna = data.get('columna')   
        nuevo_valor = data.get('valor') 
        
        # 2. Validar
        _check_file_id(file_id)
        if row_id is None or columna is None:
            return jsonify({"error": "Faltan row_id o columna"}), 400

        # 3. Obtener el "borrador" (staging) y el "historial"
        datos_staging_lista = session.get('df_staging')
        history_stack = session.get('history', [])
        
        if not datos_staging_lista:
            raise Exception("No se encontró df_staging en la sesión.")

        # 4. Encontrar la fila, guardar el cambio y el historial
        fila_modificada = False
        for fila in datos_staging_lista:
            # Comparamos el '_row_id'
            if int(fila.get('_row_id')) == int(row_id):
                
                # --- ¡NUEVA LÓGICA DE HISTORIAL! ---
                # 1. Obtener el valor ANTIGUO
                old_val = fila.get(columna)
                
                # 2. Crear el "objeto de cambio"
                change_obj = {
                    'row_id': row_id,
                    'columna': columna,
                    'old_val': old_val,
                    'new_val': nuevo_valor
                }
                
                # 3. Añadir el cambio al historial (la pila)
                history_stack.append(change_obj)
                
                # 4. Limitar el tamaño de la pila (como sugeriste)
                if len(history_stack) > UNDO_STACK_LIMIT:
                    history_stack.pop(0) # Elimina el cambio más antiguo
                # --- FIN DE LA LÓGICA ---

                # 5. Aplicar el nuevo valor a la fila
                fila[columna] = nuevo_valor
                fila_modificada = True
                break 
        
        if not fila_modificada:
            return jsonify({"error": f"No se encontró la fila con _row_id {row_id}"}), 404
            
        # 6. Guardar todo de vuelta en la sesión
        session['df_staging'] = datos_staging_lista
        session['history'] = history_stack
        
        # 7. Responder con éxito y el tamaño del historial
        return jsonify({
            "status": "success", 
            "message": f"Fila {row_id} actualizada.",
            "history_count": len(history_stack) # Informa al frontend cuántos "undos" hay
        })

    except Exception as e:
        print(f"Error en /api/update_cell: {e}") 
        return jsonify({"error": str(e)}), 500

# --- ¡NUEVA API DE DESHACER (UNDO)! ---
@app.route('/api/undo_change', methods=['POST'])
def undo_change():
    """
    Deshace el último cambio de 'update_cell'.
    Toma el último cambio de 'history', lo revierte
    en 'df_staging' y lo elimina de la pila.
    """
    try:
        # 1. Validar el file_id
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        # 2. Obtener la pila de historial
        history_stack = session.get('history', [])
        
        # 3. Comprobar si hay algo que deshacer
        if not history_stack:
            return jsonify({"error": "No hay nada que deshacer."}), 404
            
        # 4. Obtener el último cambio (el más reciente)
        last_change = history_stack.pop() # .pop() elimina y devuelve el último item
        
        # 5. Extraer los datos del "objeto de cambio"
        row_id_to_revert = last_change.get('row_id')
        col_to_revert = last_change.get('columna')
        value_to_restore = last_change.get('old_val') # El valor al que queremos volver
        
        # 6. Obtener el "borrador" (staging)
        datos_staging_lista = session.get('df_staging')
        if not datos_staging_lista:
             raise Exception("No se encontró df_staging en la sesión.")
        
        # 7. Buscar la fila y revertir el cambio
        fila_revertida = False
        for fila in datos_staging_lista:
            if int(fila.get('_row_id')) == int(row_id_to_revert):
                # Encontramos la fila. Restauramos el valor antiguo.
                fila[col_to_revert] = value_to_restore
                fila_revertida = True
                break
        
        if not fila_revertida:
            # Esto no debería pasar si la lógica es correcta
            raise Exception(f"Error de consistencia: no se encontró la fila {row_id_to_revert} para deshacer.")
        
        # 8. Guardar la pila (sin el cambio) y los datos (revertidos)
        session['history'] = history_stack
        session['df_staging'] = datos_staging_lista
        
        # 9. Responder al frontend con los datos actualizados
        return jsonify({
            "status": "success",
            "message": f"Cambio en Fila {row_id_to_revert} deshecho.",
            "data": datos_staging_lista, # Devuelve *toda* la tabla actualizada
            "history_count": len(history_stack) # Informa cuántos "undos" quedan
        })

    except Exception as e:
        print(f"Error en /api/undo_change: {e}") 
        return jsonify({"error": str(e)}), 500

# --- ¡API DE REVERTIR MODIFICADA! (Ahora es la "Opción Nuclear") ---
@app.route('/api/revert_changes', methods=['POST'])
def revert_changes():
    """
    Restaura el "borrador" (df_staging) a la versión "prístina",
    copiando 'df_pristine' encima de 'df_staging' y
    borrando todo el historial de deshacer.
    """
    try:
        # 1. Validar el file_id
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        # 2. Obtener la copia "prístina" (df_pristine)
        datos_pristine_lista = session.get('df_pristine')
        if not datos_pristine_lista:
             raise Exception("No se encontró df_pristine en la sesión.")
             
        # 3. Sobrescribir el "borrador" (df_staging) con la copia prístina
        # Usamos list() para asegurar que sea una COPIA
        session['df_staging'] = list(datos_pristine_lista)
        
        # 4. Limpiar la pila de deshacer
        session['history'] = []
        
        # 5. Responder al frontend con los datos restaurados
        return jsonify({
            "status": "success", 
            "message": "Cambios revertidos al original.",
            "data": datos_pristine_lista, # Devuelve los datos originales
            "history_count": 0 # Ya no hay "undos"
        })
        
    except Exception as e:
        print(f"Error en /api/revert_changes: {e}") 
        return jsonify({"error": str(e)}), 500
# ---
# --- FIN DE LAS APIS DE EDICIÓN ---
# ---

# --- (El resto de las APIs: /api/filter, /api/download_excel, /api/group_by, 
# --- /api/download_excel_grouped, y 'if __name__ == ...' 
# --- van aquí SIN CAMBIOS) ---
@app.route('/api/filter', methods=['POST'])
def filter_data():
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')

        _check_file_id(file_id)
        # Usa 'df_staging' (que tiene los cambios)
        df_staging = _get_df_from_session('df_staging')

        resultado_df = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)

        monto_total = 0.0
        monto_promedio = 0.0
        monto_col_name = _find_monto_column(resultado_df)

        if monto_col_name and not resultado_df.empty:
            try:
                monto_col_str_limpia = resultado_df[monto_col_name].astype(str).str.replace(r'[$,]', '', regex=True)
                monto_numerico = pd.to_numeric(monto_col_str_limpia, errors='coerce').fillna(0)
                monto_total = monto_numerico.sum()
                monto_promedio = monto_numerico.mean()
            except Exception as e:
                print(f"Error al calcular resumen: {e}")

        resumen_stats = {
            "total_facturas": len(resultado_df),
            "monto_total": f"${monto_total:,.2f}", 
            "monto_promedio": f"${monto_promedio:,.2f}"
        }

        resultado_json = resultado_df.to_dict(orient="records") 
        return jsonify({ 
            "data": resultado_json, 
            "num_filas": len(resultado_df),
            "resumen": resumen_stats
        })

    except Exception as e:
        print(f"Error en /api/filter: {e}") 
        return jsonify({"error": str(e)}), 500

@app.route('/api/download_excel', methods=['POST'])
def download_excel():
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')
        columnas_visibles = data.get('columnas_visibles') 

        _check_file_id(file_id)
        # Usa 'df_staging' (con los cambios)
        df_staging = _get_df_from_session('df_staging')

        resultado_df = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)
        
        df_a_exportar = resultado_df
        if columnas_visibles and isinstance(columnas_visibles, list):
             columnas_existentes = [col for col in columnas_visibles if col in resultado_df.columns]
             if columnas_existentes:
                 df_a_exportar = resultado_df[columnas_existentes]

        # Ocultar el _row_id en la descarga
        if '_row_id' in df_a_exportar.columns:
            df_a_exportar = df_a_exportar.drop(columns=['_row_id'])

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

@app.route('/api/group_by', methods=['POST'])
def group_data():
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')
        columna_agrupar = data.get('columna_agrupar') 

        _check_file_id(file_id)
        # Usa 'df_staging' (con los cambios)
        df_staging = _get_df_from_session('df_staging')
        
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
    
@app.route('/api/download_excel_grouped', methods=['POST'])
def download_excel_grouped():
    try:
        data = request.json
        file_id = data.get('file_id')
        filtros_recibidos = data.get('filtros_activos')
        columna_agrupar = data.get('columna_agrupar')

        _check_file_id(file_id)
        # Usa 'df_staging' (con los cambios)
        df_staging = _get_df_from_session('df_staging')

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