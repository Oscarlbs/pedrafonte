"""Rumores que se deforman al pasar de uno a otro, relaciones, escenas y vida de la aldea."""

from __future__ import annotations

import random

from sqlalchemy import select

from aldea import ia
from aldea.ia.simulado import MotorSimulado
from aldea.modelos import Cronica, Escena, Rechazo, Recuerdo, Rumor, RumorCopia
from aldea.motor import charla, ciclo, construccion, drama, escenas, estado, reflexion, rumores, rutinas

from .conftest import INICIO


def todos_presentes(s, aldea):
    for a in estado.aldeanos(s, aldea, solo_presentes=False):
        a.presente = True
    s.flush()
    return {a.clave: a for a in estado.aldeanos(s, aldea)}


# --- El reparto garantiza conflicto -----------------------------------------------------------------

def test_reparto_con_secretos_cruzados_rivalidades_deuda_y_amor(s, aldea):
    gente = todos_presentes(s, aldea)
    assert len(gente) == 12
    # Cada secreto afecta a otro vecino, y entre todos cierran una cadena.
    assert all(a.secreto and a.secreto_sobre in gente and a.secreto_sobre != a.clave for a in gente.values())
    assert {a.secreto_sobre for a in gente.values()} == set(gente)
    etiquetas = {}
    for a in gente.values():
        for _otro, r in estado.relaciones_de(s, aldea, a.id):
            etiquetas.setdefault(r.etiqueta, set()).add(r.id)
    assert len(etiquetas["rivalidad"]) == 2
    assert len(etiquetas["deuda"]) == 1 and len(etiquetas["amor"]) == 1
    assert gente["herrero"].datos["debe"] == {"a": "viuda", "cantidad": 30}
    assert estado.valor_relacion(s, aldea, gente["lenador"].id, gente["panadera"].id) == 70


# --- Rumores ----------------------------------------------------------------------------------------

def test_el_rumor_se_deforma_al_pasar_y_sigue_hablando_del_mismo(s, aldea):
    gente = todos_presentes(s, aldea)
    motor = MotorSimulado()
    rumor = s.scalar(select(Rumor).where(Rumor.sobre_id == gente["herrero"].id))
    copia = s.scalar(select(RumorCopia).where(RumorCopia.rumor_id == rumor.id, RumorCopia.aldeano_id == gente["viuda"].id))
    cadena = ["viuda", "tabernero", "molinero", "cura", "pastor", "mozo"]
    textos = [copia.texto]
    for de, a in zip(cadena, cadena[1:], strict=False):
        copia = rumores.pasar(s, aldea, copia, gente[de], gente[a], motor)
        assert copia is not None
        textos.append(copia.texto)
        assert "mauro" in copia.texto.lower()  # sigue hablando del herrero
    assert copia.deformacion == 5
    assert len(set(textos)) == len(textos)  # cada versión es distinta de la anterior
    assert len(textos[-1]) > len(textos[0])
    assert rumor.texto == textos[0]  # el original no se toca


def test_no_se_cuenta_dos_veces_ni_al_aludido_y_tiene_tope(s, aldea):
    gente = todos_presentes(s, aldea)
    motor = MotorSimulado()
    rumor = s.scalar(select(Rumor).where(Rumor.sobre_id == gente["herrero"].id))
    copia = s.scalar(select(RumorCopia).where(RumorCopia.rumor_id == rumor.id, RumorCopia.aldeano_id == gente["viuda"].id))
    assert rumores.pasar(s, aldea, copia, gente["viuda"], gente["escriba"], motor) is None  # ya lo sabe
    assert rumores.pasar(s, aldea, copia, gente["viuda"], gente["herrero"], motor) is None  # es el aludido
    assert rumores.candidato(s, aldea, gente["viuda"], gente["herrero"]) is None
    assert rumores.candidato(s, aldea, gente["viuda"], gente["pastor"]).rumor_id == rumor.id
    copia.deformacion = rumores.MAX_DEFORMACION
    assert rumores.pasar(s, aldea, copia, gente["viuda"], gente["pastor"], motor) is None  # ya es demasiado gordo


