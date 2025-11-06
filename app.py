# app.py (Versión 6.3 - ¡Corrección de Recarga de Autocompletado!)

import os
import pandas as pd
import uuid
import io 
import json # ¡NUEVO IMPORTE!
from flask import Flask, request, jsonify, render_template, send_file, session, redirect, url_for
from flask_cors import CORS
from flask_session import Session 

# --- Importar tus módulos ---
from modules.loader import cargar_datos
from modules.filters import aplicar_filtros_dinamicos
from modules.translator import get_text, LANGUAGES

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

# --- ¡NUEVA FUNCIÓN DE AYUDA! ---
def cargar_listas_usuario():
    """Carga las listas personalizadas desde user_autocomplete.json"""
    try:
        # Asegúrate de que el archivo exista, si no, créalo vacío
        if not os.path.exists('user_autocomplete.json'):
            with open('user_autocomplete.json', 'w') as f:
                json.dump({}, f)
            return {}
            
        with open('user_autocomplete.json', 'r') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"Error cargando user_autocomplete.json: {e}")
        return {} # Si está corrupto, devuelve un dict vacío

# --- ¡NUEVA FUNCIÓN DE AYUDA! ---
def get_autocomplete_options(df: pd.DataFrame) -> dict:
    """
    Toma un DataFrame y genera las opciones de autocompletado
    fusionándolas con las listas guardadas por el usuario.
    """
    
    # 1. Carga las listas guardadas por el usuario
    listas_de_usuario = cargar_listas_usuario()
    # 'listas_de_usuario' es ej: {"Status": ["Archivado", "Revisado"]}

    # 2. Prepara el diccionario final
    autocomplete_options = {}

    # 3. Define las columnas que queremos escanear
    columnas_para_autocompletar = [
        "Vendor Name", "Status", "Assignee", 
        "Operating Unit Name", "Pay Status", "Document Type", "_row_status"
    ]

    for col in columnas_para_autocompletar:
        
        # Combina listas de usuario y de Excel
        # Usamos un 'set' para evitar duplicados
        opciones_combinadas = set()

        # Añade las listas del usuario (si existen)
        if col in listas_de_usuario:
            opciones_combinadas.update(listas_de_usuario[col])

        # Escanea el Excel y añade esas opciones
        if col in df.columns:
            valores_unicos_excel = df[col].astype(str).unique()
            opciones_limpias_excel = [val for val in valores_unicos_excel if val and pd.notna(val) and val.strip() != ""]
            opciones_combinadas.update(opciones_limpias_excel)
        
        # Convierte el set final a una lista ordenada
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
    
    # ¡CORRECCIÓN! pd.DataFrame.from_records() es el constructor correcto
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


# --- ¡RUTA PRINCIPAL '/' MODIFICADA! ---
@app.route('/')
def home():
    """
    Renderiza la página principal.
    ¡AHORA también carga y pasa las opciones de autocompletado
    si ya existe una sesión!
    """
    
    # Prepara los datos base para inyectar en el HTML
    session_data = {
        "file_id": session.get('file_id'),
        "columnas": [],
        "autocomplete_options": {} # ¡NUEVO!
    }
    
    # Intenta obtener el DF de la sesión
    df_staging_data = session.get('df_staging')
    
    if df_staging_data and isinstance(df_staging_data, list) and len(df_staging_data) > 0:
        # Si hay datos, obtén las columnas
        session_data["columnas"] = list(df_staging_data[0].keys())
        
        # --- ¡NUEVA LÓGICA DE RECARGA! ---
        # 1. Reconvierte los datos de sesión a un DataFrame de Pandas
        #    (solo para poder escanearlo)
        df_para_escanear = pd.DataFrame.from_records(df_staging_data)
        
        # 2. Llama a la misma función de ayuda que usa /api/upload
        session_data["autocomplete_options"] = get_autocomplete_options(df_para_escanear)
        # --- FIN DE LA NUEVA LÓGICA ---

    # Pasa estos datos (incluyendo las opciones) al template
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
        
        session.clear()
        
        data_dict_list = df.to_dict('records')
        
        session['df_pristine'] = data_dict_list
        session['df_original'] = data_dict_list
        session['df_staging'] = data_dict_list   
        session['file_id'] = file_id

        if os.path.exists(file_path):
            os.remove(file_path)

        todas_las_columnas = [col for col in df.columns]
        
        # --- ¡LÓGICA DE AUTOCOMPLETADO! ---
        # Llama a la función de ayuda para obtener las listas
        autocomplete_options = get_autocomplete_options(df)
        # --- FIN DE LA LÓGICA ---

        return jsonify({ 
            "file_id": file_id, 
            "columnas": todas_las_columnas,
            "autocomplete_options": autocomplete_options # Envía la lista fusionada
        })
        
    except Exception as e:
        print(f"Error en /api/upload: {e}") 
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({"error": str(e)}), 500

# --- ¡NUEVA API DE GUARDADO DE LISTAS! ---
@app.route('/api/save_autocomplete_lists', methods=['POST'])
def save_autocomplete_lists():
    """
    Recibe un JSON del frontend y lo guarda en 'user_autocomplete.json'
    """
    try:
        nuevas_listas = request.json
        if not isinstance(nuevas_listas, dict):
            return jsonify({"error": "El formato debe ser un JSON object"}), 400
            
        with open('user_autocomplete.json', 'w') as f:
            json.dump(nuevas_listas, f, indent=4)
            
        return jsonify({"status": "success", "message": "Listas guardadas."})
        
    except Exception as e:
        print(f"Error en /api/save_autocomplete_lists: {e}")
        return jsonify({"error": str(e)}), 500

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
        df_staging = _get_df_from_session('df_staging')

        resultado_df = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)
        
        df_a_exportar = resultado_df
        if columnas_visibles and isinstance(columnas_visibles, list):
             columnas_existentes = [col for col in columnas_visibles if col in resultado_df.columns]
             if columnas_existentes:
                 df_a_exportar = resultado_df[columnas_existentes]

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
        df_staging = _get_df_from_session('df_staging')
        
        if not columna_agrupar: return jsonify({"error": "Missing 'columna_agrupar'"}), 400
        
        resultado_df = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)

        if resultado_df.empty:
            return jsonify({ "data": [] }) 

        if 'Total' not in resultado_df.columns:
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
        df_staging = _get_df_from_session('df_staging')

        if not columna_agrupar: return jsonify({"error": "Missing 'columna_agrupar'"}), 400
        
        resultado_df = aplicar_filtros_dinamicos(df_staging, filtros_recibidos)

        if resultado_df.empty:
            return jsonify({"error": "No data found for these filters"}), 404

        if 'Total' not in resultado_df.columns:
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