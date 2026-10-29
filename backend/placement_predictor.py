"""Placement prediction using the existing trained model."""

import math
import hashlib
import os
from pathlib import Path

import joblib


MODEL_PATH = (
    Path(__file__).resolve().parent.parent
    / "ml_model"
    / "jobpredictor"
    / "student_placement_model.pkl"
)

EXPECTED_MODEL_SHA256 = (
    "D40128913C2641E62D019F148E49E7A92B77D5C88DF10281478BD6992A5152B0"
)

# Keep prediction disabled until integration tests pass.
MODEL_VERIFIED = False

NUMERIC_FIELDS = (
    "age", "cgpa", "backlogs", "internships", "certifications",
    "coding_skills", "communication_skills", "aptitude_score", "projects"
)

INTEGER_FIELDS = frozenset({
    "age", "backlogs", "internships", "certifications",
    "coding_skills", "communication_skills", "aptitude_score", "projects"
})

DEGREE_FEATURES = {
    "BCA": "degree_BCA",
    "BE": "degree_BE",
    "BSc": "degree_BSc",
    "BTech": "degree_BTech"
}

BRANCH_FEATURES = {
    "AI": "branch_AI",
    "CS": "branch_CS",
    "DS": "branch_DS",
    "Electrical": "branch_Electrical",
    "IT": "branch_IT",
    "Mechanical": "branch_Mechanical"
}

FEATURE_ORDER = (
    *NUMERIC_FIELDS,
    "degree_BCA", "degree_BE", "degree_BSc", "degree_BTech",
    "branch_AI", "branch_CS", "branch_DS",
    "branch_Electrical", "branch_IT", "branch_Mechanical"
)

REQUEST_FIELDS = frozenset((*NUMERIC_FIELDS, "degree", "branch"))


class PlacementInputError(ValueError):
    """Raised when submitted placement inputs are invalid."""


class PlacementModelError(RuntimeError):
    """Raised when the placement model cannot safely make a prediction."""


def validate_and_encode(payload):
    if not isinstance(payload, dict):
        raise PlacementInputError("Request body must be a JSON object.")

    missing = REQUEST_FIELDS - payload.keys()
    extra = payload.keys() - REQUEST_FIELDS

    if missing:
        raise PlacementInputError(
            f"Missing required fields: {', '.join(sorted(missing))}."
        )
    if extra:
        raise PlacementInputError(
            f"Unexpected fields: {', '.join(sorted(extra))}."
        )

    features = {}

    for field in NUMERIC_FIELDS:
        value = payload[field]

        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PlacementInputError(f"{field} must be a finite number.")

        try:
            number = float(value)
        except (OverflowError, TypeError, ValueError) as error:
            raise PlacementInputError(
                f"{field} must be a finite number."
            ) from error

        if not math.isfinite(number):
            raise PlacementInputError(f"{field} must be a finite number.")

        if field in INTEGER_FIELDS and not number.is_integer():
            raise PlacementInputError(f"{field} must be an integer.")

        features[field] = int(number) if field in INTEGER_FIELDS else number

    degree = payload["degree"]
    branch = payload["branch"]

    if not isinstance(degree, str) or degree not in DEGREE_FEATURES:
        raise PlacementInputError("degree must be one of the listed options.")

    if not isinstance(branch, str) or branch not in BRANCH_FEATURES:
        raise PlacementInputError("branch must be one of the listed options.")

    selected_degree = DEGREE_FEATURES[degree]
    selected_branch = BRANCH_FEATURES[branch]

    for feature in DEGREE_FEATURES.values():
        features[feature] = int(feature == selected_degree)

    for feature in BRANCH_FEATURES.values():
        features[feature] = int(feature == selected_branch)

    return {feature: features[feature] for feature in FEATURE_ORDER}


def load_placement_model():
    """Load the model only after checking its expected file hash."""
    if not MODEL_PATH.is_file():
        raise PlacementModelError("Placement model file was not found.")

    digest = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()

    if digest.lower() != EXPECTED_MODEL_SHA256.lower():
        raise PlacementModelError("Placement model integrity check failed.")

    # Only load a trusted artifact. Pickle-based files can execute code.
    try:
        artifact = joblib.load(MODEL_PATH)
    except Exception as error:
        raise PlacementModelError("Placement model could not be loaded.") from error

    if not isinstance(artifact, dict):
        raise PlacementModelError("Unexpected model artifact format.")

    if not {"model", "features"}.issubset(artifact):
        raise PlacementModelError("Required model data is missing.")

    model = artifact["model"]
    model_features = tuple(artifact["features"])

    if model_features != FEATURE_ORDER:
        raise PlacementModelError("Model feature order does not match the API.")

    if not callable(getattr(model, "predict", None)):
        raise PlacementModelError("Model does not support prediction.")

    if set(model.classes_.tolist()) != {0, 1}:
        raise PlacementModelError("Unexpected model output classes.")

    return model


def predict_placement(features, model):
    """Return a binary placement prediction from encoded features."""
    if tuple(features) != FEATURE_ORDER:
        raise PlacementModelError("Input feature order does not match the model.")

    try:
        import pandas as pd

        row = pd.DataFrame(
            [[features[name] for name in FEATURE_ORDER]],
            columns=FEATURE_ORDER
        )
        prediction = int(model.predict(row)[0])
    except Exception as error:
        raise PlacementModelError("Placement prediction failed.") from error

    if prediction not in (0, 1):
        raise PlacementModelError("Model returned an unexpected prediction.")

    return {
        "prediction": prediction,
        "label": "PLACED" if prediction == 1 else "NOT PLACED"
    }