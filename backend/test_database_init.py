"""Tests for safe first-run database initialization in run.py.

Uses temporary file-based SQLite databases only. Never touches real project
databases.
"""

import os
import sys
import tempfile
import unittest
import sqlite3
from pathlib import Path

# Add project root and backend directory to path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, BACKEND_DIR)

os.environ["SECRET_KEY"] = "test-secret-key"

import run as run_module  # noqa: E402


class TestDatabaseInit(unittest.TestCase):
    """Tests for safe first-run database initialization."""

    def setUp(self):
        self.temp_dirs = []

    def tearDown(self):
        import shutil
        for d in self.temp_dirs:
            shutil.rmtree(d, ignore_errors=True)

    def _temp_db_url(self):
        d = tempfile.mkdtemp(prefix="sg_test_")
        self.temp_dirs.append(d)
        return f"sqlite:///{os.path.join(d, 'test.db')}"

    def _tables(self, db_path):
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        conn.close()
        return {r[0] for r in rows}

    def test_default_url_is_instance_path(self):
        """Default DATABASE_URL uses the instance/ pattern for fresh clones."""
        self.assertEqual(
            run_module.DATABASE_URL_DEFAULT,
            "sqlite:///instance/skillgapper.db",
        )

    def test_fresh_installation_creates_database_with_tables(self):
        """Missing default DB -> initialize_default_database creates it with tables."""
        db_url = self._temp_db_url()
        db_path = Path(db_url[len("sqlite:///"):])
        self.assertFalse(db_path.is_file())

        result = run_module.initialize_default_database(
            db_url, explicitly_set=False
        )

        self.assertTrue(result)
        self.assertTrue(db_path.is_file())
        tables = self._tables(db_path)
        self.assertIn("user", tables)
        self.assertIn("assessment", tables)
        self.assertIn("post", tables)

    def test_existing_database_preserved(self):
        """Existing DB -> initialize_default_database returns False, no changes."""
        db_url = self._temp_db_url()
        db_path = Path(db_url[len("sqlite:///"):])
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE IF NOT EXISTS preexisting (id INTEGER PRIMARY KEY)")
        conn.commit()
        conn.close()

        result = run_module.initialize_default_database(
            db_url, explicitly_set=False
        )

        self.assertFalse(result)
        tables = self._tables(db_path)
        self.assertIn("preexisting", tables)
        self.assertNotIn("user", tables)

    def test_explicit_database_url_not_initialized(self):
        """explicitly_set=True -> returns False even if the file is missing."""
        db_url = self._temp_db_url()
        self.assertFalse(Path(db_url[len("sqlite:///"):]).is_file())

        result = run_module.initialize_default_database(
            db_url, explicitly_set=True
        )

        self.assertFalse(result)
        self.assertFalse(Path(db_url[len("sqlite:///"):]).is_file())

    def test_non_sqlite_url_not_initialized(self):
        """Non-sqlite URL -> returns False without touching the filesystem."""
        result = run_module.initialize_default_database(
            "postgresql://user:pass@localhost/mydb", explicitly_set=False
        )
        self.assertFalse(result)

    def test_missing_database_without_init_raises(self):
        """Importing app with missing DB and no init mode raises RuntimeError."""
        db_url = self._temp_db_url()
        db_path = Path(db_url[len("sqlite:///"):])
        self.assertFalse(db_path.is_file())

        os.environ["DATABASE_URL"] = db_url
        os.environ.pop("SKILLGAPPER_DB_INITIALIZE", None)

        # Remove cached modules for a clean import of app.py
        for mod_name in list(sys.modules.keys()):
            if mod_name in ("app", "backend.app") or mod_name.startswith("backend.app"):
                del sys.modules[mod_name]
        if "placement_predictor" in sys.modules:
            del sys.modules["placement_predictor"]

        sys.path.insert(0, BACKEND_DIR)
        with self.assertRaises(RuntimeError) as ctx:
            import app as missing_app  # noqa: F811
            _ = missing_app.app

        self.assertIn("does not exist", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
