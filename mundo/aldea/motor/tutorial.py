"""El tutorial: las lecciones del escriba, una detrás de otra (`datos/tutorial.yaml`).

El motor mira solo la lección en curso: cuando su condición se cumple, la da por hecha, entrega el
premio y pasa a la siguiente. Lo que el señor hace y no deja huella en el estado (hablar con un vecino,
abrir el mapa) se apunta en `estado["hechos"]` con `apuntar`.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea
from . import condiciones, efectos, estado

HECHOS = ("charla", "decision", "pergamino", "gobierno", "mapa", "diplomacia", "recluta", "campana", "victoria", "defensa")


def pasos() -> list[dict]:
    return (datos.cargar("tutorial") or {}).get("pasos", [])


def apuntar(aldea: Aldea, clave: str, veces: int = 1) -> None:
    hechos = aldea.estado.setdefault("hechos", {})
    hechos[clave] = int(hechos.get(clave, 0)) + veces
    aldea.tocar()


def variables(aldea: Aldea) -> dict[str, int]:
    hechos = aldea.estado.get("hechos", {})
    return {f"hecho_{clave}": int(hechos.get(clave, 0)) for clave in HECHOS}


def activar(aldea: Aldea) -> None:
    aldea.estado["tutorial"] = {"paso": 0, "activo": True, "oculto": False}
    aldea.tocar()


def _dato(aldea: Aldea) -> dict | None:
    return aldea.estado.get("tutorial")


def _cumplir(s: Session, aldea: Aldea, paso: dict) -> dict:
    t = aldea.estado["tutorial"]
    premio = paso.get("premio") or {}
    if premio:
        efectos.aplicar(s, aldea, [{"recursos": premio}])
    t["paso"] = int(t["paso"]) + 1
    if t["paso"] >= len(pasos()):
        t["activo"] = False
        t["terminado"] = True
    aldea.tocar()
    estado.anotar(s, aldea, "tutorial", f"Lección aprendida: {paso['titulo'].lower()}.", clave=paso["clave"])
    estado.emitir(aldea, "tutorial", clave=paso["clave"], titulo=paso["titulo"], premio=premio)
    return {"clave": paso["clave"], "titulo": paso["titulo"], "premio": premio}


def revisar(s: Session, aldea: Aldea, v: dict[str, Any] | None = None) -> list[dict]:
    """Da por cumplidas las lecciones cuya condición ya se cumple (solo la que está en curso, y las que la sigan)."""
    t = _dato(aldea)
    cumplidas: list[dict] = []
    lista = pasos()
    while t and t.get("activo") and int(t["paso"]) < len(lista):
        paso = lista[int(t["paso"])]
        if not paso.get("condicion"):
            break  # lección de leer: espera al «Entendido»
        if not condiciones.cumple(paso["condicion"], v if v is not None and not cumplidas else estado.variables(s, aldea)):
            break
        cumplidas.append(_cumplir(s, aldea, paso))
    return cumplidas


def entendido(s: Session, aldea: Aldea) -> None:
    """El señor pulsa «Entendido» en una lección de leer."""
    t = _dato(aldea)
    lista = pasos()
    if t and t.get("activo") and int(t["paso"]) < len(lista) and not lista[int(t["paso"])].get("condicion"):
        _cumplir(s, aldea, lista[int(t["paso"])])
        revisar(s, aldea)


def orden(s: Session, aldea: Aldea, que: str) -> None:
    """Lo que el señor puede hacer con el tutorial: entendido, ocultar, mostrar, saltar o empezar de nuevo."""
    if que == "entendido":
        entendido(s, aldea)
    elif que == "empezar":
        activar(aldea)
    elif _dato(aldea) is not None:
        t = aldea.estado["tutorial"]
        if que == "ocultar":
            t["oculto"] = True
        elif que == "mostrar":
            t["oculto"] = False
        elif que == "saltar":
            t["activo"] = False
        aldea.tocar()


def resumen(s: Session, aldea: Aldea, v: dict[str, Any] | None = None) -> dict:
    """La lección en curso, para pintarla. De paso revisa si ya está cumplida."""
    revisar(s, aldea, v)
    t = _dato(aldea)
    lista = pasos()
    if not t:
        return {"activo": False, "terminado": False, "total": len(lista)}
    if not t.get("activo") or int(t["paso"]) >= len(lista):
        return {
            "activo": False, "terminado": bool(t.get("terminado")), "total": len(lista), "paso": min(int(t["paso"]), len(lista)),
            "final": (datos.cargar("tutorial") or {}).get("final", "") if t.get("terminado") else "",
        }
    paso = lista[int(t["paso"])]
    capitulos = list(dict.fromkeys(p.get("capitulo", "") for p in lista))
    return {
        "activo": True, "oculto": bool(t.get("oculto")), "terminado": False,
        "paso": int(t["paso"]) + 1, "total": len(lista),
        "clave": paso["clave"], "capitulo": paso.get("capitulo", ""),
        "capitulo_n": capitulos.index(paso.get("capitulo", "")) + 1, "capitulos": len(capitulos),
        "titulo": paso["titulo"], "texto": paso["texto"].replace("{aldea}", aldea.nombre), "como": paso.get("como", ""),
        "manual": not paso.get("condicion"), "boton": paso.get("boton"), "premio": paso.get("premio") or {},
    }
