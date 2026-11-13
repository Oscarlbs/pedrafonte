"""Carga de los YAML editables de mundo/datos/."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import yaml

from . import config

RECURSOS = ("grano", "madera", "piedra", "oro")
DESPENSA = ("harina", "pan")
TODOS_RECURSOS = RECURSOS + DESPENSA


@lru_cache
def cargar(nombre: str) -> Any:
    """Devuelve el contenido de mundo/datos/<nombre>.yaml (vacío si no existe)."""
    ruta = config.DATOS / f"{nombre}.yaml"
    if not ruta.exists():
        return {}
    return yaml.safe_load(ruta.read_text(encoding="utf-8")) or {}


def recargar() -> None:
    cargar.cache_clear()
    catalogo.cache_clear()


@lru_cache
def catalogo() -> dict[str, dict]:
    """Catálogo de edificios por clave, con valores por defecto ya puestos."""
    resultado: dict[str, dict] = {}
    for entrada in cargar("edificios"):
        e = dict(entrada)
        e.setdefault("coste", {})
        e.setdefault("requisitos", {})
        e.setdefault("efecto", {})
        e.setdefault("categoria", "adorno")
        e["tam"] = [int(e["tam"][0]), int(e["tam"][1])]
        resultado[e["clave"]] = e
    return resultado


def paisaje(clave: str) -> dict:
    paisajes = cargar("paisajes")
    return paisajes.get(clave) or paisajes["valle"]


def dificultad(clave: str) -> dict:
    tabla = cargar("dificultades") or {}
    base = {"recursos": 1.0, "produccion": 1.0, "riesgo": 1.0, "paciencia": 1.0}
    return {**base, **(tabla.get(clave) or tabla.get("normal") or {})}
