"""Gobierno: impuestos, leyes y revueltas. Riesgo moderado: cuesta perder, pero se puede."""

from __future__ import annotations

import math

from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea
from . import condiciones, efectos, estado, leyes, tutorial
from .construccion import NoSePuede

# Malestar: opinión media por debajo de esto Y tensión por encima de aquello.
OPINION_REVUELTA = -35
TENSION_REVUELTA = 55
AVISOS_PARA_REVUELTA = 3   # días seguidos de malestar antes de que estalle
DIAS_PARA_PERDER = 7       # días de revuelta sin arreglo antes de que os echen
DIAS_DESPOBLADA = 6        # días seguidos con dos vecinos o menos (pasado el arranque)


def fijar_impuestos(s: Session, aldea: Aldea, nivel: int) -> int:
    if not 0 <= nivel <= 4:
        raise NoSePuede("Los tributos van de 0 (ninguno) a 4 (abusivo).")
    e = aldea.estado
    antes = int(e.get("impuestos", 1))
    if nivel == antes:
        return nivel
    e["impuestos"] = nivel
    aldea.tocar()
    tutorial.apuntar(aldea, "gobierno")
    nombres = datos.cargar("economia")["impuestos"]["nombres"]
    # Subir duele ya; bajar se agradece, pero menos (la gente se acostumbra pronto a lo bueno).
    salto = nivel - antes
    efectos.aplicar(s, aldea, [{"opinion": -3 * salto if salto > 0 else -1 * salto, "a": "todos"}])
    if salto > 0:
        efectos.aplicar(s, aldea, [{"tension": 3 * salto}])
    estado.anotar(
        s, aldea, "ley",
        f"El señor {'sube' if salto > 0 else 'baja'} los tributos: de «{nombres[antes]}» a «{nombres[nivel]}».",
    )
    return nivel


def promulgar(s: Session, aldea: Aldea, clave: str, activa: bool) -> list[str]:
    tabla = leyes.tabla()
    if clave not in tabla:
        raise NoSePuede("Esa ley no existe.")
    ley = tabla[clave]
    e = aldea.estado
    tutorial.apuntar(aldea, "gobierno")
    vigentes = list(e.get("leyes", []))
    if activa == (clave in vigentes):
        return vigentes
    if activa:
        if not condiciones.cumple(ley.get("requisito"), estado.variables(s, aldea)):
            raise NoSePuede(f"Aún no se puede promulgar «{ley['nombre']}»: falta lo que la hace posible.")
        vigentes.append(clave)
        estado.anotar(s, aldea, "ley", f"Se promulga: {ley['nombre']}. {ley.get('descripcion', '')}".strip())
    else:
        vigentes.remove(clave)
        estado.anotar(s, aldea, "ley", f"Se deroga: {ley['nombre']}.")
    e["leyes"] = vigentes
    aldea.tocar()
    return vigentes


def cierre(s: Session, aldea: Aldea, balance: dict) -> None:
    """Cada noche: ¿hay malestar?, ¿estalla la revuelta?, ¿se apaga?, ¿os echan?"""
    e = aldea.estado
    v = estado.variables(s, aldea)
    paciencia = float(datos.dificultad(aldea.dificultad)["paciencia"])
    revuelta = e.setdefault("revuelta", {"activa": False, "dias": 0, "avisos": 0})
    malestar = v["opinion_media"] <= OPINION_REVUELTA and v["tension"] >= TENSION_REVUELTA

    if not revuelta.get("activa"):
        revuelta["avisos"] = revuelta.get("avisos", 0) + 1 if malestar else max(0, revuelta.get("avisos", 0) - 1)
        if revuelta["avisos"] == 1 and malestar:
            estado.anotar(s, aldea, "revuelta", "Se oyen corrillos a deshora y se callan cuando pasáis. Mala cosa.")
        if revuelta["avisos"] >= math.ceil(AVISOS_PARA_REVUELTA * paciencia):
            revuelta.update(activa=True, dias=0)
            perdido = round(estado.recursos(aldea).get("grano", 0) * 0.1)
            estado.sumar_recurso(aldea, "grano", -perdido)
            estado.anotar(
                s, aldea, "revuelta",
                "¡Revuelta! Los vecinos se plantan delante de vuestra puerta con horcas y cacerolas. "
                f"Nadie trabaja a gusto y del granero han volado {perdido} de grano.",
            )
            estado.emitir(aldea, "revuelta", activa=True)
    else:
        revuelta["dias"] = revuelta.get("dias", 0) + 1
        if v["opinion_media"] > -20 or v["tension"] < 40:
            revuelta.update(activa=False, dias=0, avisos=0)
            efectos.aplicar(s, aldea, [{"opinion": 4, "a": "todos"}, {"tension": -10}])
            estado.anotar(s, aldea, "revuelta", "Las aguas vuelven a su cauce: se guardan las horcas y se vuelve a la faena.")
            estado.emitir(aldea, "revuelta", activa=False)
        elif revuelta["dias"] >= math.ceil(DIAS_PARA_PERDER * paciencia):
            perder(s, aldea, "Tras muchos días de revuelta, los vecinos os han acompañado hasta el puente. Con cierta firmeza.")
        else:
            estado.sumar_recurso(aldea, "oro", -3)

    # Una aldea vacía tampoco es aldea.
    if v["poblacion"] <= 2 and v["dia"] > 10:
        e["dias_despoblada"] = e.get("dias_despoblada", 0) + 1
        if e["dias_despoblada"] >= math.ceil(DIAS_DESPOBLADA * paciencia):
            perder(s, aldea, "Ya no queda casi nadie a quien mandar. Una aldea sin vecinos es solo un claro con dueño.")
    else:
        e["dias_despoblada"] = 0
    aldea.tocar()


def perder(s: Session, aldea: Aldea, motivo: str) -> None:
    e = aldea.estado
    if e.get("perdida"):
        return
    e["perdida"] = True
    e["motivo_perdida"] = motivo
    aldea.tocar()
    estado.anotar(s, aldea, "revuelta", motivo)
    estado.emitir(aldea, "perdida", motivo=motivo)


def pedir_perdon(s: Session, aldea: Aldea) -> None:
    """Segunda oportunidad: el señor vuelve con el rabo entre las piernas y el arca vacía."""
    e = aldea.estado
    if not e.get("perdida"):
        raise NoSePuede("No hay nada que perdonar. Todavía.")
    e["perdida"] = False
    e["motivo_perdida"] = None
    e["revuelta"] = {"activa": False, "dias": 0, "avisos": 0}
    e["dias_despoblada"] = 0
    e["tension"] = 30
    e["impuestos"] = min(int(e.get("impuestos", 1)), 1)
    e["leyes"] = [c for c in e.get("leyes", []) if c not in ("jornada_larga", "racionamiento", "toque_de_queda")]
    estado.recursos(aldea)["oro"] = 0
    # Mientras estuvo fuera, el tiempo no pasó: se reanuda desde ahora.
    from . import tiempo

    e["ultima_hora"] = tiempo.clave_hora(tiempo.a_hora(tiempo.ahora_juego(aldea)))
    for a in estado.aldeanos(s, aldea, solo_presentes=False):
        if a.vivo:
            a.opinion_senor = max(a.opinion_senor, -5)
            a.animo = max(a.animo, 45)
    aldea.tocar()
    estado.anotar(
        s, aldea, "revuelta",
        "El señor vuelve por el puente, pide perdón en la plaza y entrega el arca. Se le da otra oportunidad. Una.",
    )
