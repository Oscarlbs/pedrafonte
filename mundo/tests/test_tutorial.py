"""El tutorial: lecciones en orden, premios y lo que el señor puede hacer con él."""

from __future__ import annotations

from aldea import datos, vista
from aldea.motor import condiciones, construccion, estado, guerra, tutorial

from .test_exterior import rico, todos_presentes


def test_las_lecciones_estan_bien_escritas():
    pasos = tutorial.pasos()
    assert len(pasos) >= 15 and len({p["clave"] for p in pasos}) == len(pasos)
    capitulos = list(dict.fromkeys(p["capitulo"] for p in pasos))
    assert capitulos == ["Asentarse", "Crecer", "Defenderse", "El mundo"]
    catalogo = datos.catalogo()
    for p in pasos:
        assert p["titulo"] and p["texto"] and p["como"]
        condiciones.cumple(p.get("condicion"), {})  # se puede evaluar
        for palabra in str(p.get("condicion", "")).replace("(", " ").replace(")", " ").split():
            if palabra.startswith("tiene_"):
                assert palabra[6:] in catalogo, palabra
            if palabra.startswith("hecho_"):
                assert palabra[6:] in tutorial.HECHOS, palabra
        assert set(p.get("premio", {})) <= set(datos.TODOS_RECURSOS)


def test_una_aldea_sin_tutorial_no_lo_ensena_y_se_puede_empezar(s, aldea):
    assert tutorial.resumen(s, aldea) == {"activo": False, "terminado": False, "total": len(tutorial.pasos())}
    tutorial.orden(s, aldea, "empezar")
    r = tutorial.resumen(s, aldea)
    assert r["activo"] and r["paso"] == 1 and r["manual"] and "Pedrafonte" in r["texto"]


def test_las_lecciones_van_en_orden_y_dan_premio(s, aldea):
    rico(aldea)
    tutorial.activar(aldea)
    construccion.construir(s, aldea, "choza", 30, 40)  # la segunda lección, hecha antes de tiempo
    assert tutorial.resumen(s, aldea)["clave"] == "mirar"  # pero la primera espera al «Entendido»
    madera = estado.recursos(aldea)["madera"]
    tutorial.orden(s, aldea, "entendido")
    r = tutorial.resumen(s, aldea)
    assert r["clave"] == "campo" and r["paso"] == 3  # la choza ya estaba: se da por cumplida de corrido
    assert estado.recursos(aldea)["madera"] == madera + 10
    assert r["boton"] == "construir" and r["premio"] == {"grano": 15} and r["capitulo_n"] == 1


def test_lo_que_no_deja_huella_se_apunta(s, aldea):
    tutorial.activar(aldea)
    aldea.estado["tutorial"]["paso"] = [p["clave"] for p in tutorial.pasos()].index("hablar")
    assert tutorial.resumen(s, aldea)["clave"] == "hablar"
    tutorial.apuntar(aldea, "charla")
    assert tutorial.resumen(s, aldea)["clave"] == "consejo"


def test_ocultar_saltar_y_terminar(s, aldea):
    tutorial.activar(aldea)
    tutorial.orden(s, aldea, "ocultar")
    assert tutorial.resumen(s, aldea)["oculto"] is True
    tutorial.orden(s, aldea, "mostrar")
    assert tutorial.resumen(s, aldea)["oculto"] is False
    tutorial.orden(s, aldea, "saltar")
    assert tutorial.resumen(s, aldea)["activo"] is False
    tutorial.activar(aldea)
    aldea.estado["tutorial"]["paso"] = len(tutorial.pasos()) - 1  # la última: ganar un vasallo
    vilanova = guerra.territorio(s, aldea, "vilanova")
    vilanova.datos = {**vilanova.datos, "estado": "vasallo"}
    r = tutorial.resumen(s, aldea)
    assert r["activo"] is False and r["terminado"] is True and "escribiendo" in r["final"]


def test_el_estado_del_juego_trae_la_leccion_y_la_guerra(s, aldea):
    todos_presentes(s, aldea)
    tutorial.activar(aldea)
    e = vista.estado_completo(s, aldea)
    assert e["tutorial"]["clave"] == "mirar" and e["tutorial"]["total"] == len(tutorial.pasos())
    assert e["guerra"] == {"titulo": "Señor", "dominios": 0, "tropas": 0, "fuerza": 0, "campana": None, "asedio": False, "vasallo_de": None}
    assert set(e["gobierno"]["defensa_partes"]) == {"torres", "muros", "leyes", "alianzas", "extra", "tropas"}
