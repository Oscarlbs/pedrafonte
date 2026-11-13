"""Motor de IA «claude»: la API real de Anthropic. De pago: solo se usa con ALDEA_MOTOR_IA=claude.

Hace exactamente el mismo papel que el motor simulado: recibe el contexto que prepara el motor del juego y
devuelve una propuesta (diccionario). No toca el estado del juego; lo único que escribe es su propia cuenta
de gasto (tabla `gasto_ia`), para poder respetar el tope diario.

Salvaguardas:
  · Sin ANTHROPIC_API_KEY se niega a arrancar.
  · Tope de gasto diario por aldea (TOPE_DIARIO_USD, ajustable a la baja o al alza en ia.yaml hasta
    TOPE_MAXIMO_USD). Alcanzado el tope, contesta el motor simulado hasta el día siguiente.
  · Si la API falla, rechaza la petición o devuelve algo que no es JSON, contesta el motor simulado.
  · Lo que devuelve pasa por el validador igual que lo del simulado.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date
from typing import Any

import anthropic
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from .. import datos
from ..modelos import Aldea, GastoIA
from .base import INTENCIONES_CHARLA, MotorIA

registro = logging.getLogger("aldea.ia")

MODELO_POR_DEFECTO = "claude-opus-5-5"
TOPE_DIARIO_USD = 1.00     # lo que puede gastar una aldea al día si ia.yaml no dice otra cosa
TOPE_MAXIMO_USD = 5.00     # ia.yaml no puede subir el tope por encima de esto
MAX_TOKENS = 4000          # tope de salida por llamada: son respuestas cortas y hay presupuesto que cuidar

# Dólares por millón de tokens (entrada, salida). Si el modelo de ia.yaml no está aquí ni en ia.yaml,
# se cuenta con el precio más caro de la tabla para no quedarse corto.
PRECIOS_USD = {
    "claude-fable-5-2": (8.00, 40.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-haiku-5-5": (0.10, 0.50),
}
# Modelos que admiten el relevo automático en el servidor cuando declinan una petición.
CON_RELEVO = {"claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}
BETA_RELEVO = "server-side-fallback-2026-07-01"

def _objeto(propiedades: dict) -> dict:
    return {"type": "object", "properties": propiedades, "required": list(propiedades), "additionalProperties": False}


_TEXTO = {"type": "string"}
_ENTERO = {"type": "integer"}
_CAMBIOS = {"type": "array", "items": {"anyOf": [
    _objeto({"tipo": {"type": "string", "enum": ["relacion"]}, "a": _TEXTO, "b": _TEXTO, "delta": _ENTERO}),
    _objeto({"tipo": {"type": "string", "enum": ["recuerdo"]}, "aldeano": _TEXTO, "texto": _TEXTO, "importancia": _ENTERO}),
    _objeto({"tipo": {"type": "string", "enum": ["rumor"]}, "origen": _TEXTO, "sobre": _TEXTO, "texto": _TEXTO}),
    _objeto({"tipo": {"type": "string", "enum": ["animo"]}, "aldeano": _TEXTO, "delta": _ENTERO}),
    _objeto({"tipo": {"type": "string", "enum": ["opinion_senor"]}, "aldeano": _TEXTO, "delta": _ENTERO}),
    _objeto({"tipo": {"type": "string", "enum": ["dinero"]}, "de": _TEXTO, "a": _TEXTO, "cantidad": _ENTERO}),
    _objeto({"tipo": {"type": "string", "enum": ["tension"]}, "delta": _ENTERO}),
]}}

ESQUEMAS = {
    "escena": _objeto({
        "lineas": {"type": "array", "items": _objeto({"quien": _TEXTO, "texto": _TEXTO})},
        "cambios": _CAMBIOS,
        "rumor_texto": {"anyOf": [_TEXTO, {"type": "null"}]},
    }),
    "reflexion": _objeto({
        "reflexiones": {"type": "array", "items": _objeto({"aldeano": _TEXTO, "texto": _TEXTO, "cambios": _CAMBIOS})},
    }),
    "charla": _objeto({
        "respuesta": _TEXTO,
        "intencion": {"type": "string", "enum": list(INTENCIONES_CHARLA)},
        "cambios": _CAMBIOS,
    }),
    "deformar_rumor": _objeto({"texto": _TEXTO}),
    "cronica": _objeto({"texto": _TEXTO, "opiniones": {"type": "array", "items": _TEXTO}}),
    "mensaje": _objeto({"texto": _TEXTO}),
}

REGLAS = """Eres el intérprete de {aldea}, una aldea medieval de cuento, dentro de un juego.

