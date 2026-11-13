"""Encuentros y escenas: cuando coinciden de 2 a 4 vecinos, puede haber escena.

El motor decide quién se encuentra, dónde y de qué va (el tema). La IA —una sola llamada por escena—
escribe las frases y propone cambios pequeños, que pasan por el validador.
"""

from __future__ import annotations

import random
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Aldeano, Escena, Rumor, RumorCopia, Suceso, Visitante
from ..ia.simulado import pulir
from . import contexto, estado, leyes, rumores, rutinas, social, tiempo, validador

# Probabilidad de que un grupo que coincide acabe en escena, según la hora.
PROBABILIDAD = {"amanecer": 0.12, "manana": 0.15, "mediodia": 0.45, "tarde": 0.15, "anochecer": 0.45, "noche": 0.0}
MAX_POR_HORA = 2

# Recuerdo que deja la escena en cada participante: (texto, importancia). {otros} = con quién estuvo.
RECUERDOS = {
    "rivalidad": ("Tuve palabras con {otros} en {lugar}.", 5),
    "deuda": ("{otros} y yo hablamos de la deuda. Otra vez.", 5),
    "amor_solos": ("Estuve un rato a solas con {otros}. Nadie nos vio, creo.", 6),
    "amor_disimulo": ("Hubo que disimular delante de la gente en {lugar}.", 4),
    "rumor": ("Estuvimos de cuchicheos {otros} y yo en {lugar}.", 3),
    "hambre": ("Hablamos del hambre en {lugar}. No hay otro tema.", 5),
    "impuestos": ("Hablamos de los tributos con {otros}. Nadie estaba contento.", 4),
    "fiesta": ("Celebré la fiesta con {otros}.", 5),
    "recien_llegado": ("Conocí a {otros} en {lugar}.", 5),
    "amistad": ("Buen rato con {otros} en {lugar}.", 3),
    "senor_mal": ("{otros} y yo estuvimos hablando del señor. Mal.", 4),
    "senor_bien": ("{otros} y yo estuvimos hablando del señor. Para bien, por una vez.", 3),
}
RECUERDO_DEFECTO = ("Eché un rato de charla con {otros} en {lugar}.", 2)


def limite_diario(ia: Any) -> int:
    tabla = datos.cargar("ia") or {}
    return int((tabla.get(getattr(ia, "nombre", "simulado")) or {}).get("escenas_por_dia", 8))


def hora(s: Session, aldea: Aldea, instante: datetime, ia: Any = None) -> list[Escena]:
    """Mira quién coincide a esta hora y monta las escenas que toquen."""
    if ia is None:
        return []
    e = aldea.estado
    franja = tiempo.franja(instante.hour)
    probabilidad = PROBABILIDAD.get(franja, 0) * leyes.modificadores(aldea)["escenas"]
    if probabilidad <= 0 or e.get("escenas_hoy", 0) >= limite_diario(ia):
        return []
    sitios = rutinas.donde_estan(s, aldea, instante.hour, e.get("dia", 1))
    por_id = {a.id: a for a in estado.aldeanos(s, aldea)}
    azar = estado.azar(aldea, "escenas", instante.hour)
    hechas = []
    for grupo in rutinas.grupos(sitios):
        if e.get("escenas_hoy", 0) >= limite_diario(ia) or len(hechas) >= MAX_POR_HORA:
            break
        if azar.random() > probabilidad:
            continue
        ids = grupo if len(grupo) <= 4 else azar.sample(grupo, 4)
        gente = [por_id[i] for i in ids if i in por_id]
        if len(gente) < 2:
            continue
        escena = montar(s, aldea, gente, sitios[gente[0].id], ia, azar)
        if escena is not None:
            hechas.append(escena)
    return hechas


def montar(
    s: Session, aldea: Aldea, gente: list[Aldeano], sitio: rutinas.Sitio, ia: Any, azar: random.Random,
    tema: dict | None = None,
) -> Escena | None:
    """Una escena entera: tema (motor) → frases y propuestas (IA) → validación → aplicación."""
    e = aldea.estado
    tema = tema or elegir_tema(s, aldea, gente, sitio, azar)
    copia: RumorCopia | None = tema.pop("_copia", None)
    por_clave = {a.clave: a for a in gente}
    ctx = {
        "aldea": contexto.de_aldea(aldea),
        "lugar": sitio.nombre,
        "tema": tema,
        "participantes": [contexto.perfil(s, aldea, a) for a in gente],
        "relaciones": contexto.relaciones_entre(s, aldea, gente),
        "estado": contexto.de_estado(s, aldea),
        "rumor": None,
        "semilla": f"{aldea.semilla}|{e.get('dia')}|{e.get('hora')}|{'-'.join(str(a.id) for a in gente)}",
    }
    if copia is not None:
        sobre = s.get(Aldeano, s.get(Rumor, copia.rumor_id).sobre_id)
        ctx["rumor"] = {
            "texto": copia.texto, "deformacion": copia.deformacion, "de": tema["a"], "a": tema["b"],
            "sobre": {"clave": sobre.clave, "nombre": sobre.nombre, "apodo": (sobre.datos or {}).get("apodo", sobre.nombre)},
        }

    propuesta, error = validador.como_propuesta(ia.escena(ctx))
    if error is not None:
        social.registrar_rechazos(s, aldea, "escena", [(propuesta, error)])
        return None
    lineas, rechazadas = validador.validar_lineas(propuesta.get("lineas"), set(por_clave))
    social.registrar_rechazos(s, aldea, "escena", rechazadas)
    if not lineas:
        return None
    cambios = social.validar_y_aplicar(s, aldea, propuesta.get("cambios"), gente, "escena")

    if copia is not None:
        rumores.pasar(s, aldea, copia, por_clave[tema["a"]], por_clave[tema["b"]], None, propuesta.get("rumor_texto"))
    if tema["tipo"] == "deuda":
        _abonar_deuda(s, aldea, por_clave, tema, cambios)

    plantilla, importancia = RECUERDOS.get(tema["tipo"], RECUERDO_DEFECTO)
    for a in gente:
        otros = [(o.datos or {}).get("apodo", o.nombre) for o in gente if o.id != a.id]
        texto = plantilla.format(otros=_lista(otros), lugar=sitio.nombre)
        social.recordar(s, aldea, a, pulir(texto), importancia, "escena")

    escena = Escena(
        aldea_id=aldea.id, dia=e.get("dia", 1), hora=e.get("hora", 12), lugar=sitio.nombre, cx=sitio.cx, cz=sitio.cz,
        tema=tema["tipo"], participantes=[a.id for a in gente],
        dialogo=[{"quien": por_clave[linea["quien"]].id, "texto": linea["texto"]} for linea in lineas],
        cambios=cambios, motor=getattr(ia, "nombre", "?"),
    )
    s.add(escena)
    s.flush()
    e["escenas_hoy"] = e.get("escenas_hoy", 0) + 1
    e["temas_recientes"] = (e.get("temas_recientes", []) + [tema["tipo"]])[-6:]
    aldea.tocar()
    estado.emitir(
        aldea, "escena", id=escena.id, dia=escena.dia, hora=escena.hora, lugar=escena.lugar, cx=escena.cx,
        cz=escena.cz, tema=escena.tema, participantes=escena.participantes, dialogo=escena.dialogo,
    )
    return escena


def elegir_tema(s: Session, aldea: Aldea, gente: list[Aldeano], sitio: rutinas.Sitio, azar: random.Random) -> dict:
    """De qué va la escena. Lo decide el motor mirando el estado real."""
    e = aldea.estado
    v = estado.variables(s, aldea)
    dia = e.get("dia", 1)
    candidatos: list[tuple[float, dict]] = []

    for i, a in enumerate(gente):
        for b in gente[i + 1:]:
            r = estado.relacion(s, aldea, a.id, b.id, crear=False)
            valor, etiqueta = (r.valor, r.etiqueta) if r else (0, None)
            if etiqueta == "amor":
                tipo = "amor_solos" if len(gente) == 2 else "amor_disimulo"
                candidatos.append((4.0 if len(gente) == 2 else 3.0, {"tipo": tipo, "a": a.clave, "b": b.clave}))
            elif etiqueta == "rivalidad" or valor <= -40:
                x, y = (a, b) if azar.random() < 0.5 else (b, a)
                candidatos.append((3.0, {"tipo": "rivalidad", "a": x.clave, "b": y.clave}))
            elif valor >= 30:
                candidatos.append((1.5, {"tipo": "amistad", "a": a.clave, "b": b.clave}))
            elif valor <= -10:
                candidatos.append((1.2, {"tipo": "recelo", "a": a.clave, "b": b.clave}))
            for deudor, acreedor in ((a, b), (b, a)):
                debe = (deudor.datos or {}).get("debe")
                if debe and debe.get("a") == acreedor.clave and debe.get("cantidad", 0) > 0:
                    candidatos.append((2.5, {"tipo": "deuda", "a": acreedor.clave, "b": deudor.clave, "cantidad": debe["cantidad"]}))
            for cuenta, oye in ((a, b), (b, a)):
                copia = rumores.candidato(s, aldea, cuenta, oye)
                if copia is not None and rumores.ganas_de_contar(cuenta, valor, azar):
                    candidatos.append((3.5, {"tipo": "rumor", "a": cuenta.clave, "b": oye.clave, "_copia": copia}))
                if (oye.dia_llegada or 0) >= dia - 1 and (cuenta.dia_llegada or 0) < dia - 1 and dia > 1:
                    candidatos.append((3.0, {"tipo": "recien_llegado", "a": cuenta.clave, "b": oye.clave}))

    def general(peso: float, tipo: str, **extra: Any) -> None:
        a, b = azar.sample(gente, 2)
        candidatos.append((peso, {"tipo": tipo, "a": a.clave, "b": b.clave, **extra}))

    if v["hambre_dias"] > 0 or any(a.hambre > 0 for a in gente):
        general(4.0, "hambre")
    elif v["dias_comida"] >= 10:
        general(0.8, "abundancia")
    if v["impuestos"] >= 3:
        general(2.5, "impuestos")
    if any(a.casa_id is None for a in gente):
        sin = next(a for a in gente if a.casa_id is None)
        otro = next(a for a in gente if a.id != sin.id)
        candidatos.append((1.5, {"tipo": "sin_techo", "a": sin.clave, "b": otro.clave}))
    fiesta = e.get("banderas", {}).get("fiesta")
    if fiesta:
        general(4.0, "fiesta", fiesta=fiesta)
    reciente = s.scalar(
        select(Suceso).where(
            Suceso.aldea_id == aldea.id, Suceso.dia >= dia - 1,
            Suceso.tipo.in_(("drama", "amenaza", "marcha", "visita", "consejo", "revuelta")),
        ).order_by(Suceso.id.desc()).limit(1)
    )
    if reciente is not None:
        general(2.0, "suceso", suceso=reciente.texto[:160])
    visitante = s.scalar(select(Visitante).where(Visitante.aldea_id == aldea.id, Visitante.activo.is_(True)).limit(1))
    if visitante is not None:
        general(1.5, "visitante", visitante=visitante.nombre)
    if v["opinion_media"] >= 30:
        general(1.2, "senor_bien")
    elif v["opinion_media"] <= -10:
        general(2.0, "senor_mal")
    else:
        general(0.6, "senor_neutro")
    franja = tiempo.franja(e.get("hora", 12))
    if sitio.actividad == rutinas.TABERNA or "taberna" in sitio.nombre:
        general(2.5, "taberna")
    elif franja == "anochecer":
        general(1.5, "noche")
    if franja in ("manana", "tarde"):
        general(1.5, "trabajo")
    general(1.0, "tiempo")

    # Que no se repita siempre lo mismo: los temas recientes pesan la mitad.
    recientes = e.get("temas_recientes", [])
    pesos = [peso * (0.5 ** recientes.count(tema["tipo"])) for peso, tema in candidatos]
    return dict(azar.choices([tema for _, tema in candidatos], weights=pesos)[0])


def _abonar_deuda(s: Session, aldea: Aldea, por_clave: dict[str, Aldeano], tema: dict, cambios: list[dict]) -> None:
    """Si en la escena el deudor ha pagado algo (cambio de dinero ya validado), baja la deuda."""
    deudor, acreedor = por_clave[tema["b"]], por_clave[tema["a"]]
    pagado = sum(
        c["cantidad"] for c in cambios if c["tipo"] == "dinero" and c["de"] == deudor.clave and c["a"] == acreedor.clave
    )
    debe = dict((deudor.datos or {}).get("debe") or {})
    if not pagado or not debe:
        return
    debe["cantidad"] = max(0, int(debe.get("cantidad", 0)) - pagado)
    deudor.datos = {**deudor.datos, "debe": debe if debe["cantidad"] > 0 else None}
    if debe["cantidad"] == 0:
        relacion = estado.relacion(s, aldea, deudor.id, acreedor.id)
        relacion.etiqueta = None
        relacion.valor = int(estado.limitar(relacion.valor + 20, -100, 100))
        estado.anotar(s, aldea, "drama", f"{deudor.nombre} ha saldado por fin su deuda con {acreedor.nombre}. Hay quien no se lo cree.")


def _lista(nombres: list[str]) -> str:
    if len(nombres) <= 1:
        return "".join(nombres)
    return ", ".join(nombres[:-1]) + " y " + nombres[-1]
