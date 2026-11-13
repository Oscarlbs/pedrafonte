"""Colocar, girar y derribar edificios sobre la cuadrícula. Solo el motor toca los edificios."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Edificio
from . import estado, mapa as mapas


class NoSePuede(Exception):
    """La orden no es válida; el mensaje es para enseñárselo al jugador."""


def ocupadas(s: Session, aldea: Aldea, salvo: int | None = None) -> dict[tuple[int, int], Edificio]:
    catalogo = datos.catalogo()
    celdas: dict[tuple[int, int], Edificio] = {}
    for e in estado.edificios(s, aldea):
        if e.id == salvo or e.clave not in catalogo:
            continue
        for c in mapas.huella(e.cx, e.cz, catalogo[e.clave]["tam"], e.rot):
            celdas[c] = e
    return celdas


def comprobar(
    s: Session, aldea: Aldea, clave: str, cx: int, cz: int, rot: int = 0,
    gratis: bool = False, salvo: int | None = None,
) -> None:
    """Lanza NoSePuede con el motivo si no se puede construir ahí."""
    catalogo = datos.catalogo()
    if clave not in catalogo:
        raise NoSePuede(f"No existe el edificio «{clave}».")
    ficha = catalogo[clave]
    m = mapas.mapa(aldea.paisaje)
    celdas = mapas.huella(cx, cz, ficha["tam"], rot)
    if not all(m.dentro(x, z) for x, z in celdas):
        raise NoSePuede("Se sale del valle.")
    tipos = [m.tipo(x, z) for x, z in celdas]
    if mapas.AGUA in tipos:
        raise NoSePuede("Ahí hay río. Los cimientos no flotan.")
    if mapas.PUENTE in tipos:
        raise NoSePuede("No se puede construir sobre el puente.")
    if mapas.CAMINO in tipos:
        raise NoSePuede("Por ahí pasa el camino real.")
    ya = ocupadas(s, aldea, salvo=salvo)
    if any(c in ya for c in celdas):
        raise NoSePuede("Ese sitio ya está ocupado.")

    requisitos = ficha["requisitos"]
    if requisitos.get("terreno") == "orilla" and mapas.ORILLA not in tipos:
        raise NoSePuede(f"{ficha['nombre']} tiene que tocar la orilla del río.")
    if salvo is None:  # los requisitos de aldea solo se miran al construir, no al girar
        cuenta = estado.contar_edificios(s, aldea)
        if requisitos.get("unico") and cuenta.get(clave, 0) >= 1:
            raise NoSePuede(f"Solo puede haber un edificio de este tipo: {ficha['nombre']}.")
        poblacion = len(estado.aldeanos(s, aldea))
        if poblacion < int(requisitos.get("poblacion", 0)):
            raise NoSePuede(f"Hacen falta al menos {requisitos['poblacion']} vecinos.")
        for necesario in requisitos.get("edificios", []):
            if cuenta.get(necesario, 0) < 1:
                raise NoSePuede(f"Antes hace falta: {catalogo[necesario]['nombre']}.")
        if not gratis and not estado.puede_pagar(aldea, ficha["coste"]):
            falta = ", ".join(
                f"{v:g} de {k}" for k, v in ficha["coste"].items() if estado.recursos(aldea).get(k, 0) < v
            )
            raise NoSePuede(f"No alcanza: hace falta {falta}.")


def construir(
    s: Session, aldea: Aldea, clave: str, cx: int, cz: int, rot: int = 0, gratis: bool = False
) -> Edificio:
    rot = int(rot) % 4
    comprobar(s, aldea, clave, cx, cz, rot, gratis=gratis)
    ficha = datos.catalogo()[clave]
    if not gratis:
        estado.pagar(aldea, ficha["coste"])
    edificio = Edificio(aldea_id=aldea.id, clave=clave, cx=cx, cz=cz, rot=rot, dia=aldea.estado.get("dia", 1))
    s.add(edificio)
    s.flush()
    if not ficha["efecto"].get("arrastre") and ficha["categoria"] != "adorno" and not gratis:
        estado.anotar(s, aldea, "obra", f"Se levanta: {ficha['nombre']}.", edificio=edificio.id, clave=clave)
    if not gratis and (ficha["efecto"].get("vivienda") or ficha["efecto"].get("trabajadores")):
        _recolocar(s, aldea)
    estado.emitir(aldea, "edificio", accion="construido", edificio=serializar(edificio))
    return edificio


def _recolocar(s: Session, aldea: Aldea) -> None:
    """Tras una obra, la gente se reparte otra vez por casas y trabajos."""
    from . import economia  # import tardío: economía no debe depender de construcción

    economia.asignar_casas(s, aldea)
    economia.asignar_trabajos(s, aldea)


def derribar(s: Session, aldea: Aldea, edificio_id: int) -> dict[str, float]:
    edificio = s.get(Edificio, edificio_id)
    if edificio is None or edificio.aldea_id != aldea.id:
        raise NoSePuede("Ese edificio no existe.")
    ficha = datos.catalogo().get(edificio.clave, {"coste": {}, "nombre": edificio.clave, "efecto": {}})
    # Se recupera la mitad de la madera y la piedra.
    devuelto = {k: round(v / 2) for k, v in ficha["coste"].items() if k in ("madera", "piedra") and round(v / 2) > 0}
    for recurso, cantidad in devuelto.items():
        estado.sumar_recurso(aldea, recurso, cantidad)
    for a in estado.aldeanos(s, aldea, solo_presentes=False):
        if a.casa_id == edificio.id:
            a.casa_id = None
        if a.trabajo_id == edificio.id:
            a.trabajo_id = None
    s.delete(edificio)
    s.flush()
    if ficha["efecto"].get("vivienda") or ficha["efecto"].get("trabajadores"):
        _recolocar(s, aldea)
    if not ficha["efecto"].get("arrastre") and ficha.get("categoria") != "adorno":
        estado.anotar(s, aldea, "obra", f"Se derriba: {ficha['nombre']}.", clave=edificio.clave)
    estado.emitir(aldea, "edificio", accion="derribado", id=edificio_id)
    return devuelto


def girar(s: Session, aldea: Aldea, edificio_id: int) -> Edificio:
    edificio = s.get(Edificio, edificio_id)
    if edificio is None or edificio.aldea_id != aldea.id:
        raise NoSePuede("Ese edificio no existe.")
    nuevo = (edificio.rot + 1) % 4
    comprobar(s, aldea, edificio.clave, edificio.cx, edificio.cz, nuevo, gratis=True, salvo=edificio.id)
    edificio.rot = nuevo
    estado.emitir(aldea, "edificio", accion="girado", edificio=serializar(edificio))
    return edificio


def serializar(e: Edificio) -> dict:
    return {"id": e.id, "clave": e.clave, "cx": e.cx, "cz": e.cz, "rot": e.rot, "dia": e.dia}


def centro(e: Edificio) -> tuple[int, int]:
    """Celda central de un edificio (para mandar allí a los aldeanos)."""
    tam = datos.catalogo().get(e.clave, {"tam": [1, 1]})["tam"]
    ancho, fondo = (tam[1], tam[0]) if e.rot % 2 else (tam[0], tam[1])
    return e.cx + ancho // 2, e.cz + fondo // 2
