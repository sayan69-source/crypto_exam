"""
CryptoExam Core — Test Configuration
Adds the backend root to sys.path so crypto/ imports work.
"""

import sys
from pathlib import Path

# Add backend/ to path so 'from crypto.xxx import yyy' works
backend_root = Path(__file__).parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))
