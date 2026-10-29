# Placement Model Validation Report

## Scope

This report evaluates whether the repository contains enough material to reproduce the placement model's training mechanics and assess its data quality. It does not approve the existing `student_placement_model.pkl`, change `MODEL_VERIFIED`, or claim production accuracy.

## Reproduction Findings

The available process is:

1. Read `dataset/placement.csv`.
2. Drop `student_id`, `gender`, `company_type`, and `package_lpa`.
3. Remove duplicate rows and rows with missing values.
4. Keep only `placed` labels in `{0, 1}`.
5. One-hot encode `degree` and `branch`.
6. Split with `test_size=0.20`, `random_state=42`, and `stratify=y`.
7. Train `RandomForestClassifier(n_estimators=100, max_depth=15, min_samples_leaf=2, random_state=42, n_jobs=-1)`.
8. Report accuracy, precision, recall, F1, ROC-AUC, and a confusion matrix.
9. Serialize `{"model": model, "features": list(X.columns)}`.

`FinalTrainedModel.py` contains this current pipeline. `dataprep.py` contains the preprocessing mechanics. `predict.py` confirms the serialized dictionary format. `prototypeTrainTestModel.py` is an older, non-equivalent experiment: it uses a 70/30 split and scaling, has a model-column naming bug, and serializes the last loop model rather than the selected best model.

The repository does not contain a label-generation script, a complete dependency lockfile, a training log, a signed artifact, or an independent validation dataset. The mechanics are reproducible, but the provenance of the existing artifact is not.

## Dataset and Leakage Findings

The raw dataset contains 12,000 records and has no exact duplicate rows. The filtered dataset also has 12,000 records, no exact duplicate feature vectors, and no conflicting duplicate labels.

The target is deterministic in the available data:

```text
placed = 1 when coding_skills >= 5
             and aptitude_score >= 60
             and cgpa >= 6.5
```

This rule has zero mismatches across all 12,000 records. In the raw data, `placed` is also exactly equivalent to `package_lpa > 0`. `company_type` is missing for every negative record and present for every positive record. Those two post-outcome fields are dropped before the current model is trained, but their presence confirms outcome-derived information in the source dataset.

A depth-3 decision tree reproduces every label on the fixed stratified split. The serialized random forest also predicts the filtered dataset with 100% accuracy, precision, recall, and F1. These metrics are consistent with synthetic or rule-generated labels and must not be interpreted as real-world placement performance.

There is no evidence of ordinary duplicate-row train/test contamination. However, a random holdout from the same rule-generated dataset is not independent validation and cannot establish generalization to real students or employers.

## Experimental Workflow

`reproducible_validation.py` is a non-production workflow. It:

- Reads the raw CSV and applies explicit preprocessing.
- Excludes post-outcome and identifier columns before splitting.
- Asserts the binary target and fixed feature order.
- Records the observed label-rule mismatch count.
- Uses a fixed stratified 80/20 holdout with `random_state=42`.
- Trains a separate validation forest with fixed parameters and `n_jobs=1`.
- Writes only to `experimental_output/`.
- Emits `experimental_model.joblib`, `metrics.json`, and `manifest.json`.
- Does not load, overwrite, or modify `student_placement_model.pkl`.

The direct dependencies used for the local validation run are pinned in `experimental_requirements.txt`. No packages were installed by this validation work.

Run only in an approved isolated environment with:

```powershell
.\backend\.venv\Scripts\python.exe ml_model\jobpredictor\reproducible_validation.py
```

The resulting holdout remains an internal synthetic-data check. It is not external validation.

The local run produced:

```text
train_rows=9600
holdout_rows=2400
train_accuracy=1.0
holdout_accuracy=1.0
holdout_precision=1.0
holdout_recall=1.0
holdout_f1=1.0
holdout_roc_auc=1.0
label_rule_mismatches=0
```

These results are expected from the deterministic target rule and are not production-readiness evidence.

## Requirements Before Activation

Do not enable `MODEL_VERIFIED` until all of the following are available:

- An independently authenticated artifact provenance record or signed artifact.
- Exact training environment and transitive dependency lockfile.
- The source that generated `placed`, or trustworthy labels independent of `package_lpa` and the retained-input rule.
- An untouched, independently collected validation dataset with documented label semantics.
- A security review or approved isolated loading process for the pickle/joblib artifact.

Until then, the API must remain fail-closed with `MODEL_VERIFIED=False`.
