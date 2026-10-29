import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as placement_app
import placement_predictor

from placement_predictor import (
    FEATURE_ORDER,
    MODEL_VERIFIED,
    PlacementInputError,
    PlacementModelError,
    validate_and_encode,
    load_placement_model,
    predict_placement,
)


VALID_INPUT = {
    "age": 22,
    "cgpa": 8.2,
    "backlogs": 0,
    "internships": 1,
    "certifications": 2,
    "coding_skills": 7,
    "communication_skills": 6,
    "aptitude_score": 70,
    "projects": 3,
    "degree": "BTech",
    "branch": "CS",
}


class PlacementPredictionTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        placement_app.app.config.update(TESTING=True)

    @classmethod
    def tearDownClass(cls):
        with placement_app.app.app_context():
            placement_app.db.session.remove()
            placement_app.db.engine.dispose()

    def setUp(self):
        with placement_app.app.app_context():
            placement_app.db.session.remove()
            placement_app.db.drop_all()
            placement_app.db.create_all()

        self.client = placement_app.app.test_client()

        response = self.client.post(
            "/api/signup",
            json={
                "name": "Placement Test User",
                "email": "placement-test@example.com",
                "password": "password123",
            },
        )

        self.assertEqual(response.status_code, 201)

    def test_feature_order_and_dropdown_mapping_match_model_contract(self):
        features = validate_and_encode(VALID_INPUT)

        self.assertEqual(tuple(features), FEATURE_ORDER)
        self.assertEqual(len(features), 19)
        self.assertEqual(features["degree_BTech"], 1)
        self.assertEqual(features["branch_CS"], 1)
        self.assertEqual(features["cgpa"], 8.2)
        self.assertEqual(features["age"], 22)

        degree_features = [
            "degree_BCA",
            "degree_BE",
            "degree_BSc",
            "degree_BTech",
        ]

        branch_features = [
            "branch_AI",
            "branch_CS",
            "branch_DS",
            "branch_Electrical",
            "branch_IT",
            "branch_Mechanical",
        ]

        self.assertEqual(
            sum(features[name] for name in degree_features), 1
        )
        self.assertEqual(
            sum(features[name] for name in branch_features), 1
        )

    def test_input_schema_rejects_missing_extra_nonfinite_and_wrong_types(self):
        invalid_payloads = []

        missing = dict(VALID_INPUT)
        missing.pop("cgpa")
        invalid_payloads.append(missing)

        invalid_payloads.append({**VALID_INPUT, "user_id": 999})

        for field, value in (
            ("age", True),
            ("age", 22.5),
            ("cgpa", float("nan")),
            ("coding_skills", "7"),
            ("degree", "PhD"),
            ("branch", "Unknown"),
        ):
            payload = dict(VALID_INPUT)
            payload[field] = value
            invalid_payloads.append(payload)

        invalid_payloads.extend([None, [], "not an object"])

        for payload in invalid_payloads:
            with self.subTest(payload=repr(payload)):
                with self.assertRaises(PlacementInputError):
                    validate_and_encode(payload)

    def test_endpoint_requires_auth_validates_input_and_fails_closed_with_503(self):
        anonymous = placement_app.app.test_client()

        response = anonymous.post(
            "/api/placement-prediction",
            json=VALID_INPUT,
        )
        self.assertEqual(response.status_code, 401)

        invalid = dict(VALID_INPUT)
        invalid["degree"] = "Unknown"

        response = self.client.post(
            "/api/placement-prediction",
            json=invalid,
        )
        self.assertEqual(response.status_code, 400)

        spoofed_identity = {**VALID_INPUT, "user_id": 12345}

        response = self.client.post(
            "/api/placement-prediction",
            json=spoofed_identity,
        )
        self.assertEqual(response.status_code, 400)

        self.assertFalse(MODEL_VERIFIED)

        response = self.client.post(
            "/api/placement-prediction",
            json=VALID_INPUT,
        )

        self.assertEqual(response.status_code, 503)
        self.assertIn("provenance", response.get_json()["error"])

        with placement_app.app.app_context():
            self.assertEqual(placement_app.Assessment.query.count(), 0)
            self.assertEqual(placement_app.LearningTask.query.count(), 0)

    def test_local_demo_is_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LOCAL_DEMO", None)
            with patch.object(placement_app, "RUNTIME_ENV", "development"):
                with patch.object(placement_app, "load_placement_model") as load_model:
                    response = self.client.post(
                        "/api/placement-prediction",
                        json=VALID_INPUT,
                    )

        self.assertEqual(response.status_code, 503)
        load_model.assert_not_called()

    def test_local_demo_is_ignored_outside_development(self):
        with patch.dict(os.environ, {"LOCAL_DEMO": "1"}):
            with patch.object(placement_app, "RUNTIME_ENV", "production"):
                response = self.client.post(
                    "/api/placement-prediction",
                    json=VALID_INPUT,
                )

        self.assertEqual(response.status_code, 503)

    def test_local_demo_still_requires_authentication(self):
        anonymous = placement_app.app.test_client()

        with patch.dict(os.environ, {"LOCAL_DEMO": "1"}):
            with patch.object(placement_app, "RUNTIME_ENV", "development"):
                response = anonymous.post(
                    "/api/placement-prediction",
                    json=VALID_INPUT,
                )

        self.assertEqual(response.status_code, 401)

    def test_local_demo_rejects_invalid_input_before_loading_model(self):
        invalid = dict(VALID_INPUT)
        invalid["cgpa"] = "8.2"

        with patch.dict(os.environ, {"LOCAL_DEMO": "1"}):
            with patch.object(placement_app, "RUNTIME_ENV", "development"):
                with patch.object(placement_app, "load_placement_model") as load_model:
                    response = self.client.post(
                        "/api/placement-prediction",
                        json=invalid,
                    )

        self.assertEqual(response.status_code, 400)
        load_model.assert_not_called()

    def test_local_demo_returns_prediction_from_existing_model(self):
        with patch.dict(os.environ, {"LOCAL_DEMO": "1"}):
            with patch.object(placement_app, "RUNTIME_ENV", "development"):
                response = self.client.post(
                    "/api/placement-prediction",
                    json=VALID_INPUT,
                )

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn(data["prediction"], (0, 1))
        self.assertIn(data["label"], ("PLACED", "NOT PLACED"))
        self.assertIn("Academic prototype", data["disclaimer"])

    @patch("app.load_placement_model")
    def test_local_demo_model_loading_failure_returns_503(self, load_model):
        load_model.side_effect = PlacementModelError("simulated hash failure")

        with patch.dict(os.environ, {"LOCAL_DEMO": "1"}):
            with patch.object(placement_app, "RUNTIME_ENV", "development"):
                response = self.client.post(
                    "/api/placement-prediction",
                    json=VALID_INPUT,
                )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {"error": "Unable to generate a placement prediction."},
        )

    def test_model_loads_and_predicts_valid_input(self):
        features = validate_and_encode(VALID_INPUT)
        model = load_placement_model()

        result = predict_placement(features, model)

        self.assertIn(result["prediction"], (0, 1))
        self.assertIn(result["label"], ("PLACED", "NOT PLACED"))

        expected_label = (
            "PLACED"
            if result["prediction"] == 1
            else "NOT PLACED"
        )

        self.assertEqual(result["label"], expected_label)

    @patch("app.MODEL_VERIFIED", True)
    @patch("app.load_placement_model")
    @patch("app.predict_placement")
    def test_endpoint_returns_success_when_prediction_works(
        self, mock_predict, mock_load_model
    ):
        mock_load_model.return_value = object()

        mock_predict.return_value = {
            "prediction": 1,
            "label": "PLACED",
        }

        response = self.client.post(
            "/api/placement-prediction",
            json=VALID_INPUT,
        )

        self.assertEqual(response.status_code, 200)

        data = response.get_json()

        self.assertEqual(data["prediction"], 1)
        self.assertEqual(data["label"], "PLACED")
        self.assertIn("disclaimer", data)

        mock_load_model.assert_called_once()
        mock_predict.assert_called_once()

    def test_model_loading_failure_raises_safe_error(self):
        with patch.object(
            placement_predictor,
            "joblib",
        ) as mock_joblib:

            mock_joblib.load.side_effect = RuntimeError(
                "simulated model-loading failure"
            )

            with self.assertRaises(PlacementModelError):
                load_placement_model()


if __name__ == "__main__":
    unittest.main()
