"""Rutas REST del mundo. Todas cuelgan de /api."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import bd, config, ia, vista
from ..modelos import Aldea, Aldeano, Suceso
from ..motor import ciclo, clima, construccion, estado, fundacion, guerra, tiempo, tutorial
from ..motor.construccion import NoSePuede
from .app import CANDADO, con_aldea

rutas = APIRouter(prefix="/api")


# --- General ----------------------------------------------------------------------------------------

@rutas.get("/salud")
def salud() -> dict:
    return {"ok": True, "motor_ia": config.motor_ia()}


@rutas.get("/config")
def configuracion() -> dict:
    return vista.configuracion()


@rutas.get("/clima")
def clima_actual() -> dict:
    ahora = tiempo.ahora_real()
    return clima.real() or clima.simulado(ahora.date(), ahora.hour)


# --- Aldeas -----------------------------------------------------------------------------------------

class NuevaAldea(BaseModel):
    nombre: str = Field(min_length=1, max_length=60)
    paisaje: str = "valle"
    tono: str = "cuento"
    dificultad: str = "normal"


def _listar() -> list[dict]:
    with bd.sesion() as s:
        return [vista.resumen_aldea(a) for a in s.scalars(select(Aldea).order_by(Aldea.id))]


@rutas.get("/aldeas")
async def aldeas() -> list[dict]:
    return await asyncio.to_thread(_listar)


@rutas.post("/aldeas")
async def crear_aldea(cuerpo: NuevaAldea) -> dict:
    def trabajo() -> dict:
        try:
            with CANDADO, bd.sesion() as s:
                aldea = fundacion.fundar(s, cuerpo.nombre, cuerpo.paisaje, cuerpo.tono, cuerpo.dificultad)
                return vista.resumen_aldea(aldea)
        except NoSePuede as error:
            raise HTTPException(409, str(error)) from error

    return await asyncio.to_thread(trabajo)


@rutas.delete("/aldeas/{aldea_id}")
async def borrar_aldea(aldea_id: int) -> dict:
    def trabajo() -> dict:
        with CANDADO, bd.sesion() as s:
            aldea = s.get(Aldea, aldea_id)
            if aldea is None:
                raise HTTPException(404, "Esa aldea no existe.")
            if s.scalar(select(Aldea.id).where(Aldea.id != aldea_id).limit(1)) is None:
                raise HTTPException(409, "Es la única aldea que hay: no se puede abandonar.")
            s.delete(aldea)
            return {"ok": True}

    return await asyncio.to_thread(trabajo)


@rutas.post("/aldeas/{aldea_id}/reiniciar")
async def reiniciar_aldea(aldea_id: int) -> dict:
    """Empezar de cero en el mismo sitio: se borra todo lo de la aldea y se funda otra vez."""
    def trabajo(s, aldea):
        fundacion.reiniciar(s, aldea)
        return {"estado": vista.estado_completo(s, aldea)}

    return await con_aldea(aldea_id, trabajo)


@rutas.get("/aldeas/{aldea_id}")
async def ver_aldea(aldea_id: int, hora: int | None = None) -> dict:
    """Estado completo. Con `?hora=13` los vecinos se enseñan donde estarían a esa hora (solo para mirar)."""
    def trabajo(s, aldea):
        ciclo.avanzar(s, aldea, ia=ia.obtener(aldea))  # que lo que se ve esté al día
        return vista.estado_completo(s, aldea, hora_vista=hora)

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/adelantar")
async def adelantar(aldea_id: int) -> dict:
    def trabajo(s, aldea):
        if aldea.estado.get("perdida"):
            raise NoSePuede("La aldea ya no os obedece.")
        resumen = ciclo.adelantar_dia(s, aldea, ia=ia.obtener(aldea))
        return {"resumen": {"horas": resumen["horas"], "dias": resumen["dias"]}, "estado": vista.estado_completo(s, aldea)}

    return await con_aldea(aldea_id, trabajo)


# --- Construcción -----------------------------------------------------------------------------------

class Obra(BaseModel):
    clave: str
    cx: int | None = None
    cz: int | None = None
    rot: int = 0
    celdas: list[tuple[int, int]] | None = None  # para arrastrar caminos, muros y vallas


class Referencia(BaseModel):
    id: int


@rutas.post("/aldeas/{aldea_id}/construir")
async def construir(aldea_id: int, obra: Obra) -> dict:
    def trabajo(s, aldea):
        celdas = obra.celdas or ([(obra.cx, obra.cz)] if obra.cx is not None and obra.cz is not None else [])
        if not celdas:
            raise NoSePuede("Falta decir dónde.")
        if len(celdas) > 200:
            raise NoSePuede("Demasiado de una vez; id por partes.")
        hechos, fallos = [], []
        for cx, cz in celdas:
            try:
                hechos.append(construccion.serializar(construccion.construir(s, aldea, obra.clave, cx, cz, obra.rot)))
            except NoSePuede as error:
                fallos.append({"cx": cx, "cz": cz, "motivo": str(error)})
        if not hechos:
            raise NoSePuede(fallos[0]["motivo"])
        return {"construidos": hechos, "fallos": fallos, "recursos": vista.estado_completo(s, aldea)["recursos"]}

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/comprobar")
async def comprobar(aldea_id: int, obra: Obra) -> dict:
    """Para la vista previa: dice si se puede construir ahí, sin construir."""
    def trabajo(s, aldea):
        try:
            construccion.comprobar(s, aldea, obra.clave, obra.cx or 0, obra.cz or 0, obra.rot)
            return {"valido": True, "motivo": ""}
        except NoSePuede as error:
            return {"valido": False, "motivo": str(error)}

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/derribar")
async def derribar(aldea_id: int, ref: Referencia) -> dict:
    def trabajo(s, aldea):
        devuelto = construccion.derribar(s, aldea, ref.id)
        return {"devuelto": devuelto, "recursos": vista.estado_completo(s, aldea)["recursos"]}

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/girar")
async def girar(aldea_id: int, ref: Referencia) -> dict:
    return await con_aldea(aldea_id, lambda s, aldea: construccion.serializar(construccion.girar(s, aldea, ref.id)))


# --- Vecinos y bitácora -----------------------------------------------------------------------------

@rutas.get("/aldeas/{aldea_id}/aldeanos/{aldeano_id}")
async def ficha(aldea_id: int, aldeano_id: int) -> dict:
    def trabajo(s, aldea):
        a = s.get(Aldeano, aldeano_id)
        if a is None or a.aldea_id != aldea.id:
            raise HTTPException(404, "Ese vecino no existe.")
        return vista.ficha_aldeano(s, aldea, a)

    return await con_aldea(aldea_id, trabajo)


@rutas.get("/aldeas/{aldea_id}/sucesos")
async def sucesos(aldea_id: int, limite: int = 40) -> list[dict]:
    def trabajo(s, aldea):
        filas = s.scalars(
            select(Suceso).where(Suceso.aldea_id == aldea.id).order_by(Suceso.id.desc()).limit(min(limite, 200))
        )
        return [vista.suceso(x) for x in filas]

    return await con_aldea(aldea_id, trabajo)


# --- Hablar con los vecinos -------------------------------------------------------------------------

class Mensaje(BaseModel):
    texto: str = Field(min_length=1, max_length=400)


@rutas.post("/aldeas/{aldea_id}/aldeanos/{aldeano_id}/charla")
async def hablar(aldea_id: int, aldeano_id: int, mensaje: Mensaje) -> dict:
    from ..motor import charla

    def trabajo(s, aldea):
        a = s.get(Aldeano, aldeano_id)
        if a is None or a.aldea_id != aldea.id:
            raise HTTPException(404, "Ese vecino no existe.")
        resultado = charla.hablar(s, aldea, a, mensaje.texto, ia.obtener(aldea))
        tutorial.apuntar(aldea, "charla")
        resultado["ficha"] = vista.ficha_aldeano(s, aldea, a)
        return resultado

    return await con_aldea(aldea_id, trabajo)


@rutas.get("/aldeas/{aldea_id}/escenas")
async def escenas(aldea_id: int, limite: int = 20) -> list[dict]:
    from ..modelos import Escena

    def trabajo(s, aldea):
        filas = s.scalars(
            select(Escena).where(Escena.aldea_id == aldea.id).order_by(Escena.id.desc()).limit(min(limite, 100))
        )
        return [vista.escena(x) for x in filas]

    return await con_aldea(aldea_id, trabajo)


# --- Gobierno: consejo, tributos, leyes y pergamino -------------------------------------------------

class Decision(BaseModel):
    opcion: str


class Tributos(BaseModel):
    nivel: int = Field(ge=0, le=4)


class Ley(BaseModel):
    clave: str
    activa: bool


@rutas.post("/aldeas/{aldea_id}/consejo/{peticion_id}")
async def decidir(aldea_id: int, peticion_id: int, decision: Decision) -> dict:
    from ..motor import consejo

    def trabajo(s, aldea):
        peticion = consejo.resolver(s, aldea, peticion_id, decision.opcion)
        return {"peticion": vista.peticion(peticion, aldea), "estado": vista.estado_completo(s, aldea)}

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/impuestos")
async def impuestos(aldea_id: int, tributos: Tributos) -> dict:
    from ..motor import gobierno

    def trabajo(s, aldea):
        gobierno.fijar_impuestos(s, aldea, tributos.nivel)
        return vista.estado_completo(s, aldea)

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/leyes")
async def leyes(aldea_id: int, ley: Ley) -> dict:
    from ..motor import gobierno

    def trabajo(s, aldea):
        gobierno.promulgar(s, aldea, ley.clave, ley.activa)
        return vista.estado_completo(s, aldea)

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/perdon")
async def perdon(aldea_id: int) -> dict:
    from ..motor import gobierno

    def trabajo(s, aldea):
        gobierno.pedir_perdon(s, aldea)
        return vista.estado_completo(s, aldea)

    return await con_aldea(aldea_id, trabajo)


@rutas.get("/aldeas/{aldea_id}/pergamino")
async def pergamino(aldea_id: int) -> dict:
    """La crónica del último día, tal como la dejó el escriba."""
    from ..motor import cronica

    def trabajo(s, aldea):
        ultima = cronica.ultima(s, aldea)
        return {"cronica": vista.cronica(ultima), "leido": int(aldea.estado.get("pergamino_leido", 0))}

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/pergamino/leido")
async def pergamino_leido(aldea_id: int) -> dict:
    from ..motor import cronica

    def trabajo(s, aldea):
        ultima = cronica.ultima(s, aldea)
        aldea.estado["pergamino_leido"] = ultima.dia if ultima else 0
        aldea.tocar()
        tutorial.apuntar(aldea, "pergamino")
        return {"ok": True}

    return await con_aldea(aldea_id, trabajo)


@rutas.get("/aldeas/{aldea_id}/cronicas")
async def cronicas(aldea_id: int, limite: int = 15) -> list[dict]:
    from ..modelos import Cronica

    def trabajo(s, aldea):
        filas = s.scalars(
            select(Cronica).where(Cronica.aldea_id == aldea.id).order_by(Cronica.dia.desc()).limit(min(limite, 60))
        )
        return [vista.cronica(c) for c in filas]

    return await con_aldea(aldea_id, trabajo)


# --- Mundo exterior: cartas de los vecinos y tratos con mercaderes ------------------------------------

class Trato(BaseModel):
    oferta: str


@rutas.post("/aldeas/{aldea_id}/mensajes/{mensaje_id}")
async def contestar(aldea_id: int, mensaje_id: int, decision: Decision) -> dict:
    from ..motor import exterior

    def trabajo(s, aldea):
        mensaje = exterior.responder(s, aldea, mensaje_id, decision.opcion)
        return {"mensaje": vista.mensaje(mensaje, aldea), "estado": vista.estado_completo(s, aldea)}

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/visitantes/{visitante_id}/comerciar")
async def comerciar(aldea_id: int, visitante_id: int, trato: Trato) -> dict:
    from ..motor import exterior

    def trabajo(s, aldea):
        visitante = exterior.comerciar(s, aldea, visitante_id, trato.oferta)
        return {"visitante": vista.visitante(visitante), "estado": vista.estado_completo(s, aldea)}

    return await con_aldea(aldea_id, trabajo)


# --- Tutorial -----------------------------------------------------------------------------------------

class Orden(BaseModel):
    orden: str  # entendido | ocultar | mostrar | saltar | empezar


@rutas.post("/aldeas/{aldea_id}/tutorial")
async def orden_tutorial(aldea_id: int, cuerpo: Orden) -> dict:
    def trabajo(s, aldea):
        if cuerpo.orden not in ("entendido", "ocultar", "mostrar", "saltar", "empezar"):
            raise NoSePuede("Esa orden no existe.")
        tutorial.orden(s, aldea, cuerpo.orden)
        return {"estado": vista.estado_completo(s, aldea)}

    return await con_aldea(aldea_id, trabajo)


# --- La comarca: mapa, tropas, embajadas y campañas ---------------------------------------------------

class Leva(BaseModel):
    unidad: str
    cantidad: int = 1


class Embajada(BaseModel):
    accion: str  # regalo | alianza | exigir | liberar | rescate


class Campana(BaseModel):
    vecino: str
    objetivo: str  # saquear | someter | conquistar
    tropas: dict[str, int]


def _comarca(s, aldea, **extra) -> dict:
    return {**extra, "mundo": guerra.mapa(s, aldea), "estado": vista.estado_completo(s, aldea)}


@rutas.get("/aldeas/{aldea_id}/mundo")
async def ver_mundo(aldea_id: int, mapa: bool = False) -> dict:
    """El mapa de la comarca: territorios, vuestra hueste, la campaña en curso y lo que viene de camino.

    Con `?mapa=1` cuenta como haber abierto el mapa (lo pide el tutorial); el panel de la hueste lo pide sin él.
    """
    def trabajo(s, aldea):
        ciclo.avanzar(s, aldea, ia=ia.obtener(aldea))
        if mapa:
            tutorial.apuntar(aldea, "mapa")
        return guerra.mapa(s, aldea)

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/tropas")
async def reclutar(aldea_id: int, leva: Leva) -> dict:
    def trabajo(s, aldea):
        guerra.reclutar(s, aldea, leva.unidad, leva.cantidad)
        return _comarca(s, aldea)

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/tropas/licenciar")
async def licenciar(aldea_id: int, leva: Leva) -> dict:
    def trabajo(s, aldea):
        guerra.licenciar(s, aldea, leva.unidad, leva.cantidad)
        return _comarca(s, aldea)

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/mundo/{clave}")
async def embajada(aldea_id: int, clave: str, cuerpo: Embajada) -> dict:
    def trabajo(s, aldea):
        texto = guerra.accion(s, aldea, clave, cuerpo.accion)
        return _comarca(s, aldea, texto=texto)

    return await con_aldea(aldea_id, trabajo)


@rutas.post("/aldeas/{aldea_id}/campana")
async def campana(aldea_id: int, cuerpo: Campana) -> dict:
    def trabajo(s, aldea):
        if aldea.estado.get("perdida"):
            raise NoSePuede("La aldea ya no os obedece.")
        guerra.lanzar(s, aldea, cuerpo.vecino, cuerpo.objetivo, cuerpo.tropas)
        return _comarca(s, aldea)

    return await con_aldea(aldea_id, trabajo)
