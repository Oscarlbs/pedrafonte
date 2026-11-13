"""Consultas y utilidades comunes sobre el estado de una aldea."""

from __future__ import annotations

import random
import re
from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Aldeano, Edificio, Relacion, Suceso
from . import leyes, tiempo

# Eventos pendientes de enviar por WebSocket, por aldea. La API los vacía tras cada commit.
_eventos: dict[int, list[dict]] = defaultdict(list)


def emitir(aldea: Aldea, tipo: str, **datos_evento: Any) -> None:
    _eventos[aldea.id].append({"tipo": tipo, **datos_evento})


def vaciar_eventos(aldea_id: int) -> list[dict]:
    return _eventos.pop(aldea_id, [])


def limitar(valor: float, minimo: float, maximo: float) -> float:
    return max(minimo, min(maximo, valor))


def azar(aldea: Aldea, *sal: Any) -> random.Random:
    """Azar reproducible: misma aldea, mismo día y misma sal dan el mismo resultado."""
    return random.Random(f"{aldea.semilla}|{aldea.estado.get('dia', 0)}|{'|'.join(map(str, sal))}")


# --- Aldeanos y edificios -------------------------------------------------------------------------

def aldeanos(s: Session, aldea: Aldea, solo_presentes: bool = True) -> list[Aldeano]:
    consulta = select(Aldeano).where(Aldeano.aldea_id == aldea.id).order_by(Aldeano.orden_llegada, Aldeano.id)
    if solo_presentes:
        consulta = consulta.where(Aldeano.presente.is_(True), Aldeano.vivo.is_(True))
    return list(s.scalars(consulta))


def aldeano_por_clave(s: Session, aldea: Aldea, clave: str) -> Aldeano | None:
    return s.scalar(select(Aldeano).where(Aldeano.aldea_id == aldea.id, Aldeano.clave == clave))


def edificios(s: Session, aldea: Aldea) -> list[Edificio]:
    return list(s.scalars(select(Edificio).where(Edificio.aldea_id == aldea.id).order_by(Edificio.id)))


def contar_edificios(s: Session, aldea: Aldea) -> dict[str, int]:
    cuenta: dict[str, int] = defaultdict(int)
    for e in edificios(s, aldea):
        cuenta[e.clave] += 1
    return dict(cuenta)


def plazas(s: Session, aldea: Aldea) -> int:
    catalogo = datos.catalogo()
    return sum(int(catalogo[e.clave]["efecto"].get("vivienda", 0)) for e in edificios(s, aldea) if e.clave in catalogo)


def suma_efecto(s: Session, aldea: Aldea, campo: str, solo_atendidos: bool = True) -> float:
    """Suma un efecto numérico de todos los edificios (los que piden trabajador, solo si lo tienen)."""
    catalogo = datos.catalogo()
    atendidos = {a.trabajo_id for a in aldeanos(s, aldea)}
    total = 0.0
    for e in edificios(s, aldea):
        efecto = catalogo.get(e.clave, {}).get("efecto", {})
        if campo not in efecto:
            continue
        if solo_atendidos and efecto.get("trabajadores") and e.id not in atendidos:
            continue
        total += float(efecto[campo])
    return total


MAX_DEFENSA_MUROS = 15.0


def defensa(s: Session, aldea: Aldea) -> float:
    """Defensa de la aldea: torres con guardia, murallas y empalizadas (con tope), rondas, alianzas y tropa."""
    return round(sum(partes_defensa(s, aldea).values()), 1)


def partes_defensa(s: Session, aldea: Aldea) -> dict[str, float]:
    """La defensa desglosada: torres, muros, leyes, alianzas, apaños de un día y la tropa que está en casa."""
    from . import guerra  # import tardío: guerra usa este módulo

    catalogo = datos.catalogo()
    atendidos = {a.trabajo_id for a in aldeanos(s, aldea)}
    torres = muros = 0.0
    for e in edificios(s, aldea):
        efecto = catalogo.get(e.clave, {}).get("efecto", {})
        if "defensa" not in efecto:
            continue
        if efecto.get("arrastre"):
            muros += float(efecto["defensa"])
        elif not efecto.get("trabajadores") or e.id in atendidos:
            torres += float(efecto["defensa"])
    banderas = aldea.estado.get("banderas", {})
    muros = min(MAX_DEFENSA_MUROS, muros)
    return {
        "torres": round(torres, 1),
        "muros": round(muros, 1),
        "leyes": round(float(leyes.modificadores(aldea)["defensa"]), 1),
        "alianzas": 5.0 * min(2, len(aldea.estado.get("alianzas", []))),
        "extra": round(float(banderas.get("defensa_extra", 0)), 1),
        "tropas": guerra.guarnicion(aldea, hay_muros=muros > 0),
    }


# --- Recursos -------------------------------------------------------------------------------------

def recursos(aldea: Aldea) -> dict[str, float]:
    return aldea.estado.setdefault("recursos", {r: 0 for r in datos.TODOS_RECURSOS})


def puede_pagar(aldea: Aldea, coste: dict[str, float]) -> bool:
    r = recursos(aldea)
    return all(r.get(k, 0) >= v for k, v in coste.items())


def pagar(aldea: Aldea, coste: dict[str, float]) -> None:
    r = recursos(aldea)
    for k, v in coste.items():
        r[k] = round(r.get(k, 0) - v, 2)
    aldea.tocar()


