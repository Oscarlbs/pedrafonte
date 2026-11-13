"""Reflexión nocturna: cada vecino repasa su día. Se agrupan varios por llamada a la IA."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..modelos import Aldea, Aldeano, Escena
from . import contexto, estado, social, validador

LOTE = 4  # vecinos por llamada

TEMAS_MALOS = {"rivalidad", "deuda", "hambre", "impuestos", "senor_mal", "recelo", "sin_techo"}
TEMAS_BUENOS = {"amor_solos", "fiesta", "amistad", "abundancia", "recien_llegado", "senor_bien"}


def noche(s: Session, aldea: Aldea, ia: Any = None) -> int:
    """Devuelve cuántas reflexiones se guardaron."""
    if ia is None:
        return 0
    gente = estado.aldeanos(s, aldea)
    dia = aldea.estado.get("dia", 1)
    escenas = list(s.scalars(select(Escena).where(Escena.aldea_id == aldea.id, Escena.dia == dia)))
    guardadas = 0
    for i in range(0, len(gente), LOTE):
        lote = gente[i:i + LOTE]
        ctx = {
            "aldea": contexto.de_aldea(aldea),
            "estado": contexto.de_estado(s, aldea),
            "aldeanos": [_perfil_noche(s, aldea, a, dia, escenas) for a in lote],
            "semilla": f"{aldea.semilla}|{dia}|noche|{i}",
        }
        propuesta, error = validador.como_propuesta(ia.reflexion(ctx))
        if error is not None:
            social.registrar_rechazos(s, aldea, "reflexion", [(propuesta, error)])
            continue
        por_clave = {a.clave: a for a in lote}
        reflexiones = propuesta.get("reflexiones")
        if not isinstance(reflexiones, list):
            social.registrar_rechazos(s, aldea, "reflexion", [(propuesta, "«reflexiones» no es una lista")])
            continue
        vistos: set[str] = set()
        for r in reflexiones:
            clave = r.get("aldeano") if isinstance(r, dict) else None
            if clave not in por_clave or clave in vistos:
                social.registrar_rechazos(s, aldea, "reflexion", [(r, "reflexión de alguien que no está en el lote, o repetida")])
                continue
            motivo = validador.motivo_texto(r.get("texto"), 3, 300)
            if motivo is not None:
                social.registrar_rechazos(s, aldea, "reflexion", [(r, motivo)])
                continue
            vistos.add(clave)
            a = por_clave[clave]
            social.recordar(s, aldea, a, r["texto"], 5, "reflexion")
            # En su reflexión, cada cual solo puede cambiarse a sí mismo.
            social.validar_y_aplicar(s, aldea, r.get("cambios"), [a], "reflexion")
            guardadas += 1
    return guardadas


def _perfil_noche(s: Session, aldea: Aldea, a: Aldeano, dia: int, escenas: list[Escena]) -> dict:
    perfil = contexto.perfil(s, aldea, a, recuerdos=0)
    perfil["recuerdos_hoy"] = [r.texto for r in social.recuerdos_de(s, aldea, a.id, 4, desde_dia=dia)]
    temas = {e.tema for e in escenas if a.id in e.participantes}
    perfil["dia_malo"] = bool(temas & TEMAS_MALOS) or a.hambre > 0
    perfil["dia_bueno"] = bool(temas & TEMAS_BUENOS) and not perfil["dia_malo"]
    return perfil
