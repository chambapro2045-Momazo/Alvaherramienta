"""
priority_manager.py (Versión 16.6 - Fix Spaces & Exact Match)
-------------------
Gestión de reglas con soporte para desactivación y configuración global.
Modificación: Se añade .strip() a las comparaciones para evitar fallos por espacios en blanco.
"""

import pandas as pd
from .json_manager import cargar_json, guardar_json

RULES_FILE = 'user_priority_rules.json'

def _load_data() -> dict:
    """Carga el JSON completo (reglas y settings)."""
    data = cargar_json(RULES_FILE)
    # Estructura base si el archivo es nuevo o antiguo
    if 'rules' not in data: data['rules'] = []
    if 'settings' not in data: 
        data['settings'] = {
            "enable_scf_intercompany": True, # Por defecto activado
            "enable_age_sort": True          # Por defecto activado
        }
    return data

def load_rules() -> list[dict]:
    return _load_data().get('rules', [])

def load_settings() -> dict:
    """Devuelve la configuración global."""
    return _load_data().get('settings', {})

def save_settings(new_settings: dict) -> bool:
    """Guarda/Actualiza las configuraciones globales."""
    data = _load_data()
    # Actualiza solo las claves enviadas
    data['settings'].update(new_settings)
    return guardar_json(RULES_FILE, data)

def save_rule(new_rule: dict) -> bool:
    """Guarda o actualiza una regla (ahora soporta campo 'active')."""
    data = _load_data()
    current_rules = data['rules']
    
    target_col = new_rule.get('column', '').strip()
    target_val = new_rule.get('value', '').strip()
    
    # Si no se especifica 'active', por defecto es True (nueva regla)
    if 'active' not in new_rule:
        new_rule['active'] = True

    # Eliminar versión anterior si existe (para sobrescribirla)
    updated_rules = [
        r for r in current_rules 
        if not (r.get('column') == target_col and r.get('value') == target_val)
    ]
    
    updated_rules.append(new_rule)
    data['rules'] = updated_rules
    
    return guardar_json(RULES_FILE, data)

def toggle_rule(column: str, value: str, active_status: bool) -> bool:
    """Activa o desactiva una regla existente sin borrarla."""
    data = _load_data()
    found = False
    for rule in data['rules']:
        if rule.get('column') == column and rule.get('value') == value:
            rule['active'] = active_status
            found = True
            break
    
    if found:
        return guardar_json(RULES_FILE, data)
    return False

def delete_rule(column: str, value: str) -> bool:
    data = _load_data()
    original_len = len(data['rules'])
    data['rules'] = [
        r for r in data['rules'] 
        if not (r.get('column') == column and r.get('value') == value)
    ]
    if len(data['rules']) < original_len:
        return guardar_json(RULES_FILE, data)
    return False

def apply_priority_rules(df: pd.DataFrame) -> pd.DataFrame:
    """
    Aplica SOLO las reglas que tengan 'active': True.
    Usa .strip() para asegurar coincidencia aunque haya espacios extra.
    """
    rules = load_rules()
    
    if '_priority_reason' not in df.columns:
        df['_priority_reason'] = ""

    if not rules: return df

    for rule in rules:
        # Solo aplicar si está activa
        if not rule.get('active', True): 
            continue

        col = rule.get('column')
        val = rule.get('value')
        prio = rule.get('priority')
        reason = rule.get('reason', 'Regla personalizada')

        if col in df.columns:
            # Lógica mejorada: convertir a string, minúsculas y quitar espacios
            # Esto soluciona que "Assignee: John " no coincida con "John"
            col_normalized = df[col].astype(str).str.lower().str.strip()
            val_normalized = str(val).lower().strip()
            
            mask = col_normalized == val_normalized
            
            if mask.any():
                df.loc[mask, '_priority'] = prio
                df.loc[mask, '_priority_reason'] = reason

    return df