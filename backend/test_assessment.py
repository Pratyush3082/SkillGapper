import os
import subprocess
import sys
import tempfile
import unittest
from collections import Counter
from datetime import datetime
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
sys.path.insert(0, os.path.dirname(__file__))

import app as assessment_app


class AssessmentApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assessment_app.app.config.update(TESTING=True)

    @classmethod
    def tearDownClass(cls):
        with assessment_app.app.app_context():
            assessment_app.db.session.remove()
            assessment_app.db.engine.dispose()

    def setUp(self):
        with assessment_app.app.app_context():
            assessment_app.db.session.remove()
            assessment_app.db.drop_all()
            assessment_app.db.create_all()
        self.client = assessment_app.app.test_client()
        self.email_counter = getattr(self.__class__, "_email_counter", 0) + 1
        self.__class__._email_counter = self.email_counter
        self.email = f"assessment-test-{self.email_counter}@example.com"
        response = self.client.post(
            "/api/signup",
            json={
                "name": "Assessment Tester",
                "email": self.email,
                "password": "password123"
            }
        )
        self.assertEqual(response.status_code, 201)

    def test_relative_sqlite_url_uses_configured_working_directory(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            database_path = temporary_root / "data" / "skillgapper.db"
            database_path.parent.mkdir()
            database_path.touch()

            environment = os.environ.copy()
            environment["DATABASE_URL"] = "sqlite:///data/skillgapper.db"
            environment["APP_ENV"] = "development"
            environment["PYTHONPATH"] = str(Path(__file__).resolve().parent)
            probe = (
                "from app import app, db\n"
                "context = app.app_context()\n"
                "context.push()\n"
                "print(db.engine.url.database)\n"
                "context.pop()\n"
            )

            result = subprocess.run(
                [sys.executable, "-c", probe],
                cwd=temporary_root,
                env=environment,
                capture_output=True,
                text=True,
                check=True
            )

            self.assertEqual(
                Path(result.stdout.strip()),
                database_path.resolve()
            )

    def start_assessment(self, career_key="python_developer"):
        response = self.client.post(
            "/api/assessment/start",
            json={"career_key": career_key}
        )
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def rate_assessment(self, assessment_id, career_key):
        ratings = {
            skill["key"]: 3
            for skill in assessment_app.CAREER_CONFIG[career_key]["skills"]
        }
        response = self.client.post(
            f"/api/assessment/{assessment_id}/self-assessment",
            json={"ratings": ratings}
        )
        self.assertEqual(response.status_code, 200)

    def complete_assessment_with_roadmap(self, career_key="python_developer"):
        result = self.start_assessment(career_key)
        self.rate_assessment(result["assessment_id"], career_key)
        answers = {
            question["key"]: self.wrong_option(question)
            for question in result["questions"]
        }
        response = self.client.post(
            f"/api/assessment/{result['assessment_id']}/quiz",
            json={"answers": answers}
        )
        self.assertEqual(response.status_code, 201)
        return result["assessment_id"]

    @staticmethod
    def wrong_option(question):
        answers = "abcd"
        correct = next(
            item["answer"]
            for item in assessment_app.QUIZ_QUESTIONS
            if item["key"] == question["key"]
        )
        return next(option for option in answers if option != correct)

    def test_question_bank_and_public_payload(self):
        counts = Counter(question["skill_key"] for question in assessment_app.QUIZ_QUESTIONS)
        self.assertEqual(len(assessment_app.QUIZ_QUESTIONS), 30)
        self.assertTrue(all(count >= 5 for count in counts.values()))
        self.assertTrue(all(len(question["options"]) == 4 for question in assessment_app.QUIZ_QUESTIONS))
        for career_key, career in assessment_app.CAREER_CONFIG.items():
            self.assertEqual(
                len(assessment_app.questions_for_career(career_key)),
                len(career["skills"]) * 5
            )

        result = self.start_assessment("full_stack_developer")
        self.assertEqual(len(result["questions"]), 30)
        self.assertTrue(all("answer" not in question for question in result["questions"]))
        self.assertTrue(all("correct_option" not in question for question in result["questions"]))

        with assessment_app.app.app_context():
            assigned = assessment_app.AssessmentQuestion.query.filter_by(
                assessment_id=result["assessment_id"]
            ).all()
        self.assertEqual(len(assigned), 30)
        self.assertTrue(all(row.correct_option for row in assigned))

    def test_complete_scoring_and_skill_results(self):
        result = self.start_assessment()
        self.rate_assessment(result["assessment_id"], "python_developer")
        answers = {}

        for index, question in enumerate(result["questions"]):
            answers[question["key"]] = (
                next(item["answer"] for item in assessment_app.QUIZ_QUESTIONS if item["key"] == question["key"])
                if index < 2
                else self.wrong_option(question)
            )

        response = self.client.post(
            f"/api/assessment/{result['assessment_id']}/quiz",
            json={"answers": answers}
        )
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertEqual(payload["summary"]["total_questions"], 10)
        self.assertEqual(payload["summary"]["correct_answers"], 2)
        self.assertEqual(payload["summary"]["incorrect_answers"], 8)
        self.assertEqual(payload["summary"]["unanswered_questions"], 0)
        self.assertEqual(payload["summary"]["overall_percent"], 20.0)
        self.assertEqual(len(payload["skills"]), 2)
        self.assertTrue(all(skill["quiz_total"] == 5 for skill in payload["skills"]))
        result_fields = {
            "quiz_attempted",
            "quiz_correct",
            "quiz_incorrect",
            "quiz_unanswered",
            "quiz_percent",
            "self_rating",
            "estimated_level",
            "required_level",
            "gap",
            "priority_reason"
        }
        self.assertTrue(all(result_fields <= set(skill) for skill in payload["skills"]))
        with assessment_app.app.app_context():
            answer_count = assessment_app.QuizAnswer.query.count()
        self.assertEqual(answer_count, 10)

        persisted = self.client.get(
            f"/api/assessment/{result['assessment_id']}/results"
        )
        self.assertEqual(persisted.status_code, 200)
        self.assertEqual(
            persisted.get_json()["summary"]["overall_percent"],
            20.0
        )

    def test_incomplete_submission_persists_unanswered_questions(self):
        result = self.start_assessment()
        self.rate_assessment(result["assessment_id"], "python_developer")
        first_question = result["questions"][0]
        answers = {
            first_question["key"]: next(
                item["answer"]
                for item in assessment_app.QUIZ_QUESTIONS
                if item["key"] == first_question["key"]
            )
        }

        response = self.client.post(
            f"/api/assessment/{result['assessment_id']}/quiz",
            json={"answers": answers}
        )
        self.assertEqual(response.status_code, 201)
        summary = response.get_json()["summary"]
        self.assertEqual(summary["correct_answers"], 1)
        self.assertEqual(summary["incorrect_answers"], 0)
        self.assertEqual(summary["unanswered_questions"], 9)
        with assessment_app.app.app_context():
            answer_count = assessment_app.QuizAnswer.query.count()
            unanswered_count = assessment_app.QuizAnswer.query.filter_by(
                selected_option=""
            ).count()
        self.assertEqual(answer_count, 10)
        self.assertEqual(unanswered_count, 9)

    def test_invalid_answers_and_ownership_are_rejected(self):
        result = self.start_assessment()
        self.rate_assessment(result["assessment_id"], "python_developer")
        invalid = self.client.post(
            f"/api/assessment/{result['assessment_id']}/quiz",
            json={"answers": {result["questions"][0]["key"]: "z"}}
        )
        self.assertEqual(invalid.status_code, 400)

        other_client = assessment_app.app.test_client()
        other_signup = other_client.post(
            "/api/signup",
            json={
                "name": "Other User",
                "email": "other-owner@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(other_signup.status_code, 201)
        forbidden = other_client.get(
            f"/api/assessment/{result['assessment_id']}/results"
        )
        self.assertEqual(forbidden.status_code, 404)

        unauthenticated = assessment_app.app.test_client().post(
            "/api/assessment/start",
            json={"career_key": "python_developer"}
        )
        self.assertEqual(unauthenticated.status_code, 401)

    def test_scoring_conversion_edges(self):
        self.assertIsNone(assessment_app.quiz_level_from_score(0, 0))
        self.assertEqual(assessment_app.quiz_level_from_score(0, 5), 0)
        self.assertEqual(assessment_app.quiz_level_from_score(1, 5), 1)
        self.assertEqual(assessment_app.quiz_level_from_score(5, 5), 5)
        self.assertEqual(assessment_app.rounded_half_up(2.5), 3)

    def test_historical_nine_question_results_remain_nine(self):
        with assessment_app.app.app_context():
            user = assessment_app.User.query.filter_by(email=self.email).first()
            assessment = assessment_app.Assessment(
                user_id=user.id,
                career_key="full_stack_developer",
                career_name="Full-Stack Developer",
                self_completed=True,
                quiz_completed=True,
                completed_at=datetime.utcnow()
            )
            assessment_app.db.session.add(assessment)
            assessment_app.db.session.flush()

            ratings = {
                skill["key"]: 3
                for skill in assessment_app.CAREER_CONFIG["full_stack_developer"]["skills"]
            }
            assessment_app.db.session.add_all([
                assessment_app.SelfRating(
                    assessment_id=assessment.id,
                    skill_key=skill_key,
                    rating=rating
                )
                for skill_key, rating in ratings.items()
            ])

            attempt = assessment_app.QuizAttempt(
                assessment_id=assessment.id,
                score=2,
                total_questions=9
            )
            assessment_app.db.session.add(attempt)
            assessment_app.db.session.flush()

            legacy_questions = [
                ("html_semantic_element", "html", False),
                ("css_flex_alignment", "css", False),
                ("javascript_const", "javascript", False),
                ("javascript_dom_event", "javascript", True),
                ("python_list_index", "python", False),
                ("python_dictionary_lookup", "python", False),
                ("sql_filter_rows", "sql", True),
                ("sql_join_tables", "sql", False),
                ("react_component", "react", False)
            ]
            assessment_app.db.session.add_all([
                assessment_app.QuizAnswer(
                    attempt_id=attempt.id,
                    question_key=question_key,
                    skill_key=skill_key,
                    selected_option="a",
                    is_correct=is_correct
                )
                for question_key, skill_key, is_correct in legacy_questions
            ])

            totals = Counter(skill_key for _, skill_key, _ in legacy_questions)
            correct = Counter(skill_key for _, skill_key, is_correct in legacy_questions if is_correct)
            for career_skill in assessment_app.CAREER_CONFIG["full_stack_developer"]["skills"]:
                skill_key = career_skill["key"]
                skill_correct = correct[skill_key]
                target = career_skill["target_level"]
                combined = 3
                assessment_app.db.session.add(assessment_app.AssessmentResult(
                    assessment_id=assessment.id,
                    skill_key=skill_key,
                    skill_name=assessment_app.SKILL_LIBRARY[skill_key]["name"],
                    target_level=target,
                    self_rating=3,
                    quiz_level=assessment_app.quiz_level_from_score(skill_correct, totals[skill_key]),
                    quiz_correct=skill_correct,
                    quiz_total=totals[skill_key],
                    combined_level=combined,
                    gap=max(target - combined, 0),
                    priority_level="High" if target > combined else "Strength",
                    priority_reason="Historical result preserved."
                ))
            assessment_app.db.session.commit()
            assessment_id = assessment.id

        response = self.client.get("/api/assessment/latest")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["assessment"]["id"], assessment_id)
        self.assertEqual(payload["summary"]["total_questions"], 9)
        self.assertEqual(payload["summary"]["correct_answers"], 2)
        self.assertEqual(payload["summary"]["incorrect_answers"], 7)
        self.assertEqual(payload["summary"]["unanswered_questions"], 0)
        self.assertEqual(sum(skill["quiz_total"] for skill in payload["skills"]), 9)
        self.assertTrue(all("quiz_attempted" in skill for skill in payload["skills"]))

    def test_legacy_incomplete_assessment_cannot_be_rescored_without_snapshot(self):
        with assessment_app.app.app_context():
            user = assessment_app.User.query.filter_by(email=self.email).first()
            assessment = assessment_app.Assessment(
                user_id=user.id,
                career_key="full_stack_developer",
                career_name="Full-Stack Developer",
                self_completed=True
            )
            assessment_app.db.session.add(assessment)
            assessment_app.db.session.commit()
            assessment_id = assessment.id

        response = self.client.post(
            f"/api/assessment/{assessment_id}/quiz",
            json={"answers": {}}
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("Start a new assessment", response.get_json()["error"])

    def test_learning_tasks_are_created_once_and_statuses_persist(self):
        assessment_id = self.complete_assessment_with_roadmap()

        first = self.client.get("/api/learning-progress")
        self.assertEqual(first.status_code, 200)
        payload = first.get_json()
        self.assertEqual(payload["summary"]["total_tasks"], 2)
        self.assertEqual(payload["summary"]["not_started_tasks"], 2)
        self.assertEqual(payload["summary"]["completion_percentage"], 0)
        self.assertEqual(len(payload["tasks"]), 2)
        self.assertTrue(all(task["assessment_id"] == assessment_id for task in payload["tasks"]))
        self.assertTrue(all(task["status"] == "Not Started" for task in payload["tasks"]))
        self.assertEqual(len(payload["skills"]), 2)

        second = self.client.get("/api/learning-progress")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(second.get_json()["tasks"]), 2)
        with assessment_app.app.app_context():
            self.assertEqual(assessment_app.LearningTask.query.count(), 2)

        task_ids = [task["id"] for task in payload["tasks"]]
        for status in ("In Progress", "Completed", "Not Started"):
            response = self.client.patch(
                f"/api/learning-progress/{task_ids[0]}",
                json={"status": status}
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                next(task for task in response.get_json()["tasks"] if task["id"] == task_ids[0])["status"],
                status
            )

        completed = self.client.patch(
            f"/api/learning-progress/{task_ids[0]}",
            json={"status": "Completed"}
        )
        self.assertEqual(completed.status_code, 200)
        completed_payload = completed.get_json()
        self.assertEqual(completed_payload["summary"]["completed_tasks"], 1)
        self.assertEqual(completed_payload["summary"]["not_started_tasks"], 1)
        self.assertEqual(completed_payload["summary"]["completion_percentage"], 50.0)
        self.assertTrue(all("completion_percentage" in skill for skill in completed_payload["skills"]))

        persisted = self.client.get("/api/learning-progress")
        self.assertEqual(persisted.status_code, 200)
        persisted_payload = persisted.get_json()
        self.assertEqual(persisted_payload["summary"], completed_payload["summary"])
        with assessment_app.app.app_context():
            self.assertEqual(
                assessment_app.db.session.get(assessment_app.LearningTask, task_ids[0]).status,
                "Completed"
            )

        invalid = self.client.patch(
            f"/api/learning-progress/{task_ids[0]}",
            json={"status": "Paused"}
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(
            self.client.get("/api/learning-progress").get_json()["summary"]["completed_tasks"],
            1
        )

    def test_learning_progress_requires_auth_and_enforces_ownership(self):
        assessment_id = self.complete_assessment_with_roadmap()
        progress = self.client.get("/api/learning-progress").get_json()
        task_id = progress["tasks"][0]["id"]

        other_client = assessment_app.app.test_client()
        signup = other_client.post(
            "/api/signup",
            json={
                "name": "Progress Owner Two",
                "email": "progress-owner-two@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(signup.status_code, 201)
        self.assertEqual(other_client.get("/api/learning-progress").status_code, 200)
        self.assertEqual(
            other_client.get("/api/learning-progress").get_json()["summary"]["total_tasks"],
            0
        )
        self.assertEqual(
            other_client.patch(
                f"/api/learning-progress/{task_id}",
                json={"status": "Completed"}
            ).status_code,
            404
        )
        self.assertEqual(
            assessment_app.app.test_client().get("/api/learning-progress").status_code,
            401
        )

        with assessment_app.app.app_context():
            self.assertEqual(
                assessment_app.LearningTask.query.filter_by(
                    assessment_id=assessment_id
                ).count(),
                2
            )

    def test_notification_api_auth_ownership_and_read_status(self):
        assessment_id = self.complete_assessment_with_roadmap()
        listed = self.client.get("/api/notifications")
        self.assertEqual(listed.status_code, 200)
        payload = listed.get_json()
        self.assertEqual(payload["unread_count"], 2)
        self.assertEqual(
            {item["kind"] for item in payload["notifications"]},
            {"assessment_completed", "roadmap_available"}
        )
        notification_id = payload["notifications"][0]["id"]

        other_client = assessment_app.app.test_client()
        signup = other_client.post(
            "/api/signup",
            json={
                "name": "Notification Owner Two",
                "email": "notification-owner-two@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(signup.status_code, 201)
        self.assertEqual(other_client.get("/api/notifications").get_json()["notifications"], [])
        self.assertEqual(
            other_client.get("/api/notifications/unread-count").get_json()["unread_count"],
            0
        )
        self.assertEqual(
            other_client.post(f"/api/notifications/{notification_id}/read").status_code,
            404
        )

        marked = self.client.post(f"/api/notifications/{notification_id}/read")
        self.assertEqual(marked.status_code, 200)
        self.assertTrue(marked.get_json()["notification"]["is_read"])
        self.assertEqual(marked.get_json()["unread_count"], 1)
        repeated = self.client.post(f"/api/notifications/{notification_id}/read")
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.get_json()["unread_count"], 1)

        read_all = self.client.post("/api/notifications/read-all")
        self.assertEqual(read_all.status_code, 200)
        self.assertEqual(read_all.get_json()["unread_count"], 0)
        self.assertTrue(all(
            item["is_read"]
            for item in self.client.get("/api/notifications").get_json()["notifications"]
        ))
        self.assertEqual(
            self.client.get("/api/notifications/unread-count").get_json()["unread_count"],
            0
        )

        unauthenticated = assessment_app.app.test_client()
        self.assertEqual(unauthenticated.get("/api/notifications").status_code, 401)
        self.assertEqual(unauthenticated.get("/api/notifications/unread-count").status_code, 401)
        self.assertEqual(unauthenticated.post("/api/notifications/read-all").status_code, 401)
        self.assertEqual(
            unauthenticated.post(f"/api/notifications/{notification_id}/read").status_code,
            401
        )
        with assessment_app.app.app_context():
            self.assertEqual(
                assessment_app.Assessment.query.filter_by(id=assessment_id).count(),
                1
            )

    def test_profile_loading_update_validation_and_relogin_persistence(self):
        initial = self.client.get("/api/me")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(
            set(initial.get_json()["user"]),
            {"id", "name", "email"}
        )
        self.assertNotIn("password_hash", initial.get_json()["user"])

        updated = self.client.patch("/api/me", json={"name": "Updated Assessment Tester"})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["user"]["name"], "Updated Assessment Tester")
        self.assertEqual(updated.get_json()["user"]["email"], self.email)
        self.assertEqual(self.client.get("/api/me").get_json()["user"]["name"], "Updated Assessment Tester")

        invalid_inputs = [{}, {"name": ""}, {"name": " \n 	"}, {"name": 7}, {"name": "n" * 101}]
        for payload in invalid_inputs:
            with self.subTest(payload=repr(payload)):
                response = self.client.patch("/api/me", json=payload)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/me").get_json()["user"]["name"], "Updated Assessment Tester")

        other_client = assessment_app.app.test_client()
        other_signup = other_client.post(
            "/api/signup",
            json={
                "name": "Profile Owner Two",
                "email": "profile-owner-two@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(other_signup.status_code, 201)
        other_user_id = other_signup.get_json()["user"]["id"]

        attempted_targeted_update = self.client.patch(
            "/api/me",
            json={"name": "Own Profile With Ignored User ID", "user_id": other_user_id}
        )
        self.assertEqual(attempted_targeted_update.status_code, 200)
        self.assertEqual(
            self.client.get("/api/me").get_json()["user"]["name"],
            "Own Profile With Ignored User ID"
        )
        self.assertEqual(other_client.get("/api/me").get_json()["user"]["name"], "Profile Owner Two")

        self.assertEqual(self.client.post("/api/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/me").status_code, 401)
        relogin = self.client.post(
            "/api/login",
            json={"email": self.email, "password": "password123"}
        )
        self.assertEqual(relogin.status_code, 200)
        persisted = self.client.get("/api/me")
        self.assertEqual(persisted.status_code, 200)
        self.assertEqual(persisted.get_json()["user"]["name"], "Own Profile With Ignored User ID")

        unauthenticated = assessment_app.app.test_client()
        self.assertEqual(
            unauthenticated.patch("/api/me", json={"name": "Unauthorized"}).status_code,
            401
        )

    def test_assessment_and_roadmap_notifications_are_idempotent(self):
        assessment_id = self.complete_assessment_with_roadmap()
        first_count = self.client.get("/api/notifications").get_json()["unread_count"]
        self.assertEqual(first_count, 2)

        repeated_submission = self.client.post(
            f"/api/assessment/{assessment_id}/quiz",
            json={"answers": {}}
        )
        self.assertEqual(repeated_submission.status_code, 409)

        with assessment_app.app.app_context():
            assessment = assessment_app.db.session.get(
                assessment_app.Assessment,
                assessment_id
            )
            assessment_app.create_notification_once(
                user_id=assessment.user_id,
                event_key=f"assessment-completed:{assessment.id}",
                kind="assessment_completed",
                title="Assessment completed",
                message=f"Your {assessment.career_name} assessment results are ready.",
                target_type="assessment",
                target_id=assessment.id
            )
            assessment_app.db.session.commit()
            self.assertEqual(
                assessment_app.Notification.query.filter_by(
                    user_id=assessment.user_id
                ).count(),
                2
            )

        self.assertEqual(
            self.client.get("/api/notifications/unread-count").get_json()["unread_count"],
            2
        )

    def test_task_completion_and_progress_milestones_create_one_notification_each(self):
        self.complete_assessment_with_roadmap()
        progress = self.client.get("/api/learning-progress").get_json()
        task_ids = [task["id"] for task in progress["tasks"]]

        completed = self.client.patch(
            f"/api/learning-progress/{task_ids[0]}",
            json={"status": "Completed"}
        )
        self.assertEqual(completed.status_code, 200)
        notification_response = self.client.get("/api/notifications")
        notifications = notification_response.get_json()["notifications"]
        kinds = [item["kind"] for item in notifications]
        self.assertEqual(kinds.count("learning_task_completed"), 1)
        self.assertEqual(kinds.count("learning_progress_milestone"), 1)
        self.assertTrue(any(item["title"].startswith("50%") for item in notifications))

        repeated = self.client.patch(
            f"/api/learning-progress/{task_ids[0]}",
            json={"status": "Completed"}
        )
        self.assertEqual(repeated.status_code, 200)
        repeated_items = self.client.get("/api/notifications").get_json()["notifications"]
        self.assertEqual(
            sum(item["kind"] == "learning_task_completed" for item in repeated_items),
            1
        )
        self.assertEqual(
            sum(item["kind"] == "learning_progress_milestone" for item in repeated_items),
            1
        )

        second_task_id = next(
            task["id"] for task in repeated.get_json()["tasks"]
            if task["status"] != "Completed"
        )
        finish = self.client.patch(
            f"/api/learning-progress/{second_task_id}",
            json={"status": "Completed"}
        )
        self.assertEqual(finish.status_code, 200)
        final_notifications = self.client.get("/api/notifications").get_json()["notifications"]
        self.assertEqual(
            sum(item["kind"] == "learning_progress_milestone" for item in final_notifications),
            2
        )
        self.assertTrue(any(item["title"].startswith("100%") for item in final_notifications))

    def test_completed_assessment_without_roadmap_only_notifies_completion(self):
        assessment = self.start_assessment("python_developer")
        assessment_id = assessment["assessment_id"]
        self.rate_assessment(assessment_id, "python_developer")
        with assessment_app.app.app_context():
            for rating in assessment_app.SelfRating.query.filter_by(
                assessment_id=assessment_id
            ).all():
                rating.rating = 5
            assessment_app.db.session.commit()

        answers = {
            question["key"]: next(
                item["answer"]
                for item in assessment_app.QUIZ_QUESTIONS
                if item["key"] == question["key"]
            )
            for question in assessment["questions"]
        }
        completed = self.client.post(
            f"/api/assessment/{assessment_id}/quiz",
            json={"answers": answers}
        )
        self.assertEqual(completed.status_code, 201)
        items = self.client.get("/api/notifications").get_json()["notifications"]
        self.assertEqual([item["kind"] for item in items], ["assessment_completed"])

    def test_post_creation_edit_persistence_and_validation(self):
        created = self.client.post("/api/posts", json={"content": "  Learning update  "})
        self.assertEqual(created.status_code, 201)
        post = created.get_json()["post"]
        self.assertEqual(post["content"], "Learning update")
        self.assertEqual(post["author_name"], "Assessment Tester")
        self.assertEqual(post["user_id"], 1)
        original_created_at = post["created_at"]

        listed = self.client.get("/api/posts")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.get_json()["posts"]], [post["id"]])

        edited = self.client.patch(
            f"/api/posts/{post['id']}",
            json={"content": "Updated learning update"}
        )
        self.assertEqual(edited.status_code, 200)
        updated = edited.get_json()["post"]
        self.assertEqual(updated["content"], "Updated learning update")
        self.assertEqual(updated["created_at"], original_created_at)
        self.assertEqual(updated["user_id"], post["user_id"])
        self.assertEqual(updated["author_name"], post["author_name"])

        invalid_contents = ["", " \n\t ", "x" * 501, 123, None]
        for content in invalid_contents:
            with self.subTest(content=repr(content)):
                create_response = self.client.post("/api/posts", json={"content": content})
                self.assertEqual(create_response.status_code, 400)
                update_response = self.client.patch(
                    f"/api/posts/{post['id']}",
                    json={"content": content}
                )
                self.assertEqual(update_response.status_code, 400)

        missing_content = self.client.post("/api/posts", json={})
        self.assertEqual(missing_content.status_code, 400)
        self.assertEqual(self.client.patch("/api/posts/not-an-id", json={"content": "No"}).status_code, 404)

    def test_post_ownership_likes_and_delete_cascade(self):
        own_post_response = self.client.post(
            "/api/posts",
            json={"content": "Owned community post"}
        )
        self.assertEqual(own_post_response.status_code, 201)
        own_post = own_post_response.get_json()["post"]
        post_id = own_post["id"]

        other_client = assessment_app.app.test_client()
        other_signup = other_client.post(
            "/api/signup",
            json={
                "name": "Post Owner Two",
                "email": "post-owner-two@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(other_signup.status_code, 201)
        self.assertEqual(
            other_client.patch(
                f"/api/posts/{post_id}",
                json={"content": "Unauthorized edit"}
            ).status_code,
            404
        )
        self.assertEqual(other_client.delete(f"/api/posts/{post_id}").status_code, 404)

        first_like = other_client.post(f"/api/posts/{post_id}/like")
        self.assertEqual(first_like.status_code, 200)
        self.assertTrue(first_like.get_json()["liked"])
        self.assertEqual(first_like.get_json()["like_count"], 1)
        duplicate_like = other_client.post(f"/api/posts/{post_id}/like")
        self.assertEqual(duplicate_like.get_json()["like_count"], 1)

        like_removed = other_client.delete(f"/api/posts/{post_id}/like")
        self.assertEqual(like_removed.status_code, 200)
        self.assertFalse(like_removed.get_json()["liked"])
        self.assertEqual(like_removed.get_json()["like_count"], 0)
        other_client.post(f"/api/posts/{post_id}/like")

        edit = self.client.patch(
            f"/api/posts/{post_id}",
            json={"content": "Edited while preserving likes"}
        )
        self.assertEqual(edit.status_code, 200)
        self.assertEqual(edit.get_json()["post"]["like_count"], 1)
        self.assertEqual(other_client.get("/api/posts").get_json()["posts"][0]["content"], "Edited while preserving likes")

        deleted = self.client.delete(f"/api/posts/{post_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.delete(f"/api/posts/{post_id}").status_code, 404)
        self.assertEqual(
            self.client.patch(f"/api/posts/{post_id}", json={"content": "Too late"}).status_code,
            404
        )
        self.assertEqual(other_client.post(f"/api/posts/{post_id}/like").status_code, 404)
        self.assertEqual(other_client.get("/api/posts").get_json()["posts"], [])
        with assessment_app.app.app_context():
            self.assertEqual(assessment_app.PostLike.query.filter_by(post_id=post_id).count(), 0)

    def test_posts_and_post_actions_require_auth_and_missing_posts_return_404(self):
        anonymous = assessment_app.app.test_client()
        self.assertEqual(anonymous.get("/api/posts").status_code, 401)
        self.assertEqual(anonymous.post("/api/posts", json={"content": "Hello"}).status_code, 401)
        self.assertEqual(anonymous.patch("/api/posts/1", json={"content": "Hello"}).status_code, 401)
        self.assertEqual(anonymous.delete("/api/posts/1").status_code, 401)
        self.assertEqual(anonymous.post("/api/posts/1/like").status_code, 401)
        self.assertEqual(anonymous.delete("/api/posts/1/like").status_code, 401)

        self.assertEqual(self.client.patch("/api/posts/999", json={"content": "Missing"}).status_code, 404)
        self.assertEqual(self.client.delete("/api/posts/999").status_code, 404)
        self.assertEqual(self.client.post("/api/posts/999/like").status_code, 404)
        self.assertEqual(self.client.delete("/api/posts/999/like").status_code, 404)

    def test_posts_feed_is_shared_and_delete_removes_only_selected_post(self):
        first_post = self.client.post(
            "/api/posts",
            json={"content": "Post from account one"}
        ).get_json()["post"]

        second_client = assessment_app.app.test_client()
        signup = second_client.post(
            "/api/signup",
            json={
                "name": "Shared Feed Account Two",
                "email": "shared-feed-account-two@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(signup.status_code, 201)
        second_post_response = second_client.post(
            "/api/posts",
            json={"content": "Post from account two"}
        )
        self.assertEqual(second_post_response.status_code, 201)
        second_post = second_post_response.get_json()["post"]

        expected_posts = {
            first_post["id"]: "Post from account one",
            second_post["id"]: "Post from account two"
        }
        for client in (self.client, second_client):
            response = client.get("/api/posts")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                {post["id"]: post["content"] for post in response.get_json()["posts"]},
                expected_posts
            )

        self.assertEqual(
            self.client.patch(
                f"/api/posts/{second_post['id']}",
                json={"content": "Account one cannot edit this"}
            ).status_code,
            404
        )
        self.assertEqual(
            second_client.patch(
                f"/api/posts/{first_post['id']}",
                json={"content": "Account two cannot edit this"}
            ).status_code,
            404
        )
        self.assertEqual(
            self.client.patch(
                f"/api/posts/{first_post['id']}",
                json={"content": "Account one updated its own post"}
            ).status_code,
            200
        )
        self.assertEqual(
            second_client.patch(
                f"/api/posts/{second_post['id']}",
                json={"content": "Account two updated its own post"}
            ).status_code,
            200
        )

        self.assertEqual(self.client.delete(f"/api/posts/{first_post['id']}").status_code, 200)
        for client in (self.client, second_client):
            remaining = client.get("/api/posts").get_json()["posts"]
            self.assertEqual(len(remaining), 1)
            self.assertEqual(remaining[0]["id"], second_post["id"])
            self.assertEqual(remaining[0]["content"], "Account two updated its own post")

        self.assertEqual(second_client.delete(f"/api/posts/{second_post['id']}").status_code, 200)
        self.assertEqual(self.client.get("/api/posts").get_json()["posts"], [])
        self.assertEqual(second_client.get("/api/posts").get_json()["posts"], [])


if __name__ == "__main__":
    unittest.main()
