from pathlib import Path
import hashlib
import joblib
import pandas as pd

MODEL_PATH = Path(
    "ml_model/jobpredictor/student_placement_model.pkl"
)

EXPECTED_HASH = (
    "D40128913C2641E62D019F148E49E7A92B77D5C88DF10281478BD6992A5152B0"
)

FEATURES = [
    "age", "cgpa", "backlogs", "internships",
    "certifications", "coding_skills",
    "communication_skills", "aptitude_score", "projects",
    "degree_BCA", "degree_BE", "degree_BSc", "degree_BTech",
    "branch_AI", "branch_CS", "branch_DS",
    "branch_Electrical", "branch_IT", "branch_Mechanical",
]


def main():
    # Verify the exact file before loading it.
    digest = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()

    print("SHA-256:", digest)

    if digest.lower() != EXPECTED_HASH.lower():
        raise RuntimeError("Model hash mismatch. Aborting.")

    print("Hash matched.")
    print("Loading model...")

    # WARNING: Loading pickle/joblib can execute arbitrary code.
    saved_data = joblib.load(MODEL_PATH)

    if not isinstance(saved_data, dict):
        raise TypeError("Unexpected model artifact structure.")

    if set(saved_data.keys()) != {"model", "features"}:
        raise ValueError("Unexpected keys in saved model.")

    model = saved_data["model"]
    features = saved_data["features"]

    if list(features) != FEATURES:
        raise ValueError(
            "Feature order mismatch.\n"
            f"Expected: {FEATURES}\n"
            f"Actual:   {features}"
        )

    if set(model.classes_) != {0, 1}:
        raise ValueError(
            f"Unexpected model classes: {model.classes_}"
        )

    # Synthetic smoke-test input; not a real student record.
    sample = {
        "age": 22,
        "cgpa": 8.1,
        "backlogs": 0,
        "internships": 1,
        "certifications": 2,
        "coding_skills": 7,
        "communication_skills": 6,
        "aptitude_score": 70,
        "projects": 3,
        "degree_BCA": 0,
        "degree_BE": 0,
        "degree_BSc": 0,
        "degree_BTech": 1,
        "branch_AI": 0,
        "branch_CS": 0,
        "branch_DS": 0,
        "branch_Electrical": 0,
        "branch_IT": 1,
        "branch_Mechanical": 0,
    }

    input_df = pd.DataFrame([sample], columns=FEATURES)
    prediction = int(model.predict(input_df)[0])

    if prediction not in (0, 1):
        raise ValueError(f"Unexpected prediction: {prediction}")

    print("Feature count:", len(features))
    print("Model classes:", list(model.classes_))
    print(
        "Prediction:",
        "PLACED" if prediction == 1 else "NOT PLACED"
    )
    print("Compatibility smoke test passed.")


if __name__ == "__main__":
    main()