EL PRINCIPIO: el motor del juego decide lo que pasa; tú solo lo interpretas. Recibes un contexto en JSON
(quién está, qué siente, qué sabe, de qué va la escena) y devuelves un JSON con texto y, si procede, una
lista de «cambios» pequeños. El motor valida cada cambio y rechaza lo que no cumpla estas reglas:

  relacion       {{tipo, a, b, delta}}            a debe estar presente; delta entre -15 y 15, nunca 0
  recuerdo       {{tipo, aldeano, texto, importancia}}  aldeano presente; texto de 3 a 300 caracteres; importancia 1-10
  rumor          {{tipo, origen, sobre, texto}}   origen presente; sobre es otro vecino; texto de 8 a 240
  animo          {{tipo, aldeano, delta}}         aldeano presente; delta entre -10 y 10, nunca 0
  opinion_senor  {{tipo, aldeano, delta}}         aldeano presente; delta entre -10 y 10, nunca 0
  dinero         {{tipo, de, a, cantidad}}        los dos presentes; de 1 a 20 monedas y no más de las que tiene «de»
  tension        {{tipo, delta}}                  entre -5 y 10, nunca 0

Usa siempre la «clave» de cada vecino (no el nombre) en los campos a, b, aldeano, origen, sobre, de y quien.
No propongas nada sobre recursos, edificios, leyes, muertes ni llegadas: eso lo decide el motor y se
rechazaría. Pocos cambios y pequeños (de 0 a 4): una charla corriente no cambia vidas.

