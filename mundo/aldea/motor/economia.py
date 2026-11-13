"""Economía: casas, trabajos, producción en cadena, comida, leña, impuestos y llegada de vecinos.

Todo lo material lo decide aquí el motor. La IA no entra en este archivo.
"""

from __future__ import annotations

import math
from datetime import date

from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Aldeano, Edificio, Recuerdo
from . import estado, leyes
from . import tiempo


def parametros() -> dict:
    return datos.cargar("economia")


# --- Casas y trabajos -------------------------------------------------------------------------------

def asignar_casas(s: Session, aldea: Aldea) -> int:
    """Reparte a los vecinos por las casas. Devuelve cuántos se quedan sin techo."""
    catalogo = datos.catalogo()
    casas = {e.id: int(catalogo[e.clave]["efecto"].get("vivienda", 0)) for e in estado.edificios(s, aldea) if e.clave in catalogo}
    casas = {k: v for k, v in casas.items() if v > 0}
    gente = estado.aldeanos(s, aldea)
    ocupacion = {k: 0 for k in casas}
    for a in gente:
        if a.casa_id in casas and ocupacion[a.casa_id] < casas[a.casa_id]:
            ocupacion[a.casa_id] += 1
        else:
            a.casa_id = None
    sin_techo = 0
    for a in gente:
        if a.casa_id is None:
            libre = next((k for k in casas if ocupacion[k] < casas[k]), None)
            if libre is None:
                sin_techo += 1
            else:
                a.casa_id = libre
                ocupacion[libre] += 1
    return sin_techo


def asignar_trabajos(s: Session, aldea: Aldea) -> None:
    """Cada mañana: primero cada cual a lo de su oficio; los huecos, con quien quede libre."""
    catalogo = datos.catalogo()
    puestos: list[tuple[Edificio, dict]] = []
    for e in estado.edificios(s, aldea):
        efecto = catalogo.get(e.clave, {}).get("efecto", {})
        for _ in range(int(efecto.get("trabajadores", 0))):
            puestos.append((e, efecto))
    gente = [a for a in estado.aldeanos(s, aldea) if a.salud >= 20]
    for a in estado.aldeanos(s, aldea):
        a.trabajo_id = None
    libres = list(gente)
    vacantes: list[tuple[Edificio, dict]] = []
    for edificio, efecto in puestos:
        del_oficio = next((a for a in libres if a.oficio in efecto.get("oficios", [])), None)
        if del_oficio is not None:
            del_oficio.trabajo_id = edificio.id
            libres.remove(del_oficio)
        else:
            vacantes.append((edificio, efecto))
    # Lo que da de comer va primero; luego madera y piedra; al final, servicios.
    orden = {clave: i for i, clave in enumerate(catalogo)}
    prioridad = lambda p: (0 if "produce" in p[1] or "comida_extra" in p[1] else 1, orden.get(p[0].clave, 99))  # noqa: E731
    for edificio, _efecto in sorted(vacantes, key=prioridad):
        if not libres:
            break
        libres.pop(0).trabajo_id = edificio.id


def rendimiento(aldeano: Aldeano, efecto: dict) -> float:
    return 1.0 if aldeano.oficio in efecto.get("oficios", []) else float(parametros()["rendimiento_sin_oficio"])


# --- Producción -------------------------------------------------------------------------------------

