"""Hablar con un vecino. Contesta en su papel, con lo que sabe y lo que calla.

El motor decide cuánta confianza hay (según la opinión que tiene del señor); la IA escribe la respuesta.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..ia.base import INTENCIONES_CHARLA
from ..modelos import Aldea, Aldeano
from . import contexto, estado, social, validador
from .construccion import NoSePuede

# Opinión sobre el señor a partir de la cual un vecino suelta una pista de su secreto, o lo confiesa.
CONFIANZA_PISTA = 40
CONFIANZA_REVELA = 70
# Con buenas palabras se gana opinión, pero poca: este es el tope por vecino y día.
TOPE_OPINION_DIA = 4


def confianza(a: Aldeano) -> str:
    if a.opinion_senor >= CONFIANZA_REVELA:
        return "revela"
    if a.opinion_senor >= CONFIANZA_PISTA:
        return "pista"
    return "niega"


def hablar(s: Session, aldea: Aldea, a: Aldeano, mensaje: str, ia: Any) -> dict:
    if not a.presente or not a.vivo:
        raise NoSePuede(f"{a.nombre} no está en la aldea.")
    if (motivo := validador.motivo_texto(mensaje, 1, 400)) is not None:
        raise NoSePuede(f"No os ha entendido: {motivo}.")
    e = aldea.estado
    nivel = confianza(a)
    perfil = contexto.perfil(s, aldea, a, recuerdos=5)
    perfil["relaciones"] = contexto.relaciones_de(s, aldea, a)
    perfil["edificio_oficio"] = contexto.edificio_del_oficio(s, aldea, a)
    ctx = {
        "aldea": contexto.de_aldea(aldea),
        "estado": contexto.de_estado(s, aldea),
        "aldeano": perfil,
        "vecinos": contexto.vecinos(s, aldea),
        "confianza": nivel,
        "mensaje": mensaje.strip(),
        "semilla": f"{aldea.semilla}|{e.get('dia')}|{a.id}|{mensaje.strip()}|{e.get('charlas', 0)}",
    }
    e["charlas"] = e.get("charlas", 0) + 1
    propuesta, error = validador.como_propuesta(ia.charla(ctx))
    respuesta = propuesta.get("respuesta")
    if error is None and (motivo := validador.motivo_texto(respuesta, 1, 600)) is not None:
        error = f"respuesta no válida: {motivo}"
    if error is not None:
        social.registrar_rechazos(s, aldea, "charla", [(propuesta, error)])
        return {"respuesta": "…", "aldeano": a.id, "revelado": False}

    cambios = propuesta.get("cambios")
    if isinstance(cambios, list):
        cambios = _topar_opinion(s, aldea, a, cambios)
    social.validar_y_aplicar(s, aldea, cambios, [a], "charla")

    intencion = propuesta.get("intencion")
    if intencion not in INTENCIONES_CHARLA:
        intencion = "otra"
    revelado = False
    if intencion == "secreto" and nivel == "revela" and a.secreto:
        sabidos = e.setdefault("secretos_sabidos", [])
        if a.clave not in sabidos:
            sabidos.append(a.clave)
            revelado = True
            estado.anotar(s, aldea, "confidencia", f"{a.nombre} os ha confiado su secreto.", aldeano=a.id)
    aldea.tocar()
    return {"respuesta": respuesta.strip(), "aldeano": a.id, "revelado": revelado, "intencion": intencion}


def _topar_opinion(s: Session, aldea: Aldea, a: Aldeano, cambios: list) -> list:
    """Deja fuera (y registra) las subidas de opinión que pasen del tope diario por vecino."""
    e = aldea.estado
    clave_dia = f"{e.get('dia', 1)}:{a.clave}"
    ganado = e.setdefault("charla_opinion", {})
    # Solo se guarda la cuenta de hoy.
    for vieja in [k for k in ganado if not k.startswith(f"{e.get('dia', 1)}:")]:
        ganado.pop(vieja)
    filtrados = []
    for c in cambios:
        if isinstance(c, dict) and c.get("tipo") == "opinion_senor" and isinstance(c.get("delta"), int) and c["delta"] > 0:
            if ganado.get(clave_dia, 0) + c["delta"] > TOPE_OPINION_DIA:
                social.registrar_rechazos(s, aldea, "charla", [(c, "tope diario de opinión ganada conversando")])
                continue
            ganado[clave_dia] = ganado.get(clave_dia, 0) + c["delta"]
        filtrados.append(c)
    return filtrados
