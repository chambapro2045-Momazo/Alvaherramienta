"""
priority_manager.py
-------------------
Módulo encargado de la gestión y aplicación de reglas de prioridad personalizadas.

Estándares: Google Python Style Guide.
Optimizaciones v18.0:
- Vectorización de operaciones de string.
- Agrupación de reglas por columna para evitar re-procesamiento redundante.
"""

import pandas as pd
from .json_manager import cargar_json, guardar_json

# Constante que define la ruta del archivo JSON de persistencia.
RULES_FILE = 'user_priority_rules.json'


def _load_data() -> dict:
    """
    Carga los datos completos (reglas y configuraciones) desde el archivo JSON.

    Si el archivo no existe o faltan claves, inicializa estructuras por defecto.

    Returns:
        dict: Un diccionario con las claves 'rules' (list) y 'settings' (dict).
    """
    # Cargamos el archivo utilizando el gestor de JSON seguro.
    data = cargar_json(RULES_FILE)
    
    # Inicializamos la lista de reglas si no existe.
    if 'rules' not in data:
        data['rules'] = []
        
    # Inicializamos la configuración global si no existe.
    if 'settings' not in data:
        data['settings'] = {
            "enable_scf_intercompany": True,  # Habilita lógica hardcoded SCF.
            "enable_age_sort": True           # Habilita ordenamiento por antigüedad.
        }
    return data


def load_rules() -> list[dict]:
    """
    Obtiene únicamente la lista de reglas de prioridad.

    Returns:
        list[dict]: Lista de diccionarios, donde cada uno representa una regla.
    """
    return _load_data().get('rules', [])


def load_settings() -> dict:
    """
    Obtiene la configuración global de la aplicación.

    Returns:
        dict: Diccionario con las configuraciones (flags booleanos).
    """
    return _load_data().get('settings', {})


def save_settings(new_settings: dict) -> bool:
    """
    Actualiza y guarda las configuraciones globales.

    Args:
        new_settings (dict): Diccionario con las nuevas configuraciones a aplicar.

    Returns:
        bool: True si la operación de guardado fue exitosa, False en caso contrario.
    """
    # Cargamos los datos actuales.
    data = _load_data()
    # Actualizamos el diccionario de settings con los nuevos valores.
    data['settings'].update(new_settings)
    # Persistimos los cambios en el disco.
    return guardar_json(RULES_FILE, data)


def save_rule(new_rule: dict) -> bool:
    """
    Guarda una nueva regla o actualiza una existente.

    Si ya existe una regla para la misma columna y valor, la sobrescribe.

    Args:
        new_rule (dict): Diccionario con la definición de la regla 
                         (column, value, priority, reason, active).

    Returns:
        bool: True si se guardó correctamente.
    """
    data = _load_data()
    current_rules = data['rules']
    
    # Normalizamos los inputs para asegurar consistencia en la búsqueda.
    target_col = new_rule.get('column', '').strip()
    target_val = new_rule.get('value', '').strip()
    
    # Establecemos el estado 'active' por defecto en True si no viene definido.
    if 'active' not in new_rule:
        new_rule['active'] = True

    # Filtramos la lista para eliminar la versión anterior de la regla (si existe).
    # Esto evita duplicados lógicos.
    updated_rules = [
        r for r in current_rules 
        if not (r.get('column') == target_col and r.get('value') == target_val)
    ]
    
    # Añadimos la nueva regla a la lista.
    updated_rules.append(new_rule)
    data['rules'] = updated_rules
    
    # Guardamos el archivo actualizado.
    return guardar_json(RULES_FILE, data)


def toggle_rule(column: str, value: str, active_status: bool) -> bool:
    """
    Cambia el estado de activación (On/Off) de una regla específica.

    Args:
        column (str): Nombre de la columna de la regla.
        value (str): Valor objetivo de la regla.
        active_status (bool): True para activar, False para desactivar.

    Returns:
        bool: True si se encontró y actualizó la regla, False si no existía.
    """
    data = _load_data()
    found = False
    
    # Iteramos sobre las reglas para encontrar la coincidencia.
    for rule in data['rules']:
        if rule.get('column') == column and rule.get('value') == value:
            # Actualizamos el estado.
            rule['active'] = active_status
            found = True
            break
    
    # Solo guardamos si hubo cambios.
    if found:
        return guardar_json(RULES_FILE, data)
    return False


