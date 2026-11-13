"""La guerra: tropas, campañas contra otros señores, huestes que vienen, asedios, vasallos y títulos.

Todo lo decide el motor con las cifras de `datos/guerra.yaml` y de `datos/vecinos.yaml`. «Fuerza» es la
misma medida que la defensa de la aldea (una torre con guardia vale 10), así que un ejército y unos muros
se pueden comparar.

Lo que cambia con el tiempo de cada territorio va en `Vecino.datos`: `fuerza_ahora` (su mesnada tras las
batallas, que se rehace poco a poco), `estado` (libre, vasallo o conquistado) y unas pocas fechas.
"""

from __future__ import annotations

import math
import random
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Vecino
from . import efectos, estado, social, tutorial
from .construccion import NoSePuede

REHACERSE = 0.04        # parte de su mesnada que un territorio recupera cada noche
DESERCION = 0.25        # parte de la tropa de sueldo que se va la noche que no cobra
MAX_PARTES = 8          # partes de guerra que se guardan
DIAS_ENTRE_EMBAJADAS = 3


def cfg() -> dict:
    return datos.cargar("guerra") or {}


def unidades() -> dict[str, dict]:
    return {u["clave"]: u for u in cfg().get("unidades", [])}


# === Territorios ====================================================================================

def _pon(v: Vecino, **cambios: Any) -> None:
    v.datos = {**(v.datos or {}), **cambios}


def asegurar(s: Session, aldea: Aldea) -> list[Vecino]:
    """Los territorios de la comarca, al día con `vecinos.yaml` (las aldeas viejas no los tenían todos)."""
    lista = list(s.scalars(select(Vecino).where(Vecino.aldea_id == aldea.id).order_by(Vecino.id)))
    por_clave = {v.clave: v for v in lista}
    for ficha in (datos.cargar("vecinos") or {}).get("aldeas", []):
        extra = {k: val for k, val in ficha.items() if k not in ("clave", "nombre", "senor", "caracter", "relacion")}
        v = por_clave.get(ficha["clave"])
        if v is None:
            v = Vecino(
                aldea_id=aldea.id, clave=ficha["clave"], nombre=ficha["nombre"], senor=ficha["senor"],
                caracter=ficha.get("caracter", ""), relacion=int(ficha.get("relacion", 0)), datos=extra,
            )
            s.add(v)
            lista.append(v)
        else:
            faltan = {k: val for k, val in extra.items() if k not in (v.datos or {})}
            if faltan:
                _pon(v, **faltan)
        if "fuerza_ahora" not in (v.datos or {}):
            _pon(v, fuerza_ahora=float((v.datos or {}).get("fuerza", 10)), estado="libre")
    s.flush()
    return lista


def territorio(s: Session, aldea: Aldea, clave: str) -> Vecino:
    for v in asegurar(s, aldea):
        if v.clave == clave:
            return v
    raise NoSePuede("Ese territorio no está en la comarca.")


def situacion(v: Vecino) -> str:
    return (v.datos or {}).get("estado", "libre")


def dias_de_marcha(v: Vecino) -> int:
    origen = cfg().get("aldea", {}).get("pos", [50, 58])
    x, y = (v.datos or {}).get("pos", [50, 30])
    return max(1, round(math.hypot(x - origen[0], y - origen[1]) / float(cfg().get("dia_de_marcha", 20))))


def tributo_de(v: Vecino) -> dict[str, float]:
    """Lo que paga al día: nada si es libre; más si la plaza está conquistada."""
    if situacion(v) == "libre":
        return {}
    factor = float(cfg().get("tributo_conquista", 1.6)) if situacion(v) == "conquistado" else 1.0
    riqueza = float((v.datos or {}).get("riqueza", 50))
    return {r: round(riqueza * float(parte) * factor, 1) for r, parte in (cfg().get("tributo") or {}).items()}


def dominios(lista: list[Vecino]) -> int:
    return sum(1 for v in lista if situacion(v) != "libre")


def titulo(lista: list[Vecino]) -> str:
    cuantos = dominios(lista)
    nombre = "Señor"
    for t in cfg().get("titulos", []):
        if cuantos >= int(t["dominios"]):
            nombre = t["nombre"]
    return nombre


# === Tropas =========================================================================================

def tropas(aldea: Aldea) -> dict[str, int]:
    """Las que están en casa. Las que marchan con la hueste van aparte, en la campaña."""
    guardadas = aldea.estado.get("tropas") or {}
    return {clave: int(guardadas.get(clave, 0)) for clave in unidades()}


def _guardar_tropas(aldea: Aldea, nuevas: dict[str, int]) -> None:
    aldea.estado["tropas"] = {k: max(0, int(n)) for k, n in nuevas.items()}
    aldea.tocar()


def fuerza(tr: dict[str, int], en_muro: bool = False) -> float:
    campo = "en_muro" if en_muro else "fuerza"
    tabla = unidades()
    return round(sum(n * float(tabla[k].get(campo, tabla[k]["fuerza"])) for k, n in tr.items() if k in tabla), 1)


def total(tr: dict[str, int]) -> int:
    return sum(tr.values())


def guarnicion(aldea: Aldea, hay_muros: bool) -> float:
    """Lo que suman a la defensa las tropas que están en casa (más si hay muro tras el que ponerse)."""
    return fuerza(tropas(aldea), en_muro=hay_muros)


def cupos(s: Session, aldea: Aldea) -> dict[str, int]:
    """Cuántos hombres de armas caben (cuarteles) y cuánta milicia se puede levantar (vecinos)."""
    fuera = (aldea.estado.get("campana") or {}).get("tropas") or {}
    return {
        "sueldo": int(estado.suma_efecto(s, aldea, "tropas", solo_atendidos=False)),
        "milicia": int(len(estado.aldeanos(s, aldea)) * float(cfg().get("milicia_por_vecino", 0.5))),
        "sueldo_usado": sum(n for k, n in tropas(aldea).items() if k != "milicia") + sum(int(n) for k, n in fuera.items() if k != "milicia"),
        "milicia_usada": tropas(aldea).get("milicia", 0) + int(fuera.get("milicia", 0)),
    }


