"""El motor «claude» con un cliente falso: ni red ni gasto. Se prueba el contrato, el tope y los respaldos."""

from __future__ import annotations

import json
from types import SimpleNamespace

import anthropic
import pytest
from sqlalchemy import select

from aldea import config, ia
from aldea.ia.claude import ESQUEMAS, MotorClaude
from aldea.ia.simulado import MotorSimulado
from aldea.modelos import GastoIA, Rechazo
from aldea.motor import charla, escenas, estado, rutinas


class ClienteFalso:
    """Imita lo justo del SDK: `.beta.messages.create(...)` y `.messages.create(...)`."""

    def __init__(self, respuesta=None, error=None, motivo="end_turn", entrada=1000, salida=300):
        self.llamadas: list[dict] = []
        self._respuesta, self._error, self._motivo = respuesta, error, motivo
        self._uso = SimpleNamespace(input_tokens=entrada, output_tokens=salida, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        self.messages = SimpleNamespace(create=self._crear)
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._crear))

    def _crear(self, **parametros):
        self.llamadas.append(parametros)
        if self._error is not None:
            raise self._error
        texto = self._respuesta if isinstance(self._respuesta, str) else json.dumps(self._respuesta, ensure_ascii=False)
        return SimpleNamespace(
            content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=texto)],
            stop_reason=self._motivo, usage=self._uso,
        )


def motor(s, aldea, **falso):
    cliente = ClienteFalso(**falso)
    return MotorClaude(MotorSimulado(), aldea=aldea, sesion=s, cliente=cliente), cliente


def escena_de_prueba(s, aldea, motor_ia):
    gente = estado.aldeanos(s, aldea)[:2]
    sitio = rutinas.Sitio("plaza", 22, 27, "la hoguera")
    tema = {"tipo": "tiempo", "a": gente[0].clave, "b": gente[1].clave}
    return gente, escenas.montar(s, aldea, gente, sitio, motor_ia, estado.azar(aldea, "claude"), tema=tema)


def test_sin_clave_el_motor_claude_se_niega(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        MotorClaude(MotorSimulado())


def test_el_motor_por_defecto_es_el_simulado_y_no_cuesta(monkeypatch, s, aldea):
    monkeypatch.delenv("ALDEA_MOTOR_IA", raising=False)
    assert config.motor_ia() == "simulado"
    assert ia.obtener(aldea).nombre == "simulado"
    monkeypatch.setenv("ALDEA_MOTOR_IA", "gpt")
    with pytest.raises(RuntimeError):
        config.motor_ia()


def test_la_propuesta_de_claude_pasa_por_el_validador_como_cualquier_otra(s, aldea):
    a, b = (x.clave for x in estado.aldeanos(s, aldea)[:2])
    propuesta = {
        "lineas": [{"quien": a, "texto": "Hum. Va a llover."}, {"quien": b, "texto": "Aquí siempre va a llover."}],
        "cambios": [
            {"tipo": "relacion", "a": a, "b": b, "delta": 2},
            {"tipo": "relacion", "a": a, "b": b, "delta": 80},  # fuera de rango: rechazado
            {"tipo": "recursos", "oro": 500},                   # no permitido: rechazado
        ],
        "rumor_texto": None,
    }
    motor_ia, cliente = motor(s, aldea, respuesta=propuesta)
    gente, escena = escena_de_prueba(s, aldea, motor_ia)
    assert len(cliente.llamadas) == 1  # una sola llamada por escena
    assert escena.motor == "claude" and len(escena.dialogo) == 2
    assert escena.cambios == [{"tipo": "relacion", "a": a, "b": b, "delta": 2}]
    assert len(list(s.scalars(select(Rechazo)))) == 2
    llamada = cliente.llamadas[0]
    assert llamada["model"] == "claude-opus-5-5" and llamada["fallbacks"] == "default"
    assert llamada["output_config"]["format"]["schema"] == ESQUEMAS["escena"]
    assert "thinking" not in llamada and "temperature" not in llamada
    assert "el motor del juego decide" in llamada["system"]


def test_se_lleva_la_cuenta_del_gasto_y_al_llegar_al_tope_contesta_el_simulado(s, aldea):
    motor_ia, cliente = motor(s, aldea, respuesta={"texto": "Mauro debe un potosí"}, entrada=100_000, salida=30_000)
    ctx = {"texto": "Mauro debe treinta monedas", "cuenta": {"rasgos": []}, "semilla": 1}
    motor_ia.deformar_rumor(ctx)
    fila = s.scalar(select(GastoIA))
    assert fila.llamadas == 1 and fila.coste_usd == pytest.approx(0.4 + 0.6)  # 100k × 4 $/M + 30k × 20 $/M
    assert motor_ia.gastado_hoy() >= motor_ia.tope_usd
    respuesta = motor_ia.deformar_rumor(ctx)  # ya no se llama a la API
    assert len(cliente.llamadas) == 1
    assert "Mauro" in respuesta["texto"] and respuesta["texto"] != "Mauro debe un potosí"


def test_el_tope_no_se_puede_subir_mas_alla_del_maximo_del_codigo(monkeypatch, s, aldea):
    from aldea import datos
    from aldea.ia import claude

    monkeypatch.setattr(datos, "cargar", lambda nombre: {"claude": {"tope_diario_usd": 999}} if nombre == "ia" else {})
    assert MotorClaude(MotorSimulado(), cliente=ClienteFalso()).tope_usd == claude.TOPE_MAXIMO_USD


@pytest.mark.parametrize("falso", [
    {"respuesta": "Lo siento, no puedo ayudar con eso."},           # no es JSON
    {"respuesta": {"lineas": []}, "motivo": "refusal"},             # el modelo declina
    {"respuesta": '{"lineas": [{"quien": "a", "tex', "motivo": "max_tokens"},  # cortado
    {"error": anthropic.APIConnectionError(request=None)},          # sin red
])
def test_si_claude_falla_la_escena_la_escribe_el_simulado(s, aldea, falso):
    motor_ia, cliente = motor(s, aldea, **falso)
    _gente, escena = escena_de_prueba(s, aldea, motor_ia)
    assert len(cliente.llamadas) == 1
    assert escena is not None and len(escena.dialogo) >= 2  # la vida sigue
    assert motor_ia.ultimo_error


def test_charla_con_claude_el_motor_decide_si_hay_confianza_para_el_secreto(s, aldea):
    viuda = estado.aldeano_por_clave(s, aldea, "viuda")
    respuesta = {"respuesta": "Los marcos los movió mi difunto, señor.", "intencion": "secreto", "cambios": []}
    motor_ia, cliente = motor(s, aldea, respuesta=respuesta)
    viuda.opinion_senor = 10
    assert not charla.hablar(s, aldea, viuda, "¿Qué callas?", motor_ia)["revelado"]  # el motor dijo «niega»
    assert json.loads(cliente.llamadas[-1]["messages"][0]["content"].split("Contexto:\n", 1)[1])["confianza"] == "niega"
    viuda.opinion_senor = 90
    assert charla.hablar(s, aldea, viuda, "¿Qué callas?", motor_ia)["revelado"]
