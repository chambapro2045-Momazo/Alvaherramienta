"""
priority_manager.py
-------------------
Gestión de reglas de prioridad con soporte para operadores lógicos, numéricos y motivos.
"""

import pandas as pd
import numpy as np
from .json_manager import cargar_json, guardar_json

RULES_FILE = 'user_priority_rules.json'

def _load_data() -> dict:
    data = cargar_json(RULES_FILE)
    if 'rules' not in data: data['rules'] = []
    if 'settings' not in data:
        data['settings'] = {
            "enable_scf_intercompany": True,
            "enable_age_sort": True
        }
    return data

def load_rules() -> list:
    """Carga las reglas asegurando que tengan valores por defecto."""
    data = _load_data()
    rules = data.get('rules', [])
    for r in rules:
        if 'operator' not in r: r['operator'] = 'equals'
        if 'active' not in r: r['active'] = True
        if 'reason' not in r: r['reason'] = ""
    return rules

def load_settings() -> dict:
    return _load_data().get('settings', {})

def save_settings(new_settings: dict) -> bool:
    data = _load_data()
    data['settings'].update(new_settings)
    return guardar_json(RULES_FILE, data)

def save_rule(new_rule: dict) -> bool:
    data = _load_data()
    # Asegurar campos por defecto
    if 'active' not in new_rule: new_rule['active'] = True
    if 'operator' not in new_rule: new_rule['operator'] = 'equals'
    
    # Evitar duplicados: Eliminamos si ya existe una regla idéntica (mismo criterio)
    data['rules'] = [
        r for r in data['rules'] 
        if not (r.get('column') == new_rule.get('column') and 
                r.get('value') == new_rule.get('value') and
                r.get('operator') == new_rule.get('operator'))
    ]
    
    data['rules'].append(new_rule)
    return guardar_json(RULES_FILE, data)

def delete_rule(column: str, value: str, operator: str) -> bool:
    data = _load_data()
    operator = operator or 'equals'
    original_len = len(data['rules'])
    
    data['rules'] = [
        r for r in data['rules'] 
        if not (r.get('column') == column and 
                r.get('value') == value and 
                r.get('operator', 'equals') == operator)
    ]
    
    if len(data['rules']) < original_len:
        return guardar_json(RULES_FILE, data)
    return False

def toggle_rule(column: str, value: str, operator: str, active_status: bool) -> bool:
    data = _load_data()
    operator = operator or 'equals'
    found = False
    for rule in data['rules']:
        if (rule.get('column') == column and 
            rule.get('value') == value and 
            rule.get('operator', 'equals') == operator):
            rule['active'] = active_status
            found = True
            break
    if found: return guardar_json(RULES_FILE, data)
    return False

def _clean_currency_vectorized(series):
    """Limpia $ y , de una columna para convertirla a números."""
    return pd.to_numeric(series.astype(str).str.replace(r'[$,]', '', regex=True), errors='coerce').fillna(0)

def apply_priority_rules(df: pd.DataFrame) -> pd.DataFrame:
    """Aplica las reglas guardadas sobre el DataFrame."""
    rules = load_rules()
    
    # Asegurar que existan las columnas base
    if '_priority_reason' not in df.columns:
        df['_priority_reason'] = "Prioridad base"
    
    if not rules:
        return df

    # 1. Agrupar reglas por columna para optimizar
    rules_by_column = {}
    for rule in rules:
        if rule.get('active', True):
            col = rule.get('column')
            if col:
                if col not in rules_by_column: rules_by_column[col] = []
                rules_by_column[col].append(rule)

    # 2. Iterar por columnas y aplicar reglas
    for col_name, column_rules in rules_by_column.items():
        if col_name in df.columns:
            # Preparamos datos texto
            col_str_series = df[col_name].astype(str).str.lower().str.strip()
            
            # Preparamos datos numéricos (solo si hay reglas numéricas para esta columna)
            is_numeric_batch = any(r.get('operator') in ['greater', 'less', 'greater_eq', 'less_eq'] for r in column_rules)
            col_num_series = None
            if is_numeric_batch:
                col_num_series = _clean_currency_vectorized(df[col_name])

            for rule in column_rules:
                operator = rule.get('operator', 'equals')
                val_rule = str(rule.get('value', '')).strip()
                prio = rule.get('priority')
                reason = rule.get('reason', 'Regla personalizada')
                
                mask = None

                # --- Lógica de Operadores ---
                try:
                    if operator == 'equals':
                        mask = (col_str_series == val_rule.lower())
                    
                    elif operator == 'contains':
                        mask = col_str_series.str.contains(val_rule.lower(), regex=False)
                    
                    elif operator == 'not_equals':
                        mask = (col_str_series != val_rule.lower())

                    # Operadores Numéricos
                    elif operator in ['greater', 'less', 'greater_eq', 'less_eq'] and col_num_series is not None:
                        # Limpiamos el valor que escribió el usuario (ej: "$5,000" -> 5000.0)
                        val_rule_clean = val_rule.replace('$','').replace(',','')
                        if val_rule_clean:
                            val_rule_num = float(val_rule_clean)
                            
                            if operator == 'greater': mask = (col_num_series > val_rule_num)
                            elif operator == 'less': mask = (col_num_series < val_rule_num)
                            elif operator == 'greater_eq': mask = (col_num_series >= val_rule_num)
                            elif operator == 'less_eq': mask = (col_num_series <= val_rule_num)
                except Exception:
                    # Si falla la conversión de una regla específica, la saltamos sin romper todo
                    continue

                # Aplicar cambios donde la máscara sea True
                if mask is not None and mask.any():
                    df.loc[mask, '_priority'] = prio
                    df.loc[mask, '_priority_reason'] = reason

    return df