
import pandas as pd

# Load dataset
df = pd.read_csv("placement.csv")

# Remove unnecessary columns
df = df.drop(columns=[
    "student_id",
    "gender",
    "company_type",
    "package_lpa"
])

# Remove duplicate rows
df = df.drop_duplicates()

# Remove rows with missing values
df = df.dropna()

# Filter invalid placement labels
df = df[df["placed"].isin([0, 1])]

# Convert categorical columns into numerical columns
df = pd.get_dummies(df, columns=["degree", "branch"], dtype=int)

# Save filtered dataset
df.to_csv("student_placement_filtered.csv", index=False)

print("Filtered CSV created successfully!")
print(df.head())
print("Dataset shape:", df.shape)

