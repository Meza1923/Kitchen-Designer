import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

ElementCategory = Literal[
    "base_cabinet",
    "upper_cabinet",
    "tall_cabinet",
    "corner_blocker",
    "fridge",
    "washing_machine",
    "under_counter_oven",
    "sink",
    "stove",
    "water_bar",
    "coffee_machine",
    "window",
    "door",
    "socket",
    "power_socket",
]
TallZoneType = Literal["door", "drawers", "oven", "microwave", "coffee", "open"]


class TallZoneConfig(BaseModel):
    id: str
    type: TallZoneType
    heightPct: float
    drawerCount: Optional[int] = None


class KitchenItem(BaseModel):
    id: str
    category: ElementCategory
    label: Optional[str] = None
    x: float
    y: float
    width: float
    height: float
    depth: Optional[float] = None  # cm into the room; filled with a category default by the client
    hasToeKick: bool = False
    toeKickHeight: float = 10
    noCountertop: Optional[bool] = None  # counter-bearing units only: leave out the countertop slab
    frontType: Literal["doors", "drawers"] = "doors"
    doorCount: Literal[1, 2] = 1
    drawerCount: int = Field(default=3, ge=1, le=5)
    drawerSplitPcts: list[float] = Field(default_factory=list)
    tallZones: Optional[list[TallZoneConfig]] = None
    sinkBowls: Optional[Literal[1, 2]] = None
    hasFaucet: Optional[bool] = None
    burnerCount: Optional[Literal[4, 5]] = None
    doorHinge: Optional[Literal["left", "right"]] = None
    doorSwing: Optional[Literal["in", "out"]] = None
    socketCount: Optional[Literal[1, 2, 3, 4]] = None


class WallRun(BaseModel):
    id: str
    name: str
    kind: Literal["wall", "island"] = "wall"
    side: Optional[Literal["north", "east", "south", "west"]] = None
    removed: Optional[bool] = None  # walls only: open side of the room
    widthCm: float = 400
    heightCm: float = 260
    countertopThicknessCm: float = 3
    items: list[KitchenItem] = Field(default_factory=list)
    # Islands only
    planX: Optional[float] = None
    planY: Optional[float] = None
    depthCm: Optional[float] = None
    rotationDeg: Optional[Literal[0, 90, 180, 270]] = None


class Room(BaseModel):
    widthCm: float = 400
    depthCm: float = 300
    heightCm: float = 260


class ProjectData(BaseModel):
    # Optional so projects saved before the plan view still load; the client migrates them.
    room: Optional[Room] = None
    walls: list[WallRun]
    activeWallId: str


def default_project_data() -> ProjectData:
    room = Room()
    sides = [
        ("A", "north", room.widthCm),
        ("B", "east", room.depthCm),
        ("C", "south", room.widthCm),
        ("D", "west", room.depthCm),
    ]
    walls = [
        WallRun(
            id=str(uuid.uuid4()), name=f"Wall {letter}", kind="wall", side=side, widthCm=length, heightCm=room.heightCm
        )
        for letter, side, length in sides
    ]
    return ProjectData(room=room, walls=walls, activeWallId=walls[0].id)


class ProjectCreate(BaseModel):
    name: str = Field(default="Untitled Kitchen", min_length=1, max_length=255)
    data: Optional[ProjectData] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    data: Optional[ProjectData] = None


class ProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    updated_at: datetime


class ProjectOut(ProjectSummary):
    data: ProjectData
    created_at: datetime
