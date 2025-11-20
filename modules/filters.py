# modules/filters.py (Versión 4.0 - Operadores Numéricos)

import pandas as pd
from collections import defaultdict

def _clean_currency(series):
    """Convierte serie de texto con $ y , a flotantes para poder comparar."""
    # Elimina $ y , y convierte a número. Los errores se vuelven NaN.
    return pd.to_numeric(series.astype(str).str.replace(r'[$,]', '', regex=True), errors='coerce')

def aplicar_filtros_dinamicos(df: pd.DataFrame, filtros: list) -> pd.DataFrame:
    """
    Aplica filtros con operadores avanzados (>, <, =, contains).
    """
    if not filtros:
        return df.copy()

    # 1. Agrupar filtros por columna
    # Ahora guardamos el objeto filtro COMPLETO (con operador), no solo el valor.
    filtros_agrupados = defaultdict(list)
    for f in filtros:
        if f.get('columna') and 'valor' in f:
             filtros_agrupados[f['columna']].append(f)

    resultado = df.copy()

    # 2. Iterar sobre cada columna (AND entre columnas)
    for columna, lista_filtros in filtros_agrupados.items():
        if not lista_filtros or columna not in resultado.columns:
            continue
            
        try:
            # Máscara inicial (Falso) para lógica OR acumulativa
            mascara_columna = pd.Series([False] * len(resultado), index=resultado.index)
            
            col_data = resultado[columna]
            
            # Detectar si necesitamos conversión numérica
            # Si alguno de los filtros usa >, <, >=, <=
            es_numerico = any(f.get('operador') in ['greater', 'less', 'greater_eq', 'less_eq'] for f in lista_filtros)
            
            col_data_num = None
            if es_numerico:
                col_data_num = _clean_currency(col_data)
            
            for filtro in lista_filtros:
                val = filtro.get('valor')
                op = filtro.get('operador', 'contains') # Default a 'contains' si no viene
                
                # --- Operadores de Texto ---
                if op == 'contains':
                    mascara_columna |= col_data.astype(str).str.contains(str(val), case=False, regex=False, na=False)
                
                elif op == 'equals':
                    mascara_columna |= (col_data.astype(str).str.lower() == str(val).lower())
                
                elif op == 'not_equals':
                    mascara_columna |= (col_data.astype(str).str.lower() != str(val).lower())

                # --- Operadores Numéricos ---
                elif es_numerico and col_data_num is not None:
                    try:
                        # Limpiamos el valor input del usuario (por si puso "$5,000")
                        val_clean = str(val).replace(',', '').replace('$', '')
                        val_num = float(val_clean)
                        
                        if op == 'greater': mascara_columna |= (col_data_num > val_num)
                        elif op == 'less': mascara_columna |= (col_data_num < val_num)
                        elif op == 'greater_eq': mascara_columna |= (col_data_num >= val_num)
                        elif op == 'less_eq': mascara_columna |= (col_data_num <= val_num)
                    except ValueError:
                        # Si el usuario escribió texto en un filtro numérico, lo ignoramos
                        pass

            # Aplicar la máscara de esta columna al resultado
            resultado = resultado[mascara_columna]

        except Exception as e:
            print(f"Advertencia filtrando columna '{columna}': {e}")
            pass

    return resultado