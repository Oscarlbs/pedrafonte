"""Entorno de Alembic: usa los modelos del mundo y la base de datos de ALDEA_BD_URL."""

from alembic import context

from aldea import bd, config
from aldea.modelos import Base

config.cargar_env()
objetivo = Base.metadata


def en_linea() -> None:
    motor = bd.crear_motor(config.bd_url())
    with motor.connect() as conexion:
        context.configure(connection=conexion, target_metadata=objetivo, render_as_batch=conexion.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()
    motor.dispose()


def sin_conexion() -> None:
    context.configure(url=config.bd_url(), target_metadata=objetivo, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    sin_conexion()
else:
    en_linea()