def delete_rule(column: str, value: str) -> bool:
    """
    Elimina permanentemente una regla de la base de datos JSON.

    Args:
        column (str): Columna objetivo de la regla a eliminar.
        value (str): Valor objetivo de la regla a eliminar.

    Returns:
        bool: True si se eliminó (el tamaño de la lista cambió), False si no.
    """
    data = _load_data()
    original_len = len(data['rules'])
    
    # Reconstruimos la lista excluyendo la regla coincidente.
    data['rules'] = [
        r for r in data['rules'] 
        if not (r.get('column') == column and r.get('value') == value)
    ]
    
    # Verificamos si se eliminó algo comparando longitudes.
    if len(data['rules']) < original_len:
        return guardar_json(RULES_FILE, data)
    return False


def replace_all_rules(new_rules: list, new_settings: dict) -> bool:
    """
    Sobrescribe TODAS las reglas y configuraciones actuales con las nuevas proporcionadas.
    Útil para importar vistas completas.

    Args:
        new_rules (list): Lista completa de reglas a guardar.
        new_settings (dict): Diccionario de configuración global.

    Returns:
        bool: True si se guardó correctamente.
    """
    # Construimos la estructura completa del archivo.
    data = {
        "rules": new_rules,
        "settings": new_settings
    }
    # Guardamos directamente, sobrescribiendo lo anterior.
    return guardar_json(RULES_FILE, data)


def apply_priority_rules(df: pd.DataFrame) -> pd.DataFrame:
    """
    Aplica las reglas de prioridad personalizadas al DataFrame de forma vectorizada.

    Optimización v18.0:
    Agrupa las reglas por columna para normalizar los textos del DataFrame 
    una sola vez por columna, en lugar de hacerlo por cada regla.

    Args:
        df (pd.DataFrame): El DataFrame principal de facturas.

    Returns:
        pd.DataFrame: El DataFrame con las columnas '_priority' y '_priority_reason' actualizadas.
    """
    # Cargamos todas las reglas.
    rules = load_rules()
    
    # Aseguramos que exista la columna de razón.
    if '_priority_reason' not in df.columns:
        df['_priority_reason'] = ""

    # Si no hay reglas, retornamos el DF intacto.
    if not rules:
        return df

    # 1. Agrupar reglas por columna para optimizar el procesamiento.
    # Estructura: {'NombreColumna': [Regla1, Regla2, ...]}
    rules_by_column = {}
    for rule in rules:
        if rule.get('active', True):  # Solo procesamos reglas activas.
            col = rule.get('column')
            if col:
                if col not in rules_by_column:
                    rules_by_column[col] = []
                rules_by_column[col].append(rule)

    # 2. Iterar por cada columna única que tenga reglas asociadas.
    for col_name, column_rules in rules_by_column.items():
        # Verificamos que la columna exista en el DataFrame.
        if col_name in df.columns:
            # --- OPTIMIZACIÓN ---
            # Normalizamos la columna UNA SOLA VEZ para todas las reglas de esta columna.
            # Convertimos a string, minúsculas y quitamos espacios.
            col_normalized_series = df[col_name].astype(str).str.lower().str.strip()
            
            # Aplicamos cada regla asociada a esta columna.
            for rule in column_rules:
                # Obtenemos los valores de la regla.
                val_rule = str(rule.get('value', '')).lower().strip()
                prio = rule.get('priority')
                reason = rule.get('reason', 'Regla personalizada')

                # Creamos la máscara booleana vectorial.
                mask = col_normalized_series == val_rule
                
                # Si hay coincidencias, aplicamos la actualización vectorizada.
                if mask.any():
                    df.loc[mask, '_priority'] = prio
                    df.loc[mask, '_priority_reason'] = reason

    return df