"""Los motores de IA. El motor del juego decide; estos solo interpretan y proponen.

Se elige con la variable de entorno ALDEA_MOTOR_IA: «simulado» (por defecto, sin coste) o «claude».
"""

from __future__ import annotations

from functools import lru_cache

from .. import config
from ..modelos import Aldea
from .base import MotorIA
from .simulado import MotorSimulado


@lru_cache
def _simulado() -> MotorSimulado:
    return MotorSimulado()


def obtener(aldea: Aldea | None = None) -> MotorIA:
    """Motor de IA para esta aldea, según ALDEA_MOTOR_IA."""
    if config.motor_ia() == "claude":
        from .claude import MotorClaude

        return MotorClaude.de_aldea(aldea, respaldo=_simulado())
    return _simulado()
