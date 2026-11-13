"""Efectos declarados en los YAML (sucesos, peticiones, leyes, fiestas, amenazas…) y cómo los aplica el motor.

Un efecto es un diccionario pequeño. Los que hay:
  {recursos: {grano: -10, oro: 5}}          suma o resta recursos (sin bajar de cero)
  {animo: 5, a: todos}                      a quién: todos | un papel (a, b, p…) | oficio:x | clave:x
  {opinion: -5, a: a}                       opinión sobre el señor
  {salud: -10, a: todos}   {dinero: 5, a: a}
  {relacion: [a, b], delta: -10}
  {tension: 8}
  {recuerdo: "texto con {a}", a: todos, importancia: 5}
  {rumor: "texto", sobre: a, origen: b, verdad: false}
  {secreto: a, lo_sabe: b}                  el secreto de «a» se escapa como rumor que conoce «b»
  {ley: clave, activa: true}   {impuestos: 1}   (sube o baja el nivel)
  {bandera: nombre, valor: x, dias: 3}      marca temporal (dias) o permanente
  {deuda: b, cantidad: -5}                  cambia lo que debe «b»
  {promesa: {clave, texto, condicion, dias}} el señor promete algo; se cumple o se rompe (ver consejo.py)
  {expulsar: b}                             «b» se marcha de la aldea y no vuelve
  {visitante: tipo}                         hace llegar un visitante (mercader, juglar…)
  {defensa: 2, dias: 5}                     defensa temporal

Los papeles (a, b, p…) se resuelven con `resolver_sujetos` a partir de selectores:
  clave:molinero · oficio:cura · rasgo:chismoso · azar · rival_a / rival_b · amante_a / amante_b ·
  deudor / acreedor · mas_descontento · mas_contento · mas_pobre · mas_rico · hambriento · sin_techo ·
  secreto_de:a (a quien afecta el secreto de «a»)
"""

from __future__ import annotations

import random
from typing import Any

from sqlalchemy.orm import Session

from ..ia.simulado import pulir
from ..modelos import Aldea, Aldeano
from . import estado, social


def resolver_sujetos(
    s: Session, aldea: Aldea, sujetos: dict[str, str] | None, azar: random.Random,
    fijos: dict[str, Aldeano] | None = None,
) -> dict[str, Aldeano] | None:
    """Convierte selectores en vecinos presentes y distintos entre sí. None si alguno no se puede."""
    gente = estado.aldeanos(s, aldea)
    resultado: dict[str, Aldeano] = dict(fijos or {})
    usados = {a.id for a in resultado.values()}

    def libres() -> list[Aldeano]:
        return [a for a in gente if a.id not in usados]

    pares = {"rival": _par_extremo(s, aldea, gente, minimo=True), "amante": _par_etiqueta(s, aldea, gente, "amor")}
    for papel, selectores in (sujetos or {}).items():
        if papel in resultado:
            continue
        elegido: Aldeano | None = None
        for selector in selectores if isinstance(selectores, list) else [selectores]:
            elegido = _elegir(str(selector), libres(), gente, usados, resultado, pares, azar)
            if elegido is not None:
                break
        if elegido is None:
            return None
        resultado[papel] = elegido
        usados.add(elegido.id)
    return resultado


def _elegir(
    selector: str, candidatos: list[Aldeano], gente: list[Aldeano], usados: set[int],
    resultado: dict[str, Aldeano], pares: dict, azar: random.Random,
) -> Aldeano | None:
    elegido: Aldeano | None = None
    if selector == "azar":
        elegido = azar.choice(candidatos) if candidatos else None
    elif selector.startswith("clave:"):
        elegido = next((a for a in candidatos if a.clave == selector[6:]), None)
    elif selector.startswith("oficio:"):
        elegido = next((a for a in candidatos if a.oficio == selector[7:]), None)
    elif selector.startswith("rasgo:"):
        con = [a for a in candidatos if selector[6:] in (a.rasgos or [])]
        elegido = azar.choice(con) if con else None
    elif selector in ("rival_a", "rival_b", "amante_a", "amante_b"):
        par = pares[selector[:-2]]
        elegido = par[0 if selector.endswith("_a") else 1] if par else None
        if elegido is not None and elegido.id in usados:
            elegido = None
    elif selector in ("deudor", "acreedor"):
        deudor = next((a for a in gente if ((a.datos or {}).get("debe") or {}).get("cantidad", 0) > 0), None)
        if deudor is not None:
            acreedor = next((a for a in gente if a.clave == deudor.datos["debe"]["a"]), None)
            elegido = deudor if selector == "deudor" else acreedor
            if elegido is not None and (acreedor is None or elegido.id in usados):
                elegido = None
    elif selector == "mas_descontento":
        elegido = min(candidatos, key=lambda a: a.opinion_senor, default=None)
    elif selector == "mas_contento":
        elegido = max(candidatos, key=lambda a: a.opinion_senor, default=None)
    elif selector == "mas_pobre":
        elegido = min(candidatos, key=lambda a: a.dinero, default=None)
    elif selector == "mas_rico":
        elegido = max(candidatos, key=lambda a: a.dinero, default=None)
    elif selector == "hambriento":
        elegido = max((a for a in candidatos if a.hambre > 0), key=lambda a: a.hambre, default=None)
    elif selector == "sin_techo":
        elegido = next((a for a in candidatos if a.casa_id is None), None)
    elif selector.startswith("secreto_de:"):
        origen = resultado.get(selector[11:])
        elegido = next((a for a in candidatos if origen is not None and a.clave == origen.secreto_sobre), None)
    return elegido


def _par_extremo(s: Session, aldea: Aldea, gente: list[Aldeano], minimo: bool) -> tuple[Aldeano, Aldeano] | None:
    mejor: tuple[int, Aldeano, Aldeano] | None = None
    for i, a in enumerate(gente):
        for b in gente[i + 1:]:
            valor = estado.valor_relacion(s, aldea, a.id, b.id)
            if mejor is None or (valor < mejor[0] if minimo else valor > mejor[0]):
                mejor = (valor, a, b)
    if mejor is None or (minimo and mejor[0] > -25):
        return None
    return mejor[1], mejor[2]


def _par_etiqueta(s: Session, aldea: Aldea, gente: list[Aldeano], etiqueta: str) -> tuple[Aldeano, Aldeano] | None:
    for i, a in enumerate(gente):
        for b in gente[i + 1:]:
            r = estado.relacion(s, aldea, a.id, b.id, crear=False)
            if r is not None and r.etiqueta == etiqueta:
                return a, b
    return None


def huecos(aldea: Aldea, sujetos: dict[str, Aldeano], variables: dict[str, Any] | None = None) -> dict[str, Any]:
    """Textos para rellenar plantillas: {a} es como le llaman, {a_nombre} el nombre entero, {a_oficio}.

    Si se pasan las variables del estado, también valen {poblacion}, {sin_techo}, {dias_comida}…
    """
    resultado: dict[str, Any] = {k: (f"{v:g}" if isinstance(v, float) else v) for k, v in (variables or {}).items()}
    resultado["aldea"] = aldea.nombre
    for papel, a in sujetos.items():
        d = a.datos or {}
        resultado[papel] = d.get("apodo", a.nombre)
        resultado[f"{papel}_nombre"] = a.nombre
        resultado[f"{papel}_oficio"] = d.get("oficio_nombre", a.oficio)
    return resultado


class _Huecos(dict):
    def __missing__(self, clave: str) -> str:
        return "alguien"


def rellenar(texto: str, valores: dict[str, Any]) -> str:
    try:
        return pulir(str(texto).format_map(_Huecos(valores)))
    except (ValueError, IndexError):
        return str(texto)


def _destinatarios(s: Session, aldea: Aldea, a_quien: Any, sujetos: dict[str, Aldeano]) -> list[Aldeano]:
    gente = estado.aldeanos(s, aldea)
    a_quien = str(a_quien or "todos")
    if a_quien == "todos":
        return gente
    if a_quien in sujetos:
        return [sujetos[a_quien]]
    if a_quien.startswith("oficio:"):
        return [a for a in gente if a.oficio == a_quien[7:]]
    if a_quien.startswith("clave:"):
        return [a for a in gente if a.clave == a_quien[6:]]
    if a_quien.startswith("rasgo:"):
        return [a for a in gente if a_quien[6:] in (a.rasgos or [])]
    return []


def _uno(s: Session, aldea: Aldea, quien: str, sujetos: dict[str, Aldeano]) -> Aldeano | None:
    if quien in sujetos:
        return sujetos[quien]
    return next(iter(_destinatarios(s, aldea, quien, sujetos)), None) if ":" in str(quien) else None


def aplicar(
    s: Session, aldea: Aldea, lista: list[dict] | None, sujetos: dict[str, Aldeano] | None = None,
    multiplicador: float = 1.0,
) -> None:
    """Aplica una lista de efectos. `multiplicador` escala las pérdidas (dificultad, defensa…)."""
    sujetos = sujetos or {}
    valores = huecos(aldea, sujetos)
    e = aldea.estado
    for efecto in lista or []:
        if "recursos" in efecto:
            for recurso, delta in efecto["recursos"].items():
                estado.sumar_recurso(aldea, recurso, delta * (multiplicador if delta < 0 else 1.0))
        elif "animo" in efecto:
            for a in _destinatarios(s, aldea, efecto.get("a"), sujetos):
                a.animo = int(estado.limitar(a.animo + efecto["animo"], 0, 100))
        elif "opinion" in efecto:
            for a in _destinatarios(s, aldea, efecto.get("a"), sujetos):
                a.opinion_senor = int(estado.limitar(a.opinion_senor + efecto["opinion"], -100, 100))
        elif "salud" in efecto:
            for a in _destinatarios(s, aldea, efecto.get("a"), sujetos):
                a.salud = int(estado.limitar(a.salud + efecto["salud"], 5, 100))
        elif "dinero" in efecto:
            for a in _destinatarios(s, aldea, efecto.get("a"), sujetos):
                a.dinero = int(estado.limitar(a.dinero + efecto["dinero"], 0, 9999))
        elif "relacion" in efecto:
            x, y = (_uno(s, aldea, p, sujetos) for p in efecto["relacion"])
            if x is not None and y is not None and x.id != y.id:
                social.cambiar_relacion(s, aldea, x.id, y.id, int(efecto.get("delta", 0)))
        elif "tension" in efecto:
            social.tensar(aldea, efecto["tension"])
        elif "recuerdo" in efecto:
            for a in _destinatarios(s, aldea, efecto.get("a"), sujetos):
                social.recordar(s, aldea, a, rellenar(efecto["recuerdo"], valores), int(efecto.get("importancia", 5)), "suceso")
        elif "rumor" in efecto:
            from . import rumores

            sobre, origen = sujetos.get(efecto.get("sobre", "")), sujetos.get(efecto.get("origen", ""))
            if sobre is not None:
                rumores.crear(s, aldea, sobre, rellenar(efecto["rumor"], valores), origen=origen, verdad=bool(efecto.get("verdad")))
        elif "secreto" in efecto:
            from . import rumores

            de_quien = sujetos.get(efecto["secreto"])
            if de_quien is not None:
                rumores.soltar_secreto(s, aldea, de_quien, sujetos.get(efecto.get("lo_sabe", "")))
        elif "ley" in efecto:
            leyes_activas = [c for c in e.get("leyes", []) if c != efecto["ley"]]
            if efecto.get("activa", True):
                leyes_activas.append(efecto["ley"])
            e["leyes"] = leyes_activas
        elif "impuestos" in efecto:
            e["impuestos"] = int(estado.limitar(e.get("impuestos", 1) + efecto["impuestos"], 0, 4))
        elif "bandera" in efecto:
            e.setdefault("banderas", {})[efecto["bandera"]] = efecto.get("valor", True)
            if efecto.get("dias"):
                e.setdefault("banderas_caducan", {})[efecto["bandera"]] = e.get("dia", 1) + int(efecto["dias"])
        elif "deuda" in efecto:
            deudor = sujetos.get(efecto["deuda"])
            debe = dict((deudor.datos or {}).get("debe") or {}) if deudor is not None else {}
            if debe:
                debe["cantidad"] = max(0, int(debe.get("cantidad", 0)) + int(efecto.get("cantidad", 0)))
                deudor.datos = {**deudor.datos, "debe": debe if debe["cantidad"] > 0 else None}
        elif "promesa" in efecto:
            promesa = dict(efecto["promesa"])
            promesa["vence"] = e.get("dia", 1) + int(promesa.pop("dias", 5))
            e["promesas"] = [x for x in e.get("promesas", []) if x.get("clave") != promesa.get("clave")] + [promesa]
        elif "expulsar" in efecto:
            fuera = sujetos.get(efecto["expulsar"])
            if fuera is not None:
                fuera.presente = False
                fuera.casa_id = fuera.trabajo_id = None
                fuera.datos = {**(fuera.datos or {}), "se_fue": e.get("dia", 1) + 9999}  # no vuelve
                estado.emitir(aldea, "aldeano", accion="se_va", id=fuera.id)
        elif "visitante" in efecto:
            from . import exterior

            exterior.llegar(s, aldea, efecto["visitante"])
        elif "defensa" in efecto:
            e.setdefault("banderas", {})["defensa_extra"] = efecto["defensa"]
            e.setdefault("banderas_caducan", {})["defensa_extra"] = e.get("dia", 1) + int(efecto.get("dias", 3))
    aldea.tocar()
    s.flush()


def caducar_banderas(aldea: Aldea) -> None:
    """Quita las marcas temporales cuyo plazo ha pasado. Se llama al amanecer."""
    e = aldea.estado
    dia = e.get("dia", 1)
    caducan = e.get("banderas_caducan", {})
    for nombre in [n for n, limite in caducan.items() if limite <= dia]:
        e.get("banderas", {}).pop(nombre, None)
        caducan.pop(nombre, None)
    aldea.tocar()
