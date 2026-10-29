import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.exc import SQLAlchemyError

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "frontend-config-test")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as skillgapper_app


class FrontendDevServerConfigTests(unittest.TestCase):
    def test_rebuilt_database_and_sqlite_sidecars_are_ignored_by_live_server(self):
        settings_path = Path(__file__).resolve().parent.parent / ".vscode" / "settings.json"
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        ignored_paths = settings["liveServer.settings.ignoreFiles"]

        for file_name in (
            "skillgapper.db",
            "skillgapper.db-journal",
            "skillgapper.db-shm",
            "skillgapper.db-wal"
        ):
            with self.subTest(file_name=file_name):
                self.assertIn(
                    f"database-rebuild-20261023/{file_name}",
                    ignored_paths
                )

    def test_loopback_frontend_ports_receive_credentialed_cors_headers(self):
        client = skillgapper_app.app.test_client()

        for origin in ("http://localhost:5501", "http://127.0.0.1:5501"):
            with self.subTest(origin=origin):
                response = client.options(
                    "/api/login",
                    headers={
                        "Origin": origin,
                        "Access-Control-Request-Method": "POST",
                        "Access-Control-Request-Headers": "content-type",
                    },
                )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.headers.get("Access-Control-Allow-Origin"),
                    origin,
                )
                self.assertEqual(
                    response.headers.get("Access-Control-Allow-Credentials"),
                    "true",
                )

    def test_login_database_failure_returns_json_instead_of_html(self):
        client = skillgapper_app.app.test_client()

        with skillgapper_app.app.app_context():
            with patch.object(skillgapper_app.User, "query") as query:
                query.filter_by.side_effect = SQLAlchemyError(
                    "database disk image is malformed"
                )
                response = client.post(
                    "/api/login",
                    json={
                        "email": "user@example.com",
                        "password": "password123",
                    },
                )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.content_type, "application/json")
        self.assertEqual(
            response.get_json(),
            {"error": "Unable to sign in right now. Please try again later."},
        )
        self.assertNotIn("database disk image", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
