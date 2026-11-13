"""El mundo de fuera: aldeas vecinas y sus mensajes, mercaderes y viajeros, fiestas y amenazas.

Como en todo lo demás, el motor decide (quién escribe, qué ofrece, si el golpe entra) y la IA solo pone
la voz a los mensajes de los señores vecinos.
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Aldeano, Mensaje, Vecino, Visitante
from . import condiciones, efectos, estado, rutinas, social, validador
from .construccion import NoSePuede

DIAS_MENSAJE = 2            # lo que espera un vecino antes de dar la callada por respuesta
PROBABILIDAD_MENSAJE = 0.4  # cada mañana, si no hay ninguno pendiente
PROBABILIDAD_VISITA = 0.3   # cada mañana, si no hay nadie de visita (0,5 con puesto de mercado)
DESCANSO_AMENAZA = 6        # días de respiro tras un golpe o un susto
VALOR = {"grano": 1.0, "madera": 1.2, "piedra": 1.6, "oro": 3.0, "pan": 1.3, "harina": 1.2}
NOMBRE_RECURSO = {"grano": "grano", "madera": "madera", "piedra": "piedra", "oro": "monedas", "pan": "pan", "harina": "harina"}


# === El día =========================================================================================

def amanecer(s: Session, aldea: Aldea, instante: datetime, ligero: bool = False, ia: Any = None) -> None:
    celebrar_fiestas(s, aldea, instante.date())
    if aldea.estado.get("revuelta", {}).get("activa"):
        return
    azar = estado.azar(aldea, "exterior")
    despedir_visitantes(s, aldea, azar)
    cuarentena = "cuarentena" in aldea.estado.get("leyes", [])
    hay_visita = s.scalar(select(Visitante.id).where(Visitante.aldea_id == aldea.id, Visitante.activo.is_(True)).limit(1))
    mercado = estado.contar_edificios(s, aldea).get("mercado", 0) > 0
    if not hay_visita and not cuarentena and aldea.estado.get("dia", 1) >= 2:
        if azar.random() < (0.5 if mercado else PROBABILIDAD_VISITA):
            llegar(s, aldea)
    caducar_mensajes(s, aldea)
    pendiente = s.scalar(select(Mensaje.id).where(Mensaje.aldea_id == aldea.id, Mensaje.estado == "abierto").limit(1))
    if not pendiente and not ligero and aldea.estado.get("dia", 1) >= 3 and azar.random() < PROBABILIDAD_MENSAJE:
        nuevo_mensaje(s, aldea, ia)


def cierre(s: Session, aldea: Aldea, instante: datetime, balance: dict, ligero: bool = False) -> None:
    amenazas(s, aldea, ligero=ligero)


# === Fiestas ========================================================================================

def pascua(anio: int) -> date:
    """Domingo de Pascua (calendario gregoriano, algoritmo de Meeus)."""
    a, b, c = anio % 19, anio // 100, anio % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = (h + l - 7 * m + 114) % 31 + 1
    return date(anio, mes, dia)


def fiestas_del_dia(fecha: date) -> list[dict]:
    resultado = []
    for fiesta in datos.cargar("fiestas") or []:
        if "pascua" in fiesta:
            cuando = pascua(fecha.year) + timedelta(days=int(fiesta["pascua"]))
        else:
            mes, dia = (int(x) for x in str(fiesta["fecha"]).split("-"))
            cuando = date(fecha.year, mes, dia)
        if cuando == fecha:
            resultado.append(fiesta)
    return resultado


def celebrar_fiestas(s: Session, aldea: Aldea, fecha: date) -> list[dict]:
    celebradas = []
    for fiesta in fiestas_del_dia(fecha):
        gasto = fiesta.get("gasto") or {}
        texto = fiesta.get("texto", f"Hoy es {fiesta['nombre']}.")
        if estado.puede_pagar(aldea, gasto):
            estado.pagar(aldea, gasto)
            efectos.aplicar(s, aldea, fiesta.get("efectos"))
        else:
            efectos.aplicar(s, aldea, [{"animo": 2, "a": "todos"}])
            texto += " Se celebró con lo puesto, que la despensa no daba para más."
        efectos.aplicar(s, aldea, [{"bandera": "fiesta", "valor": fiesta["nombre"], "dias": 1}])
        estado.anotar(s, aldea, "fiesta", texto, clave=fiesta["clave"])
        celebradas.append(fiesta)
    return celebradas


# === Mercaderes y viajeros ==========================================================================

def llegar(s: Session, aldea: Aldea, clave: str | None = None) -> Visitante | None:
    """Llega un visitante por el camino. `clave` puede ser la clave de la ficha o un tipo («juglar»)."""
    fichas = (datos.cargar("mercaderes") or {}).get("visitantes", [])
    if clave is not None:
        fichas = [f for f in fichas if clave in (f["clave"], f["tipo"])]
    if not fichas:
        return None
    azar = estado.azar(aldea, "visita", clave or "")
    ficha = azar.choices(fichas, weights=[float(f.get("peso", 1)) for f in fichas])[0]
    dia = aldea.estado.get("dia", 1)
    (cx, cz), _nombre, _id = rutinas.Lugares(s, aldea).plaza()
    visitante = Visitante(
        aldea_id=aldea.id, tipo=ficha["tipo"], nombre=azar.choice(ficha["nombres"]),
        dia_llegada=dia, dia_salida=dia + int(ficha.get("dias", 1)), activo=True,
        datos={
            "clave": ficha["clave"], "descripcion": ficha.get("descripcion", ""), "color": ficha.get("color", "#6b4a8c"),
            "noticia": azar.choice(ficha.get("noticias") or [""]),
            "ofertas": [{**o, "quedan": int(o.get("veces", 1))} for o in ficha.get("ofertas", [])],
            "cx": cx + 1, "cz": cz + 1,
        },
    )
    s.add(visitante)
    s.flush()
    aldea.estado.setdefault("banderas", {})["visitante"] = visitante.nombre
    aldea.tocar()
    nombre = visitante.nombre[:1].upper() + visitante.nombre[1:]
    noticia = f" Trae noticias: «{visitante.datos['noticia']}»" if visitante.datos["noticia"] else ""
    estado.anotar(s, aldea, "visita", f"Llega por el camino {visitante.nombre}. {visitante.datos['descripcion']}{noticia}", visitante=visitante.id)
    estado.emitir(aldea, "visitante", accion="llega", id=visitante.id, nombre=nombre)
    return visitante


def despedir_visitantes(s: Session, aldea: Aldea, azar: random.Random) -> None:
    dia = aldea.estado.get("dia", 1)
    fichas = {f["clave"]: f for f in (datos.cargar("mercaderes") or {}).get("visitantes", [])}
    activos = s.scalars(select(Visitante).where(Visitante.aldea_id == aldea.id, Visitante.activo.is_(True)))
    for visitante in activos:
        if visitante.dia_salida > dia:
            continue
        visitante.activo = False
        aldea.estado.get("banderas", {}).pop("visitante", None)
        aldea.tocar()
        ficha = fichas.get((visitante.datos or {}).get("clave"), {})
        lios = ficha.get("lios") or []
        if lios and azar.random() < float(ficha.get("lio", 0)):
            lio = azar.choice(lios)
            sujetos = efectos.resolver_sujetos(s, aldea, lio.get("sujetos"), azar)
            if sujetos is not None:
                efectos.aplicar(s, aldea, lio.get("efectos"), sujetos)
                estado.anotar(s, aldea, "visita", efectos.rellenar(lio["texto"], efectos.huecos(aldea, sujetos)))
                estado.emitir(aldea, "visitante", accion="se_va", id=visitante.id)
                continue
        nombre = visitante.nombre[:1].upper() + visitante.nombre[1:]
        estado.anotar(s, aldea, "visita", f"{nombre} recoge sus cosas y sigue camino.")
        estado.emitir(aldea, "visitante", accion="se_va", id=visitante.id)


def comerciar(s: Session, aldea: Aldea, visitante_id: int, clave_oferta: str) -> Visitante:
    visitante = s.get(Visitante, visitante_id)
    if visitante is None or visitante.aldea_id != aldea.id or not visitante.activo:
        raise NoSePuede("Ese visitante ya no está en la aldea.")
    ofertas = [dict(o) for o in (visitante.datos or {}).get("ofertas", [])]
    oferta = next((o for o in ofertas if o["clave"] == clave_oferta), None)
    if oferta is None:
        raise NoSePuede("Ese trato no existe.")
    if oferta.get("quedan", 0) <= 0:
        raise NoSePuede("De eso ya no le queda.")
    if not estado.puede_pagar(aldea, oferta.get("coste") or {}):
        raise NoSePuede("No tenéis con qué pagar ese trato.")
    estado.pagar(aldea, oferta.get("coste") or {})
    efectos.aplicar(s, aldea, oferta.get("efectos"))
    oferta["quedan"] -= 1
    visitante.datos = {**visitante.datos, "ofertas": ofertas}
    estado.anotar(s, aldea, "comercio", f"Trato cerrado con {visitante.nombre}: {oferta['texto']}.")
    return visitante


# === Aldeas vecinas y mensajes ======================================================================

def vecinos(s: Session, aldea: Aldea) -> list[Vecino]:
    return list(s.scalars(select(Vecino).where(Vecino.aldea_id == aldea.id).order_by(Vecino.id)))


def cambiar_relacion_vecino(s: Session, aldea: Aldea, clave: str, delta: int) -> None:
    for v in vecinos(s, aldea):
        if v.clave == clave:
            v.relacion = int(estado.limitar(v.relacion + delta, -100, 100))


def _oferta_comercio(v: Vecino, azar: random.Random) -> tuple[str, int, str, int]:
    da, pide = v.datos.get("vende", "grano"), v.datos.get("compra", "oro")
    cuanto_da = azar.choice([20, 30, 40])
    margen = 1.15 - v.relacion / 250  # cuanto mejor os lleváis, mejor precio
    cuanto_pide = max(1, round(cuanto_da * VALOR[da] * margen / VALOR[pide]))
    return da, cuanto_da, pide, cuanto_pide


def nuevo_mensaje(s: Session, aldea: Aldea, ia: Any = None, tipo: str | None = None, clave_vecino: str | None = None) -> Mensaje | None:
    """Un señor vecino escribe. El motor decide quién, qué y con qué opciones; la IA redacta."""
    from ..ia.simulado import MotorSimulado

    lista = vecinos(s, aldea)
    if clave_vecino is not None:
        lista = [v for v in lista if v.clave == clave_vecino]
    if not lista:
        return None
    e = aldea.estado
    dia = e.get("dia", 1)
    azar = estado.azar(aldea, "mensaje", tipo or "", clave_vecino or "")
    v = azar.choice(lista)
    aliados = e.get("alianzas", [])
    candidato = _casadero(s, aldea, azar)
    if tipo is None:
        pesos = {"comercio": 4.0, "cortesia": 2.0}
        if candidato is not None and v.relacion >= 0 and dia >= 6:
            pesos["boda"] = 1.5
        if v.relacion >= 25 and v.clave not in aliados:
            pesos["alianza"] = 2.0
        if dia >= int((datos.cargar("guerra") or {}).get("paz_inicial", 15)) and v.clave not in aliados:
            pesos["amenaza"] = float(v.datos.get("belicoso", 0.2)) * (5.0 if v.relacion <= 0 else 0.6)
        tipo = azar.choices(list(pesos), weights=list(pesos.values()))[0]

    huecos: dict[str, Any] = {"senor": v.senor, "vecino": v.nombre, "aldea": aldea.nombre}
    info: dict[str, Any] = {"vecino": v.clave}
    opciones: list[dict] = []
    defecto = "rechazar"
    rel = lambda delta: {"vecino": v.clave, "relacion": delta}  # noqa: E731

    if tipo == "comercio":
        da, cuanto_da, pide, cuanto_pide = _oferta_comercio(v, azar)
        huecos.update(da=f"{cuanto_da} de {NOMBRE_RECURSO[da]}", pide=f"{cuanto_pide} de {NOMBRE_RECURSO[pide]}" if pide != "oro" else f"{cuanto_pide} monedas")
        rebaja = max(1, round(cuanto_pide * 0.8))
        opciones = [
            {"clave": "aceptar", "texto": f"Aceptar el trato ({huecos['da']} por {huecos['pide']})", "coste": {pide: cuanto_pide},
             "efectos": [{"recursos": {da: cuanto_da}}, rel(5)], "resultado": f"Trato hecho con {v.nombre}. Los carros se cruzan en el puente."},
            {"clave": "regatear", "texto": "Regatear", "coste": {pide: rebaja},
             "suerte": {
                 "probabilidad": estado.limitar(0.5 + v.relacion / 100, 0.15, 0.9),
                 "exito": {"efectos": [{"recursos": {da: cuanto_da}}, rel(2)], "resultado": f"{v.senor} refunfuña, pero acepta la rebaja."},
                 "fracaso": {"efectos": [{"recursos": {pide: rebaja}}, rel(-5)], "resultado": f"{v.senor} se ofende con la rebaja y retira la oferta."},
             }},
            {"clave": "rechazar", "texto": "Rechazar con buenas palabras", "efectos": [rel(-1)], "resultado": "Declináis el trato con mucha cortesía."},
        ]
    elif tipo == "boda":
        if candidato is None:
            return None
        genero = (candidato.datos or {}).get("genero", "m")
        nombres = (datos.cargar("vecinos") or {}).get("pretendientes", {})
        pretendiente = azar.choice(nombres.get("nombres_f" if genero == "m" else "nombres_m", ["Aldara"]))
        huecos.update(vuestro=candidato.nombre, suyo=f"{pretendiente} de {v.nombre}")
        info.update(aldeano=candidato.id, pretendiente=pretendiente, genero_pretendiente="f" if genero == "m" else "m")
        opciones = [
            {"clave": "bendecir", "texto": f"Bendecir la boda de {candidato.nombre}", "efectos": [], "resultado": ""},
            {"clave": "que_decidan", "texto": "Que decidan los novios", "efectos": [], "resultado": ""},
            {"clave": "rechazar", "texto": "Rechazar la propuesta", "efectos": [rel(-8)], "resultado": f"Decís que no. En {v.nombre} lo toman como un desaire."},
        ]
        defecto = "que_decidan"
    elif tipo == "alianza":
        opciones = [
            {"clave": "aceptar", "texto": f"Aliarse con {v.nombre}", "efectos": [rel(15), {"alianza": v.clave}, {"opinion": 2, "a": "rasgo:miedoso"}],
             "resultado": f"Alianza sellada con {v.nombre}. Si vienen mal dadas, acudirán. O eso pone en el pergamino."},
            {"clave": "rechazar", "texto": "Mantenerse sin compromisos", "efectos": [rel(-6)], "resultado": f"Preferís no ataros. {v.senor} lo recordará."},
        ]
    elif tipo == "amenaza":
        cantidad = azar.choice([10, 15, 20])
        huecos["cantidad"] = cantidad
        info["cantidad"] = cantidad
        opciones = [
            {"clave": "pagar", "texto": f"Pagar las {cantidad} monedas", "coste": {"oro": cantidad}, "efectos": [rel(4), {"opinion": -3, "a": "todos"}],
             "resultado": "Pagáis. Compráis paz, y en la aldea se comenta lo barato que se vende el señor."},
            {"clave": "plantar_cara", "texto": "Plantar cara (hace falta defensa)", "condicion": "defensa >= 10",
             "efectos": [rel(-4), {"opinion": 5, "a": "todos"}, {"tension": -3}],
             "resultado": f"Contestáis que vengan a por ellas. {v.senor} hace cuentas de vuestras defensas y lo deja estar."},
            {"clave": "negarse", "texto": "Negarse", "efectos": [rel(-10), {"mesnada": v.clave}],
             "resultado": f"Os negáis. {v.senor} no es de amenazar en balde: conviene vigilar el camino estos días."},
        ]
        defecto = "negarse"
    else:
        tipo = "cortesia"
        opciones = [
            {"clave": "regalo", "texto": "Mandar un presente", "coste": {"oro": 5}, "efectos": [rel(10)], "resultado": f"Mandáis un presente a {v.nombre}. Queda apuntado, y bien apuntado."},
            {"clave": "excusarse", "texto": "Excusarse", "efectos": [rel(-2)], "resultado": "Os excusáis: mucho trabajo, poco camino."},
        ]
        defecto = "excusarse"

    variables = estado.variables(s, aldea)
    opciones = [o for o in opciones if condiciones.cumple(o.get("condicion"), variables)]
    plantillas = ((datos.cargar("vecinos") or {}).get("mensajes", {}).get(tipo, {}) or {}).get(v.datos.get("estilo", "ceremonioso"))
    ctx = {
        "aldea": {"nombre": aldea.nombre, "tono": aldea.tono},
        "remitente": {"nombre": v.senor, "aldea": v.nombre, "caracter": v.caracter, "relacion": v.relacion},
        "tipo": tipo, "datos": {k: val for k, val in huecos.items()},
        "plantillas": plantillas, "huecos": huecos,
        "semilla": f"{aldea.semilla}|{dia}|{v.clave}|{tipo}",
    }
    texto = None
    for motor in ([ia] if ia is not None else []) + [MotorSimulado()]:
        propuesta, error = validador.como_propuesta(motor.mensaje(ctx))
        if error is None and validador.motivo_texto(propuesta.get("texto"), 10, 900) is None:
            texto = propuesta["texto"].strip()
            break
        social.registrar_rechazos(s, aldea, "mensaje", [(propuesta, error or "texto de mensaje no válido")])
    mensaje = Mensaje(
        aldea_id=aldea.id, vecino_id=v.id, dia=dia, tipo=tipo, remitente=f"{v.senor}, de {v.nombre}",
        texto=texto or f"{v.senor} os manda saludos.", opciones=opciones, defecto=defecto, estado="abierto", datos=info,
    )
    s.add(mensaje)
    s.flush()
    estado.anotar(s, aldea, "vecinos", f"Llega un mensajero de {v.nombre} con carta de {v.senor}.", mensaje=mensaje.id)
    estado.emitir(aldea, "mensaje", id=mensaje.id, clase=tipo, remitente=mensaje.remitente)
    return mensaje


def _casadero(s: Session, aldea: Aldea, azar: random.Random) -> Aldeano | None:
    posibles = [
        a for a in estado.aldeanos(s, aldea)
        if a.oficio not in ("cura", "mozo") and not (a.datos or {}).get("casado") and int((a.datos or {}).get("edad") or 30) < 60
    ]
    return azar.choice(posibles) if posibles else None


def responder(s: Session, aldea: Aldea, mensaje_id: int, opcion: str, caducado: bool = False) -> Mensaje:
    mensaje = s.get(Mensaje, mensaje_id)
    if mensaje is None or mensaje.aldea_id != aldea.id:
        raise NoSePuede("Ese mensaje no existe.")
    if mensaje.estado != "abierto":
        raise NoSePuede("Ese mensaje ya está contestado.")
    elegida = next((o for o in mensaje.opciones if o["clave"] == opcion), None)
    if elegida is None:
        raise NoSePuede("Esa respuesta no existe.")
    coste = elegida.get("coste") or {}
    if not estado.puede_pagar(aldea, coste):
        if not caducado:
            raise NoSePuede("El arca no da para esa respuesta.")
        coste = {}
    estado.pagar(aldea, coste)
    lista, resultado = list(elegida.get("efectos") or []), elegida.get("resultado", "")
    if "suerte" in elegida:
        azar = estado.azar(aldea, "suerte", mensaje.id)
        rama = elegida["suerte"]["exito" if azar.random() < float(elegida["suerte"]["probabilidad"]) else "fracaso"]
        lista, resultado = list(rama.get("efectos") or []), rama.get("resultado", "")
    if mensaje.tipo == "boda" and opcion in ("bendecir", "que_decidan"):
        lista, resultado = _boda(s, aldea, mensaje, impuesta=opcion == "bendecir")
    _aplicar(s, aldea, lista)
    mensaje.respuesta = opcion
    mensaje.resultado = estado.pulir(("No contestasteis. " if caducado else "") + resultado) if resultado else ""
    mensaje.estado = "caducado" if caducado else "contestado"
    estado.anotar(s, aldea, "vecinos", f"Carta de {mensaje.remitente}: {mensaje.resultado}", mensaje=mensaje.id)
    s.flush()
    return mensaje


def _aplicar(s: Session, aldea: Aldea, lista: list[dict]) -> None:
    """Efectos de un mensaje: los corrientes más los propios de la diplomacia."""
    e = aldea.estado
    corrientes = []
    for efecto in lista:
        if "vecino" in efecto:
            cambiar_relacion_vecino(s, aldea, efecto["vecino"], int(efecto.get("relacion", 0)))
        elif "alianza" in efecto:
            e["alianzas"] = sorted(set(e.get("alianzas", [])) | {efecto["alianza"]})
            for otro in vecinos(s, aldea):
                if otro.clave != efecto["alianza"]:
                    otro.relacion = int(estado.limitar(otro.relacion - 5, -100, 100))
        elif "mesnada" in efecto:
            quien = next((v for v in vecinos(s, aldea) if v.clave == efecto["mesnada"]), None)
            if quien is not None and not e.get("amenaza"):
                azar = estado.azar(aldea, "mesnada")
                e["amenaza"] = {
                    "clave": "mesnada", "dia_golpe": e.get("dia", 1) + azar.choice([2, 3]), "fuerza": azar.randint(10, 18),
                    "vecino": quien.clave,
                    "ficha": {
                        "nombre": estado.pulir(f"la mesnada de {quien.senor}").lower()[:1] + estado.pulir(f"la mesnada de {quien.senor}")[1:],
                        "rechazado": {
                            "texto": f"La mesnada de {quien.senor} llegó hasta el puente, contó lanzas y se dio la vuelta. En {quien.nombre} ahora os respetan un poco más.",
                            "efectos": [{"opinion": 6, "a": "todos"}, {"tension": -4}],
                        },
                        "golpe": {
                            "texto": f"La mesnada de {quien.senor} entró al amanecer y se cobró lo que pedía, con intereses.",
                            "efectos": [{"recursos": {"oro": -20, "grano": -20}}, {"opinion": -6, "a": "todos"}, {"animo": -5, "a": "todos"}, {"tension": 12}],
                        },
                    },
                }
        else:
            corrientes.append(efecto)
    aldea.tocar()
    efectos.aplicar(s, aldea, corrientes)


def _boda(s: Session, aldea: Aldea, mensaje: Mensaje, impuesta: bool) -> tuple[list[dict], str]:
    """La boda con alguien de la aldea vecina. Si el novio o la novia quería a otra persona, hay drama."""
    from . import economia

    info = mensaje.datos or {}
    vecino = s.get(Vecino, mensaje.vecino_id)
    clave_vecino = vecino.clave if vecino else ""
    novio = s.get(Aldeano, info.get("aldeano"))
    if novio is None or not novio.presente:
        return [{"vecino": clave_vecino, "relacion": -2}], "El interesado ya no está en la aldea, y la boda se queda en nada."
    apodo = (novio.datos or {}).get("apodo", novio.nombre)
    amor = next((otro for otro, r in estado.relaciones_de(s, aldea, novio.id) if r.etiqueta == "amor"), None)
    amado = s.get(Aldeano, amor) if amor else None
    if amado is not None and not impuesta:
        return _con_sujetos(
            s, aldea, {"n": novio, "m": amado},
            [{"vecino": clave_vecino, "relacion": -3}, {"opinion": 8, "a": "n"}, {"opinion": 4, "a": "m"}],
            f"{apodo} dice que no, y no da explicaciones. En el pozo dicen que las explicaciones tienen nombre.",
        )
    if not impuesta and estado.azar(aldea, "boda", novio.id).random() < 0.4:
        return [{"vecino": clave_vecino, "relacion": -2}], f"{apodo} lo piensa una noche y dice que no, que está bien como está."
    # Hay boda.
    novio.datos = {**(novio.datos or {}), "casado": info.get("pretendiente")}
    conyuge = economia._inmigrante(s, aldea)
    genero = info.get("genero_pretendiente", "f")
    conyuge.nombre = f"{info.get('pretendiente', 'Aldara')} de {vecino.nombre if vecino else 'fuera'}"
    conyuge.presente = True
    conyuge.dia_llegada = aldea.estado.get("dia", 1)
    conyuge.datos = {**conyuge.datos, "apodo": info.get("pretendiente", "Aldara"), "genero": genero, "casado": apodo,
                     "oficio_nombre": "labradora" if genero == "f" else "labrador"}
    conyuge.oficio = "labrador"
    social.cambiar_relacion(s, aldea, novio.id, conyuge.id, 35 if amado is None else 5)
    lista = [
        {"vecino": clave_vecino, "relacion": 15}, {"recursos": {"oro": 10}}, {"animo": 5, "a": "todos"},
        {"bandera": "fiesta", "valor": "la boda", "dias": 1},
    ]
    if amado is not None:  # impuesta, y quería a otra persona
        _con_sujetos(s, aldea, {"n": novio, "m": amado}, [
            {"animo": -15, "a": "n"}, {"animo": -15, "a": "m"}, {"opinion": -18, "a": "n"}, {"opinion": -18, "a": "m"},
            {"recuerdo": "El señor casó a {n} con alguien de fuera. No se lo perdono.", "a": "m", "importancia": 9}, {"tension": 8},
        ], "")
        return lista, f"Hay boda, porque vos lo mandáis. {apodo} dice «sí» mirando al suelo, y alguien en la aldea no ha ido al convite."
    return lista, f"Hay boda y convite. {apodo} está que no cabe en el jubón, y {vecino.nombre if vecino else 'la aldea vecina'} manda dote y parientes con hambre."


def _con_sujetos(s: Session, aldea: Aldea, sujetos: dict[str, Aldeano], lista: list[dict], resultado: str) -> tuple[list[dict], str]:
    """Aplica ya los efectos que nombran papeles y deja para después los diplomáticos."""
    efectos.aplicar(s, aldea, [x for x in lista if "vecino" not in x], sujetos)
    return [x for x in lista if "vecino" in x], resultado


def caducar_mensajes(s: Session, aldea: Aldea) -> None:
    dia = aldea.estado.get("dia", 1)
    viejos = s.scalars(select(Mensaje).where(Mensaje.aldea_id == aldea.id, Mensaje.estado == "abierto", Mensaje.dia <= dia - DIAS_MENSAJE))
    for mensaje in list(viejos):
        responder(s, aldea, mensaje.id, mensaje.defecto or mensaje.opciones[-1]["clave"], caducado=True)


# === Amenazas =======================================================================================

def amenazas(s: Session, aldea: Aldea, ligero: bool = False) -> None:
    e = aldea.estado
    dia = e.get("dia", 1)
    if e.get("peste"):
        _dia_de_peste(s, aldea)
    pendiente = e.get("amenaza")
    if pendiente:
        if dia >= int(pendiente["dia_golpe"]):
            _golpe(s, aldea, pendiente)
        return
    if ligero or e.get("peste") or e.get("asedio") or dia < e.get("enfriamientos", {}).get("amenaza", 0):
        return
    riesgo = float(datos.dificultad(aldea.dificultad)["riesgo"])
    azar = estado.azar(aldea, "amenaza")
    v = estado.variables(s, aldea)
    fichas = list(datos.cargar("amenazas") or [])
    azar.shuffle(fichas)
    for ficha in fichas:
        if condiciones.cumple(ficha.get("condicion"), v) and azar.random() < float(ficha.get("probabilidad", 0.05)) * riesgo:
            minimo, maximo = ficha.get("fuerza", [0, 0])
            e["amenaza"] = {"clave": ficha["clave"], "dia_golpe": dia + int(ficha.get("dias_aviso", 1)), "fuerza": azar.randint(minimo, maximo)}
            aldea.tocar()
            estado.anotar(s, aldea, "amenaza", ficha["aviso"], clave=ficha["clave"])
            estado.emitir(aldea, "amenaza", clave=ficha["clave"], aviso=True)
            return


def _golpe(s: Session, aldea: Aldea, pendiente: dict) -> None:
    e = aldea.estado
    dia = e.get("dia", 1)
    tabla = {f["clave"]: f for f in datos.cargar("amenazas") or []}
    ficha = pendiente.get("ficha") or tabla.get(pendiente["clave"], {})
    e["amenaza"] = None
    e.setdefault("enfriamientos", {})["amenaza"] = dia + DESCANSO_AMENAZA
    aldea.tocar()
    if pendiente["clave"] == "hueste":
        from . import guerra

        guerra.asalto(s, aldea, pendiente)
        return
    if pendiente["clave"] == "peste":
        e["peste"] = {"hasta": dia + int(ficha.get("dias", 5))}
        estado.anotar(s, aldea, "amenaza", ficha.get("inicio", "Ha entrado la fiebre en la aldea."), clave="peste")
        return
    fuerza = float(pendiente.get("fuerza", 10))
    defensa = estado.defensa(s, aldea)
    if defensa >= fuerza:
        efectos.aplicar(s, aldea, ficha["rechazado"].get("efectos"))
        estado.anotar(s, aldea, "amenaza", ficha["rechazado"]["texto"], clave=pendiente["clave"], defendido=True)
        if pendiente.get("vecino"):
            cambiar_relacion_vecino(s, aldea, pendiente["vecino"], 5)
    else:
        riesgo = min(1.3, float(datos.dificultad(aldea.dificultad)["riesgo"]))
        dano = estado.limitar((fuerza - defensa) / fuerza, 0.25, 1.0) * riesgo
        efectos.aplicar(s, aldea, ficha["golpe"].get("efectos"), multiplicador=dano)
        texto = ficha["golpe"]["texto"]
        if defensa > 0:
            texto += " La guardia hizo lo que pudo, y gracias a ella no fue peor."
        estado.anotar(s, aldea, "amenaza", texto, clave=pendiente["clave"], defendido=False)
    estado.emitir(aldea, "amenaza", clave=pendiente["clave"], aviso=False)


def _dia_de_peste(s: Session, aldea: Aldea) -> None:
    e = aldea.estado
    dia = e.get("dia", 1)
    tabla = {f["clave"]: f for f in datos.cargar("amenazas") or []}
    gente = estado.aldeanos(s, aldea)
    riesgo = float(datos.dificultad(aldea.dificultad)["riesgo"])
    cuidados = estado.suma_efecto(s, aldea, "salud")
    cuarentena = "cuarentena" in e.get("leyes", [])
    enfermos = max(0, round(len(gente) * 0.25 * riesgo) - (1 if cuidados >= 5 else 0) - (1 if cuarentena else 0))
    azar = estado.azar(aldea, "peste")
    mortal = aldea.tono == "crudo" or aldea.dificultad == "dificil"
    for a in azar.sample(gente, min(enfermos, len(gente))):
        a.salud = int(estado.limitar(a.salud - (14 if cuidados >= 5 else 25), 5, 100))
        a.animo = int(estado.limitar(a.animo - 4, 0, 100))
        social.recordar(s, aldea, a, "Me cogió la fiebre. Días de jergón, caldo y miedo.", 6, "suceso")
        if mortal and a.salud <= 10 and azar.random() < 0.3 and len(gente) > 3:
            a.vivo, a.presente = False, False
            a.casa_id = a.trabajo_id = None
            efectos.aplicar(s, aldea, [{"animo": -8, "a": "todos"}, {"tension": 6}])
            estado.anotar(s, aldea, "amenaza", f"La fiebre se ha llevado a {a.nombre}. La aldea entera calla.", aldeano=a.id)
            estado.emitir(aldea, "aldeano", accion="se_va", id=a.id)
    if dia >= int(e["peste"].get("hasta", dia)):
        e["peste"] = None
        e.setdefault("enfriamientos", {})["amenaza"] = dia + 20
        estado.anotar(s, aldea, "amenaza", tabla.get("peste", {}).get("fin", "La fiebre remite."), clave="peste")
    aldea.tocar()
