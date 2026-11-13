"""El tiempo que hace. Real desde Open-Meteo (gratis, sin clave) o simulado según la estación.

El clima real solo vale para «ahora»: si se han adelantado días con el botón, o no hay red, o la
configuración dice «simulado», se usa el simulado (determinista por fecha y semilla).
"""

from __future__ import annotations

import random
import time
from datetime import date, datetime

import httpx

from .. import config
from ..modelos import Aldea
from . import tiempo

TIPOS = ("despejado", "nubes", "lluvia", "niebla", "tormenta", "nieve")
NOMBRES = {
    "despejado": "cielo despejado", "nubes": "nublado", "lluvia": "lluvia",
    "niebla": "niebla", "tormenta": "tormenta", "nieve": "nieve",
}

# Las pruebas ponen esto a True para no tocar la red.
SIN_RED = False
_CADUCA_S = 20 * 60
_cache: dict = {"cuando": 0.0, "dato": None}

# Probabilidad de cada tipo por estación (clima atlántico: llueve lo suyo).
_PROBABILIDAD = {
    "primavera": {"despejado": 0.35, "nubes": 0.25, "lluvia": 0.28, "niebla": 0.07, "tormenta": 0.05, "nieve": 0.0},
    "verano": {"despejado": 0.6, "nubes": 0.2, "lluvia": 0.1, "niebla": 0.04, "tormenta": 0.06, "nieve": 0.0},
    "otono": {"despejado": 0.25, "nubes": 0.25, "lluvia": 0.33, "niebla": 0.12, "tormenta": 0.05, "nieve": 0.0},
    "invierno": {"despejado": 0.22, "nubes": 0.25, "lluvia": 0.3, "niebla": 0.1, "tormenta": 0.05, "nieve": 0.08},
}
_TEMPERATURA = {"primavera": 15, "verano": 23, "otono": 14, "invierno": 8}


def simulado(fecha: date, hora: int = 12, semilla: int = 1) -> dict:
    estacion = tiempo.estacion(fecha)
    azar = random.Random(f"clima|{semilla}|{fecha.isoformat()}")
    tabla = _PROBABILIDAD[estacion]
    tipo = azar.choices(list(tabla), weights=list(tabla.values()))[0]
    # Niebla de amanecer: frecuente en otoño e invierno aunque luego abra.
    if hora in (6, 7, 8) and tipo in ("despejado", "nubes") and azar.random() < 0.45 and estacion in ("otono", "invierno"):
        tipo = "niebla"
    temperatura = _TEMPERATURA[estacion] + azar.randint(-4, 4) + (3 if 12 <= hora <= 17 else -2 if hora < 7 else 0)
    if tipo == "nieve":
        temperatura = min(temperatura, 1)
    return {"tipo": tipo, "temperatura": temperatura, "origen": "simulado", "descripcion": NOMBRES[tipo]}


def _tipo_wmo(codigo: int) -> str:
    if codigo in (0, 1):
        return "despejado"
    if codigo in (2, 3):
        return "nubes"
    if codigo in (45, 48):
        return "niebla"
    if codigo in (71, 73, 75, 77, 85, 86):
        return "nieve"
    if codigo >= 95:
        return "tormenta"
    return "lluvia"


def real() -> dict | None:
    """Clima actual de la ubicación del señor, o None si no se puede consultar."""
    if SIN_RED or config.ubicacion()["clima"] != "open-meteo":
        return None
    ahora = time.monotonic()
    if _cache["dato"] is not None and ahora - _cache["cuando"] < _CADUCA_S:
        return _cache["dato"]
    lugar = config.ubicacion()
    try:
        respuesta = httpx.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lugar["latitud"], "longitude": lugar["longitud"],
                "current": "temperature_2m,weather_code,cloud_cover,wind_speed_10m,precipitation",
                "timezone": lugar["huso"],
            },
            timeout=4.0,
        )
        respuesta.raise_for_status()
        actual_ = respuesta.json()["current"]
        tipo = _tipo_wmo(int(actual_["weather_code"]))
        dato = {
            "tipo": tipo,
            "temperatura": round(float(actual_["temperature_2m"])),
            "viento": round(float(actual_.get("wind_speed_10m", 0))),
            "nubes": int(actual_.get("cloud_cover", 0)),
            "origen": "real",
            "descripcion": NOMBRES[tipo],
        }
    except Exception:  # sin red, API caída o respuesta rara: se simula
        _cache.update(cuando=ahora - _CADUCA_S + 120, dato=None)  # reintenta en 2 minutos
        return None
    _cache.update(cuando=ahora, dato=dato)
    return dato


def actual(aldea: Aldea, instante: datetime) -> dict:
    if int(aldea.estado.get("desfase_dias", 0)) == 0:
        dato = real()
        if dato is not None:
            return dato
    return simulado(instante.date(), instante.hour, aldea.semilla)