def reclutar(s: Session, aldea: Aldea, clave: str, cantidad: int) -> dict[str, int]:
    unidad = unidades().get(clave)
    if unidad is None:
        raise NoSePuede("Esa tropa no existe.")
    if cantidad < 1 or cantidad > 50:
        raise NoSePuede("Decid cuántos, entre uno y cincuenta.")
    e = aldea.estado
    if e.get("revuelta", {}).get("activa"):
        raise NoSePuede("Con la aldea revuelta nadie se alista.")
    cuenta = estado.contar_edificios(s, aldea)
    nombres = datos.catalogo()
    for necesario in unidad.get("requiere", []):
        if not cuenta.get(necesario):
            raise NoSePuede(f"Hace falta {nombres.get(necesario, {}).get('nombre', necesario).lower()} para tener {unidad['plural']}.")
    c = cupos(s, aldea)
    if clave == "milicia":
        if c["milicia_usada"] + cantidad > c["milicia"]:
            raise NoSePuede(f"No hay tantos brazos: la milicia no pasa de {c['milicia']} (uno por cada dos vecinos).")
    elif c["sueldo_usado"] + cantidad > c["sueldo"]:
        libres = max(0, c["sueldo"] - c["sueldo_usado"])
        raise NoSePuede(f"En los cuarteles solo caben {libres} más. Levantad otro cuartel.")
    coste = {r: n * cantidad for r, n in (unidad.get("coste") or {}).items()}
    if not estado.puede_pagar(aldea, coste):
        raise NoSePuede("El arca no da para tanta tropa.")
    estado.pagar(aldea, coste)
    tr = tropas(aldea)
    tr[clave] += cantidad
    _guardar_tropas(aldea, tr)
    if clave == "milicia":
        e.setdefault("leva_desde", e.get("dia", 1))
    tutorial.apuntar(aldea, "recluta", cantidad)
    hay = "un hombre" if total(tr) == 1 else f"{total(tr)} hombres"
    estado.anotar(s, aldea, "guerra", f"Se {'alista' if cantidad == 1 else 'alistan'} {_cuantos(cantidad, unidad)}. Ya hay {hay} en armas en {aldea.nombre}.")
    estado.emitir(aldea, "guerra", accion="recluta")
    return tr


def licenciar(s: Session, aldea: Aldea, clave: str, cantidad: int) -> dict[str, int]:
    unidad = unidades().get(clave)
    tr = tropas(aldea)
    if unidad is None or cantidad < 1 or tr.get(clave, 0) < cantidad:
        raise NoSePuede("No tenéis tantos que mandar a casa.")
    tr[clave] -= cantidad
    _guardar_tropas(aldea, tr)
    if clave == "milicia" and tr["milicia"] == 0:
        aldea.estado.pop("leva_desde", None)
    estado.anotar(s, aldea, "guerra", f"Mandáis a casa a {_cuantos(cantidad, unidad)}.")
    return tr


def _restar_bajas(tr: dict[str, int], parte: float, azar: random.Random) -> dict[str, int]:
    """Quita esa parte de cada tropa (redondeando con azar). Devuelve las bajas."""
    bajas = {}
    for clave, n in tr.items():
        caen = n * parte
        caen = int(caen) + (1 if azar.random() < caen - int(caen) else 0)
        caen = min(n, caen)
        if caen:
            bajas[clave] = caen
            tr[clave] = n - caen
    return bajas


def _cuantos(n: int, unidad: dict) -> str:
    return f"un {unidad.get('singular', unidad['plural'])}" if n == 1 else f"{n} {unidad['plural']}"


def _texto_tropas(tr: dict[str, int]) -> str:
    tabla = unidades()
    partes = [_cuantos(n, tabla[k]) for k, n in tr.items() if n and k in tabla]
    if not partes:
        return "nadie"
    return partes[0] if len(partes) == 1 else ", ".join(partes[:-1]) + " y " + partes[-1]


def _heridos(s: Session, aldea: Aldea, cuantos: int, azar: random.Random) -> None:
    """Las bajas de la milicia son vecinos con nombre: vuelven heridos (y en tono crudo, alguno no vuelve)."""
    gente = estado.aldeanos(s, aldea)
    mortal = aldea.tono == "crudo" or aldea.dificultad == "dificil"
    for a in azar.sample(gente, min(cuantos, 3, len(gente))):
        a.salud = int(estado.limitar(a.salud - 35, 5, 100))
        a.animo = int(estado.limitar(a.animo - 12, 0, 100))
        social.recordar(s, aldea, a, "Fui a la guerra con la milicia y volví herido. El señor volvió entero.", 7, "suceso")
        if mortal and azar.random() < 0.25 and len(gente) > 4:
            a.vivo, a.presente = False, False
            a.casa_id = a.trabajo_id = None
            efectos.aplicar(s, aldea, [{"animo": -8, "a": "todos"}, {"opinion": -6, "a": "todos"}, {"tension": 8}])
            estado.anotar(s, aldea, "guerra", f"{a.nombre} no ha vuelto de la guerra. En su casa han cerrado las contras.", aldeano=a.id)
            estado.emitir(aldea, "aldeano", accion="se_va", id=a.id)


# === La noche =======================================================================================

def cierre(s: Session, aldea: Aldea, balance: dict | None = None, ligero: bool = False) -> None:
    """Cada noche: la campaña avanza, el cerco aprieta, se cobran tributos y sueldos, y alguien conspira."""
    lista = asegurar(s, aldea)
    _campana_noche(s, aldea)
    _asedio_noche(s, aldea)
    _rehacer(lista)
    cobrado = _tributos(s, aldea, lista)
    pagado = _sueldos(s, aldea)
    _vasallaje_propio(s, aldea)
    _rebeliones(s, aldea, lista)
    if not ligero:
        _huestes(s, aldea, lista)
    if balance is not None:
        if cobrado:
            balance["tributos"] = cobrado
        if pagado:
            balance["sueldos"] = pagado
    aldea.tocar()