def test_oir_un_rumor_enfria_el_trato_y_deja_recuerdo(s, aldea):
    gente = todos_presentes(s, aldea)
    rumor = s.scalar(select(Rumor).where(Rumor.sobre_id == gente["herrero"].id))
    copia = s.scalar(select(RumorCopia).where(RumorCopia.rumor_id == rumor.id, RumorCopia.aldeano_id == gente["viuda"].id))
    antes = estado.valor_relacion(s, aldea, gente["pastor"].id, gente["herrero"].id)
    rumores.pasar(s, aldea, copia, gente["viuda"], gente["pastor"], MotorSimulado())
    assert estado.valor_relacion(s, aldea, gente["pastor"].id, gente["herrero"].id) < antes
    recuerdo = s.scalar(select(Recuerdo).where(Recuerdo.aldeano_id == gente["pastor"].id, Recuerdo.tipo == "rumor"))
    assert "Doña Aldonza me contó que" in recuerdo.texto


def test_un_rumor_deformado_que_cambia_de_persona_se_rechaza(s, aldea):
    gente = todos_presentes(s, aldea)

    class IAQueCambiaDeVictima:
        nombre = "liante"

        def deformar_rumor(self, ctx):
            return {"texto": "Sabela la panadera debe mil monedas al rey de Francia"}

    rumor = s.scalar(select(Rumor).where(Rumor.sobre_id == gente["herrero"].id))
    copia = s.scalar(select(RumorCopia).where(RumorCopia.rumor_id == rumor.id, RumorCopia.aldeano_id == gente["viuda"].id))
    nueva = rumores.pasar(s, aldea, copia, gente["viuda"], gente["pastor"], IAQueCambiaDeVictima())
    assert nueva.texto == copia.texto  # pasa tal cual: el motor no se inventa nada
    rechazo = s.scalar(select(Rechazo).where(Rechazo.origen == "rumor"))
    assert "ya no habla de Mauro" in rechazo.motivo


def test_quien_es_callado_cuenta_menos_que_quien_es_chismoso(s, aldea):
    gente = todos_presentes(s, aldea)

    def veces(clave):
        azar = random.Random(1)
        return sum(rumores.ganas_de_contar(gente[clave], 10, azar) for _ in range(400))

    assert veces("tabernero") > veces("lenador") * 2
    assert not rumores.ganas_de_contar(gente["viuda"], -60, random.Random(1))  # al enemigo, ni los buenos días


def test_el_secreto_se_escapa_una_sola_vez_como_rumor_verdadero(s, aldea):
    gente = todos_presentes(s, aldea)
    rumor = rumores.soltar_secreto(s, aldea, gente["molinero"], gente["tabernero"])
    assert rumor.verdad and rumor.sobre_id == gente["molinero"].id
    assert rumor.texto.startswith("La maquila de Roque")
    assert rumores.sabe(s, aldea, gente["tabernero"].id, rumor.id)
    assert rumores.soltar_secreto(s, aldea, gente["molinero"], gente["cura"]) is None


# --- Escenas ----------------------------------------------------------------------------------------

def test_escena_de_rumor_una_sola_llamada_y_el_rumor_pasa_deformado(s, aldea):
    gente = todos_presentes(s, aldea)

    class Contadora(MotorSimulado):
        llamadas = 0

        def escena(self, ctx):
            Contadora.llamadas += 1
            return super().escena(ctx)

        def deformar_rumor(self, ctx):  # no debe usarse: la escena ya trae el rumor deformado
            raise AssertionError("una sola llamada por escena")

    copia = rumores.candidato(s, aldea, gente["viuda"], gente["tabernero"])
    sitio = rutinas.Sitio("plaza", 22, 27, "Hoguera")
    escena = escenas.montar(
        s, aldea, [gente["viuda"], gente["tabernero"]], sitio, Contadora(), estado.azar(aldea, "rumor"),
        tema={"tipo": "rumor", "a": "viuda", "b": "tabernero", "_copia": copia},
    )
    assert Contadora.llamadas == 1
    assert escena.tema == "rumor" and 2 <= len(escena.dialogo) <= 4
    nueva = s.scalar(select(RumorCopia).where(RumorCopia.aldeano_id == gente["tabernero"].id))
    assert nueva.deformacion == 1 and nueva.texto != copia.texto and "Mauro" in nueva.texto
    assert any("Mauro" in linea["texto"] for linea in escena.dialogo)


def test_los_rivales_que_coinciden_acaban_peor(s, aldea):
    gente = todos_presentes(s, aldea)
    par = [gente["molinero"], gente["panadera"]]
    sitio = rutinas.Sitio("plaza", 22, 27, "Hoguera")
    temas = {escenas.elegir_tema(s, aldea, par, sitio, random.Random(i))["tipo"] for i in range(40)}
    assert "rivalidad" in temas
    antes = estado.valor_relacion(s, aldea, par[0].id, par[1].id)
    for i in range(6):
        aldea.estado["hora"] = 8 + i
        escenas.montar(s, aldea, par, sitio, MotorSimulado(), random.Random(i), tema={"tipo": "rivalidad", "a": "molinero", "b": "panadera"})
    assert estado.valor_relacion(s, aldea, par[0].id, par[1].id) < antes
    assert not list(s.scalars(select(Rechazo)))  # el motor simulado propone dentro de las reglas


def test_pagar_parte_de_la_deuda_la_reduce(s, aldea):
    gente = todos_presentes(s, aldea)
    herrero, viuda = gente["herrero"], gente["viuda"]
    herrero.dinero = 10

    class IAPagadora:
        nombre = "pagadora"

        def escena(self, ctx):
            return {
                "lineas": [{"quien": "herrero", "texto": "Tened, doña Aldonza."}],
                "cambios": [{"tipo": "dinero", "de": "herrero", "a": "viuda", "cantidad": 6}],
            }

    sitio = rutinas.Sitio("plaza", 22, 27, "Hoguera")
    escenas.montar(s, aldea, [viuda, herrero], sitio, IAPagadora(), random.Random(1), tema={"tipo": "deuda", "a": "viuda", "b": "herrero", "cantidad": 30})
    assert herrero.dinero == 4 and viuda.dinero == 52
    assert herrero.datos["debe"]["cantidad"] == 24


# --- Charla -----------------------------------------------------------------------------------------

def test_charla_contesta_en_su_papel_y_calla_el_secreto_sin_confianza(s, aldea):
    motor = MotorSimulado()
    viuda = estado.aldeano_por_clave(s, aldea, "viuda")
    saludo = charla.hablar(s, aldea, viuda, "Buenos días", motor)
    assert "Dios os guarde" in saludo["respuesta"]
    viuda.opinion_senor = 10
    secreto = charla.hablar(s, aldea, viuda, "¿Qué secreto escondes?", motor)
    assert not secreto["revelado"] and "marcos" not in secreto["respuesta"]
    viuda.opinion_senor = 80
    secreto = charla.hablar(s, aldea, viuda, "Dime la verdad, ¿qué secreto guardas?", motor)
    assert secreto["revelado"] and "marcos" in secreto["respuesta"]
    assert "viuda" in aldea.estado["secretos_sabidos"]


def test_charla_cuenta_rumores_segun_la_opinion_y_los_halagos_tienen_tope(s, aldea):
    motor = MotorSimulado()
    viuda = estado.aldeano_por_clave(s, aldea, "viuda")
    viuda.opinion_senor = 20
    assert "Mauro" in charla.hablar(s, aldea, viuda, "¿Qué se dice por ahí? ¿Algún rumor?", motor)["respuesta"]
    viuda.opinion_senor = -20
    assert "Mauro" not in charla.hablar(s, aldea, viuda, "¿Algún rumor?", motor)["respuesta"]
    viuda.opinion_senor = 0
    for _ in range(6):
        charla.hablar(s, aldea, viuda, "Gracias, buen trabajo", motor)
    assert viuda.opinion_senor == 3  # un halago vale; el segundo ya pasa del tope diario
    insulto = charla.hablar(s, aldea, viuda, "Calla, inútil", motor)
    assert viuda.opinion_senor == -3 and insulto["respuesta"]


