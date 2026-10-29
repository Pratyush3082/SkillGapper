"""Start the SkillGapper local academic demo."""

from __future__ import annotations

import os
import json
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
BACKEND_PORT = 5000
FRONTEND_PORT = 5501
DATABASE_URL_DEFAULT = "sqlite:///instance/skillgapper.db"
DATABASE_URL = os.environ.get("DATABASE_URL", DATABASE_URL_DEFAULT)
database_url_explicitly_set = "DATABASE_URL" in os.environ


def initialize_default_database(database_url: str, explicitly_set: bool) -> bool:
    """Initialize the default SQLite database if it does not exist.

    This is a safe, explicit first-run setup only. It never initializes when
    the user has explicitly configured DATABASE_URL, and it never touches an
    existing database file.

    Args:
        database_url: The SQLAlchemy database URL (sqlite:///...).
        explicitly_set: Whether DATABASE_URL was set by the user (vs default).

    Returns:
        True if a new database was initialized, False otherwise.
    """
    if explicitly_set:
        return False

    if not database_url.startswith("sqlite:///"):
        return False

    db_path = Path(database_url[len("sqlite:///"):]).resolve()
    if db_path.is_file():
        return False

    db_path.parent.mkdir(parents=True, exist_ok=True)
    os.environ["DATABASE_URL"] = database_url
    os.environ["SKILLGAPPER_DB_INITIALIZE"] = "1"
    os.environ["APP_ENV"] = "development"

    from backend.app import app as flask_app, db as sqla_db

    with flask_app.app_context():
        sqla_db.create_all()

    return True


class LauncherError(RuntimeError):
    """Raised when the local demo cannot be started safely."""


def find_backend_python() -> Path:
    candidates = (
        PROJECT_ROOT / "backend.venv" / "Scripts" / "python.exe",
        PROJECT_ROOT / "backend" / ".venv" / "Scripts" / "python.exe",
    )

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    expected = ", ".join(str(path) for path in candidates)
    raise LauncherError(f"No project backend Python interpreter found. Checked: {expected}")


def find_npx() -> str:
    for command in ("npx.cmd", "npx"):
        resolved = shutil.which(command)
        if resolved:
            return resolved
    raise LauncherError("npx was not found. Install Node.js or add npx to PATH.")


def port_is_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.25)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def fetch_local_service(port: int, path: str) -> tuple[int, bytes] | None:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}{path}", timeout=0.75
        ) as response:
            return response.status, response.read(256 * 1024)
    except (urllib.error.URLError, OSError, TimeoutError):
        return None


