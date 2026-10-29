import pandas as pd 
import numpy as np 
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler


# all the classifers
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC

# all the evalution teqniques
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix, classification_report, roc_auc_score


df = pd.read_csv("student_placement_filtered.csv")
X = df.drop("placed", axis=1)
y = df["placed"]

#data evalution
print(df.head())
print("Dataset shape:", df.shape)
print(df.tail())

# data check up 
print(df.describe())
print(df.info())
print(df.isnull().sum())

# Data visulaization

import seaborn as sns
plt.figure(figsize=(7, 5))

sns.countplot(data=df, x="placed")

plt.title("Number of Students Placed vs Not Placed")
plt.xlabel("Placement Status")
plt.ylabel("Number of Students")
plt.show()

# data categorical count 
print(df["placed"].value_counts())

#Data preprocessing

# splitting the dataset into target and features
X = df.drop("placed", axis=1)
Y = df["placed"]
# Split the dataset into training and testing sets 
X_train, X_test, y_train, y_test = train_test_split( X, y, test_size=0.3, random_state=42, stratify=y )

# Check the shapes
print("X_train shape:", X_train.shape)
print("X_test shape:", X_test.shape)
print("y_train shape:", y_train.shape)
print("y_test shape:", y_test.shape)




# processing and scaling the data
scaler = StandardScaler()
X_train = scaler.fit_transform(X_train)
X_test = scaler.transform(X_test)



# intialize , train ,predict and evalute the ml model
#==========================================================================================

# Intialize the models

models = {
    "Logistic Regression": LogisticRegression(),
    "Decision Tree": DecisionTreeClassifier(),
    "Random Forest": RandomForestClassifier(),
    "SVM": SVC()
}


# store the result in result list

results = []


models.items()


# Train and evalute the models

for name, model in models.items():

    # fit and train the models
    model.fit(X_train, y_train)

    # prediction on the training data
    train_pred = model.predict(X_train)
    test_pred = model.predict(X_test)

    results.append({
        "Models": name,
        "Training Accuracy": accuracy_score(y_train, train_pred),
        "Test Accuracy": accuracy_score(y_test, test_pred),
        "Precision Score": precision_score(y_test, test_pred),  # out of all predicted 1s, how many were actually 1
        "Recall Score": recall_score(y_test, test_pred),        # out of all actual 1s, how many were captured
        "F1 Score": f1_score(y_test, test_pred)                 # harmonic mean of precision and recall
    })
    
    
    
# convert the list "results" into dataframe
results_df = pd.DataFrame(results).sort_values(
    by="Test Accuracy",
    ascending=False
)
results_df = round(results_df,4)



# visualize the results comparison



plt.figure(figsize=(10, 6))

sns.barplot(x='Test Accuracy', y='Model', data=results_df, hue='Model')

plt.title('Model Accuracy Comparison')
plt.xlim(0.8, 1.0)  # Zoom in to see the differences
plt.show()

# Automatically pick the best model
best_model_name = results_df.iloc[0]['Model']
print(f"\n The Best Model is: {best_model_name}")


import joblib

# file names
model_file_name = "bestJobpredictor"
scaler_filename = "scaler.joblib"

# save model and scaler
joblib.dump(model, model_file_name)
joblib.dump(scaler, scaler_filename)

print("Model and scaler saved successfully!")