def producir(s: Session, aldea: Aldea, fecha: date, clima_tipo: str) -> dict[str, dict[str, float]]:
    p = parametros()
    catalogo = datos.catalogo()
    dificultad = datos.dificultad(aldea.dificultad)
    paisaje = datos.paisaje(aldea.paisaje).get("recursos", {})
    gente = estado.aldeanos(s, aldea)
    por_trabajo = {a.trabajo_id: a for a in gente if a.trabajo_id}
    animo_medio = sum(a.animo for a in gente) / len(gente) if gente else 50
    estacion = tiempo.estacion(fecha)
    mods = leyes.modificadores(aldea)
    herramientas = 1.0 + estado.suma_efecto(s, aldea, "herramientas")
    general = float(dificultad["produccion"]) * (0.75 + animo_medio / 200) * herramientas * mods["produccion"]
    if aldea.estado.get("revuelta", {}).get("activa"):
        general *= 0.5

    producido: dict[str, float] = {}
    gastado: dict[str, float] = {}
    r = estado.recursos(aldea)
    orden = {clave: i for i, clave in enumerate(catalogo)}
    for e in sorted(estado.edificios(s, aldea), key=lambda e: (orden.get(e.clave, 99), e.id)):
        efecto = catalogo.get(e.clave, {}).get("efecto", {})
        if "produce" not in efecto:
            continue
        trabajador = por_trabajo.get(e.id)
        if efecto.get("trabajadores") and trabajador is None:
            continue
        factor = general * (rendimiento(trabajador, efecto) if trabajador else 1.0)
        if efecto.get("estacional"):
            factor *= float(p["estaciones"][estacion]) * float(p["clima"].get(clima_tipo, 1.0))
        # Lo que consume limita lo que produce: si solo hay media ración de grano, sale media de harina.
        consumo = efecto.get("consume", {})
        proporcion = 1.0
        for recurso, cantidad in consumo.items():
            necesario = cantidad * factor
            if necesario > 0:
                proporcion = min(proporcion, r.get(recurso, 0) / necesario)
        if proporcion <= 0:
            continue
        for recurso, cantidad in consumo.items():
            usado = round(cantidad * factor * proporcion, 2)
            estado.sumar_recurso(aldea, recurso, -usado)
            gastado[recurso] = round(gastado.get(recurso, 0) + usado, 2)
        for recurso, cantidad in efecto["produce"].items():
            hecho = round(cantidad * factor * proporcion * float(paisaje.get(recurso, 1.0)), 2)
            estado.sumar_recurso(aldea, recurso, hecho)
            producido[recurso] = round(producido.get(recurso, 0) + hecho, 2)
    # Consumos de edificios que no producen recursos (taberna, herrería): si falta, ese día no rinden.
    for e in estado.edificios(s, aldea):
        efecto = catalogo.get(e.clave, {}).get("efecto", {})
        if "produce" in efecto or "consume" not in efecto or e.id not in por_trabajo:
            continue
        if estado.puede_pagar(aldea, efecto["consume"]):
            estado.pagar(aldea, efecto["consume"])
            for recurso, cantidad in efecto["consume"].items():
                gastado[recurso] = round(gastado.get(recurso, 0) + cantidad, 2)
    return {"producido": producido, "gastado": gastado}


# --- Comida, leña y merma ---------------------------------------------------------------------------

def comer(s: Session, aldea: Aldea, fecha: date) -> dict:
    """Reparte las raciones del día. Devuelve cuánto se comió y quién pasó hambre."""
    p = parametros()
    catalogo = datos.catalogo()
    gente = estado.aldeanos(s, aldea)
    mods = leyes.modificadores(aldea)
    r = estado.recursos(aldea)
    estacion = tiempo.estacion(fecha)

    extra = 0.0
    atendidos = {a.trabajo_id for a in gente}
    for e in estado.edificios(s, aldea):
        efecto = catalogo.get(e.clave, {}).get("efecto", {})
        if "comida_extra" not in efecto:
            continue
        if efecto.get("invierno_parado") and estacion == "invierno":
            continue
        if efecto.get("trabajadores") and e.id not in atendidos:
            continue
        extra += float(efecto["comida_extra"])

    raciones = len(gente) * mods["consumo"]
    pendientes = max(0.0, raciones - extra)
    pan = min(r.get("pan", 0), pendientes)
    estado.sumar_recurso(aldea, "pan", -pan)
    pendientes -= pan
    por_racion = float(p["grano_por_racion"])
    grano = min(r.get("grano", 0), pendientes * por_racion)
    estado.sumar_recurso(aldea, "grano", -grano)
    pendientes -= grano / por_racion

    # Los que se quedan sin ración: primero los de bolsa más flaca (el rico siempre encuentra un mendrugo).
    n_hambrientos = math.ceil(pendientes - 1e-6) if pendientes > 0.05 else 0
    hambrientos = sorted(gente, key=lambda a: (a.dinero, a.id))[:n_hambrientos]
    ids = {a.id for a in hambrientos}
    cuidados = estado.suma_efecto(s, aldea, "salud") / 4
    for a in gente:
        if a.id in ids:
            a.hambre += 1
            a.salud = int(estado.limitar(a.salud - 4, 5, 100))
        else:
            a.hambre = max(0, a.hambre - 2)
            a.salud = int(estado.limitar(a.salud + 2 + cuidados, 0, 100))
    aldea.estado["hambre_dias"] = aldea.estado.get("hambre_dias", 0) + 1 if hambrientos else 0
    aldea.tocar()
    return {"pan": round(pan, 2), "grano": round(grano, 2), "extra": extra, "hambrientos": [a.id for a in hambrientos]}


