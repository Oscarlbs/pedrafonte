"""El contrato de un motor de IA.

Un motor de IA **interpreta**: recibe un contexto que ha preparado el motor del juego y devuelve una
propuesta en forma de diccionario (lo que sería el JSON de un modelo). Nunca toca la base de datos ni el
estado. Lo que devuelve pasa por `motor/validador.py` antes de aplicarse; lo que no valida se rechaza
y se registra.

Formas de las propuestas:

  escena(ctx)          → {"lineas": [{"quien": clave, "texto": str}], "cambios": [...], "rumor_texto": str | None}
  reflexion(ctx)       → {"reflexiones": [{"aldeano": clave, "texto": str, "cambios": [...]}]}
  charla(ctx)          → {"respuesta": str, "intencion": str, "cambios": [...]}
  deformar_rumor(ctx)  → {"texto": str}
  cronica(ctx)         → {"texto": str, "opiniones": [str]}
  mensaje(ctx)         → {"texto": str}

Los `cambios` admitidos están en docs/DISENO.md §4 (relacion, recuerdo, rumor, animo, opinion_senor,
dinero, tension).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

INTENCIONES_CHARLA = (
    "saludo", "despedida", "estado", "trabajo", "hambre", "impuestos", "rumores", "sobre_otro",
    "secreto", "halago", "amenaza", "deseo", "amor", "senor", "otra",
)


@runtime_checkable
class MotorIA(Protocol):
    nombre: str

    def escena(self, ctx: dict) -> dict: ...

    def reflexion(self, ctx: dict) -> dict: ...

    def charla(self, ctx: dict) -> dict: ...

    def deformar_rumor(self, ctx: dict) -> dict: ...

    def cronica(self, ctx: dict) -> dict: ...

    def mensaje(self, ctx: dict) -> dict: ...
