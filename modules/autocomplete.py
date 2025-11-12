# modules/autocomplete.py (Versión 8.0 - Prioridades)
# Módulo dedicado a generar las opciones de autocompletado.

import pandas as pd
from .json_manager import cargar_json, USER_LISTS_FILE

def get_autocomplete_options(df: pd.DataFrame) -> dict:
    """
    (Documentación de Google: Inicio de la función)
    Propósito:
    Toma un DataFrame y genera las opciones de autocompletado
    fusionándolas con las listas guardadas por el usuario.
    
    Versión 8.0:
    - (¡MODIFICADO!) Añade `_priority` a la lista de
      columnas canónicas para que aparezca en los
      dropdowns de filtro y agrupación.
    (Documentación de Google: Fin de la función)
    """
    listas_de_usuario = cargar_json(USER_LISTS_FILE)
    
    autocomplete_options = {}

    # (Documentación de Google: Lista "CANÓNICA" de columnas)
    columnas_target_canonicas = [
        "Vendor Name", "Status", "Assignee", 
        "Operating Unit Name", "Pay Status", "Document Type",
        "Pay group", "WEC Email Inbox", "Sender Email", 
        "Currency Code", "payment method",
        "_row_status", # (Columna interna existente)
        "_priority"    # (¡NUEVA COLUMNA INTERNA v8.0!)
    ]
    
    df_cols_lower_map = {col.lower(): col for col in df.columns}

    for canonical_name in columnas_target_canonicas:
        
        opciones_combinadas = set()
        
        lista_guardada = listas_de_usuario.get(canonical_name)
        
        if isinstance(lista_guardada, list):
            opciones_combinadas.update(lista_guardada)

        df_col_name_real = df_cols_lower_map.get(canonical_name.lower())
        
        if df_col_name_real:
            valores_unicos_excel = df[df_col_name_real].astype(str).unique()
            opciones_limpias_excel = [
                val for val in valores_unicos_excel 
                if val and pd.notna(val) and val.strip() != ""
            ]
            opciones_combinadas.update(opciones_limpias_excel)
        
        if opciones_combinadas:
            key_name = df_col_name_real if df_col_name_real else canonical_name
            autocomplete_options[key_name] = sorted(list(opciones_combinadas))
             
    return autocomplete_options