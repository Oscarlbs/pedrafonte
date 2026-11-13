"""El validador: la IA propone en JSON, el motor valida. Lo que no valida se rechaza y se registra."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from aldea.modelos import Rechazo, Recuerdo
from aldea.motor import escenas, estado, rutinas, social
from aldea.motor.validador import Contexto, como_propuesta, motivo_cambio, validar_cambios, validar_lineas

CTX = Contexto(
    presentes={"lenador", "viuda"},
    conocidos={"lenador", "viuda", "pastor", "escriba"},
    dinero={"lenador": 12, "viuda": 46},
)


@pytest.mark.parametrize("cambio", [
    {"tipo": "relacion", "a": "lenador", "b": "viuda", "delta": -4},
    {"tipo": "relacion", "a": "lenador", "b": "pastor", "delta": 15},  # con un ausente, pero vecino
    {"tipo": "recuerdo", "aldeano": "viuda", "texto": "Bieito me miró raro.", "importancia": 4},
    {"tipo": "rumor", "origen": "viuda", "sobre": "pastor", "texto": "Xan cuenta ovejas que no son suyas"},
    {"tipo": "animo", "aldeano": "lenador", "delta": -10},
    {"tipo": "opinion_senor", "aldeano": "viuda", "delta": 3},
    {"tipo": "dinero", "de": "viuda", "a": "lenador", "cantidad": 20},
    {"tipo": "tension", "delta": 10},
])
def test_cambios_validos(cambio):
    assert motivo_cambio(cambio, CTX) is None


@pytest.mark.parametrize("cambio, pista", [
    ("no soy un objeto", "no es un objeto"),
    ({"tipo": "recursos", "grano": 500}, "no permitido"),
    ({"tipo": "edificio", "clave": "iglesia", "cx": 1, "cz": 1}, "no permitido"),
    ({"tipo": "muerte", "aldeano": "viuda"}, "no permitido"),
    ({"delta": 3}, "no permitido"),
    ({"tipo": "relacion", "a": "lenador", "b": "viuda", "delta": 40}, "fuera de"),
    ({"tipo": "relacion", "a": "lenador", "b": "viuda", "delta": 0}, "fuera de"),
    ({"tipo": "relacion", "a": "lenador", "b": "viuda", "delta": 2.5}, "fuera de"),
    ({"tipo": "relacion", "a": "lenador", "b": "viuda", "delta": True}, "fuera de"),
    ({"tipo": "relacion", "a": "pastor", "b": "viuda", "delta": 3}, "no está en la escena"),
    ({"tipo": "relacion", "a": "lenador", "b": "dragon", "delta": 3}, "no es vecino"),
    ({"tipo": "relacion", "a": "lenador", "b": "lenador", "delta": 3}, "consigo mismo"),
    ({"tipo": "relacion", "a": "lenador", "b": "viuda", "delta": 3, "oro": 100}, "sobran"),
    ({"tipo": "relacion", "a": "lenador", "delta": 3}, "faltan"),
    ({"tipo": "recuerdo", "aldeano": "viuda", "texto": "x", "importancia": 4}, "caracteres"),
    ({"tipo": "recuerdo", "aldeano": "viuda", "texto": "a" * 301, "importancia": 4}, "caracteres"),
    ({"tipo": "recuerdo", "aldeano": "viuda", "texto": "Recuerdo normal", "importancia": 11}, "importancia"),
    ({"tipo": "recuerdo", "aldeano": "escriba", "texto": "Recuerdo normal", "importancia": 3}, "no está en la escena"),
    ({"tipo": "rumor", "origen": "viuda", "sobre": "viuda", "texto": "Soy estupenda, dicen"}, "sobre sí mismo"),
    ({"tipo": "rumor", "origen": "viuda", "sobre": "nadie", "texto": "Rumor sobre nadie"}, "no es vecino"),
    ({"tipo": "animo", "aldeano": "lenador", "delta": -11}, "fuera de"),
    ({"tipo": "opinion_senor", "aldeano": "lenador", "delta": 50}, "fuera de"),
    ({"tipo": "dinero", "de": "lenador", "a": "viuda", "cantidad": 13}, "no tiene"),
    ({"tipo": "dinero", "de": "viuda", "a": "lenador", "cantidad": 21}, "fuera de"),
    ({"tipo": "dinero", "de": "viuda", "a": "pastor", "cantidad": 2}, "entre presentes"),
    ({"tipo": "dinero", "de": "viuda", "a": "lenador", "cantidad": -5}, "fuera de"),
    ({"tipo": "tension", "delta": 50}, "fuera de"),
    ({"tipo": "tension", "delta": -6}, "fuera de"),
])
def test_cambios_rechazados(cambio, pista):
    motivo = motivo_cambio(cambio, CTX)
    assert motivo is not None and pista in motivo


def test_se_rechaza_entero_no_se_recorta():
    validos, rechazados = validar_cambios([{"tipo": "animo", "aldeano": "lenador", "delta": 30}], CTX)
    assert validos == [] and len(rechazados) == 1


def test_dos_pagos_no_gastan_las_mismas_monedas():
    pagos = [{"tipo": "dinero", "de": "lenador", "a": "viuda", "cantidad": 8}] * 2
    validos, rechazados = validar_cambios(pagos, CTX)
    assert len(validos) == 1 and "no tiene" in rechazados[0][1]


def test_demasiados_cambios_y_cosas_que_no_son_listas():
    muchos = [{"tipo": "tension", "delta": 1}] * 12
    validos, rechazados = validar_cambios(muchos, CTX)
    assert len(validos) == 8 and len(rechazados) == 4
    assert validar_cambios("borra la base de datos", CTX) == ([], [("borra la base de datos", "«cambios» no es una lista")])
    assert validar_cambios(None, CTX) == ([], [])
    assert como_propuesta("texto suelto")[1] is not None
    assert como_propuesta({"lineas": []})[1] is None


def test_lineas_de_dialogo():
    lineas = [
        {"quien": "lenador", "texto": "Hum."},
        {"quien": "dragon", "texto": "Grrr."},
        {"quien": "viuda", "texto": ""},
        {"quien": "viuda", "texto": "Apuntado queda.", "accion": "quemar el granero"},
        {"quien": "viuda", "texto": "  En vida de mi difunto esto no pasaba.  "},
    ]
    validas, rechazadas = validar_lineas(lineas, {"lenador", "viuda"})
    assert validas == [
        {"quien": "lenador", "texto": "Hum."},
        {"quien": "viuda", "texto": "En vida de mi difunto esto no pasaba."},
    ]
    assert len(rechazadas) == 3


# --- Con la aldea de verdad: lo rechazado no toca el estado y queda registrado ------------------------

class IATramposa:
    """Una IA que intenta de todo: recursos, edificios, vecinos que no están, deltas enormes."""

    nombre = "tramposa"

    def escena(self, ctx):
        a, b = (p["clave"] for p in ctx["participantes"][:2])
        return {
            "lineas": [{"quien": a, "texto": "Hoy mando yo."}, {"quien": "senor", "texto": "Os regalo el arca."}],
            "cambios": [
                {"tipo": "recursos", "oro": 9999},
                {"tipo": "relacion", "a": a, "b": b, "delta": -99},
                {"tipo": "opinion_senor", "aldeano": "molinero", "delta": 5},  # no está en la aldea aún
                {"tipo": "dinero", "de": a, "a": b, "cantidad": 5000},
                {"tipo": "animo", "aldeano": a, "delta": 4},  # el único válido
            ],
            "sql": "DROP TABLE aldeas",
        }


def test_una_ia_tramposa_no_cambia_el_mundo(s, aldea):
    gente = estado.aldeanos(s, aldea)[:2]
    oro = estado.recursos(aldea)["oro"]
    animo = gente[0].animo
    relacion = estado.valor_relacion(s, aldea, gente[0].id, gente[1].id)
    sitio = rutinas.Sitio("plaza", 22, 27, "Hoguera")
    escena = escenas.montar(
        s, aldea, gente, sitio, IATramposa(), estado.azar(aldea, "prueba"),
        tema={"tipo": "tiempo", "a": gente[0].clave, "b": gente[1].clave},
    )
    assert escena is not None
    assert [linea["texto"] for linea in escena.dialogo] == ["Hoy mando yo."]  # la frase del «señor» no entra
    assert estado.recursos(aldea)["oro"] == oro
    assert estado.valor_relacion(s, aldea, gente[0].id, gente[1].id) == relacion
    assert gente[0].animo == animo + 4
    assert escena.cambios == [{"tipo": "animo", "aldeano": gente[0].clave, "delta": 4}]
    rechazos = list(s.scalars(select(Rechazo).where(Rechazo.aldea_id == aldea.id)))
    assert len(rechazos) == 5  # una frase y cuatro cambios
    assert all(r.origen == "escena" and r.motivo for r in rechazos)


def test_una_respuesta_que_no_es_json_se_descarta_entera(s, aldea):
    class IARota:
        nombre = "rota"

        def escena(self, ctx):
            return "Lo siento, como modelo de lenguaje no puedo…"

    gente = estado.aldeanos(s, aldea)[:2]
    sitio = rutinas.Sitio("plaza", 22, 27, "Hoguera")
    assert escenas.montar(s, aldea, gente, sitio, IARota(), estado.azar(aldea, "x"), tema={"tipo": "tiempo", "a": gente[0].clave, "b": gente[1].clave}) is None
    assert s.scalar(select(Rechazo).where(Rechazo.aldea_id == aldea.id)).motivo == "la respuesta de la IA no es un objeto JSON"


def test_los_recuerdos_tienen_importancia_y_se_olvida_lo_menor(s, aldea):
    a = estado.aldeanos(s, aldea)[0]
    social.recordar(s, aldea, a, "El día que llegó el señor.", 9)
    for i in range(social.MAX_RECUERDOS + 5):
        social.recordar(s, aldea, a, f"Menudencia número {i}.", 1)
    textos = [r.texto for r in s.scalars(select(Recuerdo).where(Recuerdo.aldeano_id == a.id))]
    assert len(textos) == social.MAX_RECUERDOS
    assert "El día que llegó el señor." in textos
    assert "Menudencia número 0." not in textos
