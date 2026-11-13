"""El consejo diario: dos o tres peticiones nacidas del estado real de la aldea.

El motor elige las peticiones (peticiones.yaml), el señor decide y el motor aplica las consecuencias.
También lleva la cuenta de las promesas del señor: las cumplidas se agradecen, las rotas se pagan.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Aldeano, Peticion
from . import condiciones, efectos, estado, tutorial
from .construccion import NoSePuede


DIAS_DE_GRACIA = 1  # días enteros que una petición espera antes de resolverse sola


def amanecer(s: Session, aldea: Aldea, instante: datetime, ia: Any = None) -> list[Peticion]:
    """Cada mañana: caducan las peticiones viejas, se revisan las promesas y llegan peticiones nuevas."""
    efectos.caducar_banderas(aldea)
    caducar(s, aldea)
    revisar_promesas(s, aldea)
    return generar(s, aldea)


def abiertas(s: Session, aldea: Aldea) -> list[Peticion]:
    return list(s.scalars(
        select(Peticion).where(Peticion.aldea_id == aldea.id, Peticion.estado == "abierta").order_by(Peticion.id)
    ))


def generar(s: Session, aldea: Aldea, cuantas: int | None = None) -> list[Peticion]:
    """Elige las peticiones de hoy entre las que cumplen su condición. Devuelve las creadas."""
    e = aldea.estado
    dia = e.get("dia", 1)
    v = estado.variables(s, aldea)
    if v["poblacion"] == 0 or e.get("perdida"):
        return []
    pendientes = abiertas(s, aldea)
    if cuantas is None:
        # Dos o tres al día, pero sin amontonar: si el señor aún no ha decidido las de ayer, no llegan más.
        cuantas = (3 if v["poblacion"] >= 6 else 2) - len(pendientes)
    ya = {p.clave for p in pendientes}
    posibles: list[tuple[dict, dict[str, Aldeano]]] = []
    for i, ficha in enumerate(datos.cargar("peticiones") or []):
        if ficha["clave"] in ya or dia < e.get("enfriamientos", {}).get(f"peticion:{ficha['clave']}", 0):
            continue
        if not condiciones.cumple(ficha.get("condicion"), v):
            continue
        sujetos = efectos.resolver_sujetos(s, aldea, ficha.get("sujetos"), estado.azar(aldea, "consejo", i))
        if sujetos is None or "p" not in sujetos:
            continue
        posibles.append((ficha, sujetos))
    azar = estado.azar(aldea, "consejo-elige")
    creadas = []
    while posibles and len(creadas) < cuantas:
        ficha, sujetos = azar.choices(posibles, weights=[float(p[0].get("peso", 1)) for p in posibles])[0]
        posibles = [p for p in posibles if p[0] is not ficha]
        valores = efectos.huecos(aldea, sujetos, v)
        opciones = []
        for o in ficha["opciones"]:
            if not condiciones.cumple(o.get("condicion"), v):
                continue
            opciones.append({
                "clave": o["clave"], "texto": efectos.rellenar(o["texto"], valores), "pista": o.get("pista", ""),
                "coste": o.get("coste") or {}, "efectos": o.get("efectos") or [],
                "resultado": efectos.rellenar(o.get("resultado", ""), valores),
            })
        if len(opciones) < 2:
            continue
        defecto = ficha.get("defecto") if any(o["clave"] == ficha.get("defecto") for o in opciones) else opciones[-1]["clave"]
        peticion = Peticion(
            aldea_id=aldea.id, dia=dia, clave=ficha["clave"],
            titulo=efectos.rellenar(ficha["titulo"], valores), texto=efectos.rellenar(ficha["texto"], valores),
            peticionario_id=sujetos["p"].id, sujetos={k: a.id for k, a in sujetos.items()},
            opciones=opciones, defecto=defecto, estado="abierta",
        )
        s.add(peticion)
        creadas.append(peticion)
        e.setdefault("enfriamientos", {})[f"peticion:{ficha['clave']}"] = dia + int(ficha.get("enfriamiento", 5))
    aldea.tocar()
    s.flush()
    if creadas:
        estado.emitir(aldea, "consejo", peticiones=len(creadas))
    return creadas


def resolver(s: Session, aldea: Aldea, peticion_id: int, opcion: str, caducada: bool = False) -> Peticion:
    """El señor elige una opción (o caduca y se aplica la de por defecto). El motor aplica las consecuencias."""
    peticion = s.get(Peticion, peticion_id)
    if peticion is None or peticion.aldea_id != aldea.id:
        raise NoSePuede("Esa petición no existe.")
    if peticion.estado != "abierta":
        raise NoSePuede("Esa petición ya está resuelta.")
    elegida = next((o for o in peticion.opciones if o["clave"] == opcion), None)
    if elegida is None:
        raise NoSePuede("Esa opción no existe.")
    coste = elegida.get("coste") or {}
    if not estado.puede_pagar(aldea, coste):
        if not caducada:
            raise NoSePuede("El arca no da para tanto.")
        coste = {}  # si caduca y no hay con qué, no se cobra (la opción por defecto no debería costar)
    estado.pagar(aldea, coste)
    presentes = {a.id: a for a in estado.aldeanos(s, aldea)}
    sujetos = {papel: presentes[i] for papel, i in (peticion.sujetos or {}).items() if i in presentes}
    efectos.aplicar(s, aldea, elegida.get("efectos"), sujetos)
    if not caducada:
        tutorial.apuntar(aldea, "decision")
    peticion.elegida = opcion
    peticion.estado = "caducada" if caducada else "resuelta"
    peticion.resultado = (
        f"No dijisteis ni que sí ni que no. {elegida['resultado']}" if caducada else elegida["resultado"]
    )
    estado.anotar(s, aldea, "consejo", f"{peticion.titulo}: {peticion.resultado}", peticion=peticion.id, opcion=opcion)
    s.flush()
    return peticion


def caducar(s: Session, aldea: Aldea) -> int:
    """Las peticiones que llevan más de un día entero sin decidir se resuelven solas, por la opción de dejadez.

    Hay un día de gracia: el juego va a hora real y el señor no siempre puede asomarse a diario.
    """
    dia = aldea.estado.get("dia", 1)
    viejas = [p for p in abiertas(s, aldea) if p.dia < dia - DIAS_DE_GRACIA]
    for p in viejas:
        resolver(s, aldea, p.id, p.defecto or p.opciones[-1]["clave"], caducada=True)
        # Dejar las cosas sin decidir tampoco gusta.
        efectos.aplicar(s, aldea, [{"opinion": -1, "a": "todos"}])
    return len(viejas)


def revisar_promesas(s: Session, aldea: Aldea) -> None:
    """Promesa cumplida, gratitud; promesa rota, se acuerdan todos."""
    e = aldea.estado
    dia = e.get("dia", 1)
    v = estado.variables(s, aldea)
    siguen = []
    for promesa in e.get("promesas", []):
        texto = promesa.get("texto", "lo prometido")
        if condiciones.cumple(promesa.get("condicion"), v):
            efectos.aplicar(s, aldea, promesa.get("cumplida") or [{"opinion": 5, "a": "todos"}, {"tension": -3}])
            estado.anotar(s, aldea, "consejo", f"Promesa cumplida: {texto}. Hay quien hasta lo reconoce en voz alta.")
        elif dia >= int(promesa.get("vence", dia)):
            efectos.aplicar(s, aldea, promesa.get("rota") or [{"opinion": -8, "a": "todos"}, {"tension": 6}])
            estado.anotar(s, aldea, "consejo", f"Promesa rota: {texto}. Se ha pasado el plazo y la gente lleva la cuenta.")
        else:
            siguen.append(promesa)
    e["promesas"] = siguen
    aldea.tocar()
