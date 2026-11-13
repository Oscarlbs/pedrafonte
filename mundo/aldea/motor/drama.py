"""El director de drama: mide la tensión y, si la aldea se aburre dos días, saca un suceso de la tabla."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Suceso
from . import condiciones, efectos, estado, leyes

UMBRAL_BAJA = 25       # por debajo de esto, la aldea está «tranquila de más»
DIAS_BAJA = 2          # días seguidos de calma antes de que pase algo
DESCANSO = 2           # días de respiro tras un suceso del director


def actualizar_tension(s: Session, aldea: Aldea) -> float:
    """La tensión se enfría sola y sube con lo que de verdad aprieta: hambre, tributos, revuelta."""
    e = aldea.estado
    v = estado.variables(s, aldea)
    aportes = 0.0
    if v["hambre_dias"] > 0:
        aportes += 8
    aportes += {3: 3, 4: 6}.get(v["impuestos"], 0)
    aportes += 2 if v["sin_techo"] >= 2 else 0
    aportes += 5 if v["revuelta"] else 0
    aportes += leyes.modificadores(aldea)["tension"]
    calma = estado.suma_efecto(s, aldea, "calma") * 0.3
    tension = estado.limitar(e.get("tension", 0) * 0.82 + aportes - calma, 0, 100)
    e["tension"] = round(tension, 1)
    e["tension_historial"] = (e.get("tension_historial", []) + [round(tension)])[-14:]
    aldea.tocar()
    return tension


def cierre(s: Session, aldea: Aldea, ligero: bool = False, ia: Any = None) -> Suceso | None:
    actualizar_tension(s, aldea)
    if ligero:
        return None
    e = aldea.estado
    historial = e.get("tension_historial", [])
    aburrida = len(historial) >= DIAS_BAJA and all(t < UMBRAL_BAJA for t in historial[-DIAS_BAJA:])
    if aburrida and e.get("dia", 1) >= e.get("enfriamientos", {}).get("drama", 0):
        return lanzar(s, aldea)
    return None


def candidatos(s: Session, aldea: Aldea) -> list[tuple[dict, dict]]:
    """Sucesos posibles ahora mismo, con sus sujetos ya resueltos."""
    e = aldea.estado
    dia = e.get("dia", 1)
    v = estado.variables(s, aldea)
    posibles = []
    for i, suceso in enumerate(datos.cargar("sucesos") or []):
        if dia < e.get("enfriamientos", {}).get(suceso["clave"], 0):
            continue
        if not condiciones.cumple(suceso.get("condicion"), v):
            continue
        sujetos = efectos.resolver_sujetos(s, aldea, suceso.get("sujetos"), estado.azar(aldea, "drama", i))
        if sujetos is None:
            continue
        posibles.append((suceso, sujetos))
    return posibles


def lanzar(s: Session, aldea: Aldea, clave: str | None = None) -> Suceso | None:
    """Saca un suceso de la tabla (el indicado, o uno al azar según peso) y aplica sus efectos."""
    posibles = candidatos(s, aldea)
    if clave is not None:
        posibles = [p for p in posibles if p[0]["clave"] == clave]
    if not posibles:
        return None
    azar = estado.azar(aldea, "drama-elige")
    suceso, sujetos = azar.choices(posibles, weights=[float(p[0].get("peso", 1)) for p in posibles])[0]
    texto = efectos.rellenar(suceso["texto"], efectos.huecos(aldea, sujetos))
    efectos.aplicar(s, aldea, suceso.get("efectos"), sujetos)
    e = aldea.estado
    dia = e.get("dia", 1)
    e.setdefault("enfriamientos", {})[suceso["clave"]] = dia + int(suceso.get("enfriamiento", 7))
    e["enfriamientos"]["drama"] = dia + DESCANSO
    aldea.tocar()
    return estado.anotar(s, aldea, "drama", texto, clave=suceso["clave"], sujetos={k: a.id for k, a in sujetos.items()})
