"""El paso del tiempo: horas, amaneceres y cierres de día.

El juego va a hora real. `avanzar` procesa las horas que falten hasta «ahora» (o hasta la hora que
se le diga) y `adelantar_dia` suma un día al desfase y procesa de golpe esas 24 horas.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..modelos import Aldea
from . import clima, economia, estado, tiempo

# Si el servidor estuvo apagado mucho tiempo, solo las últimas horas se viven «enteras» (con escenas);
# los días anteriores se cierran solo en lo económico.
MAX_HORAS_COMPLETAS = 72
MAX_DIAS_ATRASADOS = 30


def avanzar(s: Session, aldea: Aldea, hasta: datetime | None = None, ia: Any = None) -> dict:
    """Procesa las horas pendientes. Devuelve un resumen de lo ocurrido."""
    if aldea.estado.get("perdida"):
        return {"horas": 0, "dias": 0}
    hasta = tiempo.a_hora(hasta or tiempo.ahora_juego(aldea))
    ultima = tiempo.de_clave_hora(aldea.estado["ultima_hora"])
    if hasta <= ultima:
        return {"horas": 0, "dias": 0}
    # Un apagón muy largo no se revive entero: se salta al último mes.
    if hasta - ultima > timedelta(days=MAX_DIAS_ATRASADOS):
        ultima = hasta - timedelta(days=MAX_DIAS_ATRASADOS)
    completo_desde = hasta - timedelta(hours=MAX_HORAS_COMPLETAS)
    resumen = {"horas": 0, "dias": 0, "balances": []}
    t = ultima
    while t < hasta and not aldea.estado.get("perdida"):
        t += timedelta(hours=1)
        balance = tic(s, aldea, t, ligero=t < completo_desde, ia=ia)
        resumen["horas"] += 1
        if balance is not None:
            resumen["dias"] += 1
            resumen["balances"].append(balance)
    s.flush()
    return resumen


def adelantar_dia(s: Session, aldea: Aldea, ia: Any = None, real: datetime | None = None) -> dict:
    """El botón de adelantar: un día más de desfase y a procesar sus 24 horas."""
    avanzar(s, aldea, tiempo.ahora_juego(aldea, real), ia=ia)  # primero, ponerse al día
    aldea.estado["desfase_dias"] = int(aldea.estado.get("desfase_dias", 0)) + 1
    aldea.tocar()
    return avanzar(s, aldea, tiempo.ahora_juego(aldea, real), ia=ia)


def tic(s: Session, aldea: Aldea, instante: datetime, ligero: bool = False, ia: Any = None) -> dict | None:
    """Una hora de juego. Devuelve el balance del día si en esta hora se cerró el día."""
    e = aldea.estado
    e["dia"] = tiempo.dia_n(aldea, instante)
    e["hora"] = instante.hour
    e["ultima_hora"] = tiempo.clave_hora(instante)
    aldea.tocar()
    balance = None
    if instante.hour == 0:
        e["escenas_hoy"] = 0
        e["tension_hoy"] = 0
    if instante.hour == tiempo.HORA_AMANECER:
        amanecer(s, aldea, instante, ligero=ligero, ia=ia)
    if not ligero:
        vida(s, aldea, instante, ia=ia)
    if instante.hour == tiempo.HORA_CIERRE:
        balance = cierre_dia(s, aldea, instante, ligero=ligero, ia=ia)
    estado.emitir(aldea, "hora", dia=e["dia"], hora=e["hora"])
    return balance


def amanecer(s: Session, aldea: Aldea, instante: datetime, ligero: bool = False, ia: Any = None) -> None:
    economia.asignar_casas(s, aldea)
    economia.asignar_trabajos(s, aldea)
    from . import consejo, exterior  # import tardío: estos módulos usan a su vez el ciclo

    exterior.amanecer(s, aldea, instante, ligero=ligero, ia=ia)
    consejo.amanecer(s, aldea, instante, ia=ia)


def vida(s: Session, aldea: Aldea, instante: datetime, ia: Any = None) -> None:
    """Rutinas, encuentros y escenas de esta hora."""
    from . import escenas

    escenas.hora(s, aldea, instante, ia=ia)


def cierre_dia(s: Session, aldea: Aldea, instante: datetime, ligero: bool = False, ia: Any = None) -> dict:
    from . import cronica, drama, exterior, gobierno, guerra, reflexion

    tiempo_hoy = clima.actual(aldea, instante.replace(hour=14))
    balance = economia.cierre(s, aldea, instante.date(), tiempo_hoy["tipo"])
    balance["clima_descripcion"] = tiempo_hoy["descripcion"]
    exterior.cierre(s, aldea, instante, balance, ligero=ligero)
    guerra.cierre(s, aldea, balance, ligero=ligero)
    gobierno.cierre(s, aldea, balance)
    if not ligero:
        reflexion.noche(s, aldea, ia=ia)
    drama.cierre(s, aldea, ligero=ligero, ia=ia)
    cronica.escribir(s, aldea, instante.date(), balance, ia=ia, ligero=ligero)
    estado.emitir(aldea, "cierre", dia=aldea.estado["dia"], balance=balance)
    return balance
