"""
Test configuration for notebooklm_add_urls.py

Mocks the notebooklm package so tests run without it installed.
"""
import sys
import os
from unittest.mock import MagicMock

# Create real exception classes for isinstance checks in tests
class RPCError(Exception):
    pass

class SourceAddError(Exception):
    pass

class RateLimitError(Exception):
    pass

# Build mock notebooklm module
mock_notebooklm = MagicMock()
mock_exceptions = MagicMock()
mock_exceptions.RPCError = RPCError
mock_exceptions.SourceAddError = SourceAddError
mock_exceptions.RateLimitError = RateLimitError

sys.modules["notebooklm"] = mock_notebooklm
sys.modules["notebooklm.exceptions"] = mock_exceptions

# Add scripts dir to path so tests can import the script
sys.path.insert(0, os.path.dirname(__file__))
