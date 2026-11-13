"""Aplicar al mundo los cambios sociales ya validados, y registrar los rechazados."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..modelos import Aldea, Aldeano, Rechazo, Recuerdo
from . import estado, validador

MAX_RECUERDOS = 40


def contexto(s: Session, aldea: Aldea, presentes: list[Aldeano]) -> validador.Contexto:
    todos = estado.aldeanos(s, aldea)
    return validador.Contexto(
        presentes={a.clave for a in presentes},
        conocidos={a.clave for a in todos},
        dinero={a.clave: a.dinero for a in presentes},
    )


def registrar_rechazos(s: Session, aldea: Aldea, origen: str, rechazados: list[tuple[Any, str]]) -> None:
    for propuesta, motivo in rechazados:
        s.add(Rechazo(
            aldea_id=aldea.id, dia=aldea.estado.get("dia", 0), origen=origen,
            propuesta=propuesta if isinstance(propuesta, dict) else {"valor": repr(propuesta)[:500]},
            motivo=motivo,
        ))


def validar_y_aplicar(
    s: Session, aldea: Aldea, cambios: Any, presentes: list[Aldeano], origen: str
) -> list[dict]:
    """Valida los cambios propuestos por la IA, registra los rechazados y aplica los válidos."""
    validos, rechazados = validador.validar_cambios(cambios, contexto(s, aldea, presentes))
    registrar_rechazos(s, aldea, origen, rechazados)
    aplicar(s, aldea, validos)
    return validos


def aplicar(s: Session, aldea: Aldea, cambios: list[dict]) -> None:
    """Aplica cambios que YA han pasado el validador."""
    por_clave = {a.clave: a for a in estado.aldeanos(s, aldea)}
    for c in cambios:
        tipo = c["tipo"]
        if tipo == "relacion":
            cambiar_relacion(s, aldea, por_clave[c["a"]].id, por_clave[c["b"]].id, c["delta"])
        elif tipo == "recuerdo":
            recordar(s, aldea, por_clave[c["aldeano"]], c["texto"], c["importancia"], "escena")
        elif tipo == "rumor":
            from . import rumores

            rumores.crear(s, aldea, por_clave[c["sobre"]], c["texto"], origen=por_clave[c["origen"]])
        elif tipo == "animo":
            a = por_clave[c["aldeano"]]
            a.animo = int(estado.limitar(a.animo + c["delta"], 0, 100))
        elif tipo == "opinion_senor":
            a = por_clave[c["aldeano"]]
            a.opinion_senor = int(estado.limitar(a.opinion_senor + c["delta"], -100, 100))
        elif tipo == "dinero":
            de, a = por_clave[c["de"]], por_clave[c["a"]]
            de.dinero -= c["cantidad"]
            a.dinero += c["cantidad"]
        elif tipo == "tension":
            tensar(aldea, c["delta"])
    s.flush()


def cambiar_relacion(s: Session, aldea: Aldea, a_id: int, b_id: int, delta: int) -> int:
    r = estado.relacion(s, aldea, a_id, b_id)
    r.valor = int(estado.limitar(r.valor + delta, -100, 100))
    return r.valor


def tensar(aldea: Aldea, delta: float) -> None:
    e = aldea.estado
    e["tension"] = round(estado.limitar(e.get("tension", 0) + delta, 0, 100), 1)
    e["tension_hoy"] = round(e.get("tension_hoy", 0) + delta, 1)
    aldea.tocar()


def recordar(
    s: Session, aldea: Aldea, aldeano: Aldeano, texto: str, importancia: int = 3, tipo: str = "escena"
) -> Recuerdo:
    """Guarda un recuerdo y, si ya tiene demasiados, olvida el menos importante de los viejos."""
    recuerdo = Recuerdo(
        aldea_id=aldea.id, aldeano_id=aldeano.id, dia=aldea.estado.get("dia", 1), hora=aldea.estado.get("hora", 12),
        texto=texto.strip()[:300], importancia=int(estado.limitar(importancia, 1, 10)), tipo=tipo,
    )
    s.add(recuerdo)
    s.flush()
    cuantos = s.scalar(
        select(func.count()).select_from(Recuerdo).where(Recuerdo.aldea_id == aldea.id, Recuerdo.aldeano_id == aldeano.id)
    )
    if cuantos and cuantos > MAX_RECUERDOS:
        # Se olvida lo poco importante y antiguo; lo de hoy no se toca.
        viejo = s.scalar(
            select(Recuerdo).where(
                Recuerdo.aldea_id == aldea.id, Recuerdo.aldeano_id == aldeano.id, Recuerdo.id != recuerdo.id
            ).order_by(Recuerdo.importancia, Recuerdo.dia, Recuerdo.id).limit(1)
        )
        if viejo is not None:
            s.delete(viejo)
    return recuerdo


def recuerdos_de(s: Session, aldea: Aldea, aldeano_id: int, limite: int = 5, desde_dia: int | None = None) -> list[Recuerdo]:
    consulta = select(Recuerdo).where(Recuerdo.aldea_id == aldea.id, Recuerdo.aldeano_id == aldeano_id)
    if desde_dia is not None:
        consulta = consulta.where(Recuerdo.dia >= desde_dia)
    return list(s.scalars(consulta.order_by(Recuerdo.dia.desc(), Recuerdo.importancia.desc(), Recuerdo.id.desc()).limit(limite)))