def lena_y_merma(s: Session, aldea: Aldea, fecha: date) -> dict:
    p = parametros()
    gente = estado.aldeanos(s, aldea)
    resultado = {"lena": 0, "frio": False, "merma": 0.0}
    if tiempo.estacion(fecha) == "invierno" and gente:
        necesaria = math.ceil(len(gente) / int(p["vecinos_por_lena"]))
        if estado.recursos(aldea).get("madera", 0) >= necesaria:
            estado.sumar_recurso(aldea, "madera", -necesaria)
            resultado["lena"] = necesaria
        else:
            resultado["frio"] = True
            for a in gente:
                a.salud = int(estado.limitar(a.salud - 2, 5, 100))
    cuenta = estado.contar_edificios(s, aldea)
    grano = estado.recursos(aldea).get("grano", 0)
    if not cuenta.get("granero") and grano > float(p["grano_seguro"]):
        merma = round((grano - float(p["grano_seguro"])) * float(p["merma_sin_granero"]), 2)
        estado.sumar_recurso(aldea, "grano", -merma)
        resultado["merma"] = merma
    return resultado


# --- Jornales e impuestos ---------------------------------------------------------------------------

def cobrar(s: Session, aldea: Aldea) -> dict:
    p = parametros()
    catalogo = datos.catalogo()
    nivel = int(estado.limitar(aldea.estado.get("impuestos", 1), 0, 4))
    parte = float(p["impuestos"]["parte"][nivel])
    por_id = {e.id: e for e in estado.edificios(s, aldea)}
    recaudado = 0.0
    for a in estado.aldeanos(s, aldea):
        edificio = por_id.get(a.trabajo_id) if a.trabajo_id else None
        if edificio is None:
            jornal = p["jornal"]["sin_trabajo"]
        else:
            efecto = catalogo.get(edificio.clave, {}).get("efecto", {})
            jornal = p["jornal"]["con_oficio"] if a.oficio in efecto.get("oficios", []) else p["jornal"]["sin_oficio"]
        tributo = jornal * parte
        recaudado += tributo
        a.dinero = int(estado.limitar(a.dinero + round(jornal - tributo), 0, 9999))
    recaudado *= 1.0 + estado.suma_efecto(s, aldea, "recaudacion")
    rentas = estado.suma_efecto(s, aldea, "oro_dia") + leyes.modificadores(aldea)["oro_dia"]
    total = round(recaudado + rentas)
    estado.sumar_recurso(aldea, "oro", total)
    return {"impuestos": round(recaudado), "rentas": round(rentas), "oro": total}


# --- Ánimo y opinión --------------------------------------------------------------------------------

