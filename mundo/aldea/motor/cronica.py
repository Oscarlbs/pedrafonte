"""La crónica del escriba: lo que pasó en el día y lo que opina del gobierno del señor."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..modelos import Aldea, Cronica, Escena, Peticion, Suceso
from . import contexto, estado, social, tiempo, validador

TIPOS_CONTABLES = ("drama", "amenaza", "guerra", "obra", "visita", "fiesta", "revuelta", "vecinos", "confidencia", "ley", "comercio")


def contexto_cronica(s: Session, aldea: Aldea, fecha: date, balance: dict) -> dict:
    dia = aldea.estado.get("dia", 1)
    por_id = {a.id: a for a in estado.aldeanos(s, aldea, solo_presentes=False)}
    sucesos = s.scalars(
        select(Suceso).where(Suceso.aldea_id == aldea.id, Suceso.dia == dia, Suceso.tipo.in_(TIPOS_CONTABLES)).order_by(Suceso.id)
    )
    escenas = s.scalars(select(Escena).where(Escena.aldea_id == aldea.id, Escena.dia == dia).order_by(Escena.id))
    decisiones = s.scalars(
        select(Peticion).where(Peticion.aldea_id == aldea.id, Peticion.dia == dia, Peticion.estado != "abierta").order_by(Peticion.id)
    )
    escriba = next((a for a in por_id.values() if a.oficio == "escriba"), None)
    # Las escenas más sabrosas, primero.
    orden = {"rivalidad": 0, "amor_solos": 1, "deuda": 2, "rumor": 3, "hambre": 4, "senor_mal": 5, "amor_disimulo": 6}
    lista_escenas = sorted(escenas, key=lambda e: orden.get(e.tema, 9))
    return {
        "aldea": contexto.de_aldea(aldea),
        "fecha_texto": tiempo.fecha_bonita(fecha),
        "balance": balance,
        "sucesos": [x.texto for x in sucesos],
        "escenas": [
            {"lugar": e.lugar, "tema": e.tema,
             "nombres": [(por_id[i].datos or {}).get("apodo", por_id[i].nombre) for i in e.participantes if i in por_id]}
            for e in lista_escenas
        ],
        "decisiones": [f"{p.titulo}: {p.resultado}" for p in decisiones if p.resultado],
        "escriba": {
            "presente": bool(escriba and escriba.presente and escriba.vivo),
            "nombre": escriba.nombre if escriba else "", "opinion": escriba.opinion_senor if escriba else 0,
            "animo": escriba.animo if escriba else 50, "habla": (escriba.datos or {}).get("habla", {}) if escriba else {},
        },
        "gobierno": contexto.de_estado(s, aldea),
        "semilla": f"{aldea.semilla}|{dia}|cronica",
    }


def escribir(s: Session, aldea: Aldea, fecha: date, balance: dict, ia: Any = None, ligero: bool = False) -> Cronica:
    """Escribe (o reescribe) la crónica del día. Si la IA falla o no vale, la hace el motor simulado."""
    from ..ia.simulado import MotorSimulado

    dia = aldea.estado.get("dia", 1)
    ctx = contexto_cronica(s, aldea, fecha, balance)
    simulado = MotorSimulado()
    motor = simulado if (ia is None or ligero) else ia
    texto, opiniones = _pedir(s, aldea, motor, ctx)
    if texto is None and motor is not simulado:
        texto, opiniones = _pedir(s, aldea, simulado, ctx)
    cronica = s.scalar(select(Cronica).where(Cronica.aldea_id == aldea.id, Cronica.dia == dia))
    if cronica is None:
        cronica = Cronica(aldea_id=aldea.id, dia=dia, fecha=fecha.isoformat(), texto="", opiniones=[])
        s.add(cronica)
    cronica.texto = texto or "Hoy el escriba no ha escrito nada. Mala señal o buena siesta."
    cronica.opiniones = opiniones
    cronica.datos = {"balance": balance}
    s.flush()
    estado.emitir(aldea, "cronica", dia=dia)
    return cronica


def _pedir(s: Session, aldea: Aldea, motor: Any, ctx: dict) -> tuple[str | None, list[str]]:
    propuesta, error = validador.como_propuesta(motor.cronica(ctx))
    texto = propuesta.get("texto")
    if error is None and (motivo := validador.motivo_texto(texto, 20, 4000)) is not None:
        error = f"crónica no válida: {motivo}"
    if error is not None:
        social.registrar_rechazos(s, aldea, "cronica", [(propuesta, error)])
        return None, []
    opiniones = []
    for o in propuesta.get("opiniones") or []:
        if validador.motivo_texto(o, 3, 400) is None and len(opiniones) < 5:
            opiniones.append(o.strip())
    return texto.strip(), opiniones


def ultima(s: Session, aldea: Aldea) -> Cronica | None:
    return s.scalar(select(Cronica).where(Cronica.aldea_id == aldea.id).order_by(Cronica.dia.desc()).limit(1))