def is_project_backend() -> bool:
    result = fetch_local_service(BACKEND_PORT, "/api/health")
    if result is None or result[0] != 200:
        return False

    try:
        payload = json.loads(result[1].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False

    return (
        isinstance(payload, dict)
        and payload.get("message") == "SkillGapper API is running"
    )


def is_project_frontend(port: int) -> bool:
    result = fetch_local_service(port, "/")
    if result is None or result[0] != 200:
        return False

    html = result[1].decode("utf-8", errors="ignore")
    return "<title>SkillGapper | Student Dashboard</title>" in html


def find_frontend_port() -> tuple[int, bool]:
    for port in range(FRONTEND_PORT, FRONTEND_PORT + 100):
        if not port_is_in_use(port):
            return port, False
        if is_project_frontend(port):
            return port, True

    raise LauncherError(
        f"No available frontend port found between {FRONTEND_PORT} and "
        f"{FRONTEND_PORT + 99}."
    )


def wait_for_service(
    process: subprocess.Popen,
    port: int,
    name: str,
    is_expected_service,
    timeout: float = 20.0,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LauncherError(
                f"{name} exited during startup with code {process.returncode}."
            )
        if port_is_in_use(port) and is_expected_service():
            return
        time.sleep(0.2)

    raise LauncherError(
        f"{name} did not expose the expected SkillGapper service on "
        f"127.0.0.1:{port} within {timeout:.0f} seconds."
    )


def stop_process(process: subprocess.Popen, name: str) -> None:
    if process.poll() is not None:
        return

    print(f"Stopping {name}...", flush=True)

    if os.name == "nt":
        # npx.cmd runs through cmd.exe, so terminate the whole descendant tree.
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        return

    process.terminate()
    try:
        process.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass

    process.kill()
    process.wait(timeout=5)


def main() -> int:
    processes: list[tuple[str, subprocess.Popen]] = []
    try:
        backend_reused = False
        frontend_port, frontend_reused = find_frontend_port()

        if port_is_in_use(BACKEND_PORT):
            if is_project_backend():
                backend_reused = True
                print(
                    "Reusing existing SkillGapper backend on port 5000.",
                    flush=True,
                )
            else:
                raise LauncherError(
                    "Port 5000 is already in use by another application; "
                    "it does not serve the SkillGapper backend. Exiting without "
                    "stopping it."
                )

        if frontend_reused:
            print(
                f"Reusing existing SkillGapper frontend on port {frontend_port}.",
                flush=True,
            )
        elif frontend_port != FRONTEND_PORT:
            print(
                f"Port {FRONTEND_PORT} is in use by another application; "
                f"using available frontend port {frontend_port}.",
                flush=True,
            )

        backend_python = find_backend_python() if not backend_reused else None
        npx = find_npx() if not frontend_reused else None

        # First-run database initialization: only for the default, unconfigured
        # DATABASE_URL. Never initialize when the user has explicitly configured
        # a database, and never touch an existing database file.
        if not backend_reused:
            initialized = initialize_default_database(
                DATABASE_URL, database_url_explicitly_set
            )
            if initialized:
                print(
                    f"Initialized new database at {DATABASE_URL}",
                    flush=True,
                )

        environment = os.environ.copy()
        environment.update(
            {
                "APP_ENV": "development",
                "LOCAL_DEMO": "1",
                "DATABASE_URL": DATABASE_URL,
            }
        )

        if not backend_reused and not environment.get("SECRET_KEY"):
            print(
                "Warning: SECRET_KEY is not set. Flask will use its existing "
                "development fallback for this run; set SECRET_KEY to preserve "
                "sessions across restarts.",
                file=sys.stderr,
                flush=True,
            )

        if not backend_reused:
            backend_command = [
                str(backend_python),
                "-m",
                "flask",
                "--app",
                "backend.app",
                "run",
                "--host",
                "localhost",
                "--port",
                str(BACKEND_PORT),
                "--no-reload",
            ]

        if not frontend_reused:
            frontend_command = [npx, "serve", "-l", str(frontend_port), "."]

        if backend_python is not None:
            print(f"Using backend interpreter: {backend_python}", flush=True)
        print("Starting SkillGapper local academic demo...", flush=True)

        if not backend_reused:
            backend = subprocess.Popen(
                backend_command,
                cwd=PROJECT_ROOT,
                env=environment,
            )
            processes.append(("backend", backend))
            wait_for_service(backend, BACKEND_PORT, "Backend", is_project_backend)

        if not frontend_reused:
            frontend = subprocess.Popen(
                frontend_command,
                cwd=PROJECT_ROOT,
                env=environment,
            )
            processes.append(("frontend", frontend))
            wait_for_service(
                frontend,
                frontend_port,
                "Frontend",
                lambda: is_project_frontend(frontend_port),
            )

        print(f"Frontend: http://localhost:{frontend_port}", flush=True)
        print("Backend:  http://127.0.0.1:5000", flush=True)
        print("Press Ctrl+C to stop both servers.", flush=True)

        while True:
            for name, process in processes:
                return_code = process.poll()
                if return_code is not None:
                    raise LauncherError(
                        f"{name.capitalize()} stopped unexpectedly with code {return_code}."
                    )
            time.sleep(0.5)

    except KeyboardInterrupt:
        print("\nShutdown requested.", flush=True)
        return 0
    except (LauncherError, OSError) as error:
        print(f"run.py: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        for name, process in reversed(processes):
            stop_process(process, name)


if __name__ == "__main__":
    raise SystemExit(main())
