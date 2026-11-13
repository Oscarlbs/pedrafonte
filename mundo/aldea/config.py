"""Configuración del mundo: rutas, variables de entorno y ubicación del señor.

Variables de entorno (las únicas):
  ALDEA_BD_URL       secreto, obligatorio. Sin ella el servidor se niega a arrancar.
  ALDEA_MOTOR_IA     «simulado» (por defecto, sin coste) o «claude».
  ANTHROPIC_API_KEY  secreto, solo para el motor «claude».
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[2]
DATOS = RAIZ / "mundo" / "datos"
CONFIG = RAIZ / "config"

PUERTO = 8765
MOTORES_IA = ("simulado", "claude")


def cargar_env(ruta: Path | None = None) -> None:
    """Lee el .env de la raíz sin pisar lo que ya esté en el entorno."""
    ruta = ruta or RAIZ / ".env"
    if not ruta.exists():
        return
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, _, valor = linea.partition("=")
        os.environ.setdefault(clave.strip(), valor.strip().strip('"').strip("'"))


def bd_url() -> str:
    url = os.environ.get("ALDEA_BD_URL", "").strip()
    if not url:
        raise RuntimeError(
            "Falta ALDEA_BD_URL. Copia .env.ejemplo a .env y pon la dirección de la base de datos "
            "(PostgreSQL, o sqlite:///datos-locales/aldea.sqlite si no hay Docker)."
        )
    return url


def motor_ia() -> str:
    motor = os.environ.get("ALDEA_MOTOR_IA", "simulado").strip().lower() or "simulado"
    if motor not in MOTORES_IA:
        raise RuntimeError(f"ALDEA_MOTOR_IA debe ser uno de {MOTORES_IA}, no «{motor}».")
    return motor


@lru_cache
def ubicacion() -> dict:
    ruta = CONFIG / "ubicacion.yaml"
    datos = yaml.safe_load(ruta.read_text(encoding="utf-8")) if ruta.exists() else {}
    return {
        "nombre": datos.get("nombre", "Vigo, España"),
        "latitud": float(datos.get("latitud", 42.2406)),
        "longitud": float(datos.get("longitud", -8.7207)),
        "huso": datos.get("huso", "Europe/Madrid"),
        "clima": datos.get("clima", "open-meteo"),
    }
