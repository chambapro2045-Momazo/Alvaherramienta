"""
loader.py
---------

Módulo encargado de la carga y validación de datos.

v16.0:
- Se integra 'priority_manager' para aplicar reglas personalizadas
  después de la carga inicial.
- Se inicializa la columna '_priority_reason' para el tooltip.
"""

import pandas as pd
import numpy as np
# (NUEVO v16.0) Importa el módulo de reglas personalizadas
from .priority_manager import apply_priority_rules
# (NUEVO) Importar load_settings
from .priority_manager import apply_priority_rules, load_settings

def _find_pay_group_column(df: pd.DataFrame) -> str | None:
    """Intenta encontrar la columna de "Pay group" en el DataFrame.

    Args:
        df (pd.DataFrame): El DataFrame en el que buscar.

    Returns:
        str | None: El nombre de la columna encontrada o None.
    """
    possible_names = ['pay group', 'grupo de pago', 'paygroup']
    for col in df.columns:
        if str(col).lower() in possible_names:
            return col 
    return None 

def _assign_priority(pay_group_value: str) -> str:
    """
    Asigna una prioridad ("Alta", "Media", "Baja") basado
    en el valor de la celda de "Pay group" (Lógica Base).

    Args:
        pay_group_value (str): El valor de la celda (ej. "SCF" o "Pay Group 2").

    Returns:
        str: "Alta", "Media", o "Baja".
    """
    if pay_group_value is None:
        return 'Media' # Valor por defecto

    val = str(pay_group_value).strip().upper()

    # 1. Prioridad ALTA
    if val == 'SCF' or val == 'INTERCOMPANY':
        return 'Alta'
    
    # 2. Prioridad BAJA
    if val.startswith('PAY GROUP'):
        return 'Baja'
    
    # 3. Prioridad MEDIA (Resto)
    return 'Media'

# --- Fin de Funciones de Prioridad ---


def cargar_datos(ruta_archivo: str) -> tuple[pd.DataFrame, str | None]:
    """
    Carga un archivo Excel, limpia encabezados, rellena nulos,
    calcula estatus y aplica reglas de prioridad (Estáticas + Dinámicas).

    Args:
        ruta_archivo (str): Ruta completa del archivo Excel.

    Returns:
        tuple[pd.DataFrame, str | None]: 
            - El DataFrame con los datos cargados y pre-procesados.
            - El nombre de la columna "Pay Group" encontrada (o None).
    """
    try:
        # 1. Cargar y limpiar datos base
        df = pd.read_excel(ruta_archivo, dtype=str)
        df.columns = [col.strip() for col in df.columns]
        df = df.fillna("")
        print(f" Archivo cargado correctamente con {len(df)} registros.")

        # 2. Lógica de "Row Status" (Completo/Incompleto)
        blank_mask = (df == "") | (df == "0")
        incomplete_rows = blank_mask.any(axis=1)
        df['_row_status'] = np.where(
            incomplete_rows, 
            "Incompleto",
            "Completo"
        )
        
        # --- INICIO LÓGICA DE PRIORIDAD v16.0 ---
        
        # 3. (NUEVO) Inicializar la columna de razón para el tooltip.
        df['_priority_reason'] = "" 

    # 3. Cargar Configuraciones del Usuario
        user_settings = load_settings()
        enable_scf = user_settings.get('enable_scf_intercompany', True) # Default True
        
        # 4. Aplicar Prioridad Base (hardcoded por 'Pay group')
        pay_group_col_name = _find_pay_group_column(df)
        
        if pay_group_col_name:
            print(f"Columna de 'Pay Group' identificada: '{pay_group_col_name}'")
            # Asigna la prioridad base
            df['_priority'] = df[pay_group_col_name].apply(_assign_priority)

                # (NUEVO) Solo aplicar lógica hardcoded si el usuario quiere
            if enable_scf:
                df['_priority'] = df[pay_group_col_name].apply(_assign_priority)
                df.loc[df['_priority'] == 'Alta', '_priority_reason'] = "Prioridad base (SCF/Intercompany)"
                df.loc[df['_priority'] == 'Media', '_priority_reason'] = "Prioridad base (Estándar)"
                df.loc[df['_priority'] == 'Baja', '_priority_reason'] = "Prioridad base (Pay Group)"
            else:
                # Si está desactivado, todo nace como Media
                df['_priority'] = 'Media'
                df['_priority_reason'] = "Prioridad base (Estándar)"
            
            # (NUEVO) Asigna una razón por defecto para la lógica base
            df.loc[df['_priority'] == 'Alta', '_priority_reason'] = "Prioridad base (SCF/Intercompany)"
            df.loc[df['_priority'] == 'Media', '_priority_reason'] = "Prioridad base (Estándar)"
            df.loc[df['_priority'] == 'Baja', '_priority_reason'] = "Prioridad base (Pay Group)"
        else:
            print("Advertencia: No se encontró 'Pay Group'. Asignando 'Media' por defecto.")
            df['_priority'] = 'Media'
            df['_priority_reason'] = "Prioridad base (Estándar)"
        
        # 5. (NUEVO) Aplicar Reglas Personalizadas del Usuario
        # (Esto sobrescribirá la prioridad y la razón donde haya coincidencias)
        print("Aplicando reglas de prioridad personalizadas...")
        df = apply_priority_rules(df)
        
        # --- FIN LÓGICA DE PRIORIDAD ---

        return df, pay_group_col_name

    except FileNotFoundError:
        print(f" Error: No se encontró el archivo en la ruta: {ruta_archivo}")
        return pd.DataFrame(), None
    except Exception as e:
        print(f" Error al cargar el archivo Excel: {e}")
        return pd.DataFrame(), None