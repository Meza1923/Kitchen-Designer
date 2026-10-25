import logging
import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import KitchenProject
from .schemas import (
    ProjectCreate,
    ProjectOut,
    ProjectSummary,
    ProjectUpdate,
    default_project_data,
)

log = logging.getLogger("kitchen")


def init_db(retries: int = 30, delay: float = 1.0) -> None:
    """Wait for the database to accept connections, then create tables."""
    for attempt in range(1, retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            Base.metadata.create_all(bind=engine)
            log.info("Database ready")
            return
        except OperationalError:
            log.warning("Database not ready (attempt %d/%d)", attempt, retries)
            time.sleep(delay)
    raise RuntimeError("Could not connect to the database")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Kitchen Elevation Designer API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_project_or_404(db: Session, project_id: uuid.UUID) -> KitchenProject:
    project = db.get(KitchenProject, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/projects", response_model=list[ProjectSummary])
def list_projects(db: Session = Depends(get_db)):
    stmt = select(KitchenProject).order_by(KitchenProject.updated_at.desc())
    return db.scalars(stmt).all()


@app.post("/api/projects", response_model=ProjectOut, response_model_exclude_none=True, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    data = payload.data or default_project_data()
    project = KitchenProject(name=payload.name, data=data.model_dump(exclude_none=True))
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@app.get("/api/projects/{project_id}", response_model=ProjectOut, response_model_exclude_none=True)
def get_project(project_id: uuid.UUID, db: Session = Depends(get_db)):
    return get_project_or_404(db, project_id)


@app.put("/api/projects/{project_id}", response_model=ProjectOut, response_model_exclude_none=True)
def update_project(
    project_id: uuid.UUID, payload: ProjectUpdate, db: Session = Depends(get_db)
):
    project = get_project_or_404(db, project_id)
    if payload.name is not None:
        project.name = payload.name
    if payload.data is not None:
        project.data = payload.data.model_dump(exclude_none=True)
    db.commit()
    db.refresh(project)
    return project


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: uuid.UUID, db: Session = Depends(get_db)):
    project = get_project_or_404(db, project_id)
    db.delete(project)
    db.commit()
    return Response(status_code=204)
