const PLACEMENT_API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const PLACEMENT_API_HOST = window.location.hostname || "127.0.0.1";
const PLACEMENT_API_URL = `${PLACEMENT_API_PROTOCOL}//${PLACEMENT_API_HOST}:5000/api`;

const placementPageStatus = document.getElementById("placementPageStatus");
const placementPanel = document.getElementById("placementPanel");
const placementForm = document.getElementById("placementForm");
const placementResult = document.getElementById("placementResult");
const placementResultIcon = document.getElementById("placementResultIcon");
const placementResultLabel = document.getElementById("placementResultLabel");
const placementFormMessage = document.getElementById("placementFormMessage");
const placementSubmitButton = document.getElementById("placementSubmitBtn");

function setPlacementStatus(message, type = "") {
    if (!placementPageStatus) return;
    placementPageStatus.textContent = message;
    placementPageStatus.className = `placement-status${type ? ` ${type}` : ""}`;
    placementPageStatus.hidden = !message;
}

function setPlacementFormMessage(message, type = "") {
    if (!placementFormMessage) return;
    placementFormMessage.textContent = message;
    placementFormMessage.className = `placement-form-message${type ? ` ${type}` : ""}`;
    placementFormMessage.hidden = !message;
}

function hidePlacementResult() {
    if (!placementResult) return;
    placementResult.hidden = true;
    placementResult.className = "placement-result";
}

function showPlacementResult(label) {
    if (!placementResult || !placementResultIcon || !placementResultLabel) return;

    const isPlaced = label === "PLACED";
    placementResult.className = `placement-result ${isPlaced ? "placed" : "not-placed"}`;
    placementResultIcon.textContent = isPlaced ? "✓" : "—";
    placementResultLabel.textContent = label;
    placementResult.hidden = false;
}

async function verifyPlacementPageSession() {
    try {
        const response = await fetch(`${PLACEMENT_API_URL}/me`, {
            credentials: "include"
        });
        if (response.status === 401) {
            window.location.href = "login.html";
            return;
        }
        if (!response.ok) {
            setPlacementStatus("Unable to verify your session. Please try again.", "error");
            return;
        }

        const result = await response.json();
        if (!result.user) {
            window.location.href = "login.html";
            return;
        }

        placementPanel.hidden = false;
        setPlacementStatus("");
    } catch (error) {
        console.error("Unable to verify the placement prediction session.", error);
        setPlacementStatus("Unable to connect to SkillGapper. Check your connection and try again.", "error");
    }
}

if (placementForm) {
    placementForm.addEventListener("submit", async event => {
        event.preventDefault();
        setPlacementFormMessage("");
        hidePlacementResult();

        if (!placementForm.reportValidity()) return;

        const formData = new FormData(placementForm);
        const payload = {};
        for (const [key, value] of formData.entries()) {
            if (key === "degree" || key === "branch") {
                payload[key] = value;
            } else {
                payload[key] = Number(value);
            }
        }

        placementSubmitButton.disabled = true;
        setPlacementFormMessage("Checking prediction availability…");
        try {
            const response = await fetch(`${PLACEMENT_API_URL}/placement-prediction`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (response.status === 401) {
                window.location.href = "login.html";
                return;
            }
            if (!response.ok) {
                const message = response.status === 503
                    ? "Placement prediction is currently unavailable for this demo."
                    : result.error || "Placement prediction is unavailable right now.";
                setPlacementFormMessage(
                    message,
                    "error"
                );
                return;
            }

            if (result.label !== "PLACED" && result.label !== "NOT PLACED") {
                setPlacementFormMessage("The prediction service returned an invalid result.", "error");
                return;
            }

            showPlacementResult(result.label);
        } catch (error) {
            console.error("Placement prediction request failed.", error);
            setPlacementFormMessage("Unable to contact the placement prediction service.", "error");
        } finally {
            placementSubmitButton.disabled = false;
        }
    });

    placementForm.addEventListener("input", () => {
        setPlacementFormMessage("");
        hidePlacementResult();
    });
    placementForm.addEventListener("change", () => {
        setPlacementFormMessage("");
        hidePlacementResult();
    });
}

verifyPlacementPageSession();