def _rehacer(lista: list[Vecino]) -> None:
    for v in lista:
        base = float((v.datos or {}).get("fuerza", 10))
        ahora = float((v.datos or {}).get("fuerza_ahora", base))
        if ahora < base:
            _pon(v, fuerza_ahora=round(min(base, ahora + base * REHACERSE), 2))


def _tributos(s: Session, aldea: Aldea, lista: list[Vecino]) -> dict[str, float]:
    cobrado: dict[str, float] = {}
    for v in lista:
        for recurso, cuanto in tributo_de(v).items():
            estado.sumar_recurso(aldea, recurso, cuanto)
            cobrado[recurso] = round(cobrado.get(recurso, 0) + cuanto, 1)
    return cobrado


def _sueldos(s: Session, aldea: Aldea) -> dict[str, float]:
    e = aldea.estado
    tabla = unidades()
    tr = tropas(aldea)
    fuera = (e.get("campana") or {}).get("tropas") or {}
    cuenta: dict[str, float] = {}
    for clave, unidad in tabla.items():
        hombres = tr.get(clave, 0) + int(fuera.get(clave, 0))
        for recurso, cuanto in (unidad.get("sueldo") or {}).items():
            cuenta[recurso] = cuenta.get(recurso, 0) + cuanto * hombres
    cuenta = {r: round(n, 1) for r, n in cuenta.items() if n > 0}
    if not cuenta:
        return {}
    if estado.puede_pagar(aldea, cuenta):
        estado.pagar(aldea, cuenta)
    else:
        # Se paga lo que haya y parte de la tropa de sueldo se marcha con lo puesto (y con vuestras lanzas).
        for recurso, cuanto in cuenta.items():
            estado.sumar_recurso(aldea, recurso, -min(cuanto, estado.recursos(aldea).get(recurso, 0)))
        azar = estado.azar(aldea, "desercion")
        sueldo = {k: n for k, n in tr.items() if k != "milicia"}
        bajas = _restar_bajas(sueldo, DESERCION, azar)
        if bajas:
            _guardar_tropas(aldea, {**tr, **sueldo})
            estado.anotar(s, aldea, "guerra", f"No hubo con qué pagar a la tropa: esta noche {'ha' if total(bajas) == 1 else 'han'} desertado {_texto_tropas(bajas)}.")
            efectos.aplicar(s, aldea, [{"tension": 4}])
    # La milicia son vecinos: si pasan muchos días en armas, las casas se quejan.
    desde = e.get("leva_desde")
    if desde is not None and tr.get("milicia", 0) + int(fuera.get("milicia", 0)) > 0:
        if e.get("dia", 1) - int(desde) > int(cfg().get("milicia_paciencia", 6)):
            efectos.aplicar(s, aldea, [{"opinion": -1, "a": "todos"}, {"animo": -1, "a": "todos"}])
    else:
        e.pop("leva_desde", None)
    return cuenta


def _vasallaje_propio(s: Session, aldea: Aldea) -> None:
    e = aldea.estado
    if not e.get("vasallo_de"):
        return
    pago = {k: v for k, v in (cfg().get("vasallaje") or {}).items() if k in ("oro", "grano")}
    for recurso, cuanto in pago.items():
        estado.sumar_recurso(aldea, recurso, -min(float(cuanto), estado.recursos(aldea).get(recurso, 0)))


def _rebeliones(s: Session, aldea: Aldea, lista: list[Vecino]) -> None:
    """Un vasallo aguanta mientras os teme: si su mesnada vuelve a ser más que la vuestra, se sacude el yugo."""
    azar = estado.azar(aldea, "rebelion")
    vuestra = fuerza(tropas(aldea)) + fuerza((aldea.estado.get("campana") or {}).get("tropas") or {})
    for v in lista:
        if situacion(v) != "vasallo":
            continue
        suya = float(v.datos.get("fuerza_ahora", 10))
        if suya > vuestra * 1.25 and azar.random() < 0.12:
            _pon(v, estado="libre")
            v.relacion = int(estado.limitar(v.relacion - 25, -100, 100))
            estado.anotar(s, aldea, "guerra", f"{v.senor} ha roto el vasallaje: ha contado vuestras lanzas, ha contado las suyas y ha dejado de pagar.", vecino=v.clave)
            estado.emitir(aldea, "guerra", accion="rebelion", vecino=v.clave)


# === Campañas: ir contra otro ========================================================================

def refuerzos(lista: list[Vecino], aldea: Aldea, contra: str) -> float:
    """Lo que mandan vasallos y aliados a vuestra campaña."""
    aliados = set(aldea.estado.get("alianzas", []))
    suma = 0.0
    for v in lista:
        if v.clave == contra:
            continue
        suya = float((v.datos or {}).get("fuerza_ahora", 0))
        if situacion(v) != "libre":
            suma += suya * float(cfg().get("leva_vasallo", 0.25))
        elif v.clave in aliados:
            suma += suya * float(cfg().get("leva_aliado", 0.15))
    return round(suma, 1)


