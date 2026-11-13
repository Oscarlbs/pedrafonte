"""Leyes del señor: qué hay en vigor y cómo modifican la economía y el ánimo (leyes.yaml)."""

from __future__ import annotations

from .. import datos
from ..modelos import Aldea, Aldeano

NEUTRO = {"produccion": 1.0, "consumo": 1.0, "animo": 0, "tension": 0, "oro_dia": 0, "defensa": 0, "escenas": 1.0}


def tabla() -> dict[str, dict]:
    return {ley["clave"]: ley for ley in (datos.cargar("leyes") or [])}


def en_vigor(aldea: Aldea) -> list[dict]:
    leyes = tabla()
    return [leyes[c] for c in aldea.estado.get("leyes", []) if c in leyes]


def modificadores(aldea: Aldea) -> dict[str, float]:
    """Suma (o producto, para los multiplicadores) de los efectos de las leyes en vigor."""
    total = dict(NEUTRO)
    for ley in en_vigor(aldea):
        for campo, valor in (ley.get("modificadores") or {}).items():
            if campo in ("produccion", "consumo", "escenas"):
                total[campo] *= float(valor)
            elif campo in total:
                total[campo] += valor
    return total


def opinion_de(aldea: Aldea, aldeano: Aldeano) -> int:
    """Cuánto sube o baja la opinión de este vecino por las leyes en vigor (según su oficio y rasgos)."""
    total = 0
    for ley in en_vigor(aldea):
        opinion = ley.get("opinion") or {}
        total += int(opinion.get("todos", 0))
        total += int(opinion.get(aldeano.oficio, 0))
        for rasgo in aldeano.rasgos or []:
            total += int(opinion.get(f"rasgo:{rasgo}", 0))
    return total
