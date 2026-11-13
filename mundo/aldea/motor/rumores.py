"""Rumores: nacen, pasan de boca en boca y se deforman por el camino.

El motor decide si un rumor pasa y a quién; la IA solo propone cómo queda al contarlo. El texto deformado
tiene que seguir hablando de la misma persona, o se rechaza.
"""

from __future__ import annotations

import random
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..modelos import Aldea, Aldeano, Rumor, RumorCopia
from . import estado, social, validador

MAX_DEFORMACION = 6


def crear(
    s: Session, aldea: Aldea, sobre: Aldeano, texto: str, origen: Aldeano | None = None,
    verdad: bool = False, sabe: list[Aldeano] | None = None,
) -> Rumor:
    """Echa a correr un rumor nuevo. Lo conocen de salida el origen y quien se indique."""
    texto = limpiar(texto)
    rumor = Rumor(
        aldea_id=aldea.id, sobre_id=sobre.id, origen_id=origen.id if origen else None,
        texto=texto, verdad=verdad, dia=aldea.estado.get("dia", 1),
    )
    s.add(rumor)
    s.flush()
    for a in {x.id: x for x in ([origen] if origen else []) + (sabe or [])}.values():
        if a.id != sobre.id:
            s.add(RumorCopia(
                aldea_id=aldea.id, rumor_id=rumor.id, aldeano_id=a.id, texto=texto, deformacion=0,
                de_quien_id=None, dia=rumor.dia,
            ))
    s.flush()
    return rumor


def limpiar(texto: str) -> str:
    """«que Fulano hace tal» → «Fulano hace tal» (así se escriben los rumores en los YAML)."""
    texto = texto.strip().rstrip(".")
    if texto.lower().startswith("que "):
        texto = texto[4:]
    return texto[:1].upper() + texto[1:]


def copias_de(s: Session, aldea: Aldea, aldeano_id: int) -> list[RumorCopia]:
    return list(s.scalars(
        select(RumorCopia).where(RumorCopia.aldea_id == aldea.id, RumorCopia.aldeano_id == aldeano_id)
        .order_by(RumorCopia.dia.desc(), RumorCopia.id.desc())
    ))


def sabe(s: Session, aldea: Aldea, aldeano_id: int, rumor_id: int) -> bool:
    return s.scalar(
        select(RumorCopia.id).where(
            RumorCopia.aldea_id == aldea.id, RumorCopia.aldeano_id == aldeano_id, RumorCopia.rumor_id == rumor_id
        )
    ) is not None


def candidato(s: Session, aldea: Aldea, de: Aldeano, a: Aldeano) -> RumorCopia | None:
    """Un rumor que `de` conoce, `a` no, y que no habla de `a` ni está ya demasiado deformado."""
    for copia in copias_de(s, aldea, de.id):
        rumor = s.get(Rumor, copia.rumor_id)
        if rumor is None or rumor.sobre_id == a.id or copia.deformacion >= MAX_DEFORMACION:
            continue
        if not sabe(s, aldea, a.id, rumor.id):
            return copia
    return None


def ganas_de_contar(de: Aldeano, relacion: int, azar: random.Random) -> bool:
    """¿Se anima `de` a contárselo a alguien con quien se lleva así?"""
    rasgos = set(de.rasgos or [])
    if relacion < -40 and "malicioso" not in rasgos:
        return False  # a quien no se traga, ni los buenos días
    probabilidad = 0.4 + relacion / 250
    probabilidad += 0.3 if "chismoso" in rasgos else 0
    probabilidad += 0.1 if "exagerado" in rasgos or "picaro" in rasgos else 0
    probabilidad -= 0.25 if "callado" in rasgos else 0
    probabilidad -= 0.1 if "leal" in rasgos else 0
    return azar.random() < estado.limitar(probabilidad, 0.05, 0.95)


def motivo_deformado(texto: Any, sobre: Aldeano) -> str | None:
    """Por qué no vale un texto deformado, o None si vale: debe seguir nombrando a quien toca."""
    if (motivo := validador.motivo_texto(texto, 8, 240)) is not None:
        return motivo
    nombres = {sobre.nombre.split()[0].lower(), str((sobre.datos or {}).get("apodo", "")).lower()} - {""}
    if not any(n in texto.lower() for n in nombres):
        return f"el rumor deformado ya no habla de {sobre.nombre}"
    return None


