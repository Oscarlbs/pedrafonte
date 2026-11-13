"""Los contextos que el motor prepara para la IA: lo que cada vecino sabe, siente y calla."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Aldeano, Rumor
from . import clima, estado, rumores, social, tiempo


def de_aldea(aldea: Aldea) -> dict:
    e = aldea.estado
    dia = e.get("dia", 1)
    fecha = tiempo.fecha_de_dia(aldea, dia)
    hora = e.get("hora", 12)
    estacion = tiempo.estacion(fecha)
    ahora = tiempo.de_clave_hora(e["ultima_hora"]) if e.get("ultima_hora") else None
    return {
        "nombre": aldea.nombre, "tono": aldea.tono, "dia": dia, "hora": hora,
        "franja": tiempo.franja(hora), "fecha_texto": tiempo.fecha_bonita(fecha),
        "estacion": estacion, "estacion_texto": tiempo.NOMBRES_ESTACION[estacion],
        "clima": (clima.actual(aldea, ahora) if ahora else {"tipo": "nubes"})["tipo"],
        "fiesta": e.get("banderas", {}).get("fiesta"),
    }


def de_estado(s: Session, aldea: Aldea) -> dict:
    v = estado.variables(s, aldea)
    impuestos = datos.cargar("economia")["impuestos"]
    return {
        "poblacion": v["poblacion"], "dias_comida": v["dias_comida"], "sin_techo": v["sin_techo"],
        "impuestos": v["impuestos"], "impuestos_nombre": impuestos["nombres"][v["impuestos"]],
        "hambre_dias": v["hambre_dias"], "tension": v["tension"], "opinion_media": v["opinion_media"],
        "animo_medio": v["animo_medio"], "leyes": list(aldea.estado.get("leyes", [])),
        "revuelta": aldea.estado.get("revuelta", {}), "dia": v["dia"],
    }


def perfil(s: Session, aldea: Aldea, a: Aldeano, recuerdos: int = 3) -> dict:
    """Ficha de un vecino tal como se le pasa a la IA: incluye lo que sabe y lo que calla."""
    d = a.datos or {}
    por_id = {v.id: v for v in estado.aldeanos(s, aldea, solo_presentes=False)}
    conocidos = []
    for copia in rumores.copias_de(s, aldea, a.id)[:4]:
        rumor = s.get(Rumor, copia.rumor_id)
        sobre = por_id.get(rumor.sobre_id) if rumor else None
        if sobre is not None:
            conocidos.append({"texto": copia.texto, "sobre": sobre.clave})
    sobre_secreto = next((v for v in por_id.values() if v.clave == a.secreto_sobre), None)
    return {
        "clave": a.clave, "nombre": a.nombre, "apodo": d.get("apodo", a.nombre.split()[0]),
        "oficio": a.oficio, "oficio_nombre": d.get("oficio_nombre", a.oficio), "genero": d.get("genero", "m"),
        "caracter": a.caracter, "rasgos": list(a.rasgos or []), "objetivo": a.objetivo,
        "secreto": a.secreto,
        "secreto_sobre": {"clave": sobre_secreto.clave, "apodo": (sobre_secreto.datos or {}).get("apodo", sobre_secreto.nombre)} if sobre_secreto else None,
        "animo": a.animo, "opinion": a.opinion_senor, "dinero": a.dinero, "hambre": a.hambre,
        "habla": d.get("habla", {}),
        "recuerdos": [r.texto for r in social.recuerdos_de(s, aldea, a.id, recuerdos)],
        "rumores": conocidos,
    }


def relaciones_entre(s: Session, aldea: Aldea, gente: list[Aldeano]) -> list[dict]:
    resultado = []
    for i, a in enumerate(gente):
        for b in gente[i + 1:]:
            r = estado.relacion(s, aldea, a.id, b.id, crear=False)
            if r is not None and (r.valor or r.etiqueta):
                resultado.append({"a": a.clave, "b": b.clave, "valor": r.valor, "etiqueta": r.etiqueta, "nota": r.nota})
    return resultado


def relaciones_de(s: Session, aldea: Aldea, a: Aldeano) -> list[dict]:
    """Lo que piensa un vecino de los demás (para la charla con el señor)."""
    por_id = {v.id: v for v in estado.aldeanos(s, aldea)}
    resultado = []
    for otro_id, r in estado.relaciones_de(s, aldea, a.id):
        otro = por_id.get(otro_id)
        if otro is None:
            continue
        resultado.append({
            "clave": otro.clave, "nombre": otro.nombre, "apodo": (otro.datos or {}).get("apodo", otro.nombre),
            "valor": r.valor, "nota": r.nota,
            # El amor escondido no se le cuenta al señor así como así.
            "publica": r.etiqueta != "amor" or bool(aldea.estado.get("banderas", {}).get("amor_publico")),
        })
    return resultado


def vecinos(s: Session, aldea: Aldea) -> list[dict]:
    return [
        {"clave": v.clave, "nombre": v.nombre, "apodo": (v.datos or {}).get("apodo", v.nombre),
         "oficio_nombre": (v.datos or {}).get("oficio_nombre", v.oficio)}
        for v in estado.aldeanos(s, aldea)
    ]


def edificio_del_oficio(s: Session, aldea: Aldea, a: Aldeano) -> dict:
    """El edificio donde este vecino rendiría de verdad, y si existe ya."""
    cuenta = estado.contar_edificios(s, aldea)
    for clave, ficha in datos.catalogo().items():
        if a.oficio in ficha["efecto"].get("oficios", [])[:1]:
            return {"nombre": ficha["nombre"], "existe": cuenta.get(clave, 0) > 0}
    return {"nombre": "", "existe": True}