def lanzar(s: Session, aldea: Aldea, clave: str, objetivo: str, envio: dict[str, int]) -> dict:
    """Sale la hueste. La batalla se da cuando llega; el botín y los supervivientes, cuando vuelve."""
    e = aldea.estado
    objetivos = cfg().get("objetivos") or {}
    if objetivo not in objetivos:
        raise NoSePuede("Ese objetivo no existe.")
    if e.get("campana"):
        raise NoSePuede("Vuestra hueste ya está en campaña. Esperad a que vuelva.")
    if e.get("asedio"):
        raise NoSePuede("Estáis cercados: de aquí no sale nadie.")
    if e.get("revuelta", {}).get("activa"):
        raise NoSePuede("Con la aldea revuelta, la tropa no os sigue.")
    lista = asegurar(s, aldea)
    v = next((x for x in lista if x.clave == clave), None)
    if v is None:
        raise NoSePuede("Ese territorio no está en la comarca.")
    if situacion(v) == "conquistado":
        raise NoSePuede(f"{v.nombre} ya es vuestra.")
    if situacion(v) == "vasallo" and objetivo != "conquistar":
        raise NoSePuede(f"{v.senor} ya es vasallo vuestro. Solo cabe conquistar la plaza.")
    en_casa = tropas(aldea)
    envio = {k: int(n) for k, n in (envio or {}).items() if int(n or 0) > 0}
    if not envio:
        raise NoSePuede("Hay que mandar a alguien.")
    for k, n in envio.items():
        if k not in en_casa or n > en_casa[k]:
            raise NoSePuede("No tenéis tanta tropa en casa.")
    dia = e.get("dia", 1)
    dias = dias_de_marcha(v)
    for k, n in envio.items():
        en_casa[k] -= n
    _guardar_tropas(aldea, en_casa)
    aliados = e.get("alianzas", [])
    if v.clave in aliados:
        # Atacar a un aliado es perjurio: se rompe la alianza y los demás toman nota.
        e["alianzas"] = [a for a in aliados if a != v.clave]
        for otro in lista:
            if otro.clave != v.clave:
                otro.relacion = int(estado.limitar(otro.relacion - 15, -100, 100))
        efectos.aplicar(s, aldea, [{"opinion": -5, "a": "todos"}])
    v.relacion = int(estado.limitar(v.relacion - 25, -100, 100))
    e["campana"] = {
        "vecino": v.clave, "nombre": v.nombre, "objetivo": objetivo, "tropas": envio, "fase": "ida",
        "dia_salida": dia, "dia_batalla": dia + dias, "dia_vuelta": None,
        "refuerzos": refuerzos(lista, aldea, v.clave),
    }
    aldea.tocar()
    tutorial.apuntar(aldea, "campana")
    estado.anotar(
        s, aldea, "guerra",
        f"Sale la hueste hacia {v.nombre}: {_texto_tropas(envio)}. {dias} {'día' if dias == 1 else 'días'} de camino. "
        f"El objetivo: {objetivos[objetivo]['nombre'].lower()}.", vecino=v.clave,
    )
    estado.emitir(aldea, "guerra", accion="sale", vecino=v.clave)
    return e["campana"]


def _campana_noche(s: Session, aldea: Aldea) -> None:
    e = aldea.estado
    c = e.get("campana")
    if not c:
        return
    dia = e.get("dia", 1)
    if c["fase"] == "ida" and dia >= int(c["dia_batalla"]):
        _batalla(s, aldea, c)
    elif c["fase"] == "vuelta" and dia >= int(c["dia_vuelta"]):
        _regreso(s, aldea, c)
    aldea.tocar()


def _batalla(s: Session, aldea: Aldea, c: dict) -> None:
    e = aldea.estado
    lista = asegurar(s, aldea)
    v = next((x for x in lista if x.clave == c["vecino"]), None)
    dia = e.get("dia", 1)
    if v is None:
        c.update(fase="vuelta", dia_vuelta=dia + 1)
        return
    objetivo = (cfg().get("objetivos") or {})[c["objetivo"]]
    azar = estado.azar(aldea, "batalla", v.clave)
    ataque = (fuerza(c["tropas"]) + float(c.get("refuerzos", 0))) * moral(s, aldea) * azar.uniform(0.85, 1.15)
    suya = float(v.datos.get("fuerza_ahora", v.datos.get("fuerza", 10)))
    defensa = (suya + float(v.datos.get("defensa", 5)) * float(objetivo.get("muros", 1.0))) * azar.uniform(0.9, 1.1)
    razon = ataque / max(1.0, defensa)
    victoria = razon >= float(objetivo.get("umbral", 1.0))
    parte_bajas = estado.limitar(0.3 / razon, 0.05, 0.4) if victoria else estado.limitar(0.3 + 0.25 * (1 - razon), 0.3, 0.65)
    antes = dict(c["tropas"])
    bajas = _restar_bajas(c["tropas"], parte_bajas, azar)
    if bajas.get("milicia"):
        _heridos(s, aldea, bajas["milicia"], azar)
    botin: dict[str, int] = {}
    riqueza = float(v.datos.get("riqueza", 50))
    otros = [x for x in lista if x.clave != v.clave and situacion(x) == "libre"]
    if victoria:
        _pon(v, fuerza_ahora=round(max(1.0, suya * azar.uniform(0.45, 0.65)), 2))
        if c["objetivo"] == "saquear":
            botin = {"oro": round(riqueza * azar.uniform(0.35, 0.6)), "grano": round(riqueza * azar.uniform(0.5, 0.9))}
            _pon(v, saqueado=dia)
            v.relacion = int(estado.limitar(v.relacion - 20, -100, 100))
            texto = f"Vuestra hueste entró en {v.nombre}, vació graneros y arcas y salió antes de que nadie cerrase las puertas."
            for otro in otros:
                otro.relacion = int(estado.limitar(otro.relacion - 6, -100, 100))
        else:
            conquista = c["objetivo"] == "conquistar"
            if conquista:
                # Hay que dejar guarnición: sale de los lanceros y arqueros que queden en pie.
                hace_falta = float(v.datos.get("defensa", 5)) * float(cfg().get("guarnicion", 0.25))
                dejada: dict[str, int] = {}
                tabla = unidades()
                for clave in ("lanceros", "arqueros", "milicia", "jinetes"):
                    while hace_falta > 0 and c["tropas"].get(clave, 0) > 0:
                        c["tropas"][clave] -= 1
                        dejada[clave] = dejada.get(clave, 0) + 1
                        hace_falta -= float(tabla[clave]["fuerza"])
                if hace_falta > 0:
                    for clave, n in dejada.items():   # no llega para guarnecerla: se queda en vasallaje
                        c["tropas"][clave] += n
                    conquista = False
                    texto = (f"Vencisteis a {v.senor} ante los muros de {v.nombre}, pero no os quedaba gente para "
                             "guarnecer la plaza. Ha jurado vasallaje y pagará tributo.")
                else:
                    c["guarnicion"] = dejada
                    texto = (f"{v.nombre} es vuestra. {v.senor} ha entregado las llaves y en la torre ondea vuestro pendón. "
                             f"Se quedan de guarnición {_texto_tropas(dejada)}.")
            else:
                texto = f"Vencisteis a la mesnada de {v.senor} en campo abierto. Ha jurado vasallaje de rodillas y pagará tributo cada día."
            _pon(v, estado="conquistado" if conquista else "vasallo", desde=dia)
            v.relacion = int(estado.limitar(-20 if not conquista else 0, -100, 100))
            e["alianzas"] = [a for a in e.get("alianzas", []) if a != v.clave]
            for otro in otros:
                # Unos se asustan y otros se enfadan: los belicosos, sobre todo, se enfadan.
                recelo = -4 - round(8 * float(otro.datos.get("belicoso", 0.2)))
                otro.relacion = int(estado.limitar(otro.relacion + recelo, -100, 100))
            if e.get("vasallo_de") == v.clave:
                e["vasallo_de"] = None
                texto += " Y con eso se acabó pagarle tributo."
        efectos.aplicar(s, aldea, [{"opinion": 4, "a": "todos"}, {"animo": 3, "a": "todos"}, {"tension": -3}])
        tutorial.apuntar(aldea, "victoria")
    else:
        _pon(v, fuerza_ahora=round(max(1.0, suya * azar.uniform(0.85, 0.95)), 2))
        texto = (f"La hueste se estrelló contra {v.nombre}. {v.senor} salió a recibirla con más gente de la que contabais, "
                 "y los vuestros vuelven a pie y callados.")
        efectos.aplicar(s, aldea, [{"opinion": -6, "a": "todos"}, {"animo": -5, "a": "todos"}, {"tension": 8}])
    if bajas:
        texto += f" Bajas: {_texto_tropas(bajas)}."
    dias = dias_de_marcha(v)
    texto = estado.pulir(texto)
    c.update(fase="vuelta", dia_vuelta=dia + dias, victoria=victoria, botin=botin, bajas=bajas, texto=texto, enviados=antes)
    estado.anotar(s, aldea, "guerra", texto, vecino=v.clave, victoria=victoria)
    estado.emitir(aldea, "guerra", accion="batalla", vecino=v.clave, victoria=victoria)


