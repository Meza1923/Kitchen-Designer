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
    data["walls"][0]["items"].append(base_cabinet(label="Sink base"))
    res = client.put(f"/api/projects/{pid}", json={"name": "Flat v2", "data": data})
    assert res.status_code == 200

    loaded = client.get(f"/api/projects/{pid}").json()
    assert loaded["name"] == "Flat v2"
    item = loaded["data"]["walls"][0]["items"][0]
    assert item["label"] == "Sink base"
    assert item["drawerCount"] == 3  # filled from the schema default

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
