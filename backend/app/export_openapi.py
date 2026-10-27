"""Write the API's OpenAPI schema to a file; the frontend generates its API types from it.

Usage (from backend/): python -m app.export_openapi ../frontend/src/generated/openapi.json
"""

import json
import sys
from pathlib import Path

from .main import app


def openapi_json() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    Path(sys.argv[1]).write_text(openapi_json())