def _regreso(s: Session, aldea: Aldea, c: dict) -> None:
    e = aldea.estado
    tr = tropas(aldea)
    for clave, n in (c.get("tropas") or {}).items():
        tr[clave] = tr.get(clave, 0) + int(n)
    _guardar_tropas(aldea, tr)
    for recurso, cuanto in (c.get("botin") or {}).items():
        estado.sumar_recurso(aldea, recurso, cuanto)
    partes = list(e.get("partes_guerra", []))
    partes.append({
        "dia": e.get("dia", 1), "vecino": c["vecino"], "nombre": c.get("nombre", c["vecino"]), "objetivo": c["objetivo"],
        "victoria": bool(c.get("victoria")), "texto": c.get("texto", ""), "bajas": c.get("bajas") or {}, "botin": c.get("botin") or {},
    })
    e["partes_guerra"] = partes[-MAX_PARTES:]
    e["campana"] = None
    botin = c.get("botin") or {}
    cola = f" Traen {botin.get('oro', 0)} monedas y {botin.get('grano', 0)} de grano." if botin else ""
    estado.anotar(s, aldea, "guerra", f"La hueste vuelve de {c.get('nombre', 'la campaña')}: {_texto_tropas(c.get('tropas') or {})} cruzan el puente.{cola}")
    estado.emitir(aldea, "guerra", accion="vuelve", vecino=c["vecino"])


# === Huestes que vienen y asedios =====================================================================

def _huestes(s: Session, aldea: Aldea, lista: list[Vecino]) -> None:
    """Quien os tiene ojeriza y gusto por la guerra acaba viniendo. Antes llega el aviso."""
    e = aldea.estado
    dia = e.get("dia", 1)
    if e.get("amenaza") or e.get("asedio") or e.get("peste") or dia < int(cfg().get("paz_inicial", 15)):
        return
    if dia < e.get("enfriamientos", {}).get("amenaza", 0) or e.get("revuelta", {}).get("activa"):
        return
    riesgo = float(datos.dificultad(aldea.dificultad)["riesgo"])
    fuera = 2.0 if e.get("campana") else 1.0   # con la hueste lejos, la ocasión la pintan calva
    azar = estado.azar(aldea, "hueste")
    hostil = int(cfg().get("relacion_hostil", -30))
    candidatos = [v for v in lista if situacion(v) == "libre" and v.relacion <= hostil and v.clave not in e.get("alianzas", [])]
    azar.shuffle(candidatos)
    for v in candidatos:
        if azar.random() < float(v.datos.get("belicoso", 0.2)) * float(cfg().get("probabilidad_hueste", 0.06)) * riesgo * fuera:
            lanzas = round(float(v.datos.get("fuerza_ahora", 10)) * azar.uniform(0.6, 0.9))
            dias = max(2, dias_de_marcha(v))
            e["amenaza"] = {
                "clave": "hueste", "vecino": v.clave, "fuerza": lanzas, "dia_golpe": dia + dias,
                "ficha": {"nombre": f"la hueste de {v.senor}".replace(" de el ", " del ")},
            }
            aldea.tocar()
            estado.anotar(
                s, aldea, "amenaza",
                f"Un pastor llega sin resuello: {v.senor} ha salido de {v.nombre} con una hueste de unas {lanzas} lanzas. "
                f"Estará aquí en {dias} días. Hay tiempo para cerrar muros, alistar gente... o mandar un presente.",
                clave="hueste", vecino=v.clave,
            )
            estado.emitir(aldea, "amenaza", clave="hueste", aviso=True)
            return


