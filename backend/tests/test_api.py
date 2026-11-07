import uuid
from pathlib import Path

from app.export_openapi import openapi_json

OPENAPI_PATH = Path(__file__).parents[2] / "frontend" / "src" / "generated" / "openapi.json"


def base_cabinet(**overrides):
    return {
        "id": "item-1",
        "category": "base_cabinet",
        "x": 0,
        "y": 0,
        "width": 60,
        "height": 87,
        "depth": 60,
        **overrides,
    }


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_create_default_project(client):
    res = client.post("/api/projects", json={})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Untitled Kitchen"
    data = body["data"]
    assert data["room"] == {"widthCm": 400, "depthCm": 300, "heightCm": 260}
    assert [(w["name"], w["side"], w["widthCm"]) for w in data["walls"]] == [
        ("Wall A", "north", 400),
        ("Wall B", "east", 300),
        ("Wall C", "south", 400),
        ("Wall D", "west", 300),
    ]
    assert data["activeWallId"] == data["walls"][0]["id"]
    # None values are left out of responses rather than sent as null.
    assert "removed" not in data["walls"][0]


def test_crud_roundtrip(client):
    created = client.post("/api/projects", json={"name": "Flat"}).json()
    pid = created["id"]

    data = created["data"]
    data["walls"][0]["items"].append(base_cabinet(label="Sink base", noCountertop=True))
    res = client.put(f"/api/projects/{pid}", json={"name": "Flat v2", "data": data})
    assert res.status_code == 200

    loaded = client.get(f"/api/projects/{pid}").json()
    assert loaded["name"] == "Flat v2"
    item = loaded["data"]["walls"][0]["items"][0]
    assert item["label"] == "Sink base"
    assert item["drawerCount"] == 3  # filled from the schema default
    assert item["noCountertop"] is True

    listed = client.get("/api/projects").json()
    assert [(p["id"], p["name"]) for p in listed] == [(pid, "Flat v2")]
    assert "data" not in listed[0]

    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_rename_keeps_data(client):
    created = client.post("/api/projects", json={}).json()
    client.put(f"/api/projects/{created['id']}", json={"name": "Renamed"})
    loaded = client.get(f"/api/projects/{created['id']}").json()
    assert loaded["data"] == created["data"]


def test_list_is_newest_first(client):
    first = client.post("/api/projects", json={"name": "first"}).json()
    client.post("/api/projects", json={"name": "second"})
    client.put(f"/api/projects/{first['id']}", json={"name": "first, edited"})
    assert [p["name"] for p in client.get("/api/projects").json()] == ["first, edited", "second"]


def test_missing_project_is_404(client):
    missing = uuid.uuid4()
    assert client.get(f"/api/projects/{missing}").status_code == 404
    assert client.put(f"/api/projects/{missing}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/projects/{missing}").status_code == 404


def test_rejects_invalid_data(client):
    pid = client.post("/api/projects", json={}).json()["id"]
    data = client.get(f"/api/projects/{pid}").json()["data"]

    data["walls"][0]["items"] = [base_cabinet(category="spaceship")]
    assert client.put(f"/api/projects/{pid}", json={"data": data}).status_code == 422

    data["walls"][0]["items"] = [base_cabinet(drawerCount=9)]
    assert client.put(f"/api/projects/{pid}", json={"data": data}).status_code == 422

    assert client.put(f"/api/projects/{pid}", json={"name": ""}).status_code == 422


def test_accepts_legacy_data_without_room(client):
    """Projects saved before the plan view have no room; the client migrates them on load."""
    data = {
        "walls": [{"id": "w1", "name": "Wall A", "items": [base_cabinet(depth=None)]}],
        "activeWallId": "w1",
    }
    res = client.post("/api/projects", json={"name": "Old", "data": data})
    assert res.status_code == 201
    assert "room" not in res.json()["data"]


def test_generated_openapi_is_up_to_date():
    """The frontend's API types are generated from this file; see ISSUES.md #7."""
    assert OPENAPI_PATH.read_text() == openapi_json(), (
        "Schema changed: from backend/ run `.venv/bin/python -m app.export_openapi "
        "../frontend/src/generated/openapi.json`, then `npm run gen:api` in frontend/"
    )


def test_room_outline_round_trip(client):
    """Feature #6: an L-shaped outline and each wall's segment survive save and load."""
    outline = [
        {"x": 0, "y": 0},
        {"x": 400, "y": 0},
        {"x": 400, "y": 150},
        {"x": 250, "y": 150},
        {"x": 250, "y": 300},
        {"x": 0, "y": 300},
    ]
    data = {
        "room": {"widthCm": 400, "depthCm": 300, "heightCm": 260, "outline": outline},
        "walls": [{"id": f"w{i}", "name": f"Wall {chr(65 + i)}", "segment": i, "items": []} for i in range(6)],
        "activeWallId": "w0",
    }
    pid = client.post("/api/projects", json={"name": "L", "data": data}).json()["id"]
    loaded = client.get(f"/api/projects/{pid}").json()["data"]
    assert loaded["room"]["outline"] == [{"x": float(p["x"]), "y": float(p["y"])} for p in outline]
    assert [w["segment"] for w in loaded["walls"]] == list(range(6))


def test_room_outline_needs_four_corners(client):
    data = {
        "room": {"outline": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}]},
        "walls": [],
        "activeWallId": "",
    }
    assert client.post("/api/projects", json={"name": "bad", "data": data}).status_code == 422


def test_partition_round_trip(client):
    """Feature #10: a partition's two faces and the host's joint item survive save and load."""
    created = client.post("/api/projects", json={"name": "T"}).json()
    data = created["data"]
    host = data["walls"][0]
    host["items"] = [base_cabinet(id="joint-p1", category="partition_joint", x=195, width=10, height=260, depth=0)]
    for face in ("a", "b"):
        data["walls"].append(
            {
                "id": f"p1{face}",
                "name": f"Partition 1 · {face.upper()}",
                "kind": "partition",
                "partitionId": "p1",
                "face": face,
                "hostId": host["id"],
                "hostX": 195,
                "widthCm": 120,
                "items": [],
            }
        )
    pid = created["id"]
    assert client.put(f"/api/projects/{pid}", json={"data": data}).status_code == 200
    loaded = client.get(f"/api/projects/{pid}").json()["data"]
    faces = [w for w in loaded["walls"] if w["kind"] == "partition"]
    assert [(w["face"], w["hostId"], w["hostX"]) for w in faces] == [("a", host["id"], 195), ("b", host["id"], 195)]
    assert loaded["walls"][0]["items"][0]["category"] == "partition_joint"