def animo_y_opinion(s: Session, aldea: Aldea, hambrientos: set[int], sin_techo: int, frio: bool) -> None:
    p = parametros()
    gente = estado.aldeanos(s, aldea)
    if not gente:
        return
    nivel = int(estado.limitar(aldea.estado.get("impuestos", 1), 0, 4))
    mods = leyes.modificadores(aldea)
    banderas = aldea.estado.get("banderas", {})
    comun_animo = (
        50 + min(18.0, estado.suma_efecto(s, aldea, "animo") + estado.suma_efecto(s, aldea, "encanto", False) / 2)
        + p["impuestos"]["animo"][nivel] + mods["animo"] + float(banderas.get("fiesta_animo", 0))
        - (4 if frio else 0)
    )
    dias_comida = estado.raciones_guardadas(aldea) / len(gente)
    comun_opinion = (
        10 + estado.suma_efecto(s, aldea, "autoridad") + p["impuestos"]["opinion"][nivel]
        + (5 if dias_comida >= 5 else 0)
    )
    # Los que duermen al raso: los últimos en llegar.
    al_raso = {a.id for a in gente if a.casa_id is None}
    paciencia = float(datos.dificultad(aldea.dificultad)["paciencia"])
    for a in gente:
        objetivo = comun_animo - (14 if a.id in hambrientos else 0) - (6 if a.id in al_raso else 0)
        objetivo += (a.salud - 70) / 10
        a.animo = int(estado.limitar(a.animo + round((objetivo - a.animo) * 0.3), 0, 100))
        objetivo_op = (
            comun_opinion + leyes.opinion_de(aldea, a) + (a.animo - 50) / 4
            - (22 if a.id in hambrientos else 0) / paciencia - (8 if a.id in al_raso else 0) / paciencia
        )
        a.opinion_senor = int(estado.limitar(a.opinion_senor + round((objetivo_op - a.opinion_senor) * 0.15), -100, 100))


# --- Población: quién se va y quién llega -----------------------------------------------------------

def marchas(s: Session, aldea: Aldea) -> list[Aldeano]:
    limite = math.ceil(int(parametros()["dias_hambre_para_marchar"]) * float(datos.dificultad(aldea.dificultad)["paciencia"]))
    se_van = [a for a in estado.aldeanos(s, aldea) if a.hambre >= limite]
    # Como mucho uno al día, y nunca el último: cuesta perder.
    se_van = se_van[:1] if len(estado.aldeanos(s, aldea)) > 2 else []
    for a in se_van:
        a.presente = False
        a.hambre = 0
        a.casa_id = a.trabajo_id = None
        a.datos = {**(a.datos or {}), "se_fue": aldea.estado.get("dia", 1)}
        estado.anotar(
            s, aldea, "marcha",
            f"{a.nombre} recoge sus cuatro cosas y se marcha valle abajo, a buscar pan a otra parte.",
            aldeano=a.id,
        )
        estado.emitir(aldea, "aldeano", accion="se_va", id=a.id)
    return se_van


def llegadas(s: Session, aldea: Aldea) -> list[Aldeano]:
    p = parametros()["llegadas"]
    gente = estado.aldeanos(s, aldea)
    if aldea.estado.get("revuelta", {}).get("activa"):
        return []
    libres = estado.plazas(s, aldea) - len(gente)
    if libres <= 0 or not gente:
        return []
    dias_comida = estado.raciones_guardadas(aldea) / len(gente)
    animo_medio = sum(a.animo for a in gente) / len(gente)
    if dias_comida < float(p["dias_comida"]) or animo_medio < float(p["animo_minimo"]):
        return []
    dia = aldea.estado.get("dia", 1)
    fuera = [
        a for a in estado.aldeanos(s, aldea, solo_presentes=False)
        if a.vivo and not a.presente and a.reparto and dia - int((a.datos or {}).get("se_fue", -99)) >= 3
    ]
    nuevo: Aldeano | None = None
    if fuera:
        nuevo = min(fuera, key=lambda a: (a.orden_llegada, a.id))
    elif estado.azar(aldea, "inmigrante").random() < float(p["probabilidad_inmigrante"]):
        nuevo = _inmigrante(s, aldea)
    if nuevo is None:
        return []
    vuelve = "se_fue" in (nuevo.datos or {})
    nuevo.presente = True
    nuevo.dia_llegada = dia
    nuevo.animo = max(nuevo.animo, 55)
    oficio = (nuevo.datos or {}).get("oficio_nombre", nuevo.oficio)
    if vuelve:
        texto = f"{nuevo.nombre} vuelve a Pedrafonte, con el hatillo al hombro y la cabeza alta." if aldea.nombre == "Pedrafonte" else f"{nuevo.nombre} vuelve a {aldea.nombre}, con el hatillo al hombro y la cabeza alta."
    else:
        texto = f"Llega por el camino {nuevo.nombre}, {oficio}, con todo lo suyo a cuestas."
    s.add(Recuerdo(
        aldea_id=aldea.id, aldeano_id=nuevo.id, dia=dia, hora=12, importancia=6, tipo="suceso",
        texto=f"Llegué a {aldea.nombre}. Hay sitio, hay lumbre y el señor parece que sabe lo que hace. Ya se verá.",
    ))
    estado.anotar(s, aldea, "llegada", texto, aldeano=nuevo.id)
    estado.emitir(aldea, "aldeano", accion="llega", id=nuevo.id)
    return [nuevo]