def asalto(s: Session, aldea: Aldea, pendiente: dict) -> None:
    """Llega la hueste enemiga. Si la defensa aguanta, se van; si hay muros y pan, acampan; si no, entran."""
    e = aldea.estado
    lista = asegurar(s, aldea)
    v = next((x for x in lista if x.clave == pendiente.get("vecino")), None)
    senor, lugar = (v.senor, v.nombre) if v else ("un señor de fuera", "lejos")
    lanzas = float(pendiente.get("fuerza", 10))
    partes = estado.partes_defensa(s, aldea)
    defensa = sum(partes.values())
    if defensa >= lanzas:
        _rechazo(s, aldea, v, lanzas, f"La hueste de {senor} llegó al puente, midió vuestros muros y vuestras lanzas, probó suerte y la perdió. Vuelven a {lugar} con menos gente y peor cara.")
        return
    asedio = cfg().get("asedio") or {}
    v_aldea = estado.variables(s, aldea)
    if partes["muros"] >= float(asedio.get("muros_minimos", 5)) and v_aldea["dias_comida"] >= 2:
        e["asedio"] = {"vecino": pendiente.get("vecino"), "fuerza": lanzas, "dias": 0, "desde": e.get("dia", 1)}
        aldea.tocar()
        estado.anotar(s, aldea, "amenaza", f"La hueste de {senor} no ha podido con los muros y ha plantado el real al otro lado del río. Estáis cercados: nadie entra, nadie sale, y el grano mengua.", clave="asedio")
        estado.emitir(aldea, "amenaza", clave="asedio", aviso=True)
        return
    _saqueo(s, aldea, v, lanzas, defensa, f"La hueste de {senor} entró en {aldea.nombre} al romper el día.")


def _rechazo(s: Session, aldea: Aldea, v: Vecino | None, lanzas: float, texto: str) -> None:
    rescate = round(lanzas * 0.6)
    efectos.aplicar(s, aldea, [{"recursos": {"oro": rescate}}, {"opinion": 7, "a": "todos"}, {"animo": 5, "a": "todos"}, {"tension": -6}])
    if v is not None:
        _pon(v, fuerza_ahora=round(max(1.0, float(v.datos.get("fuerza_ahora", 10)) * 0.65), 2))
        v.relacion = int(estado.limitar(v.relacion + 12, -100, 100))
    tutorial.apuntar(aldea, "defensa")
    estado.anotar(s, aldea, "amenaza", f"{texto} Los prisioneros han pagado {rescate} monedas de rescate.", clave="hueste", defendido=True)
    estado.emitir(aldea, "amenaza", clave="hueste", aviso=False)


def _saqueo(s: Session, aldea: Aldea, v: Vecino | None, lanzas: float, defensa: float, texto: str) -> None:
    e = aldea.estado
    riesgo = min(1.3, float(datos.dificultad(aldea.dificultad)["riesgo"]))
    dano = estado.limitar((lanzas - defensa) / max(1.0, lanzas), 0.3, 1.0) * riesgo
    r = estado.recursos(aldea)
    perdidas = {k: -round(r.get(k, 0) * parte) for k, parte in {"oro": 0.45, "grano": 0.4, "pan": 0.4, "madera": 0.2}.items()}
    efectos.aplicar(s, aldea, [{"recursos": perdidas}, {"opinion": -8, "a": "todos"}, {"animo": -8, "a": "todos"}, {"tension": 12}], multiplicador=dano)
    tr = tropas(aldea)
    bajas = _restar_bajas(tr, 0.35, estado.azar(aldea, "saqueo"))
    _guardar_tropas(aldea, tr)
    if bajas.get("milicia"):
        _heridos(s, aldea, bajas["milicia"], estado.azar(aldea, "heridos"))
    texto += " Se llevaron grano, monedas y lo que no estaba clavado."
    if bajas:
        texto += f" Cayeron {_texto_tropas(bajas)}."
    if v is not None and lanzas >= defensa * 2 and e.get("dia", 1) >= 25 and not e.get("vasallo_de"):
        e["vasallo_de"] = v.clave
        pago = cfg().get("vasallaje") or {}
        texto += f" Y antes de irse, {v.senor} os hizo jurarle vasallaje: {pago.get('oro', 3)} monedas y {pago.get('grano', 6)} de grano cada día, hasta que os sacudáis el yugo."
    if v is not None:
        v.relacion = int(estado.limitar(v.relacion + 8, -100, 100))   # ya se ha cobrado: de momento, está servido
    aldea.tocar()
    estado.anotar(s, aldea, "amenaza", texto, clave="hueste", defendido=False)
    estado.emitir(aldea, "amenaza", clave="hueste", aviso=False)


def _asedio_noche(s: Session, aldea: Aldea) -> None:
    e = aldea.estado
    cerco = e.get("asedio")
    if not cerco:
        return
    asedio = cfg().get("asedio") or {}
    lista = asegurar(s, aldea)
    v = next((x for x in lista if x.clave == cerco.get("vecino")), None)
    senor = v.senor if v else "el enemigo"
    cerco["dias"] = int(cerco.get("dias", 0)) + 1
    gente = len(estado.aldeanos(s, aldea))
    estado.sumar_recurso(aldea, "grano", -min(estado.recursos(aldea).get("grano", 0), gente * float(asedio.get("grano_por_vecino", 1.5))))
    efectos.aplicar(s, aldea, [{"animo": -2, "a": "todos"}])
    arqueros = tropas(aldea).get("arqueros", 0) >= 4
    cerco["fuerza"] = round(float(cerco["fuerza"]) * (1 - float(asedio.get("desgaste_arqueros" if arqueros else "desgaste", 0.12))), 1)
    partes = estado.partes_defensa(s, aldea)
    defensa = sum(partes.values())
    aldea.tocar()
    if cerco["fuerza"] <= defensa:
        e["asedio"] = None
        _rechazo(s, aldea, v, float(cerco["fuerza"]), f"Tras {cerco['dias']} días de cerco, la hueste de {senor} ha levantado el real: entre el hambre, las flechas y el aburrimiento, ya eran menos que vosotros.")
        e.setdefault("enfriamientos", {})["amenaza"] = e.get("dia", 1) + 8
    elif estado.variables(s, aldea)["dias_comida"] < 1 or cerco["dias"] >= int(asedio.get("dias_maximos", 6)):
        e["asedio"] = None
        _saqueo(s, aldea, v, float(cerco["fuerza"]), defensa, f"Tras {cerco['dias']} días de cerco, {aldea.nombre} ha abierto las puertas: no quedaba qué comer ni con qué resistir.")
        e.setdefault("enfriamientos", {})["amenaza"] = e.get("dia", 1) + 8


