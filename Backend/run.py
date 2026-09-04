"""Convenience launcher: `python run.py`.

Watches .env as well as the source, because uvicorn's reloader only tracks
.py files by default - editing a key and seeing no change is a confusing
five minutes nobody needs to spend twice.
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        reload_includes=[".env"],
    )
