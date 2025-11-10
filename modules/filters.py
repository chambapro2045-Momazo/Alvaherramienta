# modules/filters.py (Versión 2 - Con Lógica OR para la misma columna)

import pandas as pd
from collections import defaultdict # Para agrupar filtros por columna

def aplicar_filtros_dinamicos(df: pd.DataFrame, filtros: list) -> pd.DataFrame:
    """
    Aplica una lista de filtros al DataFrame.
    - Filtros en DIFERENTES columnas se aplican con lógica AND.
    - Filtros en la MISMA columna se aplican con lógica OR.

    Cada filtro es un diccionario: {'columna': 'NombreCol', 'valor': 'ValorBuscar'}

    Args:
        df (pd.DataFrame): El DataFrame original.
        filtros (list): Una lista de diccionarios de filtros.

    Returns:
        pd.DataFrame: El DataFrame filtrado.
    """
    
    if not filtros: # Si no hay filtros, devuelve todo
        return df.copy()

    # --- NUEVA LÓGICA: Agrupar filtros por columna ---
    filtros_agrupados = defaultdict(list)
    for f in filtros:
        # Solo consideramos filtros válidos
        if f.get('columna') and f.get('valor'):
             filtros_agrupados[f['columna']].append(f['valor'])
    # Ejemplo: filtros_agrupados = {'Invoice #': ['229', '996'], 'Status': ['Pending']}
    # ---

    # Empezamos con una copia del DataFrame completo
    resultado = df.copy()

    # --- Lógica AND entre columnas diferentes ---
    for columna, valores in filtros_agrupados.items():
        if not valores: # Si no hay valores para esta columna, saltar
            continue
            
        try:
            # --- ¡LÓGICA MEJORADA PARA N° DE FILA! (Tu Punto 3) ---
            if columna == '_row_id':
                # El usuario busca por el N° Fila (ej. 144)
                # El _row_id es 0-indexed (ej. 143)
                # Convertimos los valores buscados a los IDs correctos (int)
                ids_a_buscar = []
                for v in valores:
                    try:
                        # Convierte el valor (ej "144") a int (144) y resta 1
                        ids_a_buscar.append(int(v) - 1)
                    except ValueError:
                        pass # Ignora si el usuario escribe "abc"
                
                if not ids_a_buscar:
                    continue # Pasa al siguiente filtro si no hay IDs válidos
                
                # Busca coincidencias EXACTAS usando .isin()
                mascara_or_columna = resultado[columna].isin(ids_a_buscar)

            else:
                # --- Lógica normal (como antes) para otras columnas ---
                # Aseguramos que la columna sea texto para la búsqueda
                columna_texto = resultado[columna].astype(str).str.lower()
                
                mascara_or_columna = pd.Series([False] * len(resultado), index=resultado.index)
                
                for valor in valores:
                    valor_lower = str(valor).lower()
                    mascara_or_columna = mascara_or_columna | columna_texto.str.contains(valor_lower, case=False, na=False)
            
            # Aplica la máscara (AND con los filtros anteriores)
            resultado = resultado[mascara_or_columna]
            # --- FIN DE LA LÓGICA MEJORADA ---

        except KeyError:
             print(f"Advertencia: La columna '{columna}' especificada en un filtro no existe en el archivo.")
             pass # Si la columna no existe, simplemente ignoramos ese filtro
        except Exception as e:
            print(f"Error inesperado al aplicar filtro en '{columna}': {e}")
            pass

    return resultado