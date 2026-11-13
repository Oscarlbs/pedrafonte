"""Conexión a la base de datos (PostgreSQL en serio, SQLite para pruebas o sin Docker)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from . import config

_motor: Engine | None = None
_fabrica: sessionmaker[Session] | None = None


def crear_motor(url: str) -> Engine:
    if url.startswith("sqlite"):
        if ":memory:" not in url and url.startswith("sqlite:///") and not url.startswith("sqlite:////"):
            # Ruta relativa: cuélgala de la raíz del repo y crea la carpeta.
            ruta = config.RAIZ / url.removeprefix("sqlite:///")
            ruta.parent.mkdir(parents=True, exist_ok=True)
            url = f"sqlite:///{ruta}"
        motor = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(motor, "connect")
        def _claves_foraneas(conexion, _registro):  # pragma: no cover - trivial
            conexion.execute("PRAGMA foreign_keys=ON")

        return motor
    return create_engine(url, pool_pre_ping=True)


def motor() -> Engine:
    global _motor, _fabrica
    if _motor is None:
        _motor = crear_motor(config.bd_url())
        _fabrica = sessionmaker(_motor, expire_on_commit=False)
    return _motor


def usar_motor(nuevo: Engine) -> None:
    """Para las pruebas: cambia el motor por uno en memoria."""
    global _motor, _fabrica
    _motor = nuevo
    _fabrica = sessionmaker(nuevo, expire_on_commit=False)


@contextmanager
def sesion() -> Iterator[Session]:
    motor()
    assert _fabrica is not None
    s = _fabrica()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()