# --- La vida entera ---------------------------------------------------------------------------------

def test_una_semana_de_vida_escenas_reflexiones_cronica_y_drama(s, aldea):
    estado.recursos(aldea).update({"grano": 400, "madera": 300, "piedra": 200, "oro": 100})
    for clave, cx, cz in (("casa", 26, 16), ("casa", 26, 20), ("casa", 30, 16), ("campo", 10, 20), ("cabana_lenador", 14, 14), ("pozo", 25, 24)):
        construccion.construir(s, aldea, clave, cx, cz)
    motor = ia.obtener(aldea)
    for _ in range(7):
        ciclo.adelantar_dia(s, aldea, ia=motor, real=INICIO)
    escenas_ = list(s.scalars(select(Escena)))
    assert len(escenas_) >= 7
    assert all(2 <= len(e.participantes) <= 4 for e in escenas_)
    assert len({e.tema for e in escenas_}) >= 4
    assert s.scalar(select(Recuerdo).where(Recuerdo.tipo == "reflexion")) is not None
    cronicas = list(s.scalars(select(Cronica).order_by(Cronica.dia)))
    assert len(cronicas) == 7 and all(c.texto and c.opiniones for c in cronicas)
    assert len(estado.aldeanos(s, aldea)) > 4  # han ido llegando vecinos
    assert len(aldea.estado["tension_historial"]) == 7
    rechazos = list(s.scalars(select(Rechazo)))
    assert all(r.origen == "escena" and "no tiene" in r.motivo for r in rechazos), [r.motivo for r in rechazos]


def test_el_director_saca_un_suceso_si_hay_dos_dias_de_calma(s, aldea):
    aldea.estado["tension"] = 5
    aldea.estado["tension_historial"] = [8]
    assert drama.cierre(s, aldea) is not None  # hoy también calma: segundo día → suceso
    assert aldea.estado["tension"] > 5
    assert aldea.estado["enfriamientos"]["drama"] == aldea.estado["dia"] + drama.DESCANSO
    aldea.estado["tension"] = 5
    assert drama.cierre(s, aldea) is None  # respiro tras el suceso
    aldea.estado["tension"] = 90
    aldea.estado["enfriamientos"]["drama"] = 0
    assert drama.cierre(s, aldea) is None  # con tensión alta no hace falta empujar


def test_todos_los_sucesos_de_la_tabla_funcionan(s, aldea):
    from aldea import datos

    todos_presentes(s, aldea)
    estado.recursos(aldea).update({"grano": 999, "madera": 999, "piedra": 999, "oro": 999})
    construccion.construir(s, aldea, "molino", *datos.paisaje("valle")["solar_molino"], gratis=True)
    for clave, cx, cz in (("taberna", 26, 16), ("gallinero", 26, 20), ("panaderia", 14, 14)):
        construccion.construir(s, aldea, clave, cx, cz, gratis=True)
    claves = [x["clave"] for x in datos.cargar("sucesos")]
    lanzados = [c for c in claves if drama.lanzar(s, aldea, c) is not None]
    assert set(claves) - set(lanzados) == {"palabras_gordas"}  # ese es solo para aldeas sin taberna
    assert len(aldea.estado["secretos_en_rumor"]) == 12


def test_la_reflexion_va_por_lotes_de_cuatro(s, aldea):
    todos_presentes(s, aldea)

    class Contadora(MotorSimulado):
        lotes: list[int] = []

        def reflexion(self, ctx):
            Contadora.lotes.append(len(ctx["aldeanos"]))
            return super().reflexion(ctx)

    assert reflexion.noche(s, aldea, Contadora()) == 12
    assert Contadora.lotes == [4, 4, 4]
