"""Tablas del mundo. Todas llevan `aldea_id`: habrá varias aldeas desde el primer día."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.orm.attributes import flag_modified


class Base(DeclarativeBase):
    pass


def _aldea_fk() -> Mapped[int]:
    return mapped_column(ForeignKey("aldeas.id", ondelete="CASCADE"), index=True)


class Aldea(Base):
    __tablename__ = "aldeas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(80))
    paisaje: Mapped[str] = mapped_column(String(40), default="valle")
    tono: Mapped[str] = mapped_column(String(40), default="cuento")
    dificultad: Mapped[str] = mapped_column(String(40), default="normal")
    semilla: Mapped[int] = mapped_column(Integer, default=1)
    creada: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    # Lo escalar: recursos, desfase de días, última hora procesada, impuestos, leyes, tensión, banderas…
    estado: Mapped[dict] = mapped_column(JSON, default=dict)

    def tocar(self) -> None:
        """Avisa a SQLAlchemy de que `estado` ha cambiado por dentro."""
        flag_modified(self, "estado")


class Edificio(Base):
    __tablename__ = "edificios"

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    clave: Mapped[str] = mapped_column(String(40))
    cx: Mapped[int] = mapped_column(Integer)
    cz: Mapped[int] = mapped_column(Integer)
    rot: Mapped[int] = mapped_column(Integer, default=0)
    dia: Mapped[int] = mapped_column(Integer, default=1)
    datos: Mapped[dict] = mapped_column(JSON, default=dict)


class Aldeano(Base):
    __tablename__ = "aldeanos"
    __table_args__ = (UniqueConstraint("aldea_id", "clave"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    clave: Mapped[str] = mapped_column(String(40))
    nombre: Mapped[str] = mapped_column(String(80))
    oficio: Mapped[str] = mapped_column(String(40))
    caracter: Mapped[str] = mapped_column(Text, default="")
    rasgos: Mapped[list] = mapped_column(JSON, default=list)
    objetivo: Mapped[str] = mapped_column(Text, default="")
    secreto: Mapped[str] = mapped_column(Text, default="")
    secreto_sobre: Mapped[str | None] = mapped_column(String(40), nullable=True)
    dinero: Mapped[int] = mapped_column(Integer, default=0)
    animo: Mapped[int] = mapped_column(Integer, default=55)
    opinion_senor: Mapped[int] = mapped_column(Integer, default=10)
    salud: Mapped[int] = mapped_column(Integer, default=90)
    hambre: Mapped[int] = mapped_column(Integer, default=0)
    presente: Mapped[bool] = mapped_column(Boolean, default=False)
    vivo: Mapped[bool] = mapped_column(Boolean, default=True)
    reparto: Mapped[bool] = mapped_column(Boolean, default=True)
    orden_llegada: Mapped[int] = mapped_column(Integer, default=99)
    dia_llegada: Mapped[int | None] = mapped_column(Integer, nullable=True)
    casa_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trabajo_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    datos: Mapped[dict] = mapped_column(JSON, default=dict)


class Relacion(Base):
    """Relación simétrica entre dos aldeanos (a_id < b_id), de −100 a 100."""

    __tablename__ = "relaciones"
    __table_args__ = (UniqueConstraint("aldea_id", "a_id", "b_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    a_id: Mapped[int] = mapped_column(ForeignKey("aldeanos.id", ondelete="CASCADE"))
    b_id: Mapped[int] = mapped_column(ForeignKey("aldeanos.id", ondelete="CASCADE"))
    valor: Mapped[int] = mapped_column(Integer, default=0)
    etiqueta: Mapped[str | None] = mapped_column(String(40), nullable=True)
    nota: Mapped[str] = mapped_column(Text, default="")


class Recuerdo(Base):
    __tablename__ = "recuerdos"
    __table_args__ = (Index("ix_recuerdos_aldeano", "aldea_id", "aldeano_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    aldeano_id: Mapped[int] = mapped_column(ForeignKey("aldeanos.id", ondelete="CASCADE"))
    dia: Mapped[int] = mapped_column(Integer)
    hora: Mapped[int] = mapped_column(Integer, default=12)
    texto: Mapped[str] = mapped_column(Text)
    importancia: Mapped[int] = mapped_column(Integer, default=3)
    tipo: Mapped[str] = mapped_column(String(20), default="escena")


class Rumor(Base):
    __tablename__ = "rumores"

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    sobre_id: Mapped[int | None] = mapped_column(ForeignKey("aldeanos.id", ondelete="CASCADE"), nullable=True)
    origen_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    texto: Mapped[str] = mapped_column(Text)
    verdad: Mapped[bool] = mapped_column(Boolean, default=False)
    dia: Mapped[int] = mapped_column(Integer, default=1)


class RumorCopia(Base):
    """La versión del rumor que conoce cada aldeano, con su grado de deformación."""

    __tablename__ = "rumor_copias"
    __table_args__ = (UniqueConstraint("aldea_id", "rumor_id", "aldeano_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    rumor_id: Mapped[int] = mapped_column(ForeignKey("rumores.id", ondelete="CASCADE"))
    aldeano_id: Mapped[int] = mapped_column(ForeignKey("aldeanos.id", ondelete="CASCADE"))
    texto: Mapped[str] = mapped_column(Text)
    deformacion: Mapped[int] = mapped_column(Integer, default=0)
    de_quien_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dia: Mapped[int] = mapped_column(Integer, default=1)


class Escena(Base):
    __tablename__ = "escenas"
    __table_args__ = (Index("ix_escenas_dia", "aldea_id", "dia"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    dia: Mapped[int] = mapped_column(Integer)
    hora: Mapped[int] = mapped_column(Integer)
    lugar: Mapped[str] = mapped_column(String(80), default="")
    cx: Mapped[int] = mapped_column(Integer, default=0)
    cz: Mapped[int] = mapped_column(Integer, default=0)
    tema: Mapped[str] = mapped_column(String(40), default="")
    participantes: Mapped[list] = mapped_column(JSON, default=list)
    dialogo: Mapped[list] = mapped_column(JSON, default=list)
    cambios: Mapped[list] = mapped_column(JSON, default=list)
    motor: Mapped[str] = mapped_column(String(20), default="simulado")


class Cronica(Base):
    __tablename__ = "cronicas"
    __table_args__ = (UniqueConstraint("aldea_id", "dia"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    dia: Mapped[int] = mapped_column(Integer)
    fecha: Mapped[str] = mapped_column(String(10))
    texto: Mapped[str] = mapped_column(Text)
    opiniones: Mapped[list] = mapped_column(JSON, default=list)
    datos: Mapped[dict] = mapped_column(JSON, default=dict)


class Suceso(Base):
    """Bitácora: todo lo que pasa (construcciones, llegadas, sucesos del director, amenazas…)."""

    __tablename__ = "sucesos"
    __table_args__ = (Index("ix_sucesos_dia", "aldea_id", "dia"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    dia: Mapped[int] = mapped_column(Integer)
    hora: Mapped[int] = mapped_column(Integer, default=12)
    tipo: Mapped[str] = mapped_column(String(40))
    texto: Mapped[str] = mapped_column(Text)
    datos: Mapped[dict] = mapped_column(JSON, default=dict)


class Peticion(Base):
    __tablename__ = "peticiones"

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    dia: Mapped[int] = mapped_column(Integer)
    clave: Mapped[str] = mapped_column(String(60))
    titulo: Mapped[str] = mapped_column(String(160))
    texto: Mapped[str] = mapped_column(Text)
    peticionario_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sujetos: Mapped[dict] = mapped_column(JSON, default=dict)
    opciones: Mapped[list] = mapped_column(JSON, default=list)
    defecto: Mapped[str | None] = mapped_column(String(60), nullable=True)
    elegida: Mapped[str | None] = mapped_column(String(60), nullable=True)
    resultado: Mapped[str] = mapped_column(Text, default="")
    estado: Mapped[str] = mapped_column(String(20), default="abierta")


class Rechazo(Base):
    """Propuestas de la IA que el validador no dejó pasar."""

    __tablename__ = "rechazos"

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    dia: Mapped[int] = mapped_column(Integer, default=0)
    origen: Mapped[str] = mapped_column(String(40))
    propuesta: Mapped[dict] = mapped_column(JSON, default=dict)
    motivo: Mapped[str] = mapped_column(Text)
    creado: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Vecino(Base):
    __tablename__ = "vecinos"
    __table_args__ = (UniqueConstraint("aldea_id", "clave"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    clave: Mapped[str] = mapped_column(String(40))
    nombre: Mapped[str] = mapped_column(String(80))
    senor: Mapped[str] = mapped_column(String(80))
    caracter: Mapped[str] = mapped_column(Text, default="")
    relacion: Mapped[int] = mapped_column(Integer, default=0)
    datos: Mapped[dict] = mapped_column(JSON, default=dict)


class Mensaje(Base):
    __tablename__ = "mensajes"

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    vecino_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dia: Mapped[int] = mapped_column(Integer)
    tipo: Mapped[str] = mapped_column(String(30))
    remitente: Mapped[str] = mapped_column(String(120), default="")
    texto: Mapped[str] = mapped_column(Text)
    opciones: Mapped[list] = mapped_column(JSON, default=list)
    defecto: Mapped[str | None] = mapped_column(String(60), nullable=True)
    respuesta: Mapped[str | None] = mapped_column(String(60), nullable=True)
    resultado: Mapped[str] = mapped_column(Text, default="")
    estado: Mapped[str] = mapped_column(String(20), default="abierto")
    datos: Mapped[dict] = mapped_column(JSON, default=dict)


class Visitante(Base):
    __tablename__ = "visitantes"

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    tipo: Mapped[str] = mapped_column(String(30))
    nombre: Mapped[str] = mapped_column(String(80))
    dia_llegada: Mapped[int] = mapped_column(Integer)
    dia_salida: Mapped[int] = mapped_column(Integer)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    datos: Mapped[dict] = mapped_column(JSON, default=dict)


class GastoIA(Base):
    __tablename__ = "gasto_ia"
    __table_args__ = (UniqueConstraint("aldea_id", "fecha"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    aldea_id: Mapped[int] = _aldea_fk()
    fecha: Mapped[str] = mapped_column(String(10))
    llamadas: Mapped[int] = mapped_column(Integer, default=0)
    tokens_entrada: Mapped[int] = mapped_column(Integer, default=0)
    tokens_salida: Mapped[int] = mapped_column(Integer, default=0)
    coste_usd: Mapped[float] = mapped_column(Float, default=0.0)
