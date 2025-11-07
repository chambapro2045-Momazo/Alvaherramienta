# app.py (Versión 6.8 - Corrección de "Opción Nuclear")

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
        
        # 2 versiones + historial
        session['df_pristine'] = data_dict_list # Original-Original (Nunca cambia)
        session['df_staging'] = data_dict_list  # Borrador de trabajo
        session['history'] = []                 # Pila de Deshacer
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
    Actualiza una celda en 'df_staging' y guarda el
    cambio anterior en la pila de deshacer 'history'.
    Recalcula y devuelve los KPIs.
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
            if int(fila.get('_row_id')) == int(row_id):
                
                old_val = fila.get(columna)
                
                # No hacer nada si el valor no cambió
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
        
        # Recalcular KPIs
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

# --- (API /api/undo_change sin cambios) ---
@app.route('/api/undo_change', methods=['POST'])
def undo_change():
    """
    Deshace el último cambio de 'history' y lo aplica a 'df_staging'.
    Recalcula y devuelve los KPIs.
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        history_stack = session.get('history', [])
        if not history_stack:
            return jsonify({"error": "No hay nada que deshacer."}), 404
            
        last_change = history_stack.pop() 
        row_id_to_revert = last_change.get('row_id')
        col_to_revert = last_change.get('columna')
        value_to_restore = last_change.get('old_val') 
        
        datos_staging_lista = _get_df_from_session('df_staging')
        
        fila_revertida = False
        for fila in datos_staging_lista:
            if int(fila.get('_row_id')) == int(row_id_to_revert):
                fila[col_to_revert] = value_to_restore 
                fila_revertida = True
                break
        
        if not fila_revertida:
            raise Exception(f"Error de consistencia: no se encontró la fila {row_id_to_revert} para deshacer.")
        
        session['history'] = history_stack
        session['df_staging'] = datos_staging_lista
        
        # Recalcular KPIs
        df_staging_revertido = pd.DataFrame.from_records(datos_staging_lista)
        resumen_kpis = _calculate_kpis(df_staging_revertido)
        
        return jsonify({
            "status": "success",
            "message": f"Cambio en Fila {row_id_to_revert} deshecho.",
            "data": datos_staging_lista, 
            "history_count": len(history_stack),
            "resumen": resumen_kpis
        })

    except Exception as e:
        print(f"Error en /api/undo_change: {e}") 
        return jsonify({"error": str(e)}), 500

# --- (API /api/revert_changes sin cambios) ---
@app.route('/api/revert_changes', methods=['POST'])
def revert_changes():
    """
    Restaura 'df_staging' a 'df_pristine' (Opción Nuclear).
    Limpia el historial. Recalcula y devuelve los KPIs del original.
    """
    try:
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        # 2. Obtener la copia "prístina" (el original-original)
        datos_pristine_lista = _get_df_from_session('df_pristine')
             
        # 3. Sobrescribir el "borrador" (staging)
        session['df_staging'] = list(datos_pristine_lista)
        
        # 4. Limpiar la pila de deshacer
        session['history'] = []
        
        # 5. Recalcular KPIs del original
        df_pristine = pd.DataFrame.from_records(datos_pristine_lista)
        resumen_kpis = _calculate_kpis(df_pristine)
        
        # 6. Responder
        return jsonify({
            "status": "success", 
            "message": "Cambios revertidos al original.",
            "data": datos_pristine_lista,
            "history_count": 0,
            "resumen": resumen_kpis
        })
        
    except Exception as e:
        print(f"Error en /api/revert_changes: {e}") 
        return jsonify({"error": str(e)}), 500
        
# ---
# --- ¡API DE CONSOLIDAR CORREGIDA! ---
# ---
@app.route('/api/commit_changes', methods=['POST'])
def commit_changes():
    """
    Consolida los cambios. Esta acción limpia el historial de 
    deshacer, haciendo que los cambios actuales en 'df_staging'
    sean permanentes (hasta la próxima consolidación o reversión).
    
    ¡NO SOBRESCRIBE 'df_pristine'!
    """
    try:
        # 1. Validar
        data = request.json
        file_id = data.get('file_id')
        _check_file_id(file_id)

        # 2. Obtener el "borrador" actual (staging)
        #    (No necesitamos los datos, pero es una buena validación)
        _get_df_from_session('df_staging')
             
        # 3. --- ¡ESTE ERA EL BUG! ---
        #    La línea "session['df_pristine'] = list(datos_staging_lista)"
        #    se ha eliminado. Ya no sobrescribimos el original.
        #    --- FIN DEL BUG ---
        
        # 4. Limpiar la pila de deshacer.
        #    Esto "consolida" los cambios, ya que no se pueden deshacer.
        session['history'] = []
        
        # 5. Responder
        return jsonify({
            "status": "success", 
            "message": "Cambios consolidados. El historial de deshacer ha sido limpiado.",
            "history_count": 0
        })
        
    except Exception as e:
        print(f"Error en /api/commit_changes: {e}") 
        return jsonify({"error": str(e)}), 500
# ---
# --- FIN DE LA CORRECCIÓN ---
# ---

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

        resultado_df_filtrado = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)

        # Llama a la función helper SOBRE EL DATAFRAME FILTRADO
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
             columnas_existentes = [col for col in columnas_visibles if col in resultado_df.columns]
             if columnas_existentes:
                 df_a_exportar = resultado_df[columnas_existentes]

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