"""Lo que el juego ve del mundo: el estado convertido a diccionarios para la API."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config, datos
from .modelos import Aldea, Aldeano, Cronica, Escena, Mensaje, Peticion, Recuerdo, RumorCopia, Suceso, Vecino, Visitante
from .motor import clima, construccion, estado, guerra, rutinas, tiempo, tutorial


def resumen_aldea(aldea: Aldea) -> dict:
    return {
        "id": aldea.id, "nombre": aldea.nombre, "paisaje": aldea.paisaje, "tono": aldea.tono,
        "dificultad": aldea.dificultad, "dia": aldea.estado.get("dia", 1),
        "perdida": bool(aldea.estado.get("perdida")),
    }


def animo_texto(valor: int) -> str:
    if valor >= 80:
        return "radiante"
    if valor >= 65:
        return "contento"
    if valor >= 45:
        return "tranquilo"
    if valor >= 30:
        return "mohíno"
    if valor >= 15:
        return "amargado"
    return "desesperado"


def opinion_texto(valor: int) -> str:
    if valor >= 60:
        return "os adora"
    if valor >= 30:
        return "os aprecia"
    if valor >= 5:
        return "os respeta"
    if valor >= -20:
        return "os tolera"
    if valor >= -50:
        return "os critica"
    return "os detesta"


def relacion_texto(valor: int) -> str:
    if valor >= 60:
        return "uña y carne"
    if valor >= 30:
        return "se llevan bien"
    if valor >= 10:
        return "cordiales"
    if valor > -10:
        return "ni fu ni fa"
    if valor > -30:
        return "se miran de reojo"
    if valor > -60:
        return "se llevan mal"
    return "no se pueden ver"


def aldeano_breve(a: Aldeano, sitio: rutinas.Sitio | None = None) -> dict:
    d = a.datos or {}
    vista = {
        "id": a.id, "clave": a.clave, "nombre": a.nombre, "apodo": d.get("apodo", a.nombre),
        "oficio": a.oficio, "oficio_nombre": d.get("oficio_nombre", a.oficio),
        "genero": d.get("genero", "m"), "color": d.get("color", "#8c6d46"),
        "animo": a.animo, "animo_texto": animo_texto(a.animo),
        "opinion": a.opinion_senor, "opinion_texto": opinion_texto(a.opinion_senor),
        "salud": a.salud, "hambre": a.hambre, "dinero": a.dinero,
        "casa_id": a.casa_id, "trabajo_id": a.trabajo_id,
    }
    if sitio is not None:
        vista["sitio"] = {
            "cx": sitio.cx, "cz": sitio.cz, "actividad": sitio.actividad,
            "actividad_texto": rutinas.NOMBRE_ACTIVIDAD.get(sitio.actividad, sitio.actividad),
            "lugar": sitio.nombre, "edificio_id": sitio.edificio_id,
        }
    return vista


def ficha_aldeano(s: Session, aldea: Aldea, a: Aldeano) -> dict:
    """La ficha que ve el señor al pinchar: quién es, ánimo, relaciones y recuerdos recientes."""
    d = a.datos or {}
    por_id = {v.id: v for v in estado.aldeanos(s, aldea, solo_presentes=False)}
    relaciones = []
    for otro_id, r in estado.relaciones_de(s, aldea, a.id):
        otro = por_id.get(otro_id)
        if otro is None or not otro.presente or abs(r.valor) < 5:
            continue
        # El amor escondido no se enseña mientras siga escondido.
        etiqueta = r.etiqueta if not (r.etiqueta == "amor" and not (aldea.estado.get("banderas", {}).get("amor_publico"))) else "amistad"
        relaciones.append({
            "id": otro.id, "nombre": otro.nombre, "valor": r.valor if etiqueta == r.etiqueta else min(r.valor, 35),
            "texto": relacion_texto(r.valor if etiqueta == r.etiqueta else min(r.valor, 35)),
            "etiqueta": etiqueta, "nota": r.nota if etiqueta == r.etiqueta else "",
        })
    relaciones.sort(key=lambda r: -abs(r["valor"]))
    recuerdos = s.scalars(
        select(Recuerdo).where(Recuerdo.aldea_id == aldea.id, Recuerdo.aldeano_id == a.id)
        .order_by(Recuerdo.dia.desc(), Recuerdo.hora.desc(), Recuerdo.id.desc()).limit(8)
    )
    sitio = rutinas.donde_estan(s, aldea).get(a.id)
    descubierto = a.clave in aldea.estado.get("secretos_sabidos", [])
    return {
        **aldeano_breve(a, sitio),
        "edad": d.get("edad"),
        "caracter": a.caracter,
        "rasgos": a.rasgos,
        "objetivo": a.objetivo,
        "secreto": a.secreto if descubierto else None,
        "debe": d.get("debe"),
        "dia_llegada": a.dia_llegada,
        "relaciones": relaciones[:10],
        "recuerdos": [
            {"dia": r.dia, "hora": r.hora, "texto": r.texto, "importancia": r.importancia, "tipo": r.tipo}
            for r in recuerdos
        ],
        "rumores": s.scalar(
            select(RumorCopia.id).where(RumorCopia.aldea_id == aldea.id, RumorCopia.aldeano_id == a.id).limit(1)
        ) is not None,
    }


def escena(e: Escena) -> dict:
    return {
        "id": e.id, "dia": e.dia, "hora": e.hora, "lugar": e.lugar, "cx": e.cx, "cz": e.cz,
        "tema": e.tema, "participantes": e.participantes, "dialogo": e.dialogo,
    }


def suceso(x: Suceso) -> dict:
    return {"id": x.id, "dia": x.dia, "hora": x.hora, "tipo": x.tipo, "texto": x.texto}


def peticion(p: Peticion, aldea: Aldea) -> dict:
    opciones = []
    for o in p.opciones:
        coste = o.get("coste") or {}
        opciones.append({
            "clave": o["clave"], "texto": o["texto"], "coste": coste, "pista": o.get("pista", ""),
            "disponible": estado.puede_pagar(aldea, coste),
        })
    return {
        "id": p.id, "dia": p.dia, "clave": p.clave, "titulo": p.titulo, "texto": p.texto,
        "peticionario_id": p.peticionario_id, "opciones": opciones, "estado": p.estado,
        "elegida": p.elegida, "resultado": p.resultado,
    }


def cronica(c: Cronica | None) -> dict | None:
    if c is None:
        return None
    return {"dia": c.dia, "fecha": c.fecha, "texto": c.texto, "opiniones": c.opiniones, "datos": c.datos}


def mensaje(m: Mensaje, aldea: Aldea) -> dict:
    return {
        "id": m.id, "dia": m.dia, "tipo": m.tipo, "remitente": m.remitente, "texto": m.texto,
        "opciones": [
            {"clave": o["clave"], "texto": o["texto"], "coste": o.get("coste") or {},
             "disponible": estado.puede_pagar(aldea, o.get("coste") or {})}
            for o in m.opciones
        ],
        "respuesta": m.respuesta, "resultado": m.resultado, "estado": m.estado,
    }


def visitante(v: Visitante) -> dict:
    d = v.datos or {}
    return {
        "id": v.id, "tipo": v.tipo, "nombre": v.nombre, "dia_llegada": v.dia_llegada, "dia_salida": v.dia_salida,
        "descripcion": d.get("descripcion", ""), "ofertas": d.get("ofertas", []), "noticia": d.get("noticia", ""),
        "cx": d.get("cx"), "cz": d.get("cz"), "color": d.get("color", "#6b4a8c"),
    }


def estado_completo(s: Session, aldea: Aldea, hora_vista: int | None = None) -> dict:
    """Todo lo que el juego necesita para pintar la aldea.

    `hora_vista` solo cambia dónde se enseña a los vecinos (para previsualizar otra hora del día con el
    deslizador del juego); el tiempo del mundo no se mueve.
    """
    e = aldea.estado
    ahora = tiempo.ahora_juego(aldea)
    fecha = ahora.date()
    gente = estado.aldeanos(s, aldea)
    hora_sitios = ahora.hour if hora_vista is None else int(hora_vista) % 24
    sitios = rutinas.donde_estan(s, aldea, hora=hora_sitios, dia=tiempo.dia_n(aldea, ahora))
    lecciones = tutorial.resumen(s, aldea)  # de paso da por cumplida la lección en curso, si toca
    v = estado.variables(s, aldea)
    impuestos = datos.cargar("economia")["impuestos"]
    peticiones = list(s.scalars(
        select(Peticion).where(Peticion.aldea_id == aldea.id, Peticion.estado == "abierta").order_by(Peticion.id)
    ))
    mensajes = list(s.scalars(
        select(Mensaje).where(Mensaje.aldea_id == aldea.id, Mensaje.estado == "abierto").order_by(Mensaje.id)
    ))
    visitantes = list(s.scalars(
        select(Visitante).where(Visitante.aldea_id == aldea.id, Visitante.activo.is_(True)).order_by(Visitante.id)
    ))
    ultima_cronica = s.scalar(
        select(Cronica).where(Cronica.aldea_id == aldea.id).order_by(Cronica.dia.desc()).limit(1)
    )
    escenas_hoy = list(s.scalars(
        select(Escena).where(Escena.aldea_id == aldea.id, Escena.dia >= e.get("dia", 1) - 1)
        .order_by(Escena.id.desc()).limit(6)
    ))
    return {
        "aldea": resumen_aldea(aldea),
        "tiempo": {
            "dia": e.get("dia", 1),
            "hora": ahora.hour,
            "instante": ahora.isoformat(timespec="minutes"),
            "fecha": fecha.isoformat(),
            "fecha_texto": tiempo.fecha_bonita(fecha),
            "estacion": tiempo.estacion(fecha),
            "estacion_texto": tiempo.NOMBRES_ESTACION[tiempo.estacion(fecha)],
            "franja": tiempo.franja(ahora.hour),
            "desfase_dias": int(e.get("desfase_dias", 0)),
            "fiesta": e.get("banderas", {}).get("fiesta"),
        },
        "clima": clima.actual(aldea, ahora),
        "recursos": {k: round(val) for k, val in estado.recursos(aldea).items()},
        "poblacion": {
            "vecinos": len(gente), "plazas": v["plazas"], "sin_techo": v["sin_techo"],
            "animo": v["animo_medio"], "animo_texto": animo_texto(v["animo_medio"]),
            "opinion": v["opinion_media"], "opinion_texto": opinion_texto(v["opinion_media"]),
            "dias_comida": v["dias_comida"],
        },
        "gobierno": {
            "impuestos": int(e.get("impuestos", 1)),
            "impuestos_nombre": impuestos["nombres"][int(e.get("impuestos", 1))],
            "leyes": list(e.get("leyes", [])),
            "tension": round(e.get("tension", 0)),
            "revuelta": e.get("revuelta", {}),
            "defensa": v["defensa"],
            "defensa_partes": estado.partes_defensa(s, aldea),
            "amenaza": _amenaza(e),
            "peste": bool(e.get("peste")),
            "alianzas": list(e.get("alianzas", [])),
            "promesas": [{"texto": p.get("texto", ""), "vence": p.get("vence")} for p in e.get("promesas", [])],
            "perdida": bool(e.get("perdida")),
            "motivo_perdida": e.get("motivo_perdida"),
        },
        "edificios": [construccion.serializar(x) for x in estado.edificios(s, aldea)],
        "aldeanos": [aldeano_breve(a, sitios.get(a.id)) for a in gente],
        "balance": e.get("ultimo_balance"),
        "consejo": [peticion(p, aldea) for p in peticiones],
        "mensajes": [mensaje(m, aldea) for m in mensajes],
        "visitantes": [visitante(x) for x in visitantes],
        "escenas": [escena(x) for x in reversed(escenas_hoy)],
        "vecinos": [vecino(x) for x in s.scalars(select(Vecino).where(Vecino.aldea_id == aldea.id).order_by(Vecino.id))],
        "guerra": guerra.resumen(s, aldea),
        "tutorial": lecciones,
        "pergamino": {
            "pendiente": bool(ultima_cronica and ultima_cronica.dia > int(e.get("pergamino_leido", 0))),
            "dia": ultima_cronica.dia if ultima_cronica else None,
        },
    }


def _amenaza(e: dict) -> dict | None:
    if e.get("asedio"):
        return {"clave": "asedio", "nombre": "el cerco", "dias": 0, "fuerza": round(float(e["asedio"].get("fuerza", 0)))}
    pendiente = e.get("amenaza")
    if not pendiente:
        return None
    tabla = {f["clave"]: f for f in datos.cargar("amenazas") or []}
    ficha = pendiente.get("ficha") or tabla.get(pendiente["clave"], {})
    return {
        "clave": pendiente["clave"], "nombre": ficha.get("nombre", pendiente["clave"]),
        "dias": max(0, int(pendiente["dia_golpe"]) - int(e.get("dia", 1))),
        "fuerza": guerra._aprox(float(pendiente.get("fuerza", 0))) if pendiente["clave"] in ("hueste", "mesnada") else None,
    }


def vecino(v: Vecino) -> dict:
    return {
        "clave": v.clave, "nombre": v.nombre, "senor": v.senor, "caracter": v.caracter, "relacion": v.relacion,
        "relacion_texto": relacion_texto(v.relacion),
    }


def configuracion() -> dict:
    """Datos fijos que el juego pide al arrancar: catálogo, paisajes, ubicación, leyes…"""
    economia = datos.cargar("economia")
    return {
        "ubicacion": config.ubicacion(),
        "motor_ia": config.motor_ia(),
        "catalogo": list(datos.catalogo().values()),
        "paisajes": datos.cargar("paisajes"),
        "dificultades": datos.cargar("dificultades"),
        "tonos": datos.cargar("tonos") or {},
        "leyes": datos.cargar("leyes") or [],
        "impuestos": economia["impuestos"],
        "recursos": list(datos.TODOS_RECURSOS),
        "guerra": {"unidades": list(guerra.unidades().values()), "objetivos": guerra.cfg().get("objetivos") or {}, "titulos": guerra.cfg().get("titulos") or []},
    }
