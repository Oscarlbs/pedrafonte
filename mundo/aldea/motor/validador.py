"""El validador: la aduana entre lo que la IA propone y lo que el motor aplica.

La IA nunca cambia el estado. Devuelve propuestas en JSON; aquí se comprueba cada una contra un esquema
cerrado y contra el estado real. Lo que no valida se rechaza entero (no se recorta) y quien llama lo
registra en la tabla `rechazos`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MAX_CAMBIOS = 8
MAX_LINEAS = 8


@dataclass
class Contexto:
    """Contra qué se valida una propuesta.

    presentes: claves de los vecinos que participan (sobre ellos puede proponer cambios la IA).
    conocidos: claves de todos los vecinos de la aldea (pueden ser objeto de un rumor o de una relación).
    dinero:    monedas de cada presente, para que nadie dé lo que no tiene.
    """

    presentes: set[str]
    conocidos: set[str] = field(default_factory=set)
    dinero: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.conocidos = set(self.conocidos) | set(self.presentes)


# tipo → (campos obligatorios, validador específico)
_CAMPOS = {
    "relacion": {"a", "b", "delta"},
    "recuerdo": {"aldeano", "texto", "importancia"},
    "rumor": {"origen", "sobre", "texto"},
    "animo": {"aldeano", "delta"},
    "opinion_senor": {"aldeano", "delta"},
    "dinero": {"de", "a", "cantidad"},
    "tension": {"delta"},
}


def _entero(valor: Any) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


def motivo_texto(texto: Any, minimo: int, maximo: int) -> str | None:
    """Devuelve por qué un texto no vale, o None si vale."""
    if not isinstance(texto, str):
        return "el texto no es texto"
    limpio = texto.strip()
    if not minimo <= len(limpio) <= maximo:
        return f"el texto debe tener entre {minimo} y {maximo} caracteres (tiene {len(limpio)})"
    if any(ord(c) < 32 and c not in "\n\t" for c in limpio):
        return "el texto lleva caracteres de control"
    return None


def motivo_cambio(cambio: Any, ctx: Contexto) -> str | None:
    """Devuelve por qué se rechaza un cambio, o None si es válido."""
    if not isinstance(cambio, dict):
        return "el cambio no es un objeto"
    tipo = cambio.get("tipo")
    if tipo not in _CAMPOS:
        return f"tipo de cambio no permitido: {tipo!r}"
    campos = set(cambio) - {"tipo"}
    if campos != _CAMPOS[tipo]:
        sobran, faltan = campos - _CAMPOS[tipo], _CAMPOS[tipo] - campos
        partes = ([f"sobran {sorted(sobran)}"] if sobran else []) + ([f"faltan {sorted(faltan)}"] if faltan else [])
        return f"campos incorrectos en «{tipo}»: " + ", ".join(partes)

    def presente(clave: Any) -> bool:
        return isinstance(clave, str) and clave in ctx.presentes

    if tipo == "relacion":
        a, b, delta = cambio["a"], cambio["b"], cambio["delta"]
        if not presente(a):
            return f"«{a}» no está en la escena"
        if not isinstance(b, str) or b not in ctx.conocidos:
            return f"«{b}» no es vecino de la aldea"
        if a == b:
            return "nadie tiene relación consigo mismo"
        if not _entero(delta) or not -15 <= delta <= 15 or delta == 0:
            return "delta de relación fuera de −15…15"
    elif tipo == "recuerdo":
        if not presente(cambio["aldeano"]):
            return f"«{cambio['aldeano']}» no está en la escena"
        if (motivo := motivo_texto(cambio["texto"], 3, 300)) is not None:
            return motivo
        if not _entero(cambio["importancia"]) or not 1 <= cambio["importancia"] <= 10:
            return "importancia fuera de 1…10"
    elif tipo == "rumor":
        if not presente(cambio["origen"]):
            return f"«{cambio['origen']}» no está en la escena"
        if not isinstance(cambio["sobre"], str) or cambio["sobre"] not in ctx.conocidos:
            return f"«{cambio['sobre']}» no es vecino de la aldea"
        if cambio["origen"] == cambio["sobre"]:
            return "nadie echa a correr rumores sobre sí mismo"
        if (motivo := motivo_texto(cambio["texto"], 8, 240)) is not None:
            return motivo
    elif tipo in ("animo", "opinion_senor"):
        if not presente(cambio["aldeano"]):
            return f"«{cambio['aldeano']}» no está en la escena"
        if not _entero(cambio["delta"]) or not -10 <= cambio["delta"] <= 10 or cambio["delta"] == 0:
            return f"delta de {tipo} fuera de −10…10"
    elif tipo == "dinero":
        de, a, cantidad = cambio["de"], cambio["a"], cambio["cantidad"]
        if not presente(de) or not presente(a):
            return "el dinero solo cambia de manos entre presentes"
        if de == a:
            return "nadie se paga a sí mismo"
        if not _entero(cantidad) or not 1 <= cantidad <= 20:
            return "cantidad fuera de 1…20"
        if cantidad > ctx.dinero.get(de, 0):
            return f"«{de}» no tiene {cantidad} monedas"
    elif tipo == "tension":
        if not _entero(cambio["delta"]) or not -5 <= cambio["delta"] <= 10 or cambio["delta"] == 0:
            return "delta de tensión fuera de −5…10"
    return None


def validar_cambios(cambios: Any, ctx: Contexto) -> tuple[list[dict], list[tuple[Any, str]]]:
    """Separa los cambios válidos de los rechazados (con su motivo)."""
    if cambios is None:
        return [], []
    if not isinstance(cambios, list):
        return [], [(cambios, "«cambios» no es una lista")]
    validos: list[dict] = []
    rechazados: list[tuple[Any, str]] = []
    dinero = dict(ctx.dinero)
    for cambio in cambios:
        if len(validos) >= MAX_CAMBIOS:
            rechazados.append((cambio, f"demasiados cambios en una propuesta (máximo {MAX_CAMBIOS})"))
            continue
        motivo = motivo_cambio(cambio, Contexto(ctx.presentes, ctx.conocidos, dinero))
        if motivo is not None:
            rechazados.append((cambio, motivo))
            continue
        if cambio["tipo"] == "dinero":  # que dos pagos seguidos no gasten las mismas monedas
            dinero[cambio["de"]] = dinero.get(cambio["de"], 0) - cambio["cantidad"]
            dinero[cambio["a"]] = dinero.get(cambio["a"], 0) + cambio["cantidad"]
        validos.append(dict(cambio))
    return validos, rechazados


def validar_lineas(lineas: Any, participantes: set[str]) -> tuple[list[dict], list[tuple[Any, str]]]:
    """Valida el diálogo de una escena: quién habla debe estar presente y el texto ser razonable."""
    if not isinstance(lineas, list):
        return [], [(lineas, "«lineas» no es una lista")]
    validas: list[dict] = []
    rechazadas: list[tuple[Any, str]] = []
    for linea in lineas:
        if len(validas) >= MAX_LINEAS:
            rechazadas.append((linea, f"demasiadas frases (máximo {MAX_LINEAS})"))
            continue
        if not isinstance(linea, dict) or set(linea) != {"quien", "texto"}:
            rechazadas.append((linea, "cada frase debe llevar solo «quien» y «texto»"))
            continue
        if linea["quien"] not in participantes:
            rechazadas.append((linea, f"«{linea['quien']}» no está en la escena"))
            continue
        if (motivo := motivo_texto(linea["texto"], 1, 240)) is not None:
            rechazadas.append((linea, motivo))
            continue
        validas.append({"quien": linea["quien"], "texto": linea["texto"].strip()})
    return validas, rechazadas


def como_propuesta(respuesta: Any) -> tuple[dict, str | None]:
    """La respuesta de un motor de IA debe ser un objeto JSON; si no, se rechaza entera."""
    if isinstance(respuesta, dict):
        return respuesta, None
    return {}, "la respuesta de la IA no es un objeto JSON"