def pasar(
    s: Session, aldea: Aldea, copia: RumorCopia, de: Aldeano, a: Aldeano, ia: Any, texto_propuesto: str | None = None
) -> RumorCopia | None:
    """`de` le cuenta el rumor a `a`. Devuelve la copia nueva (deformada), o None si no pasa."""
    rumor = s.get(Rumor, copia.rumor_id)
    if rumor is None or rumor.sobre_id == a.id or sabe(s, aldea, a.id, rumor.id):
        return None
    if copia.deformacion >= MAX_DEFORMACION:
        return None
    sobre = s.get(Aldeano, rumor.sobre_id)
    if sobre is None:
        return None

    texto = texto_propuesto
    if texto is None and ia is not None:
        respuesta, error = validador.como_propuesta(ia.deformar_rumor(contexto_deformar(aldea, copia, sobre, de)))
        texto = respuesta.get("texto") if error is None else None
        if error is not None:
            social.registrar_rechazos(s, aldea, "rumor", [(respuesta, error)])
    motivo = motivo_deformado(texto, sobre) if texto is not None else "sin propuesta"
    if motivo is not None:
        if texto is not None:
            social.registrar_rechazos(s, aldea, "rumor", [({"texto": texto, "rumor": rumor.id}, motivo)])
        texto = copia.texto  # pasa tal cual lo oyó; el motor no inventa
    nueva = RumorCopia(
        aldea_id=aldea.id, rumor_id=rumor.id, aldeano_id=a.id, texto=limpiar(texto),
        deformacion=copia.deformacion + 1, de_quien_id=de.id, dia=aldea.estado.get("dia", 1),
    )
    s.add(nueva)
    # Oír un rumor enfría el trato con el aludido; más cuanto más gordo llega.
    social.cambiar_relacion(s, aldea, a.id, sobre.id, -min(8, 3 + nueva.deformacion))
    apodo = (de.datos or {}).get("apodo", de.nombre)
    social.recordar(s, aldea, a, f"{apodo[:1].upper()}{apodo[1:]} me contó que {_minuscula(nueva.texto)}.", 4 + min(3, nueva.deformacion), "rumor")
    social.tensar(aldea, 2)
    s.flush()
    return nueva


def enterarse(s: Session, aldea: Aldea, copia: RumorCopia, de: Aldeano, aludido: Aldeano) -> None:
    """El aludido se entera de lo que anda contando `de`: mal asunto para los dos."""
    social.cambiar_relacion(s, aldea, aludido.id, de.id, -12)
    apodo = (de.datos or {}).get("apodo", de.nombre)
    social.recordar(
        s, aldea, aludido, f"Me he enterado de lo que anda diciendo {apodo} de mí: que {_minuscula(copia.texto)}.", 7, "rumor"
    )
    aludido.animo = int(estado.limitar(aludido.animo - 5, 0, 100))
    social.tensar(aldea, 5)


def contexto_deformar(aldea: Aldea, copia: RumorCopia, sobre: Aldeano, cuenta: Aldeano) -> dict:
    return {
        "aldea": {"nombre": aldea.nombre, "tono": aldea.tono},
        "texto": copia.texto,
        "deformacion": copia.deformacion,
        "sobre": {"clave": sobre.clave, "nombre": sobre.nombre, "apodo": (sobre.datos or {}).get("apodo", sobre.nombre)},
        "cuenta": {"clave": cuenta.clave, "nombre": cuenta.nombre, "rasgos": list(cuenta.rasgos or [])},
        "semilla": f"{aldea.semilla}|{aldea.estado.get('dia', 0)}|{copia.id}|{cuenta.id}",
    }


def soltar_secreto(s: Session, aldea: Aldea, de_quien: Aldeano, lo_sabe: Aldeano | None = None) -> Rumor | None:
    """El secreto de un vecino se escapa en forma de rumor (lo decide el director de drama)."""
    texto = (de_quien.datos or {}).get("rumor_secreto", "")
    if not texto:
        return None
    sabidos = aldea.estado.setdefault("secretos_en_rumor", [])
    if de_quien.clave in sabidos:
        return None
    sabidos.append(de_quien.clave)
    aldea.tocar()
    return crear(s, aldea, de_quien, texto, origen=lo_sabe, verdad=True, sabe=[lo_sabe] if lo_sabe else [])


def _minuscula(texto: str) -> str:
    """Baja la inicial salvo que sea un nombre propio (los rumores suelen empezar por el nombre)."""
    primera = texto.split(" ", 1)[0]
    return texto if primera[:1].isupper() and primera.lower() not in ("dicen", "me", "lo", "yo", "será", "juran", "cuentan", "por") else texto[:1].lower() + texto[1:]
