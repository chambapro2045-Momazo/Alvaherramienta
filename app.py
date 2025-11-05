# app.py (Versión 5.0 Completa)

import os
import pandas as pd
import uuid
import io 
from flask import Flask, request, jsonify, render_template, send_file, session, redirect, url_for
from flask_cors import CORS

# --- Importar tus módulos ---
from modules.loader import cargar_datos
from modules.filters import aplicar_filtros_dinamicos
from modules.translator import get_text, LANGUAGES

# --- ¡NUEVA FUNCIÓN DE AYUDA! ---
def _find_monto_column(df):
    """Intenta encontrar la columna de monto en el DataFrame."""
    # Lista de posibles nombres (en minúsculas)
    possible_names = ['monto', 'total', 'amount', 'total amount']
    
    for col in df.columns:
        if str(col).lower() in possible_names:
            return col # Devuelve el nombre original de la columna
    return None # No se encontró
# --- FIN DE LA FUNCIÓN DE AYUDA ---

# --- Configuración de Flask ---
app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app) 
app.config['SECRET_KEY'] = 'mi-llave-secreta-para-el-buscador-12345'
UPLOAD_FOLDER = 'temp_uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- Context Processor para Traducciones ---
@app.context_processor
def inject_translator():
    lang = session.get('language', 'es') 
    return dict(get_text=get_text, lang=lang)

# --- Ruta Principal ---
@app.route('/')
def home():
    return render_template('index.html')

# --- APIs de Idioma ---
@app.route('/api/set_language/<string:lang_code>')
def set_language(lang_code):
    if lang_code in LANGUAGES:
        session['language'] = lang_code 
    return jsonify({"status": "success", "language": lang_code})

@app.route('/api/get_translations')
def get_translations():
    lang = session.get('language', 'es')
    return jsonify(LANGUAGES.get(lang, LANGUAGES['es']))

# --- API de Carga (¡ESTA ES LA RUTA QUE DABA 404!) ---
@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    file.save(file_path)
    
    try:
        df = cargar_datos(file_path)
        if df.empty: raise Exception("File is empty or corrupt")
        # Devuelve todas las columnas posibles
        todas_las_columnas = [col for col in df.columns]
        return jsonify({ "file_id": file_id, "columnas": todas_las_columnas })
    except Exception as e:
        print(f"Error en /api/upload: {e}") 
        return jsonify({"error": str(e)}), 500

# --- API de Filtrado (¡ACTUALIZADA CON LIMPIEZA DE DATOS!) ---
@app.route('/api/filter', methods=['POST'])
def filter_data():
    data = request.json
    file_id = data.get('file_id')
    filtros_recibidos = data.get('filtros_activos')
    if not file_id: return jsonify({"error": "Missing file_id"}), 400
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    if not os.path.exists(file_path): return jsonify({"error": "File expired or not found"}), 404

    try:
        df_original = cargar_datos(file_path) 
        resultado_df = aplicar_filtros_dinamicos(df_original, filtros_recibidos)

        # --- ¡LÓGICA DE RESUMEN MEJORADA! ---
        monto_total = 0.0
        monto_promedio = 0.0

        # 1. Intentar encontrar la columna de monto
        monto_col_name = _find_monto_column(resultado_df) # Esto encontrará "Total"

        if monto_col_name and not resultado_df.empty:
            try:
                # 2. ¡NUEVO! Limpiar la columna de texto (quitar $ y ,)
                # La convertimos a string, reemplazamos caracteres y LUEGO a numérico
                monto_col_str_limpia = resultado_df[monto_col_name].astype(str).str.replace(r'[$,]', '', regex=True)
                monto_numerico = pd.to_numeric(monto_col_str_limpia, errors='coerce').fillna(0)

                # 3. Calcular estadísticas
                monto_total = monto_numerico.sum()
                monto_promedio = monto_numerico.mean()
            except Exception as e:
                print(f"Error al calcular resumen: {e}")
                # Los valores se quedarán en 0.0

        # 4. Preparar el objeto de resumen
        resumen_stats = {
            "total_facturas": len(resultado_df),
            "monto_total": f"${monto_total:,.2f}", 
            "monto_promedio": f"${monto_promedio:,.2f}"
        }
        # --- FIN DE LA LÓGICA MEJORADA ---

        resultado_json = resultado_df.to_dict(orient="records") 

        return jsonify({ 
            "data": resultado_json, 
            "num_filas": len(resultado_df),
            "resumen": resumen_stats
        })

    except Exception as e:
        print(f"Error en /api/filter: {e}") 
        return jsonify({"error": str(e)}), 500

# --- API de Descarga Excel ---
@app.route('/api/download_excel', methods=['POST'])
def download_excel():
    data = request.json
    file_id = data.get('file_id')
    filtros_recibidos = data.get('filtros_activos')
    columnas_visibles = data.get('columnas_visibles') 

    if not file_id: return "Error: Missing file_id", 400
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    if not os.path.exists(file_path): return "Error: File not found", 404

    try:
        df_original = cargar_datos(file_path) 
        resultado_df = aplicar_filtros_dinamicos(df_original, filtros_recibidos)
        
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

