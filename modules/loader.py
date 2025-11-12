"""
loader.py (Versión 8.0 - Prioridades)

Módulo encargado de la carga y validación de datos.

¡NUEVO! Ahora detecta la columna "Pay group", asigna
una prioridad a cada fila ("Alta", "Media", "Baja")
y la guarda en una nueva columna interna `_priority`.
"""

import pandas as pd
import numpy as np

# (ELIMINADO v7.9) La función _find_monto_column se devolvió a app.py

# --- (NUEVO v8.0) Funciones de Lógica de Prioridad ---

def _find_pay_group_column(df: pd.DataFrame) -> str | None:
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Intenta encontrar la columna de "Pay group" en el DataFrame.
    
    Args:
        df (pd.DataFrame): El DataFrame en el que buscar.

    Returns:
        str | None: El nombre de la columna encontrada (ej. "Pay group")
                    o None si no se encuentra.
    (Documentación de Google: Fin de la función)
    """
    # (Documentación de Google: Lista de posibles nombres (en minúsculas))
    possible_names = ['pay group', 'grupo de pago', 'paygroup']
    for col in df.columns:
        if str(col).lower() in possible_names:
            return col 
    return None 

def _assign_priority(pay_group_value: str) -> str:
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Asigna una prioridad ("Alta", "Media", "Baja") basado
    en el valor de la celda de "Pay group".

    Args:
        pay_group_value (str): El valor de la celda (ej. "SCF" o "Pay Group 2").

    Returns:
        str: "Alta", "Media", o "Baja".
    (Documentación de Google: Fin de la función)
    """
    if pay_group_value is None:
        return 'Media' # (Documentación de Google: Valor por defecto)

    val = str(pay_group_value).strip().upper()

    # (Documentación de Google: 1. Prioridad ALTA)
    if val == 'SCF' or val == 'INTERCOMPANY':
        return 'Alta'
    
    # (Documentación de Google: 2. Prioridad BAJA)
    if val.startswith('PAY GROUP'):
        return 'Baja'
    
    # (Documentación de Google: 3. Prioridad MEDIA -
    #     incluye DIST, GNTD, PAYROLL, RENTS, etc.)
    return 'Media'

# --- Fin de Funciones de Prioridad ---


def cargar_datos(ruta_archivo: str) -> tuple[pd.DataFrame, str | None]:
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Carga un archivo Excel, limpia encabezados, rellena nulos
    y crea las columnas internas `_row_status` y `_priority`.

    Args:
        ruta_archivo (str): Ruta completa del archivo Excel.

    Returns:
        tuple[pd.DataFrame, str | None]: 
            - El DataFrame con los datos cargados y pre-procesados.
            - El nombre de la columna "Pay Group" encontrada (o None).
    (Documentación de Google: Fin de la función)
    """
    try:
        # (Documentación de Google: Carga el archivo, forzando todo a string)
        df = pd.read_excel(ruta_archivo, dtype=str)

        # (Documentación de Google: Limpia espacios en blanco de los nombres de columnas)
        df.columns = [col.strip() for col in df.columns]

        # (Documentación de Google: Reemplaza valores nulos (NaN, NaT) por cadenas vacías)
        df = df.fillna("")

        print(f" Archivo cargado correctamente con {len(df)} registros.")

        # --- INICIO: LÓGICA DE "ROW STATUS" (Sin cambios v7.9) ---
        blank_mask = (df == "") | (df == "0")
        incomplete_rows = blank_mask.any(axis=1)
        df['_row_status'] = np.where(
            incomplete_rows, 
            "Incompleto",
            "Completo"
        )
        # --- FIN DEL BLOQUE ---

        # --- ¡INICIO: LÓGICA DE "PRIORITY" (NUEVO v8.0)! ---
        
        # (Documentación de Google: 1. Busca la columna "Pay Group")
        pay_group_col_name = _find_pay_group_column(df)
        
        if pay_group_col_name:
            print(f"Columna de 'Pay Group' identificada: '{pay_group_col_name}'")
            # (Documentación de Google: 2. Aplica la lógica de prioridad
            #     a cada fila usando el valor de esa columna)
            df['_priority'] = df[pay_group_col_name].apply(_assign_priority)
        else:
            # (Documentación de Google: 3. Si no se encuentra, asigna
            #     "Media" a todas las filas)
            print("Advertencia: No se encontró columna de 'Pay Group'. Asignando prioridad 'Media' por defecto.")
            df['_priority'] = 'Media'
            
        # --- FIN DE LÓGICA DE PRIORIDAD ---

        # (Documentación de Google: Devuelve el DF y el nombre
        #  de la columna encontrada)
        return df, pay_group_col_name

    except FileNotFoundError:
        print(f" Error: No se encontró el archivo en la ruta: {ruta_archivo}")
        return pd.DataFrame(), None
    except Exception as e:
        print(f" Error al cargar el archivo Excel: {e}")
        return pd.DataFrame(), None