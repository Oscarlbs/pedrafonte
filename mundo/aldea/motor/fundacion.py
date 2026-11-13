"""Fundar una aldea: claro vacío, una choza, una hoguera y cuatro colonos."""

from __future__ import annotations

import random
from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Aldeano, Base, Cronica, Recuerdo, Relacion, Rumor, RumorCopia
from . import construccion, economia, estado, guerra, tiempo, tutorial

COLONOS = 4
TONOS = ("cuento", "crudo", "fantasia", "comedia")


def fundar(
    s: Session,
    nombre: str = "Pedrafonte",
    paisaje: str = "valle",
    tono: str = "cuento",
    dificultad: str = "normal",
    semilla: int | None = None,
    ahora: datetime | None = None,
    bienvenida: bool = True,
) -> Aldea:
    """Funda una aldea. Con `bienvenida`, deja escrita la primera hoja del escriba y el primer consejo."""
    ahora = tiempo.a_hora(ahora or tiempo.ahora_real())
    paisajes = datos.cargar("paisajes")
    if paisaje not in paisajes:
        paisaje = "valle"
    if tono not in TONOS:
        tono = "cuento"
    if dificultad not in (datos.cargar("dificultades") or {"normal": {}}):
        dificultad = "normal"
    aldea = Aldea(
        nombre=nombre.strip()[:80] or "Pedrafonte",
        paisaje=paisaje, tono=tono, dificultad=dificultad,
        semilla=semilla if semilla is not None else random.randint(1, 999_999),
        creada=ahora,
        estado=_estado_inicial(ahora, dificultad),
    )
    s.add(aldea)
    s.flush()
    _levantar(s, aldea, ahora, bienvenida)
    return aldea


def reiniciar(s: Session, aldea: Aldea, ahora: datetime | None = None) -> Aldea:
    """Empezar de cero en el mismo sitio: se borra todo lo de la aldea y se funda otra vez.

    Conserva el identificador, el nombre, el paisaje, el tono y la dificultad. La cuenta de gasto de IA no
    se toca, para que reiniciar no sirva para saltarse el tope diario.
    """
    ahora = tiempo.a_hora(ahora or tiempo.ahora_real())
    for tabla in reversed(Base.metadata.sorted_tables):
        if "aldea_id" in tabla.c and tabla.name != "gasto_ia":
            s.execute(delete(tabla).where(tabla.c.aldea_id == aldea.id))
    s.flush()
    s.expire_all()
    aldea.semilla = random.randint(1, 999_999)
    aldea.creada = ahora
    aldea.estado = _estado_inicial(ahora, aldea.dificultad)
    s.flush()
    _levantar(s, aldea, ahora, bienvenida=True)
    return aldea


def _estado_inicial(ahora: datetime, dificultad: str) -> dict:
    ajuste = datos.dificultad(dificultad)
    inicio = datos.cargar("economia")["inicio"]
    return {
        "fecha_fundacion": ahora.date().isoformat(),
        "desfase_dias": 0,
        "ultima_hora": tiempo.clave_hora(ahora),
        "dia": 1,
        "hora": ahora.hour,
        "recursos": {k: round(v * float(ajuste["recursos"])) for k, v in inicio.items()},
        "impuestos": 1,
        "leyes": [],
        "tension": 15,
        "tension_historial": [],
        "tension_hoy": 0,
        "hambre_dias": 0,
        "revuelta": {"activa": False, "dias": 0, "avisos": 0},
        "perdida": False,
        "banderas": {},
        "enfriamientos": {},
        "escenas_hoy": 0,
        "ultimo_balance": None,
    }


def _levantar(s: Session, aldea: Aldea, ahora: datetime, bienvenida: bool) -> None:
    """Lo que hay el primer día: choza, hoguera, colonos, vecinos de la comarca y, si toca, bienvenida y tutorial."""
    lugar = datos.cargar("paisajes")[aldea.paisaje]["inicio"]
    construccion.construir(s, aldea, "choza", *lugar["choza"], rot=0, gratis=True)
    construccion.construir(s, aldea, "hoguera", *lugar["hoguera"], rot=0, gratis=True)

    _reparto(s, aldea)
    guerra.asegurar(s, aldea)
    economia.asignar_casas(s, aldea)
    economia.asignar_trabajos(s, aldea)
    estado.anotar(
        s, aldea, "fundacion",
        f"Se funda {aldea.nombre}: un claro, una choza, una hoguera y cuatro valientes que no tenían adónde ir.",
    )
    if bienvenida:
        _bienvenida(s, aldea, ahora)
        tutorial.activar(aldea)
    estado.vaciar_eventos(aldea.id)  # nadie escucha todavía


def _bienvenida(s: Session, aldea: Aldea, ahora: datetime) -> None:
    """La primera hoja del pergamino (día 0) y las primeras peticiones, para no empezar a ciegas."""
    from . import consejo

    colonos = estado.aldeanos(s, aldea)
    lista = "; ".join(f"{a.nombre}, {(a.datos or {}).get('oficio_nombre', a.oficio)}" for a in colonos)
    cuantos = {2: "dos", 3: "tres", 4: "cuatro", 5: "cinco", 6: "seis"}.get(len(colonos), str(len(colonos)))
    texto = (
        f"En {aldea.nombre}, a {tiempo.fecha_bonita(ahora.date())}. Primera hoja.\n\n"
        f"Hoy se funda {aldea.nombre}: un claro en el valle, un río que baja con prisa y un puente que ya estaba "
        "aquí cuando llegamos y nadie sabe quién levantó. Tenemos una choza, una hoguera y lo puesto.\n\n"
        f"Somos {cuantos}, sin contar a vuestra merced: {lista}. Los demás de Vilavella, la aldea vieja que se "
        "llevó la riada, vendrán cuando haya techo y pan; y con ellos vendrán sus deudas, sus piques y sus cuentos.\n\n"
        "Quede escrito, por si mañana alguien lo niega."
    )
    s.add(Cronica(
        aldea_id=aldea.id, dia=0, fecha=ahora.date().isoformat(), texto=texto,
        opiniones=[
            "Yo empezaría por un techo: la choza es para dos y somos más. Hay quien duerme al raso, y uno de esos soy yo.",
            "Con un campo de trigo y una cabaña para el leñador habría pan y leña. Lo demás, de momento, son lujos.",
            "Cada mañana habrá quien pida audiencia. Lo que dejéis más de un día sin decidir se decidirá solo, y casi nunca a vuestro favor.",
            "Yo escribiré aquí cada noche lo que pase. Y lo que opino, que para eso tengo pluma.",
        ],
        datos={},
    ))
    aldea.estado["pergamino_leido"] = -1
    aldea.tocar()
    consejo.generar(s, aldea)


def _reparto(s: Session, aldea: Aldea) -> None:
    tabla = datos.cargar("aldeanos")
    por_clave: dict[str, Aldeano] = {}
    for ficha in tabla.get("aldeanos", []):
        orden = int(ficha.get("orden_llegada", 99))
        a = Aldeano(
            aldea_id=aldea.id, clave=ficha["clave"], nombre=ficha["nombre"], oficio=ficha["oficio"],
            caracter=ficha.get("caracter", ""), rasgos=list(ficha.get("rasgos", [])),
            objetivo=ficha.get("objetivo", ""), secreto=ficha.get("secreto", ""),
            secreto_sobre=ficha.get("secreto_sobre"), dinero=int(ficha.get("dinero", 5)),
            presente=orden <= COLONOS, dia_llegada=1 if orden <= COLONOS else None,
            reparto=True, orden_llegada=orden,
            datos={
                "apodo": ficha.get("apodo", ficha["nombre"].split()[0]),
                "genero": ficha.get("genero", "m"),
                "edad": ficha.get("edad"),
                "oficio_nombre": ficha.get("oficio_nombre", ficha["oficio"]),
                "color": ficha.get("color", "#8c6d46"),
                "habla": ficha.get("habla", {}),
                "rumor_secreto": ficha.get("rumor_secreto", ""),
            },
        )
        s.add(a)
        por_clave[a.clave] = a
    s.flush()
    for a in por_clave.values():
        if a.presente:
            s.add(Recuerdo(
                aldea_id=aldea.id, aldeano_id=a.id, dia=1, hora=aldea.estado["hora"], importancia=7, tipo="suceso",
                texto=f"Llegamos al claro con lo puesto. El señor dice que aquí será {aldea.nombre}. De momento es barro, una choza y una hoguera.",
            ))
    for r in tabla.get("relaciones", []):
        a, b = (por_clave.get(c) for c in r["entre"])
        if a is None or b is None:
            continue
        menor, mayor = sorted((a.id, b.id))
        nota = r.get("nota", "")
        s.add(Relacion(
            aldea_id=aldea.id, a_id=menor, b_id=mayor, valor=int(r.get("valor", 0)),
            etiqueta=r.get("etiqueta"), nota=nota,
        ))
        if r.get("debe") in por_clave:
            deudor = por_clave[r["debe"]]
            acreedor = b if deudor is a else a
            deudor.datos = {**deudor.datos, "debe": {"a": acreedor.clave, "cantidad": int(r.get("cantidad", 0))}}
    for r in tabla.get("rumores", []):
        sobre = por_clave.get(r["sobre"])
        origen = por_clave.get(r.get("origen", ""))
        if sobre is None:
            continue
        rumor = Rumor(
            aldea_id=aldea.id, sobre_id=sobre.id, origen_id=origen.id if origen else None,
            texto=r["texto"], verdad=bool(r.get("verdad", False)), dia=1,
        )
        s.add(rumor)
        s.flush()
        for clave in r.get("sabe", []):
            if clave in por_clave:
                s.add(RumorCopia(
                    aldea_id=aldea.id, rumor_id=rumor.id, aldeano_id=por_clave[clave].id,
                    texto=r["texto"], deformacion=0, de_quien_id=None, dia=1,
                ))
    s.flush()
