"""Servidor del mundo: API REST, WebSocket para lo que pasa en directo y el reloj del juego."""

from __future__ import annotations

import asyncio
import logging
import threading
from collections import defaultdict
from collections.abc import Callable
from contextlib import asynccontextmanager, suppress
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import bd, config, ia, vista
from ..modelos import Aldea
from ..motor import ciclo, estado, fundacion
from ..motor.construccion import NoSePuede

registro = logging.getLogger("aldea")

# Un solo candado para todo lo que cambia el mundo: peticiones del jugador y reloj no se pisan.
CANDADO = threading.RLock()
SEGUNDOS_RELOJ = 20


class Difusor:
    """Reparte por WebSocket los eventos que el motor va dejando."""

    def __init__(self) -> None:
        self.conexiones: dict[int, set[WebSocket]] = defaultdict(set)

    async def conectar(self, aldea_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self.conexiones[aldea_id].add(ws)

    def desconectar(self, aldea_id: int, ws: WebSocket) -> None:
        self.conexiones[aldea_id].discard(ws)

    async def difundir(self, aldea_id: int) -> None:
        eventos = estado.vaciar_eventos(aldea_id)
        if not eventos:
            return
        for ws in list(self.conexiones.get(aldea_id, ())):
            try:
                await ws.send_json({"eventos": eventos})
            except Exception:
                self.desconectar(aldea_id, ws)


difusor = Difusor()


def _con_aldea(aldea_id: int, trabajo: Callable[[Session, Aldea], Any]) -> Any:
    with CANDADO, bd.sesion() as s:
        aldea = s.get(Aldea, aldea_id)
        if aldea is None:
            raise HTTPException(404, "Esa aldea no existe.")
        try:
            resultado = trabajo(s, aldea)
        except NoSePuede as error:
            raise HTTPException(409, str(error)) from error
        s.flush()
        return resultado


async def con_aldea(aldea_id: int, trabajo: Callable[[Session, Aldea], Any]) -> Any:
    """Ejecuta `trabajo(sesión, aldea)` fuera del bucle de eventos, guarda y difunde lo ocurrido."""
    try:
        return await asyncio.to_thread(_con_aldea, aldea_id, trabajo)
    finally:
        await difusor.difundir(aldea_id)


def _poner_al_dia() -> list[int]:
    with CANDADO, bd.sesion() as s:
        ids = list(s.scalars(select(Aldea.id)))
    for aldea_id in ids:
        try:
            with CANDADO, bd.sesion() as s:
                aldea = s.get(Aldea, aldea_id)
                if aldea is not None:
                    ciclo.avanzar(s, aldea, ia=ia.obtener(aldea))
        except Exception:  # una aldea rota no para el reloj de las demás
            registro.exception("El reloj falló en la aldea %s", aldea_id)
    return ids


async def reloj() -> None:
    while True:
        try:
            ids = await asyncio.to_thread(_poner_al_dia)
            for aldea_id in ids:
                await difusor.difundir(aldea_id)
        except Exception:
            registro.exception("Fallo en el reloj del mundo")
        await asyncio.sleep(SEGUNDOS_RELOJ)


def preparar_bd() -> None:
    """Aplica las migraciones pendientes y, si no hay ninguna aldea, funda Pedrafonte."""
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(config.RAIZ / "mundo" / "alembic.ini"))
    cfg.set_main_option("script_location", str(config.RAIZ / "mundo" / "alembic"))
    command.upgrade(cfg, "head")
    with CANDADO, bd.sesion() as s:
        if s.scalar(select(Aldea.id).limit(1)) is None:
            fundacion.fundar(s, "Pedrafonte")


@asynccontextmanager
async def vida(_app: FastAPI):
    config.cargar_env()
    config.motor_ia()  # falla pronto si la variable está mal
    await asyncio.to_thread(preparar_bd)
    tarea = asyncio.create_task(reloj())
    yield
    tarea.cancel()
    with suppress(asyncio.CancelledError):
        await tarea


app = FastAPI(title="Pedrafonte · el mundo", lifespan=vida)

from . import rutas  # noqa: E402  (las rutas necesitan `app` ya creado)

app.include_router(rutas.rutas)


@app.websocket("/ws/{aldea_id}")
async def directo(ws: WebSocket, aldea_id: int) -> None:
    await difusor.conectar(aldea_id, ws)
    try:
        while True:
            await ws.receive_text()  # el cliente solo manda latidos
    except WebSocketDisconnect:
        pass
    finally:
        difusor.desconectar(aldea_id, ws)


# En el despliegue, el mismo servidor entrega el juego ya compilado (juego/dist).
_DIST = config.RAIZ / "juego" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{ruta:path}", include_in_schema=False)
    async def juego(ruta: str):
        archivo = (_DIST / ruta).resolve()
        if ruta and archivo.is_file() and _DIST.resolve() in archivo.parents:
            return FileResponse(archivo)
        return FileResponse(_DIST / "index.html")


def resumen_estado(s: Session, aldea: Aldea) -> dict:
    return vista.estado_completo(s, aldea)
