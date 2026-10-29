# SkillGapper

SkillGapper is a full-stack student career-development dashboard built with Flask (backend) and vanilla JavaScript/HTML/CSS (frontend). It helps students assess their skills, track learning progress, explore career paths, practice for interviews, and chat with an AI Mentor powered by a local Ollama model.

## Features

- **User Authentication**: Signup, login, logout, and profile management with hashed passwords (Flask-Bcrypt).
- **Dashboard**: Personalized home view with learning progress stats and quick actions.
- **Skill Assessment**: Self-assessment ratings and knowledge quizzes for target careers (Full-Stack Developer, Python Developer, Data Analyst).
- **Learning Progress**: Track learning tasks, roadmap items, and completion status per skill.
- **Community Posts**: Create, like, edit, and delete community posts.
- **AI Mentor Workspace**: Chat with a local AI mentor (Ollama) across multiple modes — general guidance, skill analysis, learning roadmap, mock interview, coding practice, resume review, and placement prep.
- **Conversation History**: Save, search, rename, and delete AI Mentor conversations with per-user localStorage persistence.
- **Placement Prediction**: ML-based placement outcome prediction (disabled until integration tests pass; `MODEL_VERIFIED = False`).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Flask 3.1.3, Flask-SQLAlchemy, Flask-CORS, Flask-Bcrypt |
| Database | SQLite (SQLAlchemy ORM) |
| Frontend | Vanilla JavaScript, HTML5, CSS3 (served via `npx serve`) |
| ML Model | scikit-learn model serialized with joblib/pickle |
| AI Mentor | Local Ollama (llama3.2:3b or compatible model) |
| Testing | pytest |

## Architecture and Folder Structure

```
SkillGapper/
├── .github/                  # GitHub workflows (optional, not included)
├── .gitignore                # Git ignore rules
├── .env.example              # Example environment configuration (copy to .env)
├── README.md                 # This file
├── run.py                    # Launcher: starts Flask backend + npx serve frontend
├── index.html                # Main dashboard (frontend entry)
├── login.html                # Login page
├── signup.html               # Signup page
├── forgot-password.html      # Password recovery page
├── placement-prediction.html # Placement prediction page
├── script.js                 # Main frontend application logic
├── style.css                 # Main stylesheet
├── auth.js                   # Authentication form handlers
├── auth.css                  # Authentication styles
├── placement-prediction.js   # Placement prediction page logic
├── placement-prediction.css  # Placement prediction styles
├── test_existing_model.py    # Model validation script
├── check_braces.py           # Development utility (brace checker)
├── check_brace_depth.py      # Development utility (brace depth checker)
├── find_unclosed.py          # Development utility (unclosed construct finder)
├── backend/
│   ├── app.py                # Flask application (routes, models, Ollama integration)
│   ├── placement_predictor.py # Placement prediction model wrapper
│   ├── init_database.py      # Database initialization and schema verification
│   ├── requirements.txt      # Python dependencies
│   ├── test_chat.py          # AI Mentor chat API tests
│   ├── test_assessment.py    # Assessment and progress API tests
│   ├── test_placement_prediction.py # Placement prediction tests
│   ├── test_frontend_dev_config.py # Frontend config tests
│   ├── .venv/                # Python virtual environment (gitignored)
│   └── __pycache__/          # Python bytecode cache (gitignored)
├── ml_model/
│   └── jobpredictor/
│       ├── student_placement_model.pkl  # Trained placement model (included)
│       ├── scaler.joblib                # Feature scaler (included)
│       ├── best jobpredictor.joblib     # Best model variant (included)
│       ├── dataprep.py                  # Data preparation utilities
│       ├── predict.py                   # Standalone prediction script
│       ├── FinalTrainedModel.py         # Final model training reference
│       ├── prototypeTrainTestModel.py   # Prototype training script
│       ├── reproducible_validation.py   # Validation script
│       ├── dataset/
│       │   ├── placement.csv            # Training dataset (gitignored)
│       │   └── student_placement_filtered.csv
│       └── experimental_output/         # Experimental results (gitignored)
├── database-rebuild-20261023/   # Local SQLite database (gitignored — user data)
├── database-recovery-20261023/  # Database recovery artifacts (gitignored)
└── backend/.venv/               # Virtual environment (gitignored)
```

## Prerequisites

- **Python 3.10+** (tested with Python 3.13.7)
- **pip** (Python package manager)
- **Node.js** with `npx` (for serving the frontend static files)
- **Ollama** (for AI Mentor chat — see "Ollama Setup" below)
- **Git** (optional, for version control)

## Installation Instructions (Windows)

### 1. Clone or Download the Repository

```bash
# If you have Git:
git clone <your-repository-url>
cd SkillGapper

# Or download and extract the ZIP, then open the folder.
```

### 2. Set Up the Backend Virtual Environment

```powershell
# Create the virtual environment inside the backend folder
python -m venv backend/.venv

# Activate it
backend\.venv\Scripts\Activate.ps1

# If PowerShell blocks script execution, run:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# Then re-run the activation command above.
```

### 3. Install Python Dependencies

```powershell
# With the virtual environment activated:
pip install -r backend/requirements.txt

# If you also want the ML validation dependencies:
pip install -r ml_model/jobpredictor/experimental_requirements.txt
```

### 4. Configure Environment Variables

```powershell
# Copy the example environment file
Copy-Item .env.example .env

# Edit .env with your own values:
# - Set SECRET_KEY to a strong random string
# - Set DATABASE_URL to your desired SQLite path
# - Set OLLAMA_MODEL to an installed Ollama model (e.g., llama3.2:3b)
```

Generate a strong secret key:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

### 5. Ollama Setup (AI Mentor)

The AI Mentor requires a local Ollama installation with a compatible model.

1. **Install Ollama**: Download from https://ollama.com and follow the Windows installation instructions.
2. **Start Ollama**: Run `ollama serve` or start the Ollama app from the Start menu.
3. **Pull a model**:

```bash
ollama pull llama3.2:3b
```

Other supported models: `qwen3:4b-instruct`, `qwen3:4b`, `qwen3:8b`.

4. **Verify the model is installed**:

```bash
ollama list
```

5. **Update `.env`** with your chosen model:

```
OLLAMA_MODEL=llama3.2:3b
```

### 6. Initialize the Database (Fresh Clone)

On a fresh clone, `run.py` automatically initializes a new SQLite database at
`instance/skillgapper.db` the first time it starts. No manual database setup is
required for the default configuration.

```powershell
# With the virtual environment activated:
python run.py
```

The launcher detects that `instance/skillgapper.db` does not exist, creates the
`instance/` directory, and initializes the schema using `db.create_all()`. The
`instance/` directory is gitignored, so your local database is never committed.

**To use a different database location**, set `DATABASE_URL` explicitly before
running `run.py`. When `DATABASE_URL` is set, `run.py` never performs automatic
initialization — you are responsible for creating and maintaining that database:

```powershell
$env:DATABASE_URL="sqlite:///C:/path/to/your/skillgapper.db"
$env:SECRET_KEY="your-secret-key"
python run.py
```

**To manually initialize or verify a database** (for the existing rebuild path),
use the provided initialization script:

```powershell
# Only works with the approved rebuild database path
python backend/init_database.py --database-url "sqlite:///database-rebuild-20261023/skillgapper.db" --verify-existing
```

The initialization script refuses to target any path outside the approved rebuild
directory and will not overwrite an existing database without `--verify-existing`.

## How to Start the Project

### Using the Launcher (Recommended)

```powershell
# With the virtual environment activated:
python run.py
```

This will:
1. Start the Flask backend on `http://127.0.0.1:5000`
2. Start the frontend via `npx serve` on an available port (default 5501)
3. Wait for both services to be ready
4. Print the frontend and backend URLs

Press `Ctrl+C` to stop both servers.

### Manual Start

**Backend** (terminal 1):
```powershell
$env:APP_ENV="development"
$env:LOCAL_DEMO="1"
$env:DATABASE_URL="sqlite:///instance/skillgapper.db"
$env:SECRET_KEY="your-secret-key"
python -m flask --app backend.app run --host localhost --port 5000 --no-reload
```

**Frontend** (terminal 2):
```powershell
npx serve -l 5501 .
```

## How to Access the Application

| Service | URL |
|---------|-----|
| Frontend Dashboard | `http://localhost:5501` (or the port shown by `run.py`) |
| Backend API | `http://127.0.0.1:5000` |
| Health Check | `http://127.0.0.1:5000/api/health` |

First-time users should:
1. Visit the frontend URL.
2. Click **Sign Up** to create an account.
3. Log in with your credentials.
4. Open the **AI Mentor** workspace from the dashboard.

## How to Run Tests

Backend tests are written with pytest. With the virtual environment activated:

```powershell
# Install pytest if not already installed
pip install pytest

# Set required environment variables
$env:DATABASE_URL="sqlite:///instance/skillgapper.db"
$env:SECRET_KEY="test-secret-key"

# Run all backend tests
python -m pytest backend/test_chat.py backend/test_assessment.py backend/test_placement_prediction.py backend/test_frontend_dev_config.py -v

# Run a specific test file
python -m pytest backend/test_chat.py -v
```

Note: The placement prediction model is disabled by default (`MODEL_VERIFIED = False` in `backend/placement_predictor.py`) until integration tests pass.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `DATABASE_URL must be set explicitly` | Set `DATABASE_URL` in `.env` or export it before running the app. |
| `No project backend Python interpreter found` | Ensure `backend/.venv/Scripts/python.exe` exists. Recreate the venv if needed. |
| `npx was not found` | Install Node.js and ensure `npx` is on your PATH. |
| `AI Mentor is not configured` | Set `OLLAMA_MODEL` in `.env` to an installed Ollama model and start Ollama. |
| `AI Mentor is unavailable right now` | Ensure Ollama is running (`ollama serve`) and the model is pulled (`ollama pull llama3.2:3b`). |
| `Authentication required` on `/api/chat` | Log in through the frontend first; the chat endpoint requires a valid session cookie. |
| Port 5000 already in use | Another application is using port 5000. Stop it or configure a different backend port. |
| PowerShell execution policy blocked | Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` then retry. |

## Current Limitations

- **Placement prediction** is disabled (`MODEL_VERIFIED = False`) until integration tests pass.
- **Database initialization** requires manual setup via `init_database.py`; no auto-migration on first run.
- **Frontend** is served as static files via `npx serve` — not a production-grade web server.
- **AI Mentor** requires a local Ollama installation; no cloud LLM fallback.
- **Conversation history** is stored in browser localStorage, not on the server — history is tied to the browser and device.
- **Deployment** has not been tested on production infrastructure; this is a local academic demo.

## Screenshots

> _Screenshots coming soon. Add images to a `/docs/screenshots` folder and reference them here._

| Dashboard | AI Mentor | Placement Prediction |
|-----------|-----------|----------------------|
| ![Dashboard](./docs/screenshots/dashboard.png) | ![AI Mentor](./docs/screenshots/ai-mentor.png) | ![Placement](./docs/screenshots/placement.png) |

## License

SkillGapper is released under the [MIT License](LICENSE).

Copyright (c) 2026 Pratyush Singh

## Development Utilities

The project root includes several development helper scripts:

- `check_braces.py` — Brace balance checker for JavaScript
- `check_brace_depth.py` — Brace depth analyzer for JavaScript
- `find_unclosed.py` — Unclosed construct finder for JavaScript
- `test_existing_model.py` — ML model validation script

These are development aids and are not required to run the application.