LA VOZ: {tono}
Castellano. Frases cortas, como habla la gente (cada frase, menos de 200 caracteres). Cada vecino habla
según su carácter, sus rasgos y sus muletillas; sabe lo que sabe y calla lo que calla: nadie cuenta su propio
secreto salvo que el contexto lo permita expresamente. Al señor se le trata de vos.
Todo es ficticio: sin personas ni marcas reales, sin contenido explícito ni cruel."""

TAREAS = {
    "escena": (
        "Escribe la escena entre los participantes, sobre el tema que indica el contexto (campo «tema»). De 2 a 5 "
        "frases en «lineas», en orden, cada una con «quien» (clave) y «texto». Propón en «cambios» lo que esta charla "
        "cambia de verdad. Si el contexto trae «rumor», quien lo cuenta (rumor.de) debe decírselo a rumor.a dentro "
        "del diálogo, algo deformado según su carácter (exagerado, malicioso, piadoso…) pero nombrando a la misma "
        "persona; pon esa versión deformada, sola y en una frase, en «rumor_texto». Si no hay rumor, «rumor_texto» es null."
    ),
    "reflexion": (
        "Es de noche. Para cada vecino de «aldeanos», escribe en primera persona lo que piensa de su día antes de "
        "dormir (1 a 3 frases, menos de 300 caracteres), a partir de sus recuerdos de hoy y de su ánimo. En «cambios» "
        "cada vecino solo puede cambiarse a sí mismo (animo, opinion_senor) o su relación con otro vecino."
    ),
    "charla": (
        "El señor de la aldea le habla al vecino de «aldeano» y le dice lo de «mensaje». Contesta como ese vecino, en "
        "su papel, en «respuesta» (1 a 4 frases). Puede contar rumores que conoce si se fía del señor (mira su "
        "opinión). Sobre su secreto, obedece a «confianza»: «niega» = lo esquiva; «pista» = insinúa a quién afecta "
        "sin contarlo; «revela» = lo confiesa. Indica en «intencion» de qué le estaban hablando. En «cambios», solo "
        "sobre ese vecino: cómo le deja la conversación (animo, opinion_senor) y, si merece recordarse, un recuerdo."
    ),
    "deformar_rumor": (
        "El vecino de «cuenta» va a contar el rumor de «texto». Devuélvelo en «texto» tal como saldría de su boca: "
        "un poco hinchado o torcido según sus rasgos, en una sola frase de menos de 240 caracteres, y nombrando "
        "siempre a la misma persona (campo «sobre»)."
    ),
    "cronica": (
        "Eres el escriba de la aldea. Escribe en «texto» la crónica del día para el señor (3 a 5 párrafos cortos "
        "separados por una línea en blanco) con lo que dice el contexto: tiempo, cosecha, comida, llegadas, sucesos, "
        "escenas y decisiones del consejo. No inventes hechos que no estén en el contexto. En «opiniones», de 1 a 4 "
        "frases con lo que el escriba opina de cómo gobierna el señor, según los datos de «gobierno»."
    ),
    "mensaje": (
        "Escribe en «texto» el mensaje que manda el remitente del contexto al señor de la aldea, con su carácter y en "
        "3 o 4 frases. Di lo que el contexto indica (campo «datos») y nada que comprometa más de eso."
    ),
}


class MotorClaude:
    nombre = "claude"

    def __init__(
        self, respaldo: MotorIA, aldea: Aldea | None = None, sesion: Session | None = None, cliente: Any = None,
    ) -> None:
        ajustes = (datos.cargar("ia") or {}).get("claude") or {}
        self.respaldo = respaldo
        self.aldea_id = aldea.id if aldea is not None else None
        self.aldea_nombre = aldea.nombre if aldea is not None else "la aldea"
        self.tono = aldea.tono if aldea is not None else "cuento"
        self.sesion = sesion
        self.modelo = str(ajustes.get("modelo") or MODELO_POR_DEFECTO)
        self.esfuerzo = str(ajustes.get("esfuerzo") or "low")
        self.max_tokens = int(ajustes.get("max_tokens") or MAX_TOKENS)
        self.tope_usd = min(float(ajustes.get("tope_diario_usd", TOPE_DIARIO_USD)), TOPE_MAXIMO_USD)
        precios = ajustes.get("precios_usd_por_millon") or {}
        if self.modelo in precios:
            self.precio = (float(precios[self.modelo]["entrada"]), float(precios[self.modelo]["salida"]))
        else:
            self.precio = PRECIOS_USD.get(self.modelo, max(PRECIOS_USD.values()))
        self._sin_esquema = False
        self.ultimo_error: str | None = None
        if cliente is None:
            if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
                raise RuntimeError(
                    "ALDEA_MOTOR_IA=claude necesita ANTHROPIC_API_KEY en .env. Sin clave no se arranca: "
                    "pon la clave o vuelve a ALDEA_MOTOR_IA=simulado."
                )
            cliente = anthropic.Anthropic(timeout=60.0, max_retries=1)
        self.cliente = cliente

    @classmethod
    def de_aldea(cls, aldea: Aldea | None, respaldo: MotorIA) -> MotorClaude:
        return cls(respaldo, aldea=aldea, sesion=object_session(aldea) if aldea is not None else None)

    # --- El contrato MotorIA ----------------------------------------------------------------------

    def escena(self, ctx: dict) -> dict:
        return self._interpretar("escena", ctx)

    def reflexion(self, ctx: dict) -> dict:
        return self._interpretar("reflexion", ctx)

    def charla(self, ctx: dict) -> dict:
        return self._interpretar("charla", ctx)

    def deformar_rumor(self, ctx: dict) -> dict:
        return self._interpretar("deformar_rumor", ctx)

    def cronica(self, ctx: dict) -> dict:
        return self._interpretar("cronica", ctx)

    def mensaje(self, ctx: dict) -> dict:
        return self._interpretar("mensaje", ctx)

    # --- Por dentro -------------------------------------------------------------------------------

    def _interpretar(self, tarea: str, ctx: dict) -> dict:
        """Pide la propuesta a Claude; si no se puede (tope, fallo, rechazo), contesta el motor simulado."""
        if self.gastado_hoy() >= self.tope_usd:
            return getattr(self.respaldo, tarea)(ctx)
        try:
            propuesta = self._pedir(tarea, ctx)
        except anthropic.RateLimitError as error:
            self._fallo(tarea, f"límite de peticiones: {error.message}")
        except anthropic.APIStatusError as error:
            self._fallo(tarea, f"error {error.status_code} de la API: {error.message}")
        except anthropic.APIConnectionError as error:
            self._fallo(tarea, f"sin conexión con la API: {error}")
        except (ValueError, KeyError) as error:
            self._fallo(tarea, f"respuesta no utilizable: {error}")
        else:
            return _limpiar(propuesta)
        return getattr(self.respaldo, tarea)(ctx)

    def _pedir(self, tarea: str, ctx: dict) -> dict:
        tonos = datos.cargar("tonos") or {}
        tono = (tonos.get(self.tono) or tonos.get("cuento") or {}).get("instrucciones", "Cuento amable con retranca.")
        sistema = REGLAS.format(aldea=self.aldea_nombre, tono=tono)
        contexto = json.dumps(ctx, ensure_ascii=False, sort_keys=True, default=str)
        pregunta = f"{TAREAS[tarea]}\n\nContexto:\n{contexto}"
        try:
            respuesta = self._llamar(sistema, pregunta, ESQUEMAS[tarea] if not self._sin_esquema else None)
        except anthropic.BadRequestError as error:
            if self._sin_esquema or "schema" not in str(error.message).lower():
                raise
            # La API no acepta este esquema: se pide JSON de palabra y se valida igual en el motor.
            registro.warning("La API rechazó el esquema de salida (%s); se pide JSON sin esquema.", error.message)
            self._sin_esquema = True
            respuesta = self._llamar(sistema, pregunta, None)
        self._apuntar(respuesta.usage)
        if respuesta.stop_reason == "refusal":
            raise ValueError("el modelo declinó la petición")
        if respuesta.stop_reason == "max_tokens":
            raise ValueError("la respuesta se cortó por longitud")
        texto = next((b.text for b in respuesta.content if b.type == "text"), "")
        return _json(texto)

    def _llamar(self, sistema: str, pregunta: str, esquema: dict | None) -> Any:
        salida: dict = {"effort": self.esfuerzo}
        if esquema is not None:
            salida["format"] = {"type": "json_schema", "schema": esquema}
        else:
            pregunta += "\n\nResponde solo con el objeto JSON, sin texto antes ni después."
        parametros: dict = {
            "model": self.modelo,
            "max_tokens": self.max_tokens,
            "system": sistema,
            "messages": [{"role": "user", "content": pregunta}],
            "output_config": salida,
            "cache_control": {"type": "ephemeral"},
        }
        if self.modelo in CON_RELEVO:
            # Si el modelo declina la petición, el servidor la repite con el modelo de relevo que toque.
            return self.cliente.beta.messages.create(betas=[BETA_RELEVO], fallbacks="default", **parametros)
        return self.cliente.messages.create(**parametros)

    def _fallo(self, tarea: str, motivo: str) -> None:
        self.ultimo_error = f"{tarea}: {motivo}"
        registro.warning("Motor claude → respaldo simulado (%s)", self.ultimo_error)

    # --- La cuenta del gasto ------------------------------------------------------------------------

    def _fila_hoy(self) -> GastoIA | None:
        if self.sesion is None or self.aldea_id is None:
            return None
        hoy = date.today().isoformat()
        fila = self.sesion.scalar(select(GastoIA).where(GastoIA.aldea_id == self.aldea_id, GastoIA.fecha == hoy))
        if fila is None:
            fila = GastoIA(aldea_id=self.aldea_id, fecha=hoy, llamadas=0, tokens_entrada=0, tokens_salida=0, coste_usd=0.0)
            self.sesion.add(fila)
            self.sesion.flush()
        return fila

    def gastado_hoy(self) -> float:
        fila = self._fila_hoy()
        return float(fila.coste_usd) if fila is not None else getattr(self, "_gastado", 0.0)

    def _apuntar(self, uso: Any) -> None:
        # Lo leído y escrito en caché se cuenta al precio normal de entrada: redondea hacia arriba, a favor del tope.
        entrada = (
            int(getattr(uso, "input_tokens", 0) or 0)
            + int(getattr(uso, "cache_creation_input_tokens", 0) or 0)
            + int(getattr(uso, "cache_read_input_tokens", 0) or 0)
        )
        salida = int(getattr(uso, "output_tokens", 0) or 0)
        coste = (entrada * self.precio[0] + salida * self.precio[1]) / 1_000_000
        fila = self._fila_hoy()
        if fila is None:
            self._gastado = getattr(self, "_gastado", 0.0) + coste
            return
        fila.llamadas += 1
        fila.tokens_entrada += entrada
        fila.tokens_salida += salida
        fila.coste_usd = round(fila.coste_usd + coste, 6)
        self.sesion.flush()


def _json(texto: str) -> dict:
    """Saca el objeto JSON de la respuesta (con o sin vallas de código alrededor)."""
    texto = texto.strip()
    if texto.startswith("```"):
        texto = texto.strip("`")
        texto = texto[texto.index("{"):] if "{" in texto else texto
    inicio, fin = texto.find("{"), texto.rfind("}")
    if inicio < 0 or fin <= inicio:
        raise ValueError("no hay un objeto JSON en la respuesta")
    dato = json.loads(texto[inicio:fin + 1])
    if not isinstance(dato, dict):
        raise ValueError("la respuesta no es un objeto JSON")
    return dato


def _limpiar(propuesta: dict) -> dict:
    """Quita los nulos que el esquema obliga a escribir (p. ej. rumor_texto: null)."""
    return {k: v for k, v in propuesta.items() if v is not None}
