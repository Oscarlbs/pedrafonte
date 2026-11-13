"""El reloj del juego: hora real del huso del señor más los días adelantados con el botón."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .. import config
from ..modelos import Aldea

ESTACIONES = ("primavera", "verano", "otono", "invierno")
NOMBRES_ESTACION = {"primavera": "primavera", "verano": "verano", "otono": "otoño", "invierno": "invierno"}
MESES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)
DIAS_SEMANA = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")

HORA_AMANECER = 6
HORA_CIERRE = 23


def ahora_real() -> datetime:
    """Hora de pared en el huso del señor, sin zona (así se guarda y se compara fácil)."""
    return datetime.now(ZoneInfo(config.ubicacion()["huso"])).replace(tzinfo=None)


def ahora_juego(aldea: Aldea, real: datetime | None = None) -> datetime:
    real = real or ahora_real()
    return real + timedelta(days=int(aldea.estado.get("desfase_dias", 0)))


def a_hora(instante: datetime) -> datetime:
    return instante.replace(minute=0, second=0, microsecond=0)


def clave_hora(instante: datetime) -> str:
    return instante.strftime("%Y-%m-%dT%H")


def de_clave_hora(texto: str) -> datetime:
    return datetime.strptime(texto, "%Y-%m-%dT%H")


def dia_n(aldea: Aldea, instante: datetime) -> int:
    """Número de día de la aldea: el día de la fundación es el 1."""
    fundacion = date.fromisoformat(aldea.estado["fecha_fundacion"])
    return (instante.date() - fundacion).days + 1


def fecha_de_dia(aldea: Aldea, dia: int) -> date:
    return date.fromisoformat(aldea.estado["fecha_fundacion"]) + timedelta(days=dia - 1)


def estacion(fecha: date, latitud: float | None = None) -> str:
    latitud = config.ubicacion()["latitud"] if latitud is None else latitud
    md = (fecha.month, fecha.day)
    if (3, 20) <= md < (6, 21):
        indice = 0
    elif (6, 21) <= md < (9, 23):
        indice = 1
    elif (9, 23) <= md < (12, 21):
        indice = 2
    else:
        indice = 3
    if latitud < 0:  # hemisferio sur: al revés
        indice = (indice + 2) % 4
    return ESTACIONES[indice]


def fecha_bonita(fecha: date) -> str:
    return f"{DIAS_SEMANA[fecha.weekday()]}, {fecha.day} de {MESES[fecha.month - 1]} de {fecha.year}"


def franja(hora: int) -> str:
    if hora < 6:
        return "noche"
    if hora < 9:
        return "amanecer"
    if hora < 13:
        return "manana"
    if hora < 15:
        return "mediodia"
    if hora < 19:
        return "tarde"
    if hora < 22:
        return "anochecer"
    return "noche"
