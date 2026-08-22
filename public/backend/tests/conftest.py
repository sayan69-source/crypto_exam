"""
CryptoExam Core — Test Configuration
Adds the backend root to sys.path so crypto/ imports work, and pins the test
run to its own database.
"""

import os
import sys
from pathlib import Path

# Add backend/ to path so 'from crypto.xxx import yyy' works
backend_root = Path(__file__).parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

# Point the suite at a dedicated database BEFORE anything imports app.config —
# `get_settings` is cached, and app.database builds its engine at import time,
# so this has to happen here, in conftest, to take effect at all.
#
# Without it the tests run against DATABASE_URL's default, `./cryptoexam.db`:
# the same file the dev server uses. A fixture that calls `Base.metadata.
# drop_all` in teardown then deletes every table in the developer's database —
# which is exactly what happened, emptying a seeded DB mid-session and leaving
# the running API answering "no such table". Pointed at a real DATABASE_URL
# (a server shell, a mis-set CI variable) the same teardown drops that instead.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_cryptoexam.db")
