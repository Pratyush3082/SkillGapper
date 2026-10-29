
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import joblib
import time

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report,
    roc_auc_score
)

# ==========================================
# 1. Load Dataset
# ==========================================

start_time = time.time()

df = pd.read_csv("dataset/student_placement_filtered.csv")

print("Dataset Loaded Successfully!")
print("Dataset Shape:", df.shape)
print(df.head())

# ==========================================
# 2. Check Dataset
# ==========================================

if "placed" not in df.columns:
    raise ValueError("Target column 'placed' is missing.")

if df.isnull().any().any():
    raise ValueError(
        "Dataset contains missing values. Please handle them first."
    )

if not all(
    pd.api.types.is_numeric_dtype(dtype)
    for dtype in df.drop(columns=["placed"]).dtypes
):
    raise ValueError(
        "All feature columns must be numeric."
    )

if not set(df["placed"].unique()).issubset({0, 1}):
    raise ValueError(
        "The 'placed' column must contain only 0 and 1."
    )

if df["placed"].nunique() != 2:
    raise ValueError(
        "The target column must contain both classes: 0 and 1."
    )

print("\nMissing Values:")
print(df.isnull().sum())

print("\nPlacement Distribution:")
print(df["placed"].value_counts())

# ==========================================
# 3. Prepare Features and Target
# ==========================================

X = df.drop(columns=["placed"])
y = df["placed"]

# ==========================================
# 4. Split Dataset
# ==========================================

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)

print("\nTraining Data:", X_train.shape)
print("Testing Data:", X_test.shape)

# ==========================================
# 5. Initialize Fast Random Forest
# ==========================================

model = RandomForestClassifier(
    n_estimators=100,
    max_depth=15,
    min_samples_leaf=2,
    random_state=42,
    n_jobs=-1
)

# ==========================================
# 6. Train Model
# ==========================================

print("\nTraining Model...")

model.fit(X_train, y_train)

print("Model Training Completed!")

# ==========================================
# 7. Make Predictions
# ==========================================

train_predictions = model.predict(X_train)
test_predictions = model.predict(X_test)

test_probabilities = model.predict_proba(X_test)[:, 1]

# ==========================================
# 8. Evaluate Model
# ==========================================

train_accuracy = accuracy_score(
    y_train, train_predictions
)

test_accuracy = accuracy_score(
    y_test, test_predictions
)

precision = precision_score(
    y_test, test_predictions, zero_division=0
)

recall = recall_score(
    y_test, test_predictions, zero_division=0
)

f1 = f1_score(
    y_test, test_predictions, zero_division=0
)

roc_auc = roc_auc_score(
    y_test, test_probabilities
)

print("\n========== MODEL PERFORMANCE ==========")

print(f"Training Accuracy: {train_accuracy:.4f}")
print(f"Testing Accuracy:  {test_accuracy:.4f}")
print(f"Precision Score:   {precision:.4f}")
print(f"Recall Score:      {recall:.4f}")
print(f"F1 Score:          {f1:.4f}")
print(f"ROC-AUC Score:     {roc_auc:.4f}")

# ==========================================
# 9. Classification Report
# ==========================================

print("\n========== CLASSIFICATION REPORT ==========")

print(
    classification_report(
        y_test,
        test_predictions,
        zero_division=0
    )
)

# ==========================================
# 10. Confusion Matrix
# ==========================================

cm = confusion_matrix(y_test, test_predictions)

print("\nConfusion Matrix:")
print(cm)

plt.figure(figsize=(6, 4))

sns.heatmap(
    cm,
    annot=True,
    fmt="d",
    cmap="Blues",
    xticklabels=["Not Placed", "Placed"],
    yticklabels=["Not Placed", "Placed"]
)

plt.title("Student Placement - Confusion Matrix")
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.tight_layout()
plt.show()

# ==========================================
# 11. Feature Importance
# ==========================================

importance = pd.DataFrame({
    "Feature": X.columns,
    "Importance": model.feature_importances_
}).sort_values(
    by="Importance",
    ascending=False
)

print("\n========== FEATURE IMPORTANCE ==========")
print(importance.to_string(index=False))

plt.figure(figsize=(9, 5))

sns.barplot(
    data=importance.head(10),
    x="Importance",
    y="Feature"
)

plt.title("Top 10 Important Features")
plt.tight_layout()
plt.show()

# ==========================================
# 12. Save Trained Model
# ==========================================

joblib.dump(
    {
        "model": model,
        "features": list(X.columns)
    },
    "student_placement_model.pkl"
)

print("\nModel Saved Successfully!")
print("File: student_placement_model.pkl")

# ==========================================
# 13. Training Time
# ==========================================

end_time = time.time()

print(
    f"\nTotal Execution Time: {end_time - start_time:.2f} seconds"
)

print("\nStudent Placement Prediction System Ready!")

