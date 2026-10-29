import io
import base64
import json
import os
import sys
import unittest
from datetime import datetime
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from PIL import Image
from pypdf import PdfWriter

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SECRET_KEY"] = "chat-test-secret"
sys.path.insert(0, os.path.dirname(__file__))

import app as chat_app


class FakeOllamaResponse:
    status = 200

    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exception_type, exception, traceback):
        return False

    def read(self, limit=None):
        return json.dumps(self.payload).encode("utf-8")


class MalformedOllamaResponse(FakeOllamaResponse):
    def read(self, limit=None):
        return b"not-json"


def text_pdf_bytes(text="Readable PDF attachment"):
    escaped_text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 72 Td ({escaped_text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, content in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(content)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(output)


def image_bytes():
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "#1768f5").save(output, format="PNG")
    return output.getvalue()


def multi_page_pdf_bytes(page_count):
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=72, height=72)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class ChatApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        chat_app.app.config.update(TESTING=True)

    @classmethod
    def tearDownClass(cls):
        with chat_app.app.app_context():
            chat_app.db.session.remove()
            chat_app.db.engine.dispose()

    def setUp(self):
        os.environ.pop("OLLAMA_MODEL", None)
        os.environ.pop("OLLAMA_VISION", None)
        os.environ.pop("OLLAMA_VISION_MODELS", None)
        with chat_app.app.app_context():
            chat_app.db.session.remove()
            chat_app.db.drop_all()
            chat_app.db.create_all()

        self.client = chat_app.app.test_client()
        response = self.client.post(
            "/api/signup",
            json={
                "name": "Chat Tester",
                "email": "chat-tester@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(response.status_code, 201)

    def create_assessment(self, user_id, career_key="python_developer"):
        with chat_app.app.app_context():
            assessment = chat_app.Assessment(
                user_id=user_id,
                career_key=career_key,
                career_name=chat_app.CAREER_CONFIG[career_key]["name"],
                self_completed=True,
                quiz_completed=True,
                completed_at=datetime.utcnow()
            )
            chat_app.db.session.add(assessment)
            chat_app.db.session.flush()
            chat_app.db.session.add(chat_app.AssessmentResult(
                assessment_id=assessment.id,
                skill_key="python",
                skill_name="Python",
                target_level=5,
                self_rating=2,
                quiz_level=2,
                quiz_correct=2,
                quiz_total=5,
                combined_level=2,
                gap=3,
                priority_level="High",
                priority_reason="Practice functions and error handling next."
            ))
            chat_app.db.session.add(chat_app.RoadmapItem(
                assessment_id=assessment.id,
                skill_key="python",
                skill_name="Python",
                priority_rank=1,
                priority_level="High",
                target_level=5,
                activity="Build a small Python project with tests."
            ))
            chat_app.db.session.commit()
            return assessment.id

    def test_chat_requires_authentication(self):
        response = chat_app.app.test_client().post(
            "/api/chat",
            json={"message": "Help me learn Python"}
        )

        self.assertEqual(response.status_code, 401)

    def test_chat_rejects_invalid_and_oversized_input(self):
        empty = self.client.post("/api/chat", json={"message": "  "})
        self.assertEqual(empty.status_code, 400)

        oversized_message = self.client.post(
            "/api/chat",
            json={"message": "x" * (chat_app.CHAT_MESSAGE_MAX_LENGTH + 1)}
        )
        self.assertEqual(oversized_message.status_code, 400)

        oversized_context = self.client.post(
            "/api/chat",
            json={
                "message": "Help me practice",
                "context": "x" * (chat_app.CHAT_CONTEXT_MAX_LENGTH + 1)
            }
        )
        self.assertEqual(oversized_context.status_code, 400)

        unsupported_mode = self.client.post(
            "/api/chat",
            json={"message": "Help me practice", "mode": "secret_mode"}
        )
        self.assertEqual(unsupported_mode.status_code, 400)

        unsupported_preferences = self.client.post(
            "/api/chat",
            json={
                "message": "Help me practice",
                "study_minutes": 17,
                "language": "ruby"
            }
        )
        self.assertEqual(unsupported_preferences.status_code, 400)

    def test_chat_uses_default_model_when_ollama_model_unset(self):
        with patch.object(chat_app.urllib.request, "urlopen") as urlopen:
            urlopen.return_value = FakeOllamaResponse(
                {"message": {"content": "Default model reply."}}
            )
            response = self.client.post(
                "/api/chat",
                json={"message": "Create a roadmap"}
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["reply"], "Default model reply.")
        # The default model llama3.2:3b is configured, so Ollama is called.
        urlopen.assert_called_once()
        request = urlopen.call_args[0][0]
        payload = json.loads(request.data)
        self.assertEqual(payload["model"], "llama3.2:3b")

    def test_chat_handles_ollama_unavailable(self):
        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    side_effect=URLError("Ollama is offline")
                ):
            response = self.client.post(
                "/api/chat",
                json={"message": "Practice interview questions"}
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {"error": "AI Mentor is unavailable right now. Start Ollama locally and try again."}
        )

    def test_chat_handles_missing_ollama_model(self):
        error = HTTPError(
            chat_app.OLLAMA_CHAT_URL,
            404,
            "model not found",
            {},
            io.BytesIO(b'{"error":"model not found"}')
        )
        with patch.dict(os.environ, {"OLLAMA_MODEL": "missing-model"}), \
                patch.object(chat_app.urllib.request, "urlopen", side_effect=error):
            response = self.client.post(
                "/api/chat",
                json={"message": "Teach me coding"}
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("configured AI Mentor model is unavailable", response.get_json()["error"])

    def test_chat_handles_malformed_and_empty_ollama_responses(self):
        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    return_value=MalformedOllamaResponse({})
                ):
            malformed = self.client.post(
                "/api/chat",
                json={"message": "Give me a plan"}
            )

        self.assertEqual(malformed.status_code, 503)
        self.assertIn("AI Mentor is unavailable", malformed.get_json()["error"])

        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    return_value=FakeOllamaResponse({
                        "message": {"content": "  "}
                    })
                ):
            empty = self.client.post(
                "/api/chat",
                json={"message": "Give me a plan"}
            )

        self.assertEqual(empty.status_code, 503)

    def test_chat_returns_mocked_reply_with_verified_user_context(self):
        with chat_app.app.app_context():
            user = chat_app.User.query.filter_by(email="chat-tester@example.com").first()
            assessment_id = self.create_assessment(user.id)

        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    return_value=FakeOllamaResponse({
                        "message": {"content": "Start with a tested Python project."}
                    })
                ) as urlopen:
            response = self.client.post(
                "/api/chat",
                json={
                    "message": "What should I practice next?",
                    "assessment_id": assessment_id,
                    "context": "The learner prefers short evening sessions."
                }
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            "reply": "Start with a tested Python project."
        })
        request = urlopen.call_args.args[0]
        request_payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(request_payload["model"], "mentor-test")
        self.assertEqual(request_payload["stream"], False)
        self.assertIn("Python Developer", request_payload["messages"][0]["content"])
        self.assertIn("Practice functions and error handling", request_payload["messages"][0]["content"])
        self.assertIn('"skill_category":"weak"', request_payload["messages"][0]["content"])
        self.assertNotIn("correct_option", request_payload["messages"][0]["content"])
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 45)

    def test_chat_includes_mode_preferences_and_owned_progress(self):
        with chat_app.app.app_context():
            user = chat_app.User.query.filter_by(email="chat-tester@example.com").first()
            assessment_id = self.create_assessment(user.id)
            roadmap_item = chat_app.RoadmapItem.query.filter_by(
                assessment_id=assessment_id
            ).first()
            chat_app.db.session.add(chat_app.LearningTask(
                user_id=user.id,
                assessment_id=assessment_id,
                roadmap_item_id=roadmap_item.id,
                title="Owned Python task",
                skill_key="python",
                skill_name="Python",
                priority_level="High",
                target_level=5,
                activity="Write tests",
                status="In Progress"
            ))
            chat_app.db.session.commit()

        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    return_value=FakeOllamaResponse({
                        "message": {"content": "Use the next saved task."}
                    })
                ) as urlopen:
            response = self.client.post(
                "/api/chat",
                json={
                    "message": "Plan my next week",
                    "mode": "roadmap",
                    "career_key": "python_developer",
                    "study_minutes": 30,
                    "target_skill": "python",
                    "language": "python",
                    "difficulty": "beginner",
                    "assessment_id": assessment_id
                }
            )

        self.assertEqual(response.status_code, 200)
        request_payload = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        system_message = request_payload["messages"][0]["content"]
        self.assertIn("Active mentor mode: roadmap", system_message)
        self.assertIn("Owned Python task", system_message)
        self.assertIn('"daily_minutes":30', system_message)
        self.assertIn('"target_skill":"python"', system_message)
        self.assertIn('"difficulty": "beginner"', system_message)

    def test_chat_does_not_include_another_users_progress(self):
        with chat_app.app.app_context():
            first_user = chat_app.User.query.filter_by(
                email="chat-tester@example.com"
            ).first()
            first_assessment_id = self.create_assessment(first_user.id)
            first_roadmap = chat_app.RoadmapItem.query.filter_by(
                assessment_id=first_assessment_id
            ).first()
            chat_app.db.session.add(chat_app.LearningTask(
                user_id=first_user.id,
                assessment_id=first_assessment_id,
                roadmap_item_id=first_roadmap.id,
                title="First user's task",
                skill_key="python",
                skill_name="Python",
                priority_level="High",
                target_level=5,
                activity="Keep this private",
                status="Completed"
            ))
            chat_app.db.session.commit()

        other_client = chat_app.app.test_client()
        signup = other_client.post(
            "/api/signup",
            json={
                "name": "Progress Owner",
                "email": "progress-owner@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(signup.status_code, 201)
        with chat_app.app.app_context():
            other_user = chat_app.User.query.filter_by(
                email="progress-owner@example.com"
            ).first()
            other_assessment_id = self.create_assessment(other_user.id)
            other_roadmap = chat_app.RoadmapItem.query.filter_by(
                assessment_id=other_assessment_id
            ).first()
            chat_app.db.session.add(chat_app.LearningTask(
                user_id=other_user.id,
                assessment_id=other_assessment_id,
                roadmap_item_id=other_roadmap.id,
                title="Other user's private task",
                skill_key="python",
                skill_name="Python",
                priority_level="High",
                target_level=5,
                activity="Do not leak",
                status="Completed"
            ))
            chat_app.db.session.commit()

        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    return_value=FakeOllamaResponse({
                        "message": {"content": "Your progress is private."}
                    })
                ) as urlopen:
            response = self.client.post(
                "/api/chat",
                json={"message": "What is my progress?"}
            )

        self.assertEqual(response.status_code, 200)
        system_message = json.loads(
            urlopen.call_args.args[0].data.decode("utf-8")
        )["messages"][0]["content"]
        self.assertIn("First user's task", system_message)
        self.assertNotIn("Other user's private task", system_message)

    def test_chat_rejects_another_users_assessment(self):
        with chat_app.app.app_context():
            first_user = chat_app.User.query.filter_by(
                email="chat-tester@example.com"
            ).first()
            assessment_id = self.create_assessment(first_user.id)

        other_client = chat_app.app.test_client()
        response = other_client.post(
            "/api/signup",
            json={
                "name": "Other Chat User",
                "email": "other-chat@example.com",
                "password": "password123"
            }
        )
        self.assertEqual(response.status_code, 201)

        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(chat_app, "call_ollama") as call_ollama:
            response = other_client.post(
                "/api/chat",
                json={
                    "message": "Show me my assessment context",
                    "assessment_id": assessment_id
                }
            )

        self.assertEqual(response.status_code, 404)
        self.assertNotIn("Python Developer", response.get_data(as_text=True))
        call_ollama.assert_not_called()

    def test_chat_accepts_text_attachment_without_persisting_it(self):
        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    return_value=FakeOllamaResponse({
                        "message": {"content": "Use the attached notes."}
                    })
                ) as urlopen:
            response = self.client.post(
                "/api/chat",
                data={
                    "payload": json.dumps({"message": "Review these notes"}),
                    "attachments": (io.BytesIO(b"Practice functions next."), "notes.txt")
                },
                content_type="multipart/form-data"
            )

        self.assertEqual(response.status_code, 200)
        request_payload = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        user_message = request_payload["messages"][1]
        self.assertIn("Practice functions next.", user_message["content"])
        self.assertIn("untrusted user input", user_message["content"])
        self.assertNotIn("attachments", response.get_data(as_text=True))

    def test_chat_extracts_pdf_attachment_text(self):
        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    return_value=FakeOllamaResponse({
                        "message": {"content": "PDF reviewed."}
                    })
                ) as urlopen:
            response = self.client.post(
                "/api/chat",
                data={
                    "payload": json.dumps({"message": "Review the PDF"}),
                    "attachments": (io.BytesIO(text_pdf_bytes()), "resume.pdf")
                },
                content_type="multipart/form-data"
            )

        self.assertEqual(response.status_code, 200)
        request_payload = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertIn("Readable PDF attachment", request_payload["messages"][1]["content"])

    def test_chat_sends_validated_image_to_vision_model(self):
        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-vision", "OLLAMA_VISION": "1"}), \
                patch.object(
                    chat_app.urllib.request,
                    "urlopen",
                    return_value=FakeOllamaResponse({
                        "message": {"content": "I can see the image."}
                    })
                ) as urlopen:
            response = self.client.post(
                "/api/chat",
                data={
                    "payload": json.dumps({"message": "Describe this image"}),
                    "attachments": (io.BytesIO(image_bytes()), "screen.png")
                },
                content_type="multipart/form-data"
            )

        self.assertEqual(response.status_code, 200)
        request_payload = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(len(request_payload["messages"][1]["images"]), 1)
        self.assertTrue(
            base64.b64decode(request_payload["messages"][1]["images"][0]).startswith(b"\x89PNG")
        )

    def test_chat_rejects_invalid_attachment_types_and_malformed_images(self):
        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(chat_app.urllib.request, "urlopen") as urlopen:
            unsupported = self.client.post(
                "/api/chat",
                data={
                    "payload": json.dumps({"message": "Review this"}),
                    "attachments": (io.BytesIO(b"not allowed"), "secret.exe")
                },
                content_type="multipart/form-data"
            )
            malformed_image = self.client.post(
                "/api/chat",
                data={
                    "payload": json.dumps({"message": "Review this"}),
                    "attachments": (io.BytesIO(b"not a png"), "screen.png")
                },
                content_type="multipart/form-data"
            )

        self.assertEqual(unsupported.status_code, 415)
        self.assertEqual(malformed_image.status_code, 415)
        urlopen.assert_not_called()

    def test_chat_rejects_attachment_limits(self):
        files = [
            (io.BytesIO(f"file {index}".encode("ascii")), f"file-{index}.txt")
            for index in range(chat_app.MAX_ATTACHMENTS + 1)
        ]
        data = {"payload": json.dumps({"message": "Review these"}), "attachments": files}
        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(chat_app.urllib.request, "urlopen") as urlopen:
            too_many = self.client.post(
                "/api/chat",
                data=data,
                content_type="multipart/form-data"
            )

        self.assertEqual(too_many.status_code, 413)
        urlopen.assert_not_called()

        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(chat_app.urllib.request, "urlopen") as urlopen:
            oversized = self.client.post(
                "/api/chat",
                data={
                    "payload": json.dumps({"message": "Review this"}),
                    "attachments": (
                        io.BytesIO(b"x" * (chat_app.MAX_ATTACHMENT_BYTES + 1)),
                        "large.txt"
                    )
                },
                content_type="multipart/form-data"
            )

        self.assertEqual(oversized.status_code, 413)
        urlopen.assert_not_called()

        with patch.dict(os.environ, {"OLLAMA_MODEL": "mentor-test"}), \
                patch.object(chat_app.urllib.request, "urlopen") as urlopen:
            oversized_pdf = self.client.post(
                "/api/chat",
                data={
                    "payload": json.dumps({"message": "Review this PDF"}),
                    "attachments": (
                        io.BytesIO(multi_page_pdf_bytes(chat_app.MAX_PDF_PAGES + 1)),
                        "large-document.pdf"
                    )
                },
                content_type="multipart/form-data"
            )

        self.assertEqual(oversized_pdf.status_code, 413)
        urlopen.assert_not_called()

if __name__ == "__main__":
    unittest.main()
