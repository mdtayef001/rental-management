"""Vercel's entry point for the Django backend.

Vercel's Python runtime looks for a module under `api/` and serves whatever it finds in
`app`. Everything the project needs sits one directory up, so the backend root goes on
`sys.path` before Django is imported — the function runs with `api/` as the module's home,
not the project root, and `config.settings` would not be importable otherwise.

`vercel.json` routes every path here, so this one function answers the whole API, and the
real routing still happens in `config/urls.py`. It uses the `routes`/`dest` form rather
than `rewrites`: a rewrite replaces the path the function is handed, so Django would see
`/api/index` for every request and answer 404 to all of them, including `/admin/`.
"""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config.wsgi import application as app  # noqa: E402

__all__ = ["app"]