def _inmigrante(s: Session, aldea: Aldea) -> Aldeano:
    tabla = datos.cargar("aldeanos").get("inmigrantes", {})
    azar = estado.azar(aldea, "nuevo-vecino")
    todos = estado.aldeanos(s, aldea, solo_presentes=False)
    usados = {a.nombre for a in todos}
    genero = azar.choice(["m", "f"])
    for _ in range(40):
        nombre = f"{azar.choice(tabla[f'nombres_{genero}'])} {azar.choice(tabla['apellidos'])}"
        if nombre not in usados:
            break
    oficio = azar.choice(tabla["oficios"])
    numero = len(todos) + 1
    nombres_oficio = {"labrador": "labrador", "cantero": "picapedrero", "guardia": "guardia"}
    if genero == "f":
        nombres_oficio = {"labrador": "labradora", "cantero": "picapedrera", "guardia": "guardia"}
    colores = ["#8c6d46", "#6b7f5a", "#7d5a6e", "#55708c", "#9c7b3c"]
    vecino = Aldeano(
        aldea_id=aldea.id, clave=f"vecino{numero}", nombre=nombre, oficio=oficio,
        caracter=azar.choice(tabla["caracteres"]), rasgos=azar.sample(["leal", "chismoso", "terco", "bondadoso", "curioso", "desconfiado"], 2),
        objetivo="Echar raíces aquí y que no falte el pan.", secreto="", dinero=azar.randint(2, 12),
        reparto=False, orden_llegada=100 + numero, presente=False,
        datos={
            "apodo": nombre.split()[0], "genero": genero, "oficio_nombre": nombres_oficio[oficio],
            "color": azar.choice(colores), "edad": azar.randint(18, 50),
            "habla": {"muletillas": ["Pues sí.", "Ya se verá.", "Será eso."], "saludo": "Buen día, señor."},
        },
    )
    s.add(vecino)
    s.flush()
    return vecino


# --- Cierre económico del día -----------------------------------------------------------------------

def cierre(s: Session, aldea: Aldea, fecha: date, clima_tipo: str) -> dict:
    """Todo lo material de un día: producción, comida, leña, impuestos, ánimo y población."""
    sin_techo = asignar_casas(s, aldea)
    asignar_trabajos(s, aldea)
    antes = dict(estado.recursos(aldea))
    produccion = producir(s, aldea, fecha, clima_tipo)
    comida = comer(s, aldea, fecha)
    invierno = lena_y_merma(s, aldea, fecha)
    oro = cobrar(s, aldea)
    animo_y_opinion(s, aldea, set(comida["hambrientos"]), sin_techo, invierno["frio"])
    se_van = marchas(s, aldea)
    llegan = llegadas(s, aldea)
    if llegan:
        asignar_casas(s, aldea)
    despues = estado.recursos(aldea)
    balance = {
        "dia": aldea.estado.get("dia", 1),
        "fecha": fecha.isoformat(),
        "estacion": tiempo.estacion(fecha),
        "clima": clima_tipo,
        "producido": produccion["producido"],
        "gastado": produccion["gastado"],
        "comido": {"pan": comida["pan"], "grano": comida["grano"], "extra": comida["extra"]},
        "hambrientos": len(comida["hambrientos"]),
        "lena": invierno["lena"], "frio": invierno["frio"], "merma": invierno["merma"],
        "oro": oro,
        "sin_techo": sin_techo,
        "se_van": [a.nombre for a in se_van],
        "llegan": [a.nombre for a in llegan],
        "neto": {k: round(despues.get(k, 0) - antes.get(k, 0), 2) for k in datos.TODOS_RECURSOS},
    }
    aldea.estado["ultimo_balance"] = balance
    aldea.tocar()
    return balance