# === Embajadas desde el mapa =========================================================================

def _puede_embajada(v: Vecino, dia: int) -> None:
    if dia - int((v.datos or {}).get("embajada", -99)) < DIAS_ENTRE_EMBAJADAS:
        raise NoSePuede(f"Vuestro mensajero acaba de volver de {v.nombre}. Dadle unos días.")


def accion(s: Session, aldea: Aldea, clave: str, que: str) -> str:
    """Lo que el señor hace desde el mapa sin sacar la hueste. Devuelve lo que pasó, en una frase."""
    from . import exterior

    e = aldea.estado
    dia = e.get("dia", 1)
    lista = asegurar(s, aldea)
    v = next((x for x in lista if x.clave == clave), None)
    if v is None:
        raise NoSePuede("Ese territorio no está en la comarca.")
    azar = estado.azar(aldea, "embajada", clave, que)
    vuestra = fuerza(tropas(aldea)) + refuerzos(lista, aldea, v.clave)
    suya = float(v.datos.get("fuerza_ahora", 10)) + float(v.datos.get("defensa", 5))
    if que == "regalo":
        if (v.datos or {}).get("regalo") == dia:
            raise NoSePuede("Hoy ya le habéis mandado un presente.")
        precio = int((cfg().get("embajadas") or {}).get("regalo", 10))
        if not estado.puede_pagar(aldea, {"oro": precio}):
            raise NoSePuede(f"No hay {precio} monedas en el arca para un presente.")
        estado.pagar(aldea, {"oro": precio})
        _pon(v, regalo=dia)
        v.relacion = int(estado.limitar(v.relacion + 8, -100, 100))
        texto = f"Mandáis un presente a {v.senor}. En {v.nombre} lo reciben con más agrado que sorpresa."
    elif que == "alianza":
        if situacion(v) != "libre":
            raise NoSePuede("Con un vasallo no se pacta: se manda.")
        if v.clave in e.get("alianzas", []):
            raise NoSePuede(f"Ya sois aliados de {v.nombre}.")
        if v.relacion < int((cfg().get("embajadas") or {}).get("relacion_alianza", 30)):
            raise NoSePuede(f"{v.senor} no se fía de vos todavía. Mejorad el trato antes (presentes, comercio, bodas).")
        _puede_embajada(v, dia)
        _pon(v, embajada=dia)
        if azar.random() < estado.limitar(0.35 + (v.relacion - 30) / 100 + 0.2 * (vuestra / max(1.0, suya)), 0.15, 0.95):
            exterior._aplicar(s, aldea, [{"vecino": v.clave, "relacion": 10}, {"alianza": v.clave}])
            texto = f"{v.senor} acepta la alianza. Si os atacan, acudirá; si vais a la guerra, mandará gente."
        else:
            v.relacion = int(estado.limitar(v.relacion - 3, -100, 100))
            texto = f"{v.senor} agradece la propuesta y pide tiempo para pensarlo, que es como dicen que no en {v.nombre}."
    elif que == "exigir":
        if situacion(v) != "libre":
            raise NoSePuede(f"{v.senor} ya os paga tributo.")
        _puede_embajada(v, dia)
        _pon(v, embajada=dia)
        razon = vuestra / max(1.0, suya)
        probabilidad = 0.85 if razon >= 2 else 0.5 if razon >= 1.5 else 0.2 if razon >= 1.2 else 0.0
        if azar.random() < probabilidad:
            _pon(v, estado="vasallo", desde=dia)
            v.relacion = -10
            e["alianzas"] = [a for a in e.get("alianzas", []) if a != v.clave]
            tutorial.apuntar(aldea, "victoria")
            texto = f"{v.senor} ha contado vuestras lanzas desde la muralla y ha preferido pagar. Jura vasallaje sin que se derrame una gota."
        else:
            v.relacion = int(estado.limitar(v.relacion - 20, -100, 100))
            texto = f"{v.senor} se ha reído de vuestro heraldo y lo ha devuelto montado al revés en la mula. No os teme... todavía."
    elif que == "liberar":
        if situacion(v) == "libre":
            raise NoSePuede(f"{v.nombre} no os debe vasallaje.")
        _pon(v, estado="libre")
        v.relacion = int(estado.limitar(v.relacion + 35, -100, 100))
        texto = f"Liberáis a {v.nombre} de su juramento. {v.senor} no sabe si daros las gracias o desconfiar."
    elif que == "rescate":
        if e.get("vasallo_de") != v.clave:
            raise NoSePuede(f"No sois vasallo de {v.senor}.")
        precio = int((cfg().get("vasallaje") or {}).get("rescate", 60))
        if not estado.puede_pagar(aldea, {"oro": precio}):
            raise NoSePuede(f"Comprar vuestra libertad cuesta {precio} monedas, y no las hay.")
        estado.pagar(aldea, {"oro": precio})
        e["vasallo_de"] = None
        texto = f"Pagáis {precio} monedas a {v.senor} y rompéis el juramento con todas las de la ley. Volvéis a no deberle nada a nadie."
    else:
        raise NoSePuede("Eso no se puede hacer desde el mapa.")
    aldea.tocar()
    tutorial.apuntar(aldea, "diplomacia")
    texto = estado.pulir(texto)
    estado.anotar(s, aldea, "vecinos", texto, vecino=v.clave)
    return texto


# === Para las condiciones y para pintar ===============================================================

def variables(s: Session, aldea: Aldea) -> dict[str, Any]:
    e = aldea.estado
    lista = list(s.scalars(select(Vecino).where(Vecino.aldea_id == aldea.id)))
    tr = tropas(aldea)
    fuera = (e.get("campana") or {}).get("tropas") or {}
    return {
        "tropas_total": total(tr) + sum(int(n) for n in fuera.values()),
        "tropas_en_casa": total(tr),
        "dominios": dominios(lista),
        "campana": bool(e.get("campana")),
        "asedio": bool(e.get("asedio")),
        "vasallo_de_otro": bool(e.get("vasallo_de")),
    }


def _aprox(lanzas: float) -> int:
    """Lo que cuentan los pastores: de cinco en cinco y tirando por lo alto, que el miedo suma."""
    return max(5, math.ceil(lanzas / 5.0) * 5)


def moral(s: Session, aldea: Aldea) -> float:
    """Con qué ánimo pelea vuestra hueste: el de la aldea de la que sale."""
    gente = estado.aldeanos(s, aldea)
    animo = sum(a.animo for a in gente) / len(gente) if gente else 50
    return round(estado.limitar(animo / 60, 0.8, 1.15), 2)


def mapa(s: Session, aldea: Aldea) -> dict:
    """La comarca entera, lista para pintar el mapa y sus botones."""
    from ..vista import relacion_texto

    e = aldea.estado
    dia = e.get("dia", 1)
    lista = asegurar(s, aldea)
    aliados = set(e.get("alianzas", []))
    tr = tropas(aldea)
    partes = estado.partes_defensa(s, aldea)
    tabla = unidades()
    cuenta = estado.contar_edificios(s, aldea)
    nombres = datos.catalogo()
    territorios = []
    for v in lista:
        d = v.datos or {}
        conocido = situacion(v) != "libre" or v.clave in aliados
        suya = float(d.get("fuerza_ahora", d.get("fuerza", 10)))
        acciones = []
        if situacion(v) == "libre":
            acciones += ["regalo", "alianza", "exigir", "saquear", "someter", "conquistar"]
            if v.clave in aliados:
                acciones.remove("alianza")
        elif situacion(v) == "vasallo":
            acciones += ["regalo", "conquistar", "liberar"]
        else:
            acciones += ["liberar"]
        if e.get("vasallo_de") == v.clave:
            acciones.append("rescate")
        territorios.append({
            "clave": v.clave, "nombre": v.nombre, "senor": v.senor, "caracter": v.caracter,
            "tipo": d.get("tipo", "aldea"), "pos": d.get("pos", [50, 30]),
            "relacion": v.relacion, "relacion_texto": relacion_texto(v.relacion),
            "estado": situacion(v), "aliado": v.clave in aliados,
            "fuerza": round(suya) if conocido else _aprox(suya), "fuerza_exacta": conocido,
            "defensa": round(float(d.get("defensa", 5))), "riqueza": round(float(d.get("riqueza", 50))),
            "dias": dias_de_marcha(v), "tributo": tributo_de(v),
            "tributo_posible": {r: round(float(d.get("riqueza", 50)) * float(p), 1) for r, p in (cfg().get("tributo") or {}).items()},
            "hostil": situacion(v) == "libre" and v.relacion <= int(cfg().get("relacion_hostil", -30)),
            "refuerzos": refuerzos(lista, aldea, v.clave),
            "acciones": acciones,
        })
    c = e.get("campana")
    amenaza = e.get("amenaza") if (e.get("amenaza") or {}).get("clave") in ("hueste", "mesnada") else None
    cup = cupos(s, aldea)
    return {
        "aldea": {
            "nombre": aldea.nombre, "pos": cfg().get("aldea", {}).get("pos", [50, 58]), "titulo": titulo(lista),
            "dominios": dominios(lista), "vasallo_de": e.get("vasallo_de"),
            "defensa": round(sum(partes.values()), 1), "defensa_partes": partes,
        },
        "territorios": territorios,
        "caminos": cfg().get("caminos", []),
        "tropas": tr, "fuerza": fuerza(tr), "cupos": cup,
        "unidades": [
            {**u, "disponible": all(cuenta.get(x) for x in u.get("requiere", [])),
             "falta": [nombres.get(x, {}).get("nombre", x) for x in u.get("requiere", []) if not cuenta.get(x)]}
            for u in tabla.values()
        ],
        "objetivos": cfg().get("objetivos") or {},
        "moral": moral(s, aldea),
        "precios": {
            "regalo": int((cfg().get("embajadas") or {}).get("regalo", 10)),
            "relacion_alianza": int((cfg().get("embajadas") or {}).get("relacion_alianza", 30)),
            "rescate": int((cfg().get("vasallaje") or {}).get("rescate", 60)),
        },
        "campana": None if not c else {
            **{k: c.get(k) for k in ("vecino", "nombre", "objetivo", "tropas", "fase", "victoria", "texto", "botin", "refuerzos")},
            "dias": max(0, int(c["dia_batalla"] if c["fase"] == "ida" else c["dia_vuelta"]) - dia),
        },
        "amenaza": None if not amenaza else {
            "vecino": amenaza.get("vecino"), "fuerza": _aprox(float(amenaza.get("fuerza", 10))),
            "dias": max(0, int(amenaza["dia_golpe"]) - dia), "nombre": (amenaza.get("ficha") or {}).get("nombre", "una hueste"),
        },
        "asedio": None if not e.get("asedio") else {
            "vecino": e["asedio"].get("vecino"), "fuerza": round(float(e["asedio"]["fuerza"])), "dias": int(e["asedio"].get("dias", 0)),
        },
        "partes": list(reversed(e.get("partes_guerra", []))),
        "paz_hasta": max(0, int(cfg().get("paz_inicial", 15)) - dia),
    }


def resumen(s: Session, aldea: Aldea) -> dict:
    """Lo justo para la barra de arriba."""
    e = aldea.estado
    lista = list(s.scalars(select(Vecino).where(Vecino.aldea_id == aldea.id)))
    tr = tropas(aldea)
    c = e.get("campana")
    return {
        "titulo": titulo(lista), "dominios": dominios(lista), "tropas": total(tr), "fuerza": fuerza(tr),
        "campana": None if not c else {
            "nombre": c.get("nombre"), "fase": c["fase"],
            "dias": max(0, int(c["dia_batalla"] if c["fase"] == "ida" else c["dia_vuelta"]) - e.get("dia", 1)),
        },
        "asedio": bool(e.get("asedio")), "vasallo_de": e.get("vasallo_de"),
    }