def sumar_recurso(aldea: Aldea, recurso: str, delta: float) -> float:
    """Suma (o resta, sin bajar de cero). Devuelve lo realmente aplicado."""
    r = recursos(aldea)
    antes = r.get(recurso, 0)
    r[recurso] = round(max(0.0, antes + delta), 2)
    aldea.tocar()
    return r[recurso] - antes


def raciones_guardadas(aldea: Aldea) -> float:
    r = recursos(aldea)
    return r.get("pan", 0) + r.get("grano", 0) / 1.5 + r.get("harina", 0) / 1.2


# --- Relaciones -----------------------------------------------------------------------------------

def relacion(s: Session, aldea: Aldea, a_id: int, b_id: int, crear: bool = True) -> Relacion | None:
    a_id, b_id = sorted((a_id, b_id))
    r = s.scalar(
        select(Relacion).where(Relacion.aldea_id == aldea.id, Relacion.a_id == a_id, Relacion.b_id == b_id)
    )
    if r is None and crear and a_id != b_id:
        r = Relacion(aldea_id=aldea.id, a_id=a_id, b_id=b_id, valor=0)
        s.add(r)
        s.flush()
    return r


def valor_relacion(s: Session, aldea: Aldea, a_id: int, b_id: int) -> int:
    r = relacion(s, aldea, a_id, b_id, crear=False)
    return r.valor if r else 0


def relaciones_de(s: Session, aldea: Aldea, aldeano_id: int) -> list[tuple[int, Relacion]]:
    """Pares (id del otro, relación) de un aldeano."""
    filas = s.scalars(
        select(Relacion).where(
            Relacion.aldea_id == aldea.id, (Relacion.a_id == aldeano_id) | (Relacion.b_id == aldeano_id)
        )
    )
    return [(r.b_id if r.a_id == aldeano_id else r.a_id, r) for r in filas]


# --- Bitácora -------------------------------------------------------------------------------------

def pulir(texto: str) -> str:
    """Lo que una plantilla no sabe hacer sola: «de el abad» → «del abad», y mayúscula tras punto."""
    texto = texto.replace(" a el ", " al ").replace(" de el ", " del ").replace("A el ", "Al ").replace("De el ", "Del ")
    texto = re.sub(r"([.!?]\s+)([a-zñáéíóú])", lambda m: m.group(1) + m.group(2).upper(), texto)
    return texto[:1].upper() + texto[1:]


def anotar(s: Session, aldea: Aldea, tipo: str, texto: str, **datos_suceso: Any) -> Suceso:
    texto = pulir(texto)
    suceso = Suceso(
        aldea_id=aldea.id, dia=aldea.estado.get("dia", 1), hora=aldea.estado.get("hora", 12),
        tipo=tipo, texto=texto, datos=datos_suceso,
    )
    s.add(suceso)
    emitir(aldea, "suceso", clase=tipo, texto=texto, dia=suceso.dia, hora=suceso.hora)
    return suceso


# --- Variables para las condiciones de los YAML -----------------------------------------------------

def variables(s: Session, aldea: Aldea) -> dict[str, Any]:
    e = aldea.estado
    gente = aldeanos(s, aldea)
    poblacion = len(gente)
    r = recursos(aldea)
    cuenta = contar_edificios(s, aldea)
    fecha = tiempo.fecha_de_dia(aldea, e.get("dia", 1))
    v: dict[str, Any] = {
        **{k: r.get(k, 0) for k in datos.TODOS_RECURSOS},
        "poblacion": poblacion,
        "plazas": plazas(s, aldea),
        "dia": e.get("dia", 1),
        "estacion": tiempo.estacion(fecha),
        "mes": fecha.month,
        "impuestos": e.get("impuestos", 1),
        "tension": e.get("tension", 0),
        "hambre_dias": e.get("hambre_dias", 0),
        "revuelta": bool(e.get("revuelta", {}).get("activa")),
        "defensa": defensa(s, aldea),
        "animo_medio": round(sum(a.animo for a in gente) / poblacion) if poblacion else 50,
        "opinion_media": round(sum(a.opinion_senor for a in gente) / poblacion) if poblacion else 0,
        "dias_comida": round(raciones_guardadas(aldea) / poblacion, 1) if poblacion else 99,
        "enfermos": sum(1 for a in gente if a.salud < 40),
        "peste": bool(e.get("peste")),
        "amenaza": bool(e.get("amenaza")),
        "alianzas": len(e.get("alianzas", [])),
        "visitante": bool(e.get("banderas", {}).get("visitante")),
    }
    v["sin_techo"] = max(0, poblacion - v["plazas"])
    from . import guerra, tutorial  # import tardío: los dos usan este módulo

    v.update(guerra.variables(s, aldea))
    v.update(tutorial.variables(aldea))
    for clave in datos.catalogo():
        v[f"tiene_{clave}"] = cuenta.get(clave, 0)
    for ley in e.get("leyes", []):
        v[f"ley_{ley}"] = True
    for a in gente:
        v[f"esta_{a.clave}"] = True
    for clave in e.get("secretos_en_rumor", []):
        v[f"secreto_fuera_{clave}"] = True
    for nombre, valor in e.get("banderas", {}).items():
        v.setdefault(f"bandera_{nombre}", valor)
    return v