# ---
# ¡NUEVA API! API de Agrupación (Group By)
# ---
@app.route('/api/group_by', methods=['POST'])
def group_data():
    data = request.json
    file_id = data.get('file_id')
    filtros_recibidos = data.get('filtros_activos')
    columna_agrupar = data.get('columna_agrupar') # ¡Nueva!

    if not file_id: return jsonify({"error": "Missing file_id"}), 400
    if not columna_agrupar: return jsonify({"error": "Missing 'columna_agrupar'"}), 400

    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    if not os.path.exists(file_path): return jsonify({"error": "File expired or not found"}), 404

    try:
        # 1. Carga los datos (esto ya incluye la columna '_row_status')
        df_original = cargar_datos(file_path)
        
        # 2. Aplica los mismos filtros que la vista detallada
        resultado_df = aplicar_filtros_dinamicos(df_original, filtros_recibidos)

        if resultado_df.empty:
            return jsonify({ "data": [] }) # Devuelve vacío si los filtros no dan nada

        # 3. Prepara la columna 'Total' para cálculos
        # Si no existe, crea una columna de ceros para evitar errores
        if 'Total' not in resultado_df.columns:
            resultado_df['Total'] = 0
        
        # Convierte 'Total' a numérico, los errores se vuelven NaN (Not a Number)
        resultado_df['Total'] = pd.to_numeric(resultado_df['Total'], errors='coerce')
        # Reemplaza los NaN con 0 para que las sumas funcionen
        resultado_df['Total'] = resultado_df['Total'].fillna(0)

        # 4. Define las operaciones de agregación (copiado de Streamlit)
        agg_operations = {
            'Total': ['sum', 'mean', 'min', 'max', 'count']
        }

        # 5. ¡LA LÓGICA CLAVE! Ejecuta el GroupBy
        df_agrupado = resultado_df.groupby(columna_agrupar).agg(agg_operations)

        # 6. Limpia las columnas (Pandas crea MultiIndex, ej: ('Total', 'sum'))
        # Las aplanamos a: 'Total_sum', 'Total_mean', etc.
        df_agrupado.columns = [f"{col[0]}_{col[1]}" for col in df_agrupado.columns]

        # 7. Resetea el índice para que la columna agrupada (ej. 'Vendor Name')
        # vuelva a ser una columna normal y no el índice del DataFrame.
        df_agrupado = df_agrupado.reset_index()
        
        # 8. Ordena por la suma total, de mayor a menor
        df_agrupado = df_agrupado.sort_values(by='Total_sum', ascending=False)

        # 9. Convierte a JSON y envía de vuelta
        resultado_json = df_agrupado.to_dict(orient="records")
        return jsonify({ "data": resultado_json })

    except KeyError as e:
        # Esto pasa si la 'columna_agrupar' no existe en el DF
        print(f"Error en /api/group_by: Columna '{e}' no encontrada.")
        return jsonify({"error": f"La columna '{e}' no se encontró en el archivo."}), 404
    except Exception as e:
        print(f"Error en /api/group_by: {e}") 
        return jsonify({"error": str(e)}), 500
    

# ---
# ¡NUEVA API! Descargar Excel Agrupado
# ---
@app.route('/api/download_excel_grouped', methods=['POST'])
def download_excel_grouped():
    data = request.json
    file_id = data.get('file_id')
    filtros_recibidos = data.get('filtros_activos')
    columna_agrupar = data.get('columna_agrupar')

    if not file_id: return jsonify({"error": "Missing file_id"}), 400
    if not columna_agrupar: return jsonify({"error": "Missing 'columna_agrupar'"}), 400

    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.xlsx")
    if not os.path.exists(file_path): return jsonify({"error": "File expired or not found"}), 404

    try:
        # --- Esta lógica es un CCOPY/PASTE de la API /api/group_by ---
        df_original = cargar_datos(file_path)
        resultado_df = aplicar_filtros_dinamicos(df_original, filtros_recibidos)

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
        # --- Fin del Copy/Paste ---

        # Renombra las columnas para el Excel (opcional pero bueno)
        lang = session.get('language', 'es')
        df_agrupado = df_agrupado.rename(columns={
            columna_agrupar: columna_agrupar.replace('_row_status', 'Row Status'),
            'Total_sum': get_text(lang, 'group_total_amount'),
            'Total_mean': get_text(lang, 'group_avg_amount'),
            'Total_min': get_text(lang, 'group_min_amount'),
            'Total_max': get_text(lang, 'group_max_amount'),
            'Total_count': get_text(lang, 'group_invoice_count')
        })
        
        # Filtra las columnas para que solo se incluyan las que tienen nombre
        columnas_finales = [col for col in df_agrupado.columns if col in df_agrupado.rename(columns={}).columns]
        df_agrupado = df_agrupado[columnas_finales]

        # Genera el archivo Excel en memoria
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
    
# --- Punto de entrada ---
if __name__ == '__main__':
    app.run(debug=True, port=5000, reloader_type="stat")