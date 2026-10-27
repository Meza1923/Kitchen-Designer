import os

# Must be set before the app (and its engine) is imported.
os.environ["DATABASE_URL"] = "sqlite://"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database  # noqa: E402

# In-memory SQLite shared across connections, so every request sees the same tables.
database.engine = database.create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
database.SessionLocal.configure(bind=database.engine)

from app import main  # noqa: E402

main.engine = database.engine


@pytest.fixture
def client():
    database.Base.metadata.drop_all(bind=database.engine)
    with TestClient(main.app) as c:  # runs the lifespan, which creates the tables
        yield c
