
const API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const API_HOST = window.location.hostname || "127.0.0.1";
const API_URL = `${API_PROTOCOL}//${API_HOST}:5000/api`;

// Send requests to the Flask backend
async function apiRequest(endpoint, data = null, method = "POST") {
    const options = {
        method,
        credentials: "include",
        headers: {
            "Content-Type": "application/json"
        }
    };

    if (data !== null) {
        options.body = JSON.stringify(data);
    }

    let response;
    try {
        response = await fetch(`${API_URL}${endpoint}`, options);
    } catch (error) {
        throw new Error("Unable to connect to the SkillGapper backend.");
    }

    const contentType = response.headers.get("content-type") || "";
    let result = null;

    if (contentType.toLowerCase().includes("application/json")) {
        try {
            result = await response.json();
        } catch (error) {
            result = null;
        }
    }

    if (!response.ok) {
        const message = typeof result?.error === "string"
            ? result.error
            : response.status >= 500
                ? "The server is temporarily unavailable. Please try again later."
                : "The request could not be completed.";
        const requestError = new Error(message);
        requestError.status = response.status;
        throw requestError;
    }

    if (!result || typeof result !== "object") {
        const requestError = new Error("The server returned an unexpected response.");
        requestError.status = response.status;
        throw requestError;
    }

    return result;
}

// Display a message in an existing page-specific message element.
function showMessage(message, success = false, messageId) {
    const box = messageId ? document.getElementById(messageId) : null;

    if (!box) {
        console.error(message);
        return;
    }

    box.textContent = message;
    box.classList.toggle("success", success);
}

// Signup form
const signupForm = document.getElementById("signupForm");

if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const nameInput = document.getElementById("signupName");
        const emailInput = document.getElementById("signupEmail");
        const passwordInput = document.getElementById("signupPassword");
        const confirmPasswordInput = document.getElementById("confirmPassword");

        if (!nameInput || !emailInput || !passwordInput || !confirmPasswordInput) {
            showMessage("Signup form fields could not be found.", false, "signupMessage");
            return;
        }

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (password.length < 8) {
            showMessage("Password must contain at least 8 characters.", false, "signupMessage");
            return;
        }

        if (password !== confirmPassword) {
            showMessage("Passwords do not match.", false, "signupMessage");
            return;
        }

        try {
            const result = await apiRequest("/signup", {
                name,
                email,
                password
            });

            showMessage(result.message, true, "signupMessage");

            window.location.href = "index.html";
        } catch (error) {
            showMessage(error.message, false, "signupMessage");
        }
    });
}

// Login form
const loginForm = document.getElementById("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;

        const messageBox = document.getElementById("loginMessage");

        if (!messageBox) {
            console.error("Login message element not found.");
            return;
        }

        try {
            showMessage("Signing in...", false, "loginMessage");

            const result = await apiRequest("/login", {
                email: email,
                password: password
            });

            showMessage(result.message, true, "loginMessage");

            window.location.href = "index.html";

        } catch (error) {
            showMessage(error.message, false, "loginMessage");
        }
    });
}


// Logout function
async function logoutUser() {
    try {
        await apiRequest("/logout");
        window.location.href = "login.html";
    } catch (error) {
        showMessage(error.message, false, "loginMessage");
    }
}

// Password reset remains unavailable until a secure token and email flow exists.
const forgotForm = document.getElementById("forgotForm");
const forgotMessage = document.getElementById("forgotMessage");

if (forgotForm) {
    forgotForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const email = document.getElementById("recoveryEmail")?.value.trim();

        if (!email) {
            showMessage("Please enter your email address.", false, "forgotMessage");
            return;
        }

        showMessage(
            "Password reset is currently unavailable. No email was sent.",
            false,
            "forgotMessage"
        );
    });
}
document.querySelectorAll(".toggle-password").forEach((button) => {
    button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.target);

        if (!input) return;

        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        button.textContent = isPassword ? "Hide" : "Show";
    });
});
