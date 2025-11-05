"""
loader.py

Módulo encargado de la carga y validación de datos
desde un archivo Excel que contiene las facturas.
"""

"""
loader.py

Módulo encargado de la carga y validación de datos
desde un archivo Excel que contiene las facturas.
"""

import pandas as pd
import numpy as np  # Importamos numpy

def cargar_datos(ruta_archivo: str) -> pd.DataFrame:
    """
    Carga un archivo Excel que contiene las facturas.

    Args:
        ruta_archivo (str): Ruta completa del archivo Excel (ej. 'data/Header_Facturas.xlsx').

    Returns:
        pd.DataFrame: Un DataFrame con los datos cargados y limpiados.
                      Si hay error, devuelve un DataFrame vacío.
    """
    try:
        # Cargar el archivo Excel usando pandas
        df = pd.read_excel(ruta_archivo, dtype=str)

        # Limpiar los encabezados de columnas (quitar espacios)
        df.columns = [col.strip() for col in df.columns]

        # Reemplazar valores nulos (NaN, NaT) por cadenas vacías
        df = df.fillna("")

        print(f" Archivo cargado correctamente con {len(df)} registros.")

        # --- INICIO: LÓGICA DE "ROW STATUS" (REVISANDO TODA LA FILA) ---
        
        # Ya no necesitamos la lista de 'columnas_clave'.
        # Simplemente revisamos el DataFrame completo.

        # Define qué se considera "vacío" (un string vacío o un "0")
        # Aplicamos esto a *todo* el DataFrame.
        blank_mask = (df == "") | (df == "0")
        
        # Revisa fila por fila (axis=1): si *alguna* celda está vacía, marca la fila.
        incomplete_rows = blank_mask.any(axis=1)
        
        # Crea la nueva columna '_row_status'
        df['_row_status'] = np.where(
            incomplete_rows, 
            "Incompleto",  # Valor si la fila tiene al menos un vacío
            "Completo"     # Valor si la fila está 100% llena
        )
        # --- FIN DEL BLOQUE ---

        return df

    except FileNotFoundError:
        print(f" Error: No se encontró el archivo en la ruta: {ruta_archivo}")
        return pd.DataFrame()
    except Exception as e:
        # Esto capturará errores si el archivo no es un Excel válido
        print(f" Error al cargar el archivo Excel: {e}")
        return pd.DataFrame()