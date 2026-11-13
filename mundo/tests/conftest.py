"""Preparación común de las pruebas: base de datos en memoria, sin red y con el motor simulado."""

from __future__ import annotations

import os
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ["ALDEA_MOTOR_IA"] = "simulado"
os.environ.setdefault("ALDEA_BD_URL", "sqlite://")

from aldea.modelos import Base  # noqa: E402
from aldea.motor import clima, fundacion  # noqa: E402

clima.SIN_RED = True

# Un jueves de otoño a media mañana: los campos rinden ×1 y no hace falta leña.
INICIO = datetime(2026, 10, 15, 10, 0)


@pytest.fixture
def motor_bd():
    motor = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(motor)
    yield motor
    motor.dispose()


@pytest.fixture
def s(motor_bd):
    with Session(motor_bd, expire_on_commit=False) as sesion:
        yield sesion


@pytest.fixture
def aldea(s):
    a = fundacion.fundar(s, "Pedrafonte", semilla=7, ahora=INICIO, bienvenida=False)
    s.flush()
    return a
