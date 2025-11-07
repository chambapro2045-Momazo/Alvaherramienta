# Mi_Nuevo_Buscador_Web/modules/json_manager.py
# Módulo nuevo para gestionar la lectura y escritura de archivos JSON.

import os
import json
from typing import Dict, Any

def cargar_json(file_path: str) -> Dict[str, Any]:
    """
    Carga un archivo JSON desde la ruta especificada de forma segura.

    Si el archivo no existe, lo crea con un diccionario vacío.
    Si el archivo está corrupto o no es un JSON válido, devuelve
    un diccionario vacío.

    Args:
        file_path (str): La ruta completa al archivo .json
                         (ej. 'user_autocomplete.json').

    Returns:
        Dict[str, Any]: El contenido del archivo JSON como un diccionario.
    """
    try:
        # Verifica si el archivo existe.
        if not os.path.exists(file_path):
            # Si no existe, créalo con un diccionario vacío.
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump({}, f)
            return {}
            
        # Si existe, intenta leerlo.
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Asegúrate de que el contenido sea un diccionario.
            if isinstance(data, dict):
                return data
            else:
                # Si es JSON válido pero no un dict (ej. null, list),
                # devuelve un dict vacío.
                return {}
                
    except json.JSONDecodeError:
        # Captura errores si el archivo está corrupto o vacío.
        print(f"Error: El archivo {file_path} está corrupto. Se usará un dict vacío.")
        return {} # Si está corrupto, devuelve un dict vacío.
    except Exception as e:
        # Captura otros errores (ej. permisos).
        print(f"Error inesperado cargando {file_path}: {e}")
        return {}

def guardar_json(file_path: str, data: Dict[str, Any]) -> bool:
    """
    Guarda un diccionario en un archivo JSON en la ruta especificada.

    Sobrescribe el archivo si ya existe.

    Args:
        file_path (str): La ruta completa al archivo .json donde se guardará.
        data (Dict[str, Any]): El diccionario de Python que se va a guardar.

    Returns:
        bool: True si se guardó correctamente, False si hubo un error.
    """
    try:
        # Abre el archivo en modo escritura ('w') con codificación UTF-8.
        with open(file_path, 'w', encoding='utf-8') as f:
            # Escribe el diccionario 'data' en el archivo 'f'.
            # 'indent=4' formatea el JSON para que sea legible.
            json.dump(data, f, indent=4, ensure_ascii=False)
        return True
        
    except TypeError as e:
        # Error común si 'data' contiene objetos no serializables.
        print(f"Error de tipo al guardar JSON en {file_path}: {e}")
        return False
    except IOError as e:
        # Error si no se puede escribir en el archivo (ej. permisos).
        print(f"Error de I/O al guardar JSON en {file_path}: {e}")
        return False
    except Exception as e:
        # Captura cualquier otro error inesperado.
        print(f"Error inesperado guardando {file_path}: {e}")
        return False