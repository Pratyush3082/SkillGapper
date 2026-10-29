
import joblib
import pandas as pd

# Load your trained model
saved_data = joblib.load("student_placement_model.pkl")

model = saved_data["model"]
features = saved_data["features"]

print("\nStudent Placement Prediction")

# Enter student details
student_data = []

for feature in features:
    value = float(input(f"Enter {feature}: "))
    student_data.append(value)

# Make prediction
input_data = pd.DataFrame([student_data], columns=features)

prediction = model.predict(input_data)[0]

# Display result
if prediction == 1:
    print("\nResult: Student is predicted to be PLACED.")
else:
    print("\nResult: Student is predicted to be NOT PLACED.")

