"""Train and evaluate an experimental placement model without touching production.

This workflow never loads or overwrites the existing student_placement_model.pkl.
It writes only to ml_model/jobpredictor/experimental_output/.
"""

from __future__ import annotations

import hashlib
import json
import platform
import sys
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split


ROOT = Path(__file__).resolve().parent
RAW_PATH = ROOT / "dataset" / "placement.csv"
FILTERED_PATH = ROOT / "dataset" / "student_placement_filtered.csv"
OUTPUT_PATH = ROOT / "experimental_output"

NUMERIC_FIELDS = (
    "age", "cgpa", "backlogs", "internships", "certifications",
    "coding_skills", "communication_skills", "aptitude_score", "projects",
)
DEGREE_FIELDS = ("degree_BCA", "degree_BE", "degree_BSc", "degree_BTech")
BRANCH_FIELDS = (
    "branch_AI", "branch_CS", "branch_DS",
    "branch_Electrical", "branch_IT", "branch_Mechanical",
)
FEATURE_ORDER = (*NUMERIC_FIELDS, *DEGREE_FIELDS, *BRANCH_FIELDS)
EXPECTED_COLUMNS = (*FEATURE_ORDER, "placed")
DROP_COLUMNS = ("student_id", "gender", "company_type", "package_lpa")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_and_preprocess() -> tuple[pd.DataFrame, list[str]]:
    raw = pd.read_csv(RAW_PATH)
    required = set((*DROP_COLUMNS, *NUMERIC_FIELDS, "degree", "branch", "placed"))
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f"Raw dataset is missing columns: {sorted(missing)}")

    frame = raw.drop(columns=list(DROP_COLUMNS))
    frame = frame.drop_duplicates().dropna()
    frame = frame[frame["placed"].isin([0, 1])].copy()
    frame = pd.get_dummies(frame, columns=["degree", "branch"], dtype=int)
    frame = frame.reindex(columns=list(EXPECTED_COLUMNS), fill_value=0)

    if frame.empty:
        raise ValueError("Preprocessing produced no rows.")
    if frame[list(FEATURE_ORDER)].isna().any().any():
        raise ValueError("Preprocessing produced missing feature values.")
    if set(frame["placed"].unique()) != {0, 1}:
        raise ValueError("The target must contain exactly classes 0 and 1.")

    return frame, list(FEATURE_ORDER)


def main() -> None:
    frame, features = load_and_preprocess()
    reference = pd.read_csv(FILTERED_PATH).reindex(columns=list(EXPECTED_COLUMNS), fill_value=0)
    preprocessing_matches_reference = frame.equals(reference)
    X = frame[features]
    y = frame["placed"].astype(int)

    label_rule = (
        (frame["coding_skills"] >= 5)
        & (frame["aptitude_score"] >= 60)
        & (frame["cgpa"] >= 6.5)
    ).astype(int)
    label_rule_mismatches = int((label_rule != y).sum())

    X_train, X_holdout, y_train, y_holdout = train_test_split(
        X,
        y,
        test_size=0.20,
        random_state=42,
        stratify=y,
    )

    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=15,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=1,
    )
    model.fit(X_train, y_train)

    train_predictions = model.predict(X_train)
    holdout_predictions = model.predict(X_holdout)
    holdout_probabilities = model.predict_proba(X_holdout)[:, 1]

    metrics = {
        "train_rows": len(X_train),
        "holdout_rows": len(X_holdout),
        "train_accuracy": accuracy_score(y_train, train_predictions),
        "holdout_accuracy": accuracy_score(y_holdout, holdout_predictions),
        "holdout_precision": precision_score(y_holdout, holdout_predictions),
        "holdout_recall": recall_score(y_holdout, holdout_predictions),
        "holdout_f1": f1_score(y_holdout, holdout_predictions),
        "holdout_roc_auc": roc_auc_score(y_holdout, holdout_probabilities),
        "label_rule_mismatches": label_rule_mismatches,
        "preprocessing_matches_reference": preprocessing_matches_reference,
        "warning": (
            "The holdout is sampled from the same dataset and is not independent "
            "real-world validation."
        ),
    }

    manifest = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "source_raw": str(RAW_PATH.relative_to(ROOT)),
        "source_raw_sha256": sha256(RAW_PATH),
        "source_filtered_reference": str(FILTERED_PATH.relative_to(ROOT)),
        "source_filtered_reference_sha256": sha256(FILTERED_PATH),
        "features": features,
        "dropped_columns": list(DROP_COLUMNS),
        "split": {"test_size": 0.20, "random_state": 42, "stratified": True},
        "model": {
            "class": "RandomForestClassifier",
            "n_estimators": 100,
            "max_depth": 15,
            "min_samples_leaf": 2,
            "random_state": 42,
            "n_jobs": 1,
        },
        "production_model_touched": False,
    }

    OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": features}, OUTPUT_PATH / "experimental_model.joblib")
    (OUTPUT_PATH / "metrics.json").write_text(
        json.dumps(metrics, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (OUTPUT_PATH / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(json.dumps(metrics, indent=2, sort_keys=True))
    print(f"experimental_output={OUTPUT_PATH}")


if __name__ == "__main__":
    main()
