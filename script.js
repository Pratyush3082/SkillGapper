const API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const API_HOST = window.location.hostname || "127.0.0.1";
const API_URL = `${API_PROTOCOL}//${API_HOST}:5000/api`;

/* ==========================================
   1. NOTIFICATION SYSTEM
========================================== */

const toast = document.getElementById("toast");
let toastTimer;

const notificationState = {
    items: [],
    unreadCount: 0,
    loaded: false,
    listRequest: null,
    countRequest: null
};
let currentAuthenticatedUser = null;

function showToast(text) {
    if (!toast) return;

    toast.textContent = text;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}

function setNotificationUnreadCount(count) {
    notificationState.unreadCount = Number.isFinite(count) ? count : 0;
    const badge = document.getElementById("notificationUnreadBadge");
    const panelCount = document.getElementById("notificationPanelCount");
    const markAllButton = document.getElementById("markAllNotificationsReadBtn");
    const bell = document.getElementById("notificationBtn");
    const label = notificationState.unreadCount
        ? `Notifications, ${notificationState.unreadCount} unread`
        : "Notifications";

    if (badge) {
        badge.textContent = notificationState.unreadCount > 99
            ? "99+"
            : String(notificationState.unreadCount);
        badge.hidden = notificationState.unreadCount === 0;
        badge.setAttribute("aria-label", `${notificationState.unreadCount} unread notifications`);
    }
    if (panelCount) {
        panelCount.textContent = String(notificationState.unreadCount);
        panelCount.hidden = notificationState.unreadCount === 0;
    }
    if (markAllButton) markAllButton.disabled = notificationState.unreadCount === 0;
    if (bell) bell.setAttribute("aria-label", label);
}

function setNotificationStatus(message, type = "") {
    const status = document.getElementById("notificationStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `notification-status${type ? ` ${type}` : ""}`;
    status.hidden = !message;
}

async function loadNotificationUnreadCount() {
    if (notificationState.countRequest) return notificationState.countRequest;

    notificationState.countRequest = assessmentRequest("/notifications/unread-count")
        .then(result => {
            setNotificationUnreadCount(result.unread_count);
            return result.unread_count;
        })
        .catch(error => {
            setNotificationStatus(error.message, "error");
            return null;
        })
        .finally(() => {
            notificationState.countRequest = null;
        });

    return notificationState.countRequest;
}

function formatNotificationTime(value) {
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) return "";

    const secondsAgo = Math.max(0, Math.floor((Date.now() - timestamp.getTime()) / 1000));
    if (secondsAgo < 60) return "Just now";
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
    if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(timestamp);
}

function notificationIcon(kind) {
    if (kind === "assessment_completed") return ["✓", "assessment"];
    if (kind === "roadmap_available") return ["↗", "roadmap"];
    if (kind === "learning_task_completed") return ["✓", "task"];
    if (kind === "learning_progress_milestone") return ["◉", "milestone"];
    return ["•", ""];
}

function renderNotifications() {
    const list = document.getElementById("notificationList");
    const emptyState = document.getElementById("notificationEmptyState");
    if (!list || !emptyState) return;

    list.replaceChildren();
    emptyState.hidden = notificationState.items.length > 0;

    notificationState.items.forEach(notification => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `notification-card${notification.is_read ? "" : " unread"}`;
        card.setAttribute("aria-label", `${notification.is_read ? "" : "Unread: "}${notification.title}. ${notification.message}`);
        card.dataset.notificationId = String(notification.id);

        const [iconText, iconClass] = notificationIcon(notification.kind);
        const icon = document.createElement("span");
        icon.className = `notification-icon ${iconClass}`;
        icon.textContent = iconText;
        icon.setAttribute("aria-hidden", "true");

        const copy = document.createElement("span");
        copy.className = "notification-copy";
        const title = document.createElement("strong");
        title.textContent = notification.title;
        const message = document.createElement("p");
        message.textContent = notification.message;
        const timestamp = document.createElement("time");
        timestamp.dateTime = notification.created_at;
        timestamp.textContent = formatNotificationTime(notification.created_at);
        copy.append(title, message, timestamp);

        const unread = document.createElement("span");
        unread.className = "notification-unread-indicator";
        unread.setAttribute("aria-hidden", "true");
        card.append(icon, copy, unread);
        card.addEventListener("click", () => openNotification(notification));
        list.append(card);
    });

    setNotificationUnreadCount(notificationState.unreadCount);
}

async function loadNotifications(forceRefresh = false) {
    if (notificationState.listRequest) return notificationState.listRequest;
    if (notificationState.loaded && !forceRefresh) return notificationState.items;

    setNotificationStatus("Loading notifications…", "loading");
    notificationState.listRequest = assessmentRequest("/notifications")
        .then(result => {
            notificationState.items = Array.isArray(result.notifications)
                ? result.notifications
                : [];
            notificationState.loaded = true;
            setNotificationUnreadCount(result.unread_count);
            setNotificationStatus("");
            renderNotifications();
            return notificationState.items;
        })
        .catch(error => {
            setNotificationStatus(error.message, "error");
            if (!notificationState.items.length) {
                const emptyState = document.getElementById("notificationEmptyState");
                if (emptyState) emptyState.hidden = true;
            }
            return null;
        })
        .finally(() => {
            notificationState.listRequest = null;
        });

    return notificationState.listRequest;
}

async function refreshNotificationCount() {
    notificationState.loaded = false;
    const panel = document.getElementById("notificationPanel");
    if (panel && !panel.hidden) {
        return loadNotifications(true);
    }
    return loadNotificationUnreadCount();
}

async function markAllNotificationsRead() {
    const button = document.getElementById("markAllNotificationsReadBtn");
    if (!button || button.disabled) return;

    button.disabled = true;
    setNotificationStatus("Marking notifications as read…", "loading");
    try {
        const result = await assessmentRequest("/notifications/read-all", null, "POST");
        notificationState.items = notificationState.items.map(item => ({
            ...item,
            is_read: true
        }));
        setNotificationUnreadCount(result.unread_count);
        setNotificationStatus("");
        renderNotifications();
    } catch (error) {
        setNotificationStatus(error.message, "error");
        button.disabled = notificationState.unreadCount === 0;
    }
}

async function openNotification(notification) {
    closeNotificationPanel();
    try {
        const result = await assessmentRequest(
            `/notifications/${notification.id}/read`,
            null,
            "POST"
        );
        notification.is_read = true;
        setNotificationUnreadCount(result.unread_count);
        renderNotifications();
    } catch (error) {
        showToast(error.message);
    }

    if (notification.target_type === "assessment" && notification.target_id) {
        showView("skills");
        setAssessmentStatus("Loading your assessment results…", "loading");
        try {
            const result = await assessmentRequest(
                `/assessment/${notification.target_id}/results`
            );
            assessmentState.assessmentId = notification.target_id;
            renderAssessmentResults(result);
            showAssessmentPanel("assessmentResultsPanel");
            setAssessmentStatus("");
        } catch (error) {
            setAssessmentStatus(error.message, "error");
            showAssessmentPanel("assessmentSetupPanel");
        }
        return;
    }

    if (notification.target_type === "learning_progress") {
        openLearningProgress();
    }
}

function closeNotificationPanel(returnFocus = false) {
    const panel = document.getElementById("notificationPanel");
    const button = document.getElementById("notificationBtn");
    if (panel) panel.hidden = true;
    if (button) {
        button.setAttribute("aria-expanded", "false");
        if (returnFocus) button.focus();
    }
}

/* ==========================================
   2. DASHBOARD AUTHENTICATION
========================================== */

async function logoutUser() {
    const logoutButton = document.getElementById("profileLogoutBtn");

    if (logoutButton) {
        logoutButton.disabled = true;
    }

    try {
        const response = await fetch(`${API_URL}/logout`, {
            method: "POST",
            credentials: "include"
        });

        if (!response.ok) {
            throw new Error("Logout failed.");
        }

        setNavbarGuest();
        showToast("You have been logged out.");
    } catch (error) {
        if (logoutButton) {
            logoutButton.disabled = false;
        }

        showToast(error.message);
    }
}

function setNavbarGuest() {
    currentAuthenticatedUser = null;
    const guestNavigation = document.getElementById("guestNavigation");
    const authenticatedActions = document.getElementById("authenticatedActions");

    if (guestNavigation) guestNavigation.hidden = false;
    if (authenticatedActions) authenticatedActions.hidden = true;

    const menu = document.getElementById("profileMenu");
    const profileButton = document.getElementById("topProfileBtn");
    if (menu) menu.hidden = true;
    if (profileButton) profileButton.setAttribute("aria-expanded", "false");

    setProfileGuest();
    setAiMentorAuthenticated(false);

    if (typeof assessmentState !== "undefined") {
        assessmentState.careers = [];
        assessmentState.careersLoaded = false;
        assessmentState.latestLoaded = false;
        assessmentState.assessmentId = null;
        assessmentState.career = null;
        assessmentState.questions = [];
        assessmentState.answers = {};
        assessmentState.currentQuestion = 0;
    }

    if (typeof postsState !== "undefined") {
        postsState.items = [];
        postsState.loaded = false;
        renderPosts();
        setPostStatus("");
    }
}

function setProfileStatus(message, type = "") {
    const status = document.getElementById("profileStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `profile-status${type ? ` ${type}` : ""}`;
    status.hidden = !message;
}

function setProfileGuest(message = "Sign in to view your profile.", type = "") {
    const content = document.getElementById("profileContent");
    const formCard = document.getElementById("profileFormCard");
    if (content) content.hidden = true;
    if (formCard) formCard.hidden = true;
    setProfileStatus(message, type);
}

function renderProfile(user) {
    const content = document.getElementById("profileContent");
    const formCard = document.getElementById("profileFormCard");
    const nameElement = document.getElementById("displayName");
    const emailElement = document.getElementById("profileEmail");
    const avatar = document.getElementById("profileAvatar");
    const nameInput = document.getElementById("nameInput");
    const formError = document.getElementById("profileFormError");

    if (!user || typeof user.name !== "string" || typeof user.email !== "string") {
        setProfileGuest("Unable to load your profile. Try again.", "error");
        return;
    }

    if (content) content.hidden = false;
    if (formCard) formCard.hidden = true;
    if (nameElement) nameElement.textContent = user.name;
    if (emailElement) emailElement.textContent = user.email;
    if (avatar) avatar.textContent = user.name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toLocaleUpperCase())
        .join("") || user.email[0]?.toLocaleUpperCase() || "S";
    if (nameInput) nameInput.value = user.name;
    if (formError) formError.hidden = true;
    setProfileStatus("");
}

function setNavbarUser(user) {
    currentAuthenticatedUser = user;
    const guestNavigation = document.getElementById("guestNavigation");
    const authenticatedActions = document.getElementById("authenticatedActions");
    const name = typeof user?.name === "string" ? user.name.trim() : "";
    const email = typeof user?.email === "string" ? user.email.trim() : "";

    if (guestNavigation) guestNavigation.hidden = true;
    if (authenticatedActions) authenticatedActions.hidden = false;

    const nameElement = document.getElementById("profileMenuName");
    const emailElement = document.getElementById("profileMenuEmail");
    const profileButton = document.getElementById("topProfileBtn");

    if (nameElement) nameElement.textContent = name || email || "Your account";
    if (emailElement) emailElement.textContent = email;
    const composerAvatar = document.getElementById("postComposerAvatar");
    if (composerAvatar) {
        composerAvatar.textContent = name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0].toLocaleUpperCase())
            .join("") || email[0]?.toLocaleUpperCase() || "S";
    }
    if (profileButton) {
        const initials = name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0].toLocaleUpperCase())
            .join("");
        profileButton.textContent = initials || email[0]?.toLocaleUpperCase() || "P";
        profileButton.setAttribute(
            "aria-label",
            `Open profile menu for ${name || email || "your account"}`
        );
    }

    setAiMentorAuthenticated(true);
}

async function initializeDashboardAuth() {
    setNavbarGuest();
    setProfileStatus("Loading your profile…", "loading");

    try {
        const response = await fetch(`${API_URL}/me`, {
            credentials: "include"
        });

        if (!response.ok) {
            setNavbarGuest();
            if (response.status !== 401) {
                setProfileStatus("Unable to load your profile. Try again.", "error");
            }
            return;
        }

        const result = await response.json();
        if (!result.user) {
            setNavbarGuest();
            return;
        }

        setNavbarUser(result.user);
        renderProfile(result.user);

        loadAssessmentHome();
        loadLearningProgress();
        loadNotificationUnreadCount();
        loadPosts();
    } catch (error) {
        console.error("Unable to verify the dashboard session.", error);
        setNavbarGuest();
        setProfileStatus("Unable to load your profile. Check your connection and try again.", "error");
    }
}


/* ==========================================
   2. PAGE NAVIGATION
========================================== */

const views = {
    home: document.getElementById("homeView"),
    posts: document.getElementById("postsView"),
    profile: document.getElementById("profileView"),
    progress: document.getElementById("progressView"),
    skills: document.getElementById("skillsView")
};

function closeProfileMenu(returnFocus = false) {
    const menu = document.getElementById("profileMenu");
    const profileButton = document.getElementById("topProfileBtn");

    if (menu) menu.hidden = true;
    if (profileButton) {
        profileButton.setAttribute("aria-expanded", "false");
        if (returnFocus) profileButton.focus();
    }
}

function showView(name) {
    if (!views[name]) return;

    closeProfileMenu();

    Object.entries(views).forEach(([key, view]) => {
        if (view) {
            view.classList.toggle("active", key === name);
        }
    });

    document.querySelectorAll(".bottom-nav-item").forEach(button => {
        const isActive = button.dataset.view === name;

        button.classList.toggle("active", isActive);

        if (isActive) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

document.querySelectorAll(".bottom-nav-item").forEach(button => {
    button.addEventListener("click", () => {
        if (button.dataset.view === "skills") {
            openAssessment();
            return;
        }

        if (button.dataset.view === "progress") {
            openLearningProgress();
            return;
        }

        if (button.dataset.view === "home") {
            openHome();
            return;
        }

        if (button.dataset.view === "posts") {
            showView("posts");
            loadPosts(true);
            return;
        }

        showView(button.dataset.view);
    });
});

document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => {
        if (button.dataset.go === "skills") {
            openAssessment();
            return;
        }

        if (button.dataset.go === "progress") {
            openLearningProgress();
            return;
        }

        if (button.dataset.go === "home") {
            openHome();
            return;
        }

        if (button.dataset.go === "posts") {
            showView("posts");
            loadPosts(true);
            return;
        }

        showView(button.dataset.go);
    });
});


/* ==========================================
   3. PROFILE NAVIGATION
========================================== */

const profileMenuButton = document.getElementById("topProfileBtn");
const profileMenu = document.getElementById("profileMenu");

profileMenuButton?.addEventListener("click", () => {
    if (!profileMenu) return;

    const willOpen = profileMenu.hidden;
    profileMenu.hidden = !willOpen;
    profileMenuButton.setAttribute("aria-expanded", String(willOpen));
});

document.addEventListener("click", event => {
    const container = document.querySelector(".profile-menu-container");
    if (profileMenu && !profileMenu.hidden && container && !container.contains(event.target)) {
        closeProfileMenu();
    }

    const notificationContainer = document.querySelector(".notification-container");
    const notificationPanel = document.getElementById("notificationPanel");
    if (
        notificationPanel
        && !notificationPanel.hidden
        && notificationContainer
        && !notificationContainer.contains(event.target)
    ) {
        closeNotificationPanel();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && profileMenu && !profileMenu.hidden) {
        closeProfileMenu(true);
    }

    const notificationPanel = document.getElementById("notificationPanel");
    if (event.key === "Escape" && notificationPanel && !notificationPanel.hidden) {
        closeNotificationPanel(true);
    }
});

profileMenu?.addEventListener("click", event => {
    const action = event.target.closest("[data-profile-action]")?.dataset.profileAction;
    if (!action) return;

    closeProfileMenu();
    if (action === "profile") showView("profile");
    if (action === "progress") openLearningProgress();
});

document.getElementById("profileLogoutBtn")?.addEventListener("click", logoutUser);

document.getElementById("notificationBtn")?.addEventListener("click", event => {
    const button = event.currentTarget;
    const panel = document.getElementById("notificationPanel");
    if (!panel) return;

    closeProfileMenu();
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) loadNotifications(true);
});

document.getElementById("markAllNotificationsReadBtn")
    ?.addEventListener("click", markAllNotificationsRead);


/* ==========================================
   4. HYBRID SKILL ASSESSMENT
========================================== */

const assessmentState = {
    careers: [],
    careersLoaded: false,
    latestLoaded: false,
    assessmentId: null,
    career: null,
    questions: [],
    answers: {},
    currentQuestion: 0
};

let assessmentHomeRequest = null;

async function assessmentRequest(endpoint, data = null, method = "GET", requestOptions = {}) {
    const options = {
        method,
        credentials: "include"
    };

    if (typeof FormData !== "undefined" && data instanceof FormData) {
        options.body = data;
    } else if (data !== null) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(data);
    }
    if (requestOptions.signal) options.signal = requestOptions.signal;

    const response = await fetch(`${API_URL}${endpoint}`, options);
    const contentType = response.headers.get("content-type") || "";
    const responseText = await response.text();
    let result = null;

    if (contentType.toLowerCase().includes("application/json") && responseText) {
        try {
            result = JSON.parse(responseText);
        } catch (error) {
            result = null;
        }
    }

    if (!result || typeof result !== "object") {
        const error = new Error(
            `Assessment API returned a non-JSON response for ${endpoint} ` +
            `(HTTP ${response.status}). Verify Flask is running the current ` +
            `backend at ${API_URL}.`
        );
        error.status = response.status;
        throw error;
    }

    if (!response.ok) {
        const message = response.status === 401
            ? "Your session has expired. Please sign in again."
            : result.error || "Assessment request failed.";
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return result;
}

/* ==========================================
   5. AI MENTOR
========================================== */

const aiMentorState = {
    messages: [],
    open: false,
    loading: false,
    sessionToken: 0,
    requestId: 0,
    abortController: null,
    retryMessage: "",
    lastMode: "general",
    mockInterviewScore: 0,
    pendingAttachments: [],
    previewUrls: [],
    conversationHistory: []
};

function aiMentorGetStorageKey() {
    const userId = currentAuthenticatedUser?.id;
    return userId ? `skillgapper_ai_mentor_conversations_${userId}` : null;
}

function aiMentorLoadConversations() {
    const key = aiMentorGetStorageKey();
    if (!key) return [];
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function aiMentorSaveConversations(conversations) {
    const key = aiMentorGetStorageKey();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(conversations));
    } catch (error) {
        // localStorage unavailable (e.g. private mode); history stays session-only
    }
}

function aiMentorStoreConversations(conversations) {
    aiMentorSaveConversations(conversations);
}

function aiMentorUpdateConversationHistory(history, conversationId, messages) {
    const conversations = Array.isArray(history) ? history.slice() : [];
    const index = conversations.findIndex(c => c.id === conversationId);
    const firstUserMessage = (Array.isArray(messages) && messages.length > 0)
        ? messages.find(m => m.role === "user")
        : null;
    const derivedTitle = firstUserMessage
        ? aiMentorTruncateMessage(firstUserMessage.content, 60)
        : "New conversation";
    const entry = {
        id: conversationId,
        title: derivedTitle,
        messages: Array.isArray(messages) ? messages.slice() : [],
        updatedAt: new Date().toISOString()
    };
    if (index >= 0) {
        conversations[index] = { ...conversations[index], ...entry };
        if (entry.title) conversations[index].title = entry.title;
    } else {
        entry.createdAt = new Date().toISOString();
        conversations.push(entry);
    }
    return conversations;
}

function aiMentorGenerateConversationId() {
    return `conv-${Date.now()}-${Math.trunc(Math.random() * 100000)}`;
}

const AI_MENTOR_CONTEXT_LIMIT = 3600;

function aiMentorTruncateMessage(message, maxChars = 200) {
    if (!message || message.length <= maxChars) return message;
    return message.slice(0, maxChars - 1) + "…";
}

function aiMentorClearOldestConversations() {
    const conversations = aiMentorState.conversationHistory.slice();
    if (conversations.length <= 1) {
        aiMentorClearAllConversations();
        return;
    }
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    conversations.pop();
    aiMentorState.conversationHistory = conversations;
    aiMentorStoreConversations(aiMentorState.conversationHistory);
    renderAiMentorConversationList();
}

function aiMentorClearAllConversations() {
    const key = aiMentorGetStorageKey();
    if (!key) return;
    if (window.confirm("Delete all conversation history?")) {
        localStorage.removeItem(key);
        aiMentorState.conversationHistory = [];
        aiMentorState.messages = [];
        aiMentorState.activeConversationId = null;
        renderAiMentorConversationList([]);
        renderAiMentorMessages();
        setAiMentorStatus("All conversation history cleared.", "success");
    }
}

function renderAiMentorConversationList(conversations) {
    const conversationList = document.getElementById("aiMentorConversationList");
    const historyEmpty = document.getElementById("aiMentorHistoryEmpty");
    const searchInput = document.getElementById("aiMentorHistorySearch");

    if (!conversationList || !historyEmpty) return;

    // Apply search filter
    const searchTerm = (searchInput ? searchInput.value.trim().toLowerCase() : "") || "";

    let filtered = conversations;
    if (searchTerm) {
        filtered = conversations.filter(conv =>
            conv.title.toLowerCase().includes(searchTerm) ||
            conv.lastUpdated.toLowerCase().includes(searchTerm)
        );
    }

    if (filtered.length === 0) {
        conversationList.hidden = true;
        historyEmpty.hidden = false;
        return;
    }

    conversationList.hidden = false;
    historyEmpty.hidden = true;

    // Sort by most recently updated
    filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    conversationList.replaceChildren();

    filtered.forEach((conv, index) => {
        const item = document.createElement("div");
        item.className = "ai-mentor-conversation-item";
        item.dataset.conversationId = String(conv.id);
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.setAttribute("aria-label", `Conversation: ${conv.title}, last updated ${new Date(conv.updatedAt).toLocaleDateString()}`);

        const title = document.createElement("span");
        title.className = "ai-mentor-conversation-title";
        title.textContent = conv.title;

        const date = document.createElement("span");
        date.className = "ai-mentor-conversation-date";
        date.textContent = `Updated ${new Date(conv.updatedAt).toLocaleDateString()} ${new Date(conv.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

        const actions = document.createElement("div");
        actions.className = "ai-mentor-conversation-actions";
        actions.innerHTML = `
            <button class="ai-mentor-conversation-action rename" data-action="rename" title="Rename">✎</button>
            <button class="ai-mentor-conversation-action delete" data-action="delete" title="Delete">×</button>
        `;

        item.append(title, date, actions);
        conversationList.append(item);

        // Event delegation will handle actions, but also add click for opening
        item.addEventListener("click", () => openAiMentorConversation(conv.id));
        actions.querySelector(".rename").addEventListener("click", e => {
            e.stopPropagation();
            const newTitle = window.prompt("Rename conversation:", conv.title);
            if (newTitle && newTitle.trim()) {
                aiMentorRenameConversation(conv.id, newTitle.trim());
            }
        });
        actions.querySelector(".delete").addEventListener("click", e => {
            e.stopPropagation();
            if (window.confirm("Delete this conversation?")) {
                aiMentorDeleteConversation(conv.id);
            }
        });
    });
}

function aiMentorRenameConversation(id, newTitle) {
    const conversations = aiMentorLoadConversations();
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;

    conv.title = newTitle;
    conv.updatedAt = new Date().toISOString();
    aiMentorSaveConversations(conversations);
    renderAiMentorConversationList(aiMentorLoadConversations());
}

function aiMentorDeleteConversation(id) {
    const conversations = aiMentorLoadConversations().filter(c => c.id !== id);
    aiMentorSaveConversations(conversations);
    renderAiMentorConversationList(aiMentorLoadConversations());
}

function aiMentorSaveCurrentConversation() {
    const firstUserMessage = aiMentorState.messages.find(m => m.role === "user")?.content;
    const title = aiMentorGenerateTitle(firstUserMessage || "");

    const newConversation = {
        id: Date.now(),
        title: title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: aiMentorState.messages.length,
        lastMode: aiMentorState.lastMode || "general"
    };

    let conversations = aiMentorLoadConversations();

    // Avoid duplicate: if the same title+first-message already exists, update it instead
    const existingIndex = conversations.findIndex(
        c => c.title === newConversation.title && c.messageCount === newConversation.messageCount
    );
    if (existingIndex >= 0) {
        conversations[existingIndex] = newConversation;
    } else {
        conversations.push(newConversation);
    }

    // Prune if over limit (keep last 50)
    if (conversations.length > 50) {
        conversations.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
        conversations.splice(0, conversations.length - 50);
    }

    aiMentorSaveConversations(conversations);
    renderAiMentorConversationList(aiMentorLoadConversations());
    return newConversation.id;
}

function openAiMentorConversation(conversationId) {
    // Prevent duplicate saves during rapid switching
    if (aiMentorState.loading) return;

    const conversation = (aiMentorState.conversationHistory || []).find(
        c => c.id === conversationId
    );
    if (!conversation) return;

    // Load messages from the conversation (copy to avoid shared references)
    aiMentorState.activeConversationId = conversationId;
    aiMentorState.messages = (conversation.messages || []).slice();
    aiMentorState.lastMode = conversation.lastMode || "general";
    aiMentorState.sessionToken += 1;
    invalidateAiMentorRequest();

    renderAiMentorMessages(true);
    updateAiMentorControls();

    // Close history panel
    if (aiMentorHistoryPanel) {
        aiMentorHistoryPanel.classList.remove("is-highlighted");
        aiMentorHistory?.setAttribute("aria-expanded", "false");
    }
}

function aiMentorInitHistory() {
    // Load saved conversations and render (reads from aiMentorState.conversationHistory,
    // which is populated after authentication in setAiMentorAuthenticated)
    renderAiMentorConversationList();

    // Initialize search input — filter conversation list by title or message content
    const searchInput = document.getElementById("aiMentorHistorySearch");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            renderAiMentorConversationList(e.target.value);
        });
    }

    // New chat creates a fresh conversation
    const newChatBtn = document.getElementById("aiMentorNewChat");
    if (newChatBtn) {
        newChatBtn.replaceWith(newChatBtn.cloneNode(true));
        const cloned = document.getElementById("aiMentorNewChat");
        cloned.addEventListener("click", () => {
            // Save the current conversation if it has messages and an active id
            if (aiMentorState.activeConversationId && aiMentorState.messages.length > 0) {
                aiMentorState.conversationHistory = aiMentorUpdateConversationHistory(
                    aiMentorState.conversationHistory,
                    aiMentorState.activeConversationId,
                    aiMentorState.messages
                );
                aiMentorStoreConversations(aiMentorState.conversationHistory);
            }
            // Start a fresh conversation
            aiMentorState.messages = [];
            aiMentorState.activeConversationId = null;
            aiMentorState.retryMessage = "";
            aiMentorState.mockInterviewScore = 0;
            setAiMentorStatus("");
            renderAiMentorMessages(true);
            renderAiMentorConversationList();
            openAiMentor();
            aiMentorInput?.focus();
        });
    }

    // Clear current chat — clears the active conversation's messages
    const clearChatBtn = document.getElementById("aiMentorClear");
    if (clearChatBtn) {
        clearChatBtn.replaceWith(clearChatBtn.cloneNode(true));
        const cloned = document.getElementById("aiMentorClear");
        cloned.addEventListener("click", () => {
            if (aiMentorState.messages.length === 0) return;
            aiMentorState.messages = [];
            aiMentorState.retryMessage = "";
            aiMentorState.mockInterviewScore = 0;
            setAiMentorStatus("");
            if (aiMentorState.activeConversationId) {
                aiMentorState.conversationHistory = aiMentorUpdateConversationHistory(
                    aiMentorState.conversationHistory,
                    aiMentorState.activeConversationId,
                    []
                );
                aiMentorStoreConversations(aiMentorState.conversationHistory);
            }
            renderAiMentorMessages(true);
            renderAiMentorConversationList();
            aiMentorInput?.focus();
        });
    }

    AI_MENTOR_FOLLOW_UPS = {
    general: [
        "What should I practice first?",
        "Turn that into a 30-minute task.",
        "How can I measure progress?"
    ],
    skill_analysis: [
        "Why does this skill matter for my career?",
        "Give me a beginner exercise for the top gap.",
        "How should I retest this skill?"
    ],
    roadmap: [
        "Make this plan fit my daily study time.",
        "Suggest a small portfolio project.",
        "What is my next task?"
    ],
    technical_interview: [
        "Ask the next technical question.",
        "Show me an improved example answer.",
        "Give me a hint without the answer."
    ],
    hr_interview: [
        "Ask the next HR question.",
        "Improve my introduction.",
        "What evidence should I include?"
    ],
    mock_interview: [
        "Ask the next mock interview question.",
        "Explain my score so far.",
        "Give me a stronger example answer."
    ],
    coding: [
        "Give me a hint only.",
        "Review my code without executing it.",
        "Explain the time and space complexity."
    ],
    resume_review: [
        "Improve this project description.",
        "Rewrite this as a truthful resume bullet.",
        "Create a concise interview introduction."
    ],
    placement_prep: [
        "Give me an aptitude practice question.",
        "Create a weekly preparation checklist.",
        "What should I prepare next?"
    ]
    };
}
const aiMentorWidget = document.getElementById("aiMentorWidget");
const aiMentorLauncher = document.getElementById("aiMentorLauncher");
const aiMentorMessages = document.getElementById("aiMentorMessages");
const aiMentorStatus = document.getElementById("aiMentorStatus");
const aiMentorStatusRow = document.querySelector(".ai-mentor-status-row");
const aiMentorRetry = document.getElementById("aiMentorRetry");
const aiMentorScore = document.getElementById("aiMentorScore");
const aiMentorHistory = document.getElementById("aiMentorHistory");
const aiMentorHistoryPanel = document.getElementById("aiMentorHistoryPanel");
const aiMentorHistorySummary = document.getElementById("aiMentorHistorySummary");
const aiMentorSettingsToggle = document.getElementById("aiMentorSettingsToggle");
const aiMentorSettings = document.getElementById("aiMentorSettings");
const aiMentorSidebar = document.getElementById("aiMentorSidebar");
const aiMentorSidebarToggle = document.getElementById("aiMentorSidebarToggle");
const aiMentorBackDashboard = document.getElementById("aiMentorBackDashboard");
const aiMentorAttachmentZone = document.getElementById("aiMentorAttachmentZone");
const aiMentorAttach = document.getElementById("aiMentorAttach");
const aiMentorFileInput = document.getElementById("aiMentorFileInput");
const aiMentorAttachmentPreview = document.getElementById("aiMentorAttachmentPreview");
const aiMentorAttachmentStatus = document.getElementById("aiMentorAttachmentStatus");
const AI_MENTOR_MAX_ATTACHMENTS = 4;
const AI_MENTOR_MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const AI_MENTOR_MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const AI_MENTOR_ATTACHMENT_EXTENSIONS = new Set([
    "png", "jpg", "jpeg", "webp", "pdf", "txt", "py", "java", "js", "html", "css", "json", "csv", "md"
]);
const aiMentorForm = document.getElementById("aiMentorForm");
const aiMentorInput = document.getElementById("aiMentorInput");
const aiMentorSend = document.getElementById("aiMentorSend");
const aiMentorStop = document.getElementById("aiMentorStop");
const aiMentorCareerSelect = document.getElementById("aiMentorCareerSelect");
const aiMentorStudyTime = document.getElementById("aiMentorStudyTime");
const aiMentorModeSelect = document.getElementById("aiMentorModeSelect");
const aiMentorLanguageSelect = document.getElementById("aiMentorLanguageSelect");
const aiMentorDifficultySelect = document.getElementById("aiMentorDifficultySelect");
const aiMentorSkillSelect = document.getElementById("aiMentorSkillSelect");

function appendAiMentorInlineContent(container, text) {
    text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__)/g).forEach(part => {
        if (!part) return;
        if (part.startsWith("`") && part.endsWith("`")) {
            const code = document.createElement("code");
            code.textContent = part.slice(1, -1);
            container.append(code);
            return;
        }
        if (
            (part.startsWith("**") && part.endsWith("**"))
            || (part.startsWith("__") && part.endsWith("__"))
        ) {
            const strong = document.createElement("strong");
            strong.textContent = part.slice(2, -2);
            container.append(strong);
            return;
        }
        container.append(document.createTextNode(part));
    });
}

function createAiMentorRobotIcon(className = "") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("aria-hidden", "true");
    svg.className.baseVal = className;
    const appendSvg = (tag, attributes) => {
        const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
        svg.append(element);
    };
    appendSvg("path", { class: "ai-mentor-avatar-antenna", d: "M24 11V6m0 0-3 3m3-3 3 3" });
    appendSvg("rect", { x: "8", y: "12", width: "32", height: "28", rx: "10" });
    appendSvg("circle", { cx: "18", cy: "25", r: "3" });
    appendSvg("circle", { cx: "30", cy: "25", r: "3" });
    appendSvg("path", { d: "M17 32c4 3 10 3 14 0" });
    return svg;
}

function appendAiMentorHighlightedCode(container, source) {
    const tokenPattern = /((?:#|\/\/|--)[^\n]*|`(?:\\.|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|class|return|if|else|elif|for|while|in|try|except|finally|import|from|as|const|let|var|function|new|async|await|public|private|static|void|select|where|join|group|by|order|insert|update|delete|create|table|and|or|not|true|false|null|none|this|self)\b|\b\d+(?:\.\d+)?\b)/gi;
    let cursor = 0;
    let match;
    while ((match = tokenPattern.exec(source)) !== null) {
        if (match.index > cursor) {
            container.append(document.createTextNode(source.slice(cursor, match.index)));
        }
        const token = match[0];
        const span = document.createElement("span");
        span.className = token.match(/^(#|\/\/|--)/)
            ? "ai-mentor-code-token comment"
            : token.match(/^[`'\"]/) 
                ? "ai-mentor-code-token string"
                : token.match(/^\d/)
                    ? "ai-mentor-code-token number"
                    : "ai-mentor-code-token keyword";
        span.textContent = token;
        container.append(span);
        cursor = match.index + token.length;
    }
    if (cursor < source.length) {
        container.append(document.createTextNode(source.slice(cursor)));
    }
}

function aiMentorMarkdownFragment(content) {
    const fragment = document.createDocumentFragment();
    const lines = content.split(/\r?\n/);
    let paragraphLines = [];
    let listElement = null;
    let codeLines = null;
    let codeLanguage = "";

    const flushParagraph = () => {
        if (!paragraphLines.length) return;
        const paragraph = document.createElement("p");
        appendAiMentorInlineContent(paragraph, paragraphLines.join(" "));
        fragment.append(paragraph);
        paragraphLines = [];
    };

    const flushList = () => {
        if (!listElement) return;
        fragment.append(listElement);
        listElement = null;
    };

    const flushCode = () => {
        if (!codeLines) return;
        const codeText = codeLines.join("\n");
        const codeBlock = document.createElement("div");
        codeBlock.className = "ai-mentor-code-block";
        const codeHeader = document.createElement("div");
        codeHeader.className = "ai-mentor-code-header";
        const language = document.createElement("span");
        language.textContent = codeLanguage || "code";
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "ai-mentor-code-copy";
        copyButton.dataset.aiMentorCode = codeText;
        copyButton.textContent = "Copy";
        copyButton.title = "Copy code";
        codeHeader.append(language, copyButton);
        const pre = document.createElement("pre");
        if (codeLanguage) pre.dataset.language = codeLanguage;
        const code = document.createElement("code");
        code.className = codeLanguage ? `language-${codeLanguage}` : "";
        appendAiMentorHighlightedCode(code, codeText);
        pre.append(code);
        codeBlock.append(codeHeader, pre);
        fragment.append(codeBlock);
        codeLines = null;
        codeLanguage = "";
    };

    lines.forEach(line => {
        const fence = line.match(/^\s*```\s*([\w+#-]*)\s*$/);
        if (fence) {
            if (codeLines !== null) {
                flushCode();
            } else {
                flushParagraph();
                flushList();
                codeLines = [];
                codeLanguage = fence[1].toLowerCase();
            }
            return;
        }

        if (codeLines !== null) {
            codeLines.push(line);
            return;
        }

        const listMatch = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);
        if (listMatch) {
            flushParagraph();
            const ordered = /^\s*\d+[.)]/.test(line);
            const listType = ordered ? "OL" : "UL";
            if (!listElement || listElement.tagName !== listType) {
                flushList();
                listElement = document.createElement(ordered ? "ol" : "ul");
            }
            const item = document.createElement("li");
            appendAiMentorInlineContent(item, listMatch[1]);
            listElement.append(item);
            return;
        }

        if (!line.trim()) {
            flushParagraph();
            flushList();
            return;
        }

        const headingMatch = line.match(/^\s*(#{1,3})\s+(.+)$/);
        if (headingMatch) {
            flushParagraph();
            flushList();
            const heading = document.createElement("strong");
            heading.className = "ai-mentor-heading";
            appendAiMentorInlineContent(heading, headingMatch[2]);
            fragment.append(heading);
            return;
        }

        flushList();
        paragraphLines.push(line.trim());
    });

    if (codeLines !== null) flushCode();
    flushParagraph();
    flushList();
    return fragment;
}

function formatAiMentorTime(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(date);
}

function aiMentorActionButton(label, action, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-mentor-message-action";
    button.dataset.aiMentorAction = action;
    button.dataset.messageIndex = String(index);
    button.textContent = label;
    button.title = label;
    return button;
}

function aiMentorMessageElement(role, content, loading = false, message = null, index = -1) {
    const row = document.createElement("div");
    row.className = `ai-mentor-message-row ${role}`;
    const body = document.createElement("div");
    body.className = "ai-mentor-message-body";
    const bubble = document.createElement("div");
    bubble.className = `ai-mentor-message${loading ? " loading" : ""}`;
    if (role === "assistant" && !loading) {
        bubble.append(aiMentorMarkdownFragment(content));
    } else {
        bubble.textContent = content;
    }
    if (loading) bubble.setAttribute("aria-label", "AI Mentor is thinking");
    body.append(bubble);
    if (!loading && role === "user") {
        appendAiMentorAttachmentMeta(body, message?.attachments);
    }

    if (!loading && message) {
        const meta = document.createElement("div");
        meta.className = "ai-mentor-message-meta";
        meta.append(assessmentElement("time", "ai-mentor-message-time", formatAiMentorTime(message.createdAt)));
        if (role === "assistant") {
            const actions = document.createElement("div");
            actions.className = "ai-mentor-message-actions";
            actions.append(
                aiMentorActionButton("Copy", "copy", index),
                aiMentorActionButton("Regenerate", "regenerate", index)
            );
            meta.append(actions);
        }
        body.append(meta);

        if (role === "assistant" && index === aiMentorState.messages.length - 1) {
            const followUps = document.createElement("div");
            followUps.className = "ai-mentor-follow-ups";
            (AI_MENTOR_FOLLOW_UPS[message.mode] || AI_MENTOR_FOLLOW_UPS.general)
                .forEach(prompt => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "ai-mentor-follow-up";
                    button.dataset.aiMentorFollowup = prompt;
                    button.textContent = prompt;
                    followUps.append(button);
                });
            body.append(followUps);
        }
    }

    if (role === "assistant") {
        const avatar = document.createElement("span");
        avatar.className = "ai-mentor-avatar";
        avatar.append(createAiMentorRobotIcon());
        row.append(avatar, body);
    } else {
        const avatar = document.createElement("span");
        avatar.className = "ai-mentor-user-avatar";
        avatar.setAttribute("aria-hidden", "true");
        row.append(body, avatar);
    }
    return row;
}

function aiMentorWelcomeElement() {
    const welcome = document.createElement("section");
    welcome.className = "ai-mentor-welcome";
    welcome.append(
        assessmentElement("p", "ai-mentor-welcome-kicker", "YOUR LOCAL CAREER COACH"),
        assessmentElement("h2", "", "What do you want to work on?"),
        assessmentElement("p", "ai-mentor-welcome-copy", "Choose a starting point or describe your goal. Your AI recommendations are not saved as application progress until you complete a task in Learning Progress.")
    );
    const cards = document.createElement("div");
    cards.className = "ai-mentor-feature-cards";
    [
        ["Skill gaps", "Use your verified assessment", "skill_analysis", "Analyze my strongest and weakest assessed skills and tell me what to practice next."],
        ["Roadmap", "Plan daily and weekly work", "roadmap", "Build a daily and weekly learning roadmap for my target career."],
        ["Interviews", "Practice one question at a time", "mock_interview", "Start a one-question-at-a-time mock interview for my target career."],
        ["Coding", "Hints before solutions", "coding", "Give me a coding practice exercise using my selected language and level."],
        ["Resume", "Improve only what I provide", "resume_review", "Review the resume text I paste and suggest truthful improvements."],
        ["Placement prep", "HR and aptitude practice", "placement_prep", "Create a practical weekly placement-preparation checklist without guarantees."]
    ].forEach(([title, description, mode, prompt]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ai-mentor-feature-card";
        button.dataset.aiMentorMode = mode;
        button.dataset.aiMentorPrompt = prompt;
        button.append(
            assessmentElement("strong", "", title),
            assessmentElement("span", "", description)
        );
        cards.append(button);
    });
    welcome.append(cards);
    const progressButton = document.createElement("button");
    progressButton.type = "button";
    progressButton.className = "ai-mentor-progress-link";
    progressButton.dataset.aiMentorOpenProgress = "true";
    progressButton.textContent = "Open my saved learning checklist →";
    welcome.append(progressButton);
    return welcome;
}

function renderAiMentorMessages(forceScroll = false) {
    if (!aiMentorMessages) return;

    const wasNearBottom = aiMentorMessages.scrollHeight
        - aiMentorMessages.scrollTop
        - aiMentorMessages.clientHeight < 72;
    aiMentorMessages.replaceChildren();
    aiMentorWidget?.classList.toggle(
        "has-conversation",
        aiMentorState.messages.length > 0
    );
    const totalMessages = aiMentorState.messages.length;
    if (aiMentorHistorySummary) {
        aiMentorHistorySummary.textContent = totalMessages
            ? `${totalMessages} messages in this conversation.`
            : "No messages yet. Start a new conversation.";
    }

    // Render conversation list in sidebar
    renderAiMentorConversationList();

    if (!aiMentorState.messages.length) {
        aiMentorMessages.append(aiMentorWelcomeElement());
    } else {
        aiMentorState.messages.forEach((message, index) => {
            aiMentorMessages.append(
                aiMentorMessageElement(message.role, message.content, false, message, index)
            );
        });
    }

    if (aiMentorState.loading) {
        aiMentorMessages.append(
            aiMentorMessageElement("assistant", "Thinking...", true)
        );
    }

    if (forceScroll || wasNearBottom) {
        const scrollToNewest = () => {
            aiMentorMessages.scrollTop = aiMentorMessages.scrollHeight;
        };
        if (typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(scrollToNewest);
        } else {
            scrollToNewest();
        }
    }
}

function renderAiMentorConversationList(filterText = "") {
    const conversationList = document.getElementById("aiMentorConversationList");
    const historyEmpty = document.getElementById("aiMentorHistoryEmpty");
    if (!conversationList || !aiMentorHistoryPanel) return;

    // Close any open conversation menu before re-rendering
    document.querySelectorAll(".ai-mentor-conversation-menu-items.open").forEach(el => {
        el.classList.remove("open");
        el.hidden = true;
    });

    const normalizedFilter = (filterText || "").toLowerCase().trim();

    let conversations = (aiMentorState.conversationHistory || []).slice();

    // Filter by title or message content when a search term is provided
    if (normalizedFilter) {
        conversations = conversations.filter(conv => {
            const title = (conv.title || "").toLowerCase();
            if (title.includes(normalizedFilter)) return true;
            return (conv.messages || []).some(m =>
                typeof m.content === "string" && m.content.toLowerCase().includes(normalizedFilter)
            );
        });
    }

    // Sort by lastUpdated (newest first), parsing ISO strings safely
    conversations.sort((a, b) => {
        const da = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
        const db = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
        return db - da;
    });

    if (!conversations.length) {
        conversationList.hidden = true;
        historyEmpty.hidden = false;
        historyEmpty.textContent = normalizedFilter
            ? "No conversations match your search."
            : "No conversations yet. Start a new chat.";
        return;
    }

    conversationList.hidden = false;
    historyEmpty.hidden = true;

    conversationList.replaceChildren();

    conversations.forEach((conv) => {
        const item = document.createElement("div");
        item.className = "ai-mentor-conversation-item";
        if (conv.id === aiMentorState.activeConversationId) {
            item.classList.add("is-selected");
        }
        item.dataset.conversationId = conv.id;
        item.role = "button";
        item.tabIndex = 0;
        item.setAttribute("aria-label", `Conversation: ${conv.title || "Untitled"}, last updated ${formatAiMentorTime(conv.lastUpdated || conv.createdAt)}`);

        const title = document.createElement("span");
        title.className = "ai-mentor-conversation-title";
        title.textContent = conv.title || "Untitled";
        title.title = conv.title || "Untitled";

        const menu = document.createElement("button");
        menu.type = "button";
        menu.className = "ai-mentor-conversation-menu";
        menu.setAttribute("aria-label", "Conversation options");

        const menuItems = document.createElement("div");
        menuItems.className = "ai-mentor-conversation-menu-items";
        menuItems.hidden = true;

        const renameItem = document.createElement("button");
        renameItem.type = "button";
        renameItem.className = "ai-mentor-conversation-menu-item";
        renameItem.textContent = "Rename";
        renameItem.addEventListener("click", (e) => {
            e.stopPropagation();
            closeMenu();
            openRenameDialog(conv);
        });

        const deleteItem = document.createElement("button");
        deleteItem.type = "button";
        deleteItem.className = "ai-mentor-conversation-menu-item danger";
        deleteItem.textContent = "Delete";
        deleteItem.addEventListener("click", (e) => {
            e.stopPropagation();
            closeMenu();
            openDeleteDialog(conv);
        });

        menuItems.append(renameItem, deleteItem);
        item.append(title, menu, menuItems);

        // Toggle menu on kebab click
        menu.addEventListener("click", (e) => {
            e.stopPropagation();
            if (openMenu && openMenu !== menuItems) {
                openMenu.classList.remove("open");
                openMenu.hidden = true;
            }
            const isOpen = !menuItems.classList.contains("open");
            if (isOpen) {
                menuItems.classList.add("open");
                menuItems.hidden = false;
                openMenu = menuItems;
            } else {
                menuItems.classList.remove("open");
                menuItems.hidden = true;
                openMenu = null;
            }
        });

        // Click row to open conversation (ignore menu clicks)
        item.addEventListener("click", (e) => {
            if (e.target.closest(".ai-mentor-conversation-menu, .ai-mentor-conversation-menu-items, .ai-mentor-conversation-menu-item")) return;
            closeMenu();
            openAiMentorConversation(conv.id);
        });

        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                closeMenu();
                openAiMentorConversation(conv.id);
            }
        });

        conversationList.append(item);
    });
}

/* Rename dialog state */
let renameDialogTarget = null;

function openRenameDialog(conv) {
    renameDialogTarget = conv;
    const input = document.getElementById("aiMentorRenameInput");
    const dialog = document.getElementById("aiMentorRenameDialog");
    const overlay = document.getElementById("aiMentorDialogOverlay");
    if (!input || !dialog || !overlay) return;
    input.value = conv.title || "";
    input.setSelectionRange(0, input.value.length);
    dialog.hidden = false;
    overlay.hidden = false;
    input.focus();
}

function closeRenameDialog() {
    const dialog = document.getElementById("aiMentorRenameDialog");
    const overlay = document.getElementById("aiMentorDialogOverlay");
    if (dialog) dialog.hidden = true;
    if (overlay) overlay.hidden = true;
    renameDialogTarget = null;
}

/* Delete dialog state */
let deleteDialogTarget = null;

function openDeleteDialog(conv) {
    deleteDialogTarget = conv;
    const msg = document.getElementById("aiMentorDeleteMessage");
    const dialog = document.getElementById("aiMentorDeleteDialog");
    const overlay = document.getElementById("aiMentorDialogOverlay");
    if (!msg || !dialog || !overlay) return;
    msg.textContent = `Delete conversation "${conv.title || "Untitled"}"?`;
    dialog.hidden = false;
    overlay.hidden = false;
}

function closeDeleteDialog() {
    const dialog = document.getElementById("aiMentorDeleteDialog");
    const overlay = document.getElementById("aiMentorDialogOverlay");
    if (dialog) dialog.hidden = true;
    if (overlay) overlay.hidden = true;
    deleteDialogTarget = null;
}

/* Close dialogs on Escape */
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const renameDlg = document.getElementById("aiMentorRenameDialog");
    const deleteDlg = document.getElementById("aiMentorDeleteDialog");
    const overlay = document.getElementById("aiMentorDialogOverlay");
    if (renameDlg && !renameDlg.hidden) {
        closeRenameDialog();
        return;
    }
    if (deleteDlg && !deleteDlg.hidden) {
        closeDeleteDialog();
        return;
    }
    if (overlay && !overlay.hidden) {
        overlay.hidden = true;
    }
});

function openAiMentorConversation(conversationId) {
    const conv = aiMentorState.conversationHistory.find(c => c.id === conversationId);
    if (!conv) return;

    aiMentorState.activeConversationId = conversationId;
    aiMentorState.messages = conv.messages;
    renderAiMentorMessages();
    openAiMentor();
    aiMentorInput?.focus();
}

function toggleAiMentorHistory() {
    if (!aiMentorHistoryPanel || !aiMentorHistory) return;
    const willFocus = !aiMentorHistoryPanel.classList.contains("is-highlighted");
    aiMentorHistoryPanel.classList.toggle("is-highlighted", willFocus);
    aiMentorHistory.setAttribute("aria-expanded", String(willFocus));
    if (willFocus) {
        aiMentorHistoryPanel.focus();
        aiMentorWidget?.classList.add("sidebar-open");
        // Render conversation list when opening history
        renderAiMentorConversationList();
        window.setTimeout(() => {
            aiMentorHistoryPanel.classList.remove("is-highlighted");
            aiMentorHistory.setAttribute("aria-expanded", "false");
        }, 1400);
    }
}

function focusAiMentorSettings() {
    if (!aiMentorSettingsToggle || !aiMentorSettings) return;
    const isHighlighted = aiMentorSettings.classList.toggle("is-highlighted");
    aiMentorSettingsToggle.setAttribute("aria-expanded", String(isHighlighted));
    if (isHighlighted) {
        aiMentorCareerSelect?.focus();
        aiMentorWidget?.classList.remove("sidebar-open");
        window.setTimeout(() => {
            aiMentorSettings.classList.remove("is-highlighted");
            aiMentorSettingsToggle.setAttribute("aria-expanded", "false");
        }, 1400);
    }
}

function setAiMentorStatus(message, type = "", retry = false) {
    if (aiMentorStatus) {
        aiMentorStatus.textContent = message;
        aiMentorStatus.className = `ai-mentor-status${type ? ` ${type}` : ""}`;
        aiMentorStatus.hidden = !message;
    }
    if (aiMentorRetry) aiMentorRetry.hidden = !retry;
    if (aiMentorStatusRow) aiMentorStatusRow.hidden = !message && !retry;
}

function updateAiMentorControls() {
    const hasMessage = Boolean(aiMentorInput?.value.trim());
    if (aiMentorSend) aiMentorSend.disabled = aiMentorState.loading || !hasMessage;
    if (aiMentorAttach) aiMentorAttach.disabled = aiMentorState.loading;
    if (aiMentorStop) {
        aiMentorStop.hidden = !aiMentorState.loading;
        aiMentorStop.disabled = !aiMentorState.loading;
    }
    document.querySelectorAll("[data-ai-mentor-prompt]").forEach(button => {
        button.disabled = aiMentorState.loading;
    });
}

function aiMentorFileExtension(file) {
    return file.name.split(".").pop()?.toLowerCase() || "";
}

function formatAiMentorFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setAiMentorAttachmentStatus(message, type = "") {
    if (!aiMentorAttachmentStatus) return;
    aiMentorAttachmentStatus.textContent = message;
    aiMentorAttachmentStatus.className = `ai-mentor-attachment-status${type ? ` ${type}` : ""}`;
    aiMentorAttachmentStatus.hidden = !message;
}

function revokeAiMentorPreviewUrls() {
    aiMentorState.previewUrls.forEach(url => URL.revokeObjectURL(url));
    aiMentorState.previewUrls = [];
}

function renderAiMentorAttachmentPreview() {
    if (!aiMentorAttachmentPreview) return;
    revokeAiMentorPreviewUrls();
    aiMentorAttachmentPreview.replaceChildren();
    aiMentorAttachmentPreview.hidden = aiMentorState.pendingAttachments.length === 0;

    aiMentorState.pendingAttachments.forEach((file, index) => {
        const item = document.createElement("div");
        item.className = "ai-mentor-attachment-item";
        const preview = document.createElement("span");
        preview.className = "ai-mentor-attachment-thumb";
        if (file.type.startsWith("image/")) {
            const image = document.createElement("img");
            const url = URL.createObjectURL(file);
            aiMentorState.previewUrls.push(url);
            image.src = url;
            image.alt = `Preview of ${file.name}`;
            preview.append(image);
        } else {
            preview.textContent = aiMentorFileExtension(file).toUpperCase() || "FILE";
        }
        const details = document.createElement("span");
        details.className = "ai-mentor-attachment-details";
        details.append(
            assessmentElement("strong", "", file.name),
            assessmentElement("small", "", `${aiMentorFileExtension(file).toUpperCase() || "FILE"} · ${formatAiMentorFileSize(file.size)}`)
        );
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ai-mentor-attachment-remove";
        remove.dataset.attachmentIndex = String(index);
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.title = "Remove attachment";
        remove.textContent = "×";
        item.append(preview, details, remove);
        aiMentorAttachmentPreview.append(item);
    });
}

function clearAiMentorAttachments() {
    revokeAiMentorPreviewUrls();
    aiMentorState.pendingAttachments = [];
    if (aiMentorFileInput) aiMentorFileInput.value = "";
    renderAiMentorAttachmentPreview();
    setAiMentorAttachmentStatus("");
}

function addAiMentorAttachments(fileList) {
    if (aiMentorState.loading) return;
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const accepted = [];
    const errors = [];
    let totalBytes = aiMentorState.pendingAttachments.reduce((sum, file) => sum + file.size, 0);

    for (const file of incoming) {
        const extension = aiMentorFileExtension(file);
        if (!AI_MENTOR_ATTACHMENT_EXTENSIONS.has(extension)) {
            errors.push(`${file.name}: unsupported file type`);
            continue;
        }
        if (file.size > AI_MENTOR_MAX_ATTACHMENT_BYTES) {
            errors.push(`${file.name}: exceeds the 4 MB limit`);
            continue;
        }
        if (aiMentorState.pendingAttachments.length + accepted.length >= AI_MENTOR_MAX_ATTACHMENTS) {
            errors.push(`Only ${AI_MENTOR_MAX_ATTACHMENTS} attachments are allowed`);
            break;
        }
        if (totalBytes + file.size > AI_MENTOR_MAX_TOTAL_ATTACHMENT_BYTES) {
            errors.push("The total attachment size must stay under 8 MB");
            break;
        }
        totalBytes += file.size;
        accepted.push(file);
    }

    if (accepted.length) {
        aiMentorState.pendingAttachments.push(...accepted);
        renderAiMentorAttachmentPreview();
        aiMentorInput?.focus();
    }
    if (aiMentorFileInput) aiMentorFileInput.value = "";
    setAiMentorAttachmentStatus(errors.join(" · "), errors.length ? "error" : "");
}

function appendAiMentorAttachmentMeta(container, files) {
    if (!files?.length) return;
    const list = document.createElement("div");
    list.className = "ai-mentor-message-attachments";
    files.forEach(file => {
        const item = document.createElement("span");
        item.className = "ai-mentor-message-attachment";
        item.textContent = `${aiMentorFileExtension(file).toUpperCase() || "FILE"} · ${file.name}`;
        list.append(item);
    });
    container.append(list);
}

function populateAiMentorPreferences() {
    if (!aiMentorCareerSelect) return;
    const previousCareer = aiMentorCareerSelect.value;
    const careers = Array.isArray(assessmentState.careers) ? assessmentState.careers : [];
    aiMentorCareerSelect.replaceChildren();
    const placeholder = assessmentElement("option", "", "Use my assessment career");
    placeholder.value = "";
    aiMentorCareerSelect.append(placeholder);
    careers.forEach(career => {
        const option = assessmentElement("option", "", career.name);
        option.value = career.key;
        aiMentorCareerSelect.append(option);
    });
    const assessmentCareer = assessmentState.career?.key || "";
    aiMentorCareerSelect.value = previousCareer || assessmentCareer;
    if (aiMentorCareerSelect.value !== previousCareer && !previousCareer) {
        aiMentorCareerSelect.value = assessmentCareer;
    }

    const selectedCareer = careers.find(career => career.key === aiMentorCareerSelect.value)
        || assessmentState.career;
    const previousSkill = aiMentorSkillSelect?.value || "";
    if (aiMentorSkillSelect) {
        aiMentorSkillSelect.replaceChildren();
        const skillPlaceholder = assessmentElement("option", "", "Choose a skill");
        skillPlaceholder.value = "";
        aiMentorSkillSelect.append(skillPlaceholder);
        (selectedCareer?.skills || []).forEach(skill => {
            const option = assessmentElement("option", "", skill.name);
            option.value = skill.key;
            aiMentorSkillSelect.append(option);
        });
        aiMentorSkillSelect.value = previousSkill;
    }
}

function setAiMentorMode(mode) {
    if (aiMentorModeSelect && [...aiMentorModeSelect.options].some(option => option.value === mode)) {
        aiMentorModeSelect.value = mode;
    }
    aiMentorState.lastMode = mode || "general";
}

function updateAiMentorMockScore(reply, mode) {
    if (mode !== "mock_interview") return;
    const scoreMatch = reply.match(
        /(?:score|rating)\s*(?:is|:)?\s*(10|[0-9])\s*(?:\/\s*10|out of\s*10)/i
    ) || reply.match(/\b(10|[0-9])\s*\/\s*10\b/);
    if (scoreMatch) {
        aiMentorState.mockInterviewScore = Math.max(
            0,
            Math.min(10, Number(scoreMatch[1]))
        );
    }
    if (aiMentorScore && aiMentorState.mockInterviewScore > 0) {
        aiMentorScore.textContent = `Current mock score: ${aiMentorState.mockInterviewScore}/10 · Feedback is guidance, not a placement guarantee.`;
        aiMentorScore.hidden = false;
    }
}

function aiMentorRequestPreferences(modeOverride = "") {
    const mode = modeOverride || aiMentorModeSelect?.value || aiMentorState.lastMode || "general";
    const preferences = {
        mode,
        study_minutes: Number(aiMentorStudyTime?.value || 30),
        career_key: aiMentorCareerSelect?.value || assessmentState.career?.key || null,
        target_skill: aiMentorSkillSelect?.value || null,
        language: aiMentorLanguageSelect?.value || "python",
        difficulty: aiMentorDifficultySelect?.value || "intermediate"
    };
    if (Number.isInteger(assessmentState.assessmentId) && assessmentState.assessmentId > 0) {
        preferences.assessment_id = assessmentState.assessmentId;
    }
    return preferences;
}

function invalidateAiMentorRequest() {
    aiMentorState.requestId += 1;
    aiMentorState.loading = false;
    if (aiMentorState.abortController) {
        aiMentorState.abortController.abort();
        aiMentorState.abortController = null;
    }
}

function setAiMentorAuthenticated(authenticated) {
    if (!authenticated) {
        aiMentorState.sessionToken += 1;
        invalidateAiMentorRequest();
        aiMentorState.messages = [];
        aiMentorState.conversationHistory = [];
        aiMentorState.open = false;
        aiMentorState.retryMessage = "";
        aiMentorState.mockInterviewScore = 0;
        aiMentorState.activeConversationId = null;
        clearAiMentorAttachments();
        aiMentorWidget?.classList.remove("sidebar-open");
        aiMentorSidebarToggle?.setAttribute("aria-expanded", "false");
        aiMentorHistoryPanel?.classList.remove("is-highlighted");
        aiMentorHistory?.setAttribute("aria-expanded", "false");
        aiMentorSettingsToggle?.setAttribute("aria-expanded", "false");
        if (aiMentorScore) {
            aiMentorScore.textContent = "";
            aiMentorScore.hidden = true;
        }
        if (aiMentorInput) {
            aiMentorInput.value = "";
            aiMentorInput.style.height = "";
        }
        if (aiMentorCareerSelect) aiMentorCareerSelect.value = "";
        if (aiMentorSkillSelect) aiMentorSkillSelect.value = "";
        if (aiMentorWidget) aiMentorWidget.hidden = true;
        if (aiMentorLauncher) {
            aiMentorLauncher.hidden = true;
            aiMentorLauncher.setAttribute("aria-expanded", "false");
        }
        setAiMentorStatus("");
        renderAiMentorMessages();
        updateAiMentorControls();
        return;
    }

    populateAiMentorPreferences();
    // Load this authenticated user's saved conversation history
    aiMentorState.conversationHistory = aiMentorLoadConversations();
    // Restore active conversation from history if available
    if (aiMentorState.conversationHistory && aiMentorState.conversationHistory.length > 0) {
        const recent = aiMentorState.conversationHistory[0];
        if (recent.id && aiMentorState.messages.length === 0) {
            aiMentorState.activeConversationId = recent.id;
            aiMentorState.messages = recent.messages.slice();
        }
    }
    if (aiMentorLauncher) aiMentorLauncher.hidden = false;
    renderAiMentorMessages(true);
    updateAiMentorControls();
}

function openAiMentor() {
    if (!currentAuthenticatedUser || !aiMentorWidget) return;
    aiMentorState.open = true;
    aiMentorWidget.hidden = false;
    aiMentorLauncher?.setAttribute("aria-expanded", "true");
    if (aiMentorLauncher) aiMentorLauncher.hidden = true;
    populateAiMentorPreferences();
    renderAiMentorMessages(true);
    aiMentorInput?.focus();
}

function closeAiMentor() {
    aiMentorState.open = false;
    if (aiMentorWidget) aiMentorWidget.hidden = true;
    aiMentorWidget?.classList.remove("sidebar-open");
    aiMentorSidebarToggle?.setAttribute("aria-expanded", "false");
    aiMentorHistoryPanel?.classList.remove("is-highlighted");
    aiMentorHistory?.setAttribute("aria-expanded", "false");
    aiMentorSettingsToggle?.setAttribute("aria-expanded", "false");
    if (aiMentorLauncher && currentAuthenticatedUser) {
        aiMentorLauncher.hidden = false;
        aiMentorLauncher.setAttribute("aria-expanded", "false");
    }
}

function setAiMentorSidebarOpen(open) {
    aiMentorWidget?.classList.toggle("sidebar-open", open);
    aiMentorSidebarToggle?.setAttribute("aria-expanded", String(open));
    if (aiMentorSidebarToggle) {
        aiMentorSidebarToggle.setAttribute(
            "aria-label",
            open ? "Close mentor sidebar" : "Open mentor sidebar"
        );
    }
}

function resetAiMentorConversation() {
    aiMentorState.sessionToken += 1;
    invalidateAiMentorRequest();
    // Preserve active conversation ID so New Chat can restore it
    const preservedId = aiMentorState.activeConversationId;
    aiMentorState.messages = [];
    aiMentorState.retryMessage = "";
    aiMentorState.mockInterviewScore = 0;
    clearAiMentorAttachments();
    aiMentorHistoryPanel?.classList.remove("is-highlighted");
    aiMentorHistory?.setAttribute("aria-expanded", "false");
    if (aiMentorScore) {
        aiMentorScore.textContent = "";
        aiMentorScore.hidden = true;
    }
    if (aiMentorInput) {
        aiMentorInput.value = "";
        aiMentorInput.style.height = "";
    }
    setAiMentorStatus("");
    renderAiMentorMessages(true);
    updateAiMentorControls();
    aiMentorInput?.focus();
    // If there was a previous conversation, restore it as the active one
    if (preservedId && aiMentorState.conversationHistory) {
        const prev = aiMentorState.conversationHistory.find(c => c.id === preservedId);
        if (prev) {
            aiMentorState.messages = prev.messages;
            aiMentorState.activeConversationId = preservedId;
        }
    }
}

function aiMentorConversationContext() {
    return aiMentorState.messages
        .slice(-8)
        .map(message => `${message.role === "user" ? "Learner" : "Mentor"}: ${message.content}`)
        .join("\n")
        .slice(-AI_MENTOR_CONTEXT_LIMIT);
}

async function sendAiMentorMessage(rawMessage, options = {}) {
    const message = rawMessage.trim();
    if (!message || aiMentorState.loading || !currentAuthenticatedUser) return;

    const mode = options.mode || aiMentorModeSelect?.value || aiMentorState.lastMode || "general";
    setAiMentorMode(mode);
    const context = aiMentorConversationContext();
    const sessionToken = aiMentorState.sessionToken;
    const requestId = ++aiMentorState.requestId;
    const appendUser = options.appendUser !== false;
    const attachments = options.attachments || (appendUser ? [...aiMentorState.pendingAttachments] : []);
    const attachmentMetadata = attachments.map(file => ({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size
    }));
    // Determine or generate conversation ID
    let conversationId = aiMentorState.activeConversationId;
    if (!conversationId) {
        // Check if we're appending to existing conversation or starting fresh
        if (aiMentorState.messages.length > 0 && aiMentorState.messages[0]?.attachments) {
            // Find the most recent conversation with similar structure
            const matching = aiMentorState.conversationHistory.find(c => c.messages.length === aiMentorState.messages.length);
            conversationId = matching ? matching.id : aiMentorState.activeConversationId;
        }
        if (!conversationId) {
            conversationId = aiMentorState.activeConversationId = aiMentorGenerateConversationId();
        }
    }
    if (
        appendUser
        || aiMentorState.messages.at(-1)?.role !== "user"
        || aiMentorState.messages.at(-1)?.content !== message
    ) {
        const userMessage = {
            role: "user",
            content: message,
            createdAt: new Date().toISOString(),
            mode
        };
        if (attachmentMetadata.length) userMessage.attachments = attachmentMetadata;
        aiMentorState.messages.push(userMessage);
        // Persist the user message immediately so it survives refresh or API failure
        aiMentorState.conversationHistory = aiMentorUpdateConversationHistory(
            aiMentorState.conversationHistory,
            conversationId,
            aiMentorState.messages
        );
        aiMentorStoreConversations(aiMentorState.conversationHistory);
    }
    aiMentorState.retryMessage = "";
    aiMentorState.loading = true;
    aiMentorState.abortController = new AbortController();
    setAiMentorStatus("");
    renderAiMentorMessages(true);
    updateAiMentorControls();

    try {
        const preferences = aiMentorRequestPreferences(mode);
        const payload = { message, context, ...preferences };
        let requestData = payload;
        if (attachments.length) {
            requestData = new FormData();
            requestData.append("payload", JSON.stringify(payload));
            attachments.forEach(file => {
                requestData.append("attachments", file, file.name);
            });
        }
        const result = await assessmentRequest(
            "/chat",
            requestData,
            "POST",
            { signal: aiMentorState.abortController.signal }
        );

        if (typeof result.reply !== "string" || !result.reply.trim()) {
            throw new Error("AI Mentor returned an empty response.");
        }

        if (
            requestId === aiMentorState.requestId
            && sessionToken === aiMentorState.sessionToken
        ) {
            const reply = result.reply.trim();
            aiMentorState.messages.push({
                role: "assistant",
                content: reply,
                createdAt: new Date().toISOString(),
                mode
            });
            aiMentorState.activeConversationId = conversationId;
            aiMentorState.conversationHistory = aiMentorUpdateConversationHistory(
                aiMentorState.conversationHistory,
                conversationId,
                aiMentorState.messages
            );
            aiMentorStoreConversations(aiMentorState.conversationHistory);
            renderAiMentorMessages();
            updateAiMentorControls();
        }
    } catch (error) {
        if (
            requestId !== aiMentorState.requestId
            || sessionToken !== aiMentorState.sessionToken
        ) {
            return;
        }
        if (error.name === "AbortError") {
            setAiMentorStatus("Generation stopped.");
        } else if (error.status === 401) {
            setNavbarGuest();
            window.location.href = "login.html";
            return;
        } else {
            aiMentorState.retryMessage = message;
            setAiMentorStatus(
                error.message || "AI Mentor is unavailable right now.",
                "error",
                error.status === 503 || !error.status
            );
        }
    } finally {
        if (requestId !== aiMentorState.requestId) return;
        aiMentorState.abortController = null;
        aiMentorState.loading = false;
        clearAiMentorAttachments();
        renderAiMentorMessages();
        updateAiMentorControls();
    }
}

async function copyAiMentorResponse(content) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(content);
        } else {
            const helper = document.createElement("textarea");
            helper.value = content;
            helper.setAttribute("readonly", "true");
            helper.style.position = "fixed";
            helper.style.opacity = "0";
            document.body.append(helper);
            helper.select();
            document.execCommand("copy");
            helper.remove();
        }
        showToast("AI response copied.");
    } catch (error) {
        showToast("Unable to copy this response.");
    }
}

function regenerateAiMentorResponse(index) {
    if (aiMentorState.loading) return;
    const assistantMessage = aiMentorState.messages[index];
    const userMessage = aiMentorState.messages[index - 1];
    if (!assistantMessage || assistantMessage.role !== "assistant" || userMessage?.role !== "user") return;
    aiMentorState.messages = aiMentorState.messages.slice(0, index);
    setAiMentorStatus("");
    sendAiMentorMessage(userMessage.content, {
        appendUser: false,
        mode: userMessage.mode || assistantMessage.mode || "general"
    });
}

function stopAiMentorGeneration() {
    if (!aiMentorState.loading) return;
    invalidateAiMentorRequest();
    clearAiMentorAttachments();
    aiMentorState.retryMessage = "";
    setAiMentorStatus("Generation stopped.");
    renderAiMentorMessages();
    updateAiMentorControls();
}

aiMentorLauncher?.addEventListener("click", openAiMentor);
document.getElementById("aiMentorClose")?.addEventListener("click", closeAiMentor);
aiMentorSidebarToggle?.addEventListener("click", () => {
    setAiMentorSidebarOpen(!aiMentorWidget?.classList.contains("sidebar-open"));
});
aiMentorBackDashboard?.addEventListener("click", () => {
    closeAiMentor();
    showView("home");
});
aiMentorHistory?.addEventListener("click", toggleAiMentorHistory);
aiMentorSettingsToggle?.addEventListener("click", focusAiMentorSettings);
aiMentorStop?.addEventListener("click", stopAiMentorGeneration);
aiMentorAttach?.addEventListener("click", () => aiMentorFileInput?.click());
aiMentorFileInput?.addEventListener("change", event => {
    addAiMentorAttachments(event.target.files);
});
aiMentorAttachmentPreview?.addEventListener("click", event => {
    const remove = event.target.closest("[data-attachment-index]");
    if (!remove) return;
    const index = Number(remove.dataset.attachmentIndex);
    if (!Number.isInteger(index) || index < 0) return;
    aiMentorState.pendingAttachments.splice(index, 1);
    renderAiMentorAttachmentPreview();
    setAiMentorAttachmentStatus("");
});
aiMentorAttachmentZone?.addEventListener("dragover", event => {
    if (aiMentorState.loading) return;
    event.preventDefault();
    aiMentorAttachmentZone.classList.add("is-dragging");
});
aiMentorAttachmentZone?.addEventListener("dragleave", event => {
    if (!aiMentorAttachmentZone.contains(event.relatedTarget)) {
        aiMentorAttachmentZone.classList.remove("is-dragging");
    }
});
aiMentorAttachmentZone?.addEventListener("drop", event => {
    event.preventDefault();
    aiMentorAttachmentZone.classList.remove("is-dragging");
    addAiMentorAttachments(event.dataTransfer?.files);
});
aiMentorRetry?.addEventListener("click", () => {
    if (aiMentorState.retryMessage) {
        sendAiMentorMessage(aiMentorState.retryMessage, { appendUser: false });
    }
});

aiMentorForm?.addEventListener("submit", event => {
    event.preventDefault();
    const message = aiMentorInput?.value.trim();
    if (!message) return;
    aiMentorInput.value = "";
    aiMentorInput.style.height = "";
    sendAiMentorMessage(message);
});

aiMentorInput?.addEventListener("input", () => {
    aiMentorInput.style.height = "auto";
    aiMentorInput.style.height = `${Math.min(aiMentorInput.scrollHeight, 132)}px`;
    updateAiMentorControls();
});

aiMentorInput?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        aiMentorForm?.requestSubmit();
    }
});

aiMentorModeSelect?.addEventListener("change", event => {
    setAiMentorMode(event.target.value);
});
aiMentorCareerSelect?.addEventListener("change", populateAiMentorPreferences);

aiMentorWidget?.addEventListener("click", event => {
    const codeButton = event.target.closest("[data-ai-mentor-code]");
    if (codeButton) {
        copyAiMentorResponse(codeButton.dataset.aiMentorCode || "");
        return;
    }

    const progressButton = event.target.closest("[data-ai-mentor-open-progress]");
    if (progressButton) {
        closeAiMentor();
        showView("progress");
        loadLearningProgress();
        return;
    }

    const promptButton = event.target.closest("[data-ai-mentor-prompt]");
    if (promptButton && !promptButton.disabled) {
        const mode = promptButton.dataset.aiMentorMode || aiMentorModeSelect?.value || "general";
        setAiMentorMode(mode);
        sendAiMentorMessage(promptButton.dataset.aiMentorPrompt || "", { mode });
        return;
    }

    const followupButton = event.target.closest("[data-ai-mentor-followup]");
    if (followupButton && !aiMentorState.loading) {
        sendAiMentorMessage(followupButton.dataset.aiMentorFollowup || "");
        return;
    }

    const actionButton = event.target.closest("[data-ai-mentor-action]");
    if (!actionButton || aiMentorState.loading) return;
    const index = Number(actionButton.dataset.messageIndex);
    const message = aiMentorState.messages[index];
    if (!message) return;
    if (actionButton.dataset.aiMentorAction === "copy") {
        copyAiMentorResponse(message.content);
    } else if (actionButton.dataset.aiMentorAction === "regenerate") {
        regenerateAiMentorResponse(index);
    }
});

/* Dialog button handlers */
document.getElementById("aiMentorRenameCancel")?.addEventListener("click", closeRenameDialog);
document.getElementById("aiMentorRenameSave")?.addEventListener("click", () => {
    const input = document.getElementById("aiMentorRenameInput");
    const dialog = document.getElementById("aiMentorRenameDialog");
    if (!renameDialogTarget || !input || !dialog) return;
    const newTitle = input.value.trim();
    if (!newTitle) {
        closeRenameDialog();
        return;
    }
    renameDialogTarget.title = newTitle;
    renameDialogTarget.updatedAt = new Date().toISOString();
    const idx = aiMentorState.conversationHistory.findIndex(c => c.id === renameDialogTarget.id);
    if (idx >= 0) {
        aiMentorState.conversationHistory[idx] = { ...aiMentorState.conversationHistory[idx], ...renameDialogTarget };
    }
    aiMentorStoreConversations(aiMentorState.conversationHistory);
    renderAiMentorConversationList();
    closeRenameDialog();
});

document.getElementById("aiMentorDeleteCancel")?.addEventListener("click", closeDeleteDialog);
document.getElementById("aiMentorDeleteConfirm")?.addEventListener("click", () => {
    if (!deleteDialogTarget) {
        closeDeleteDialog();
        return;
    }
    const deletedId = deleteDialogTarget.id;
    aiMentorState.conversationHistory = aiMentorState.conversationHistory.filter(
        c => c.id !== deletedId
    );
    aiMentorStoreConversations(aiMentorState.conversationHistory);
    renderAiMentorConversationList();
    if (aiMentorState.activeConversationId === deletedId) {
        aiMentorState.activeConversationId = null;
        aiMentorState.messages = [];
        renderAiMentorMessages();
    }
    closeDeleteDialog();
});

document.getElementById("aiMentorClearHistory")?.addEventListener("click", () => {
    if (aiMentorState.conversationHistory.length === 0) return;
    if (!window.confirm("Delete all conversation history?")) return;
    aiMentorState.conversationHistory = [];
    aiMentorState.messages = [];
    aiMentorState.activeConversationId = null;
    aiMentorStoreConversations([]);
    renderAiMentorConversationList();
    renderAiMentorMessages();
    setAiMentorStatus("All conversation history cleared.", "success");
});

renderAiMentorMessages();
updateAiMentorControls();

const learningProgressState = {
    data: null,
    requestId: 0,
    requestPromise: null,
    requestPromiseId: null,
    mutationPromise: null
};

function assertLearningProgressPayload(result) {
    if (
        !result
        || typeof result !== "object"
        || !result.summary
        || !Array.isArray(result.tasks)
        || !Array.isArray(result.skills)
    ) {
        throw new Error("The learning progress response was incomplete. Please try again.");
    }

    return result;
}

function applyLearningProgress(result) {
    const current = assertLearningProgressPayload(result);
    learningProgressState.data = current;
    renderLearningProgress(current);
    return current;
}

function setLearningProgressStatus(message, type = "") {
    const status = document.getElementById("learningProgressStatus");

    if (!status) return;

    status.textContent = message;
    status.className = `assessment-message${type ? ` ${type}` : ""}`;
    status.hidden = !message;
}

function updateLearningProgressRing(ring, percent) {
    if (!ring) return;

    const boundedPercent = Math.max(0, Math.min(100, percent));
    ring.style.background = `conic-gradient(var(--blue) 0 ${boundedPercent}%, #e5eaf2 ${boundedPercent}% 100%)`;
    ring.setAttribute("aria-label", `${boundedPercent}% overall progress`);
}

function updateLearningProgressDashboard(summary) {
    const percent = Number(summary.completion_percentage || 0);
    const percentElements = [
        document.getElementById("learningProgressPercent"),
        document.getElementById("learningOverviewPercent")
    ];

    percentElements.forEach(element => {
        if (!element) return;
        element.replaceChildren(document.createTextNode(String(percent)));
        const suffix = document.createElement("small");
        suffix.textContent = "%";
        element.append(suffix);
    });

    updateLearningProgressRing(
        document.getElementById("learningProgressRing"),
        percent
    );
    updateLearningProgressRing(
        document.getElementById("learningOverviewRing"),
        percent
    );

    const total = Number(summary.total_tasks || 0);
    const completed = Number(summary.completed_tasks || 0);
    const inProgress = Number(summary.in_progress_tasks || 0);
    const completedPercent = total ? completed / total * 100 : 0;
    const inProgressPercent = total ? inProgress / total * 100 : 0;
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };
    const setWidth = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.style.width = `${value}%`;
    };

    setText("learningInProgressCount", String(inProgress).padStart(2, "0"));
    setText("learningCompletedCount", String(completed).padStart(2, "0"));
    setText("learningTotalCount", String(total).padStart(2, "0"));
    setWidth("learningInProgressBar", inProgressPercent);
    setWidth("learningCompletedBar", completedPercent);
    setWidth("learningTotalBar", total ? 100 : 0);

    const message = total
        ? `${completed} of ${total} learning tasks completed.`
        : "Start an assessment to generate your learning roadmap.";
    setText("learningProgressMessage", message);
    setText("learningOverviewMessage", message);
    setText("learningProgressHeadline", total ? "Keep building momentum" : "Every step counts");
    setText("learningOverviewHeadline", total ? `${completed} of ${total} tasks complete` : "No tasks yet");
}

function renderLearningProgress(data) {
    const summary = data.summary || {};
    const summaryContainer = document.getElementById("learningProgressSummary");
    const skillsContainer = document.getElementById("learningProgressSkills");
    const tasksContainer = document.getElementById("learningTasksList");
    const taskCount = document.getElementById("learningTaskCount");

    updateLearningProgressDashboard(summary);

    if (summaryContainer) {
        summaryContainer.replaceChildren();
        [
            ["Total tasks", summary.total_tasks || 0, "Roadmap activities"],
            ["Completed", summary.completed_tasks || 0, "Finished activities"],
            ["In progress", summary.in_progress_tasks || 0, "Active activities"],
            ["Not started", summary.not_started_tasks || 0, "Ready when you are"]
        ].forEach(([label, value, detail]) => {
            const card = assessmentElement("article", "assessment-summary-card");
            card.append(
                assessmentElement("p", "stat-label", label),
                assessmentElement("strong", "stat-number", String(value)),
                assessmentElement("p", "muted", detail)
            );
            summaryContainer.append(card);
        });
    }

    if (skillsContainer) {
        skillsContainer.replaceChildren();
        if (!data.skills || !data.skills.length) {
            skillsContainer.append(
                assessmentElement("p", "learning-task-empty", "No skill progress yet. Complete an assessment to create roadmap tasks.")
            );
        } else {
            data.skills.forEach(skill => {
                const card = assessmentElement("article", "learning-skill-card");
                const top = assessmentElement("div", "learning-skill-card-top");
                top.append(
                    assessmentElement("h3", "", skill.skill_name),
                    assessmentElement("strong", "", `${skill.completion_percentage}%`)
                );
                const track = assessmentElement("div", "learning-progress-track");
                const fill = document.createElement("span");
                fill.style.width = `${skill.completion_percentage}%`;
                track.append(fill);
                card.append(
                    top,
                    track,
                    assessmentElement(
                        "p",
                        "learning-skill-counts",
                        `${skill.completed_tasks} completed · ${skill.in_progress_tasks} in progress · ${skill.not_started_tasks} not started`
                    )
                );
                skillsContainer.append(card);
            });
        }
    }

    if (taskCount) {
        taskCount.textContent = `${data.tasks?.length || 0} task${data.tasks?.length === 1 ? "" : "s"}`;
    }

    if (!tasksContainer) return;

    tasksContainer.replaceChildren();
    if (!data.tasks || !data.tasks.length) {
        tasksContainer.append(
            assessmentElement("p", "learning-task-empty", "No roadmap tasks are available yet. Complete a skill assessment to build your learning plan.")
        );
        return;
    }

    data.tasks.forEach(task => {
        const card = assessmentElement("article", "learning-task-card");
        const top = assessmentElement("div", "learning-task-card-top");
        const copy = document.createElement("div");
        copy.append(
            assessmentElement("h3", "", task.title),
            assessmentElement(
                "p",
                "muted",
                `${task.skill_name} · ${task.priority} priority · Target level ${task.target_level}/5`
            )
        );
        const statusClass = task.status === "Completed"
            ? "completed"
            : task.status === "In Progress" ? "in-progress" : "";
        top.append(
            copy,
            assessmentElement("span", `learning-task-status ${statusClass}`, task.status)
        );
        const actions = assessmentElement("div", "learning-task-actions");
        ["Not Started", "In Progress", "Completed"].forEach(status => {
            const button = assessmentElement("button", "", status);
            button.type = "button";
            button.dataset.taskId = task.id;
            button.dataset.taskStatus = status;
            button.classList.toggle("active", task.status === status);
            button.setAttribute("aria-label", `${status}: ${task.title}`);
            actions.append(button);
        });
        card.append(
            top,
            assessmentElement("p", "learning-task-meta", task.activity),
            actions
        );
        tasksContainer.append(card);
    });
}

function loadLearningProgress() {
    if (learningProgressState.mutationPromise) {
        return learningProgressState.mutationPromise
            .then(() => loadLearningProgress())
            .catch(() => null);
    }

    if (
        learningProgressState.requestPromise
        && learningProgressState.requestPromiseId === learningProgressState.requestId
    ) {
        return learningProgressState.requestPromise;
    }

    const requestId = ++learningProgressState.requestId;
    setLearningProgressStatus("Loading learning progress...", "loading");

    const requestPromise = assessmentRequest("/learning-progress")
        .then(result => {
            if (requestId !== learningProgressState.requestId) {
                return result;
            }

            applyLearningProgress(result);
            setLearningProgressStatus("");
            return result;
        })
        .catch(error => {
            if (requestId === learningProgressState.requestId) {
                setLearningProgressStatus(error.message, "error");
            }
            return null;
        })
        .finally(() => {
            if (learningProgressState.requestPromise === requestPromise) {
                learningProgressState.requestPromise = null;
                learningProgressState.requestPromiseId = null;
            }
        });

    learningProgressState.requestPromise = requestPromise;
    learningProgressState.requestPromiseId = requestId;
    return requestPromise;
}

function openLearningProgress() {
    showView("progress");
    loadLearningProgress();
}

function openHome() {
    showView("home");
    loadLearningProgress();
}

function bindLearningTaskUpdates() {
    const tasksList = document.getElementById("learningTasksList");

    if (!tasksList || tasksList.dataset.progressBound === "true") return;

    tasksList.dataset.progressBound = "true";
    tasksList.addEventListener("click", event => {
        const button = event.target.closest("[data-task-id][data-task-status]");

        if (!button || learningProgressState.mutationPromise) return;

        const requestedStatus = button.dataset.taskStatus;
        const wasAlreadyCompleted = requestedStatus === "Completed"
            && button.classList.contains("active");

        document.querySelectorAll("#learningTasksList button").forEach(item => {
            item.disabled = true;
        });
        setLearningProgressStatus("Saving task progress...", "loading");
        const mutationId = ++learningProgressState.requestId;
        let mutationPromise;

        mutationPromise = assessmentRequest(
            `/learning-progress/${button.dataset.taskId}`,
            { status: button.dataset.taskStatus },
            "PATCH"
        )
            .then(result => {
                if (mutationId !== learningProgressState.requestId) {
                    return result;
                }

                applyLearningProgress(result);
                setLearningProgressStatus("Learning progress saved.", "success");
                if (requestedStatus === "Completed" && !wasAlreadyCompleted) {
                    refreshNotificationCount();
                }
                return result;
            })
            .catch(error => {
                setLearningProgressStatus(error.message, "error");
                return null;
            })
            .finally(() => {
                if (learningProgressState.mutationPromise === mutationPromise) {
                    learningProgressState.mutationPromise = null;
                }
                document.querySelectorAll("#learningTasksList button").forEach(item => {
                    item.disabled = false;
                });
            });

        learningProgressState.mutationPromise = mutationPromise;
    });
}

bindLearningTaskUpdates();

function setAssessmentStatus(message, type = "") {
    const status = document.getElementById("assessmentStatus");

    if (!status) return;

    status.textContent = message;
    status.className = `assessment-message${type ? ` ${type}` : ""}`;
    status.hidden = !message;
}

function setAssessmentInlineMessage(id, message) {
    const element = document.getElementById(id);

    if (!element) return;

    element.textContent = message;
    element.hidden = !message;
}

function showAssessmentPanel(panelId) {
    [
        "assessmentSetupPanel",
        "selfAssessmentPanel",
        "quizPanel",
        "assessmentResultsPanel"
    ].forEach(id => {
        const panel = document.getElementById(id);

        if (panel) {
            panel.hidden = id !== panelId;
        }
    });
}

function assessmentElement(tag, className, text = "") {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    element.textContent = text;
    return element;
}

function renderCareerPreview(career) {
    const description = document.getElementById("careerDescription");
    const preview = document.getElementById("careerSkillsPreview");
    const startButton = document.getElementById("startCareerBtn");

    if (!description || !preview || !startButton) return;

    preview.replaceChildren();

    if (!career) {
        description.textContent = "Select a career to see its required skills.";
        startButton.disabled = true;
        return;
    }

    description.textContent = career.description;

    career.skills.forEach(skill => {
        const chip = assessmentElement(
            "span",
            "assessment-skill-chip",
            `${skill.name} · Target ${skill.target_level}/5`
        );
        preview.append(chip);
    });

    startButton.disabled = false;
}

function renderCareerOptions(careers) {
    const select = document.getElementById("careerSelect");

    if (!select) return;

    select.replaceChildren();

    const placeholder = assessmentElement(
        "option",
        "",
        "Choose a career goal"
    );
    placeholder.value = "";
    select.append(placeholder);

    careers.forEach(career => {
        const option = assessmentElement("option", "", career.name);
        option.value = career.key;
        select.append(option);
    });

    select.disabled = false;
    renderCareerPreview(null);
}

async function loadAssessmentHome() {
    if (assessmentHomeRequest) {
        return assessmentHomeRequest;
    }

    if (assessmentState.careersLoaded && assessmentState.latestLoaded) {
        return;
    }

    assessmentHomeRequest = (async () => {
        setAssessmentStatus("Loading assessment options...", "loading");

        try {
            const [careerResponse, latestResponse] = await Promise.all([
                assessmentRequest("/assessment/careers"),
                assessmentRequest("/assessment/latest")
            ]);

            assessmentState.careers = careerResponse.careers || [];
            assessmentState.careersLoaded = true;
            assessmentState.latestLoaded = true;
            renderCareerOptions(assessmentState.careers);

            if (latestResponse.assessment) {
                assessmentState.assessmentId = latestResponse.assessment.id || null;
                assessmentState.career = assessmentState.careers.find(
                    career => career.key === latestResponse.assessment.career_key
                ) || {
                    key: latestResponse.assessment.career_key,
                    name: latestResponse.assessment.career_name,
                    skills: []
                };
                populateAiMentorPreferences();
                renderAssessmentResults(latestResponse);
                showAssessmentPanel("assessmentResultsPanel");
                setAssessmentStatus(
                    "Your latest completed assessment is ready.",
                    "success"
                );
            } else {
                assessmentState.assessmentId = null;
                assessmentState.career = null;
                populateAiMentorPreferences();
                showAssessmentPanel("assessmentSetupPanel");
                setAssessmentStatus(
                    "No completed assessment yet. Choose a career goal to begin."
                );
            }
        } catch (error) {
            setAssessmentStatus(error.message, "error");
            showAssessmentPanel("assessmentSetupPanel");
        } finally {
            assessmentHomeRequest = null;
        }
    })();

    return assessmentHomeRequest;
}

function openAssessment() {
    showView("skills");
    loadAssessmentHome();
}

document.getElementById("startAssessmentBtn")
    ?.addEventListener("click", openAssessment);

document.getElementById("exploreSkillsBtn")
    ?.addEventListener("click", openAssessment);

document.getElementById("careerSelect")?.addEventListener("change", event => {
    assessmentState.career = assessmentState.careers.find(
        career => career.key === event.target.value
    ) || null;
    renderCareerPreview(assessmentState.career);
});

async function startCareerAssessment(event) {
    event.preventDefault();
    event.stopPropagation();

    const careerSelect = document.getElementById("careerSelect");
    const startButton = document.getElementById("startCareerBtn");
    const careerKey = careerSelect?.value;

    if (!careerKey) {
        setAssessmentStatus("Choose a career goal before continuing.", "error");
        return;
    }

    startButton.disabled = true;
    setAssessmentStatus("Starting your assessment...", "loading");

    try {
        const result = await assessmentRequest(
            "/assessment/start",
            { career_key: careerKey },
            "POST"
        );

        if (!result.assessment_id || !result.career || !Array.isArray(result.questions)) {
            throw new Error("The assessment response was incomplete. Please try again.");
        }

        assessmentState.assessmentId = result.assessment_id;
        assessmentState.career = result.career;
        assessmentState.questions = result.questions;
        assessmentState.answers = {};
        assessmentState.currentQuestion = 0;
        renderSelfAssessment(result.career);
        showAssessmentPanel("selfAssessmentPanel");
        setAssessmentStatus(result.message, "success");
    } catch (error) {
        console.error("[SkillGapper] assessment:start-failed", error);
        setAssessmentStatus(error.message, "error");
    } finally {
        startButton.disabled = false;
    }
}

function bindStartCareerAssessment() {
    const startButton = document.getElementById("startCareerBtn");

    if (!startButton) {
        console.error("[SkillGapper] assessment:start-button-not-found");
        return;
    }

    if (startButton.dataset.assessmentBound === "true") {
        return;
    }

    startButton.dataset.assessmentBound = "true";
    startButton.addEventListener("click", startCareerAssessment);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindStartCareerAssessment, { once: true });
} else {
    bindStartCareerAssessment();
}

function renderSelfAssessment(career) {
    const list = document.getElementById("selfRatingList");

    if (!list) return;

    list.replaceChildren();

    career.skills.forEach(skill => {
        const card = assessmentElement("article", "assessment-skill-card");
        const copy = assessmentElement("div", "assessment-skill-copy");
        const title = assessmentElement("h3", "", skill.name);
        const target = assessmentElement(
            "p",
            "muted",
            `Target level: ${skill.target_level}/5`
        );
        copy.append(title, target);

        const label = assessmentElement("label", "assessment-rating-label", "Your level");
        const select = document.createElement("select");
        select.className = "assessment-rating";
        select.dataset.skill = skill.key;
        select.setAttribute("aria-label", `${skill.name} self-rating`);

        const placeholder = assessmentElement("option", "", "Select 1 to 5");
        placeholder.value = "";
        select.append(placeholder);

        for (let level = 1; level <= 5; level += 1) {
            const option = assessmentElement(
                "option",
                "",
                `${level} - ${[
                    "New to it",
                    "Basic exposure",
                    "Can use with guidance",
                    "Comfortable",
                    "Can apply independently"
                ][level - 1]}`
            );
            option.value = String(level);
            select.append(option);
        }

        select.addEventListener("change", updateSelfAssessmentProgress);
        label.append(select);
        card.append(copy, label);
        list.append(card);
    });

    updateSelfAssessmentProgress();
}

function updateSelfAssessmentProgress() {
    const controls = [
        ...document.querySelectorAll("#selfRatingList .assessment-rating")
    ];
    const completed = controls.filter(control => control.value).length;
    const progress = document.getElementById("selfAssessmentProgress");

    if (progress) {
        progress.textContent = `${completed} of ${controls.length} rated`;
    }

    setAssessmentInlineMessage("selfAssessmentError", "");
}

document.getElementById("submitSelfAssessmentBtn")
    ?.addEventListener("click", async () => {
        const controls = [
            ...document.querySelectorAll("#selfRatingList .assessment-rating")
        ];
        const missingControl = controls.find(control => !control.value);

        if (missingControl) {
            setAssessmentInlineMessage(
                "selfAssessmentError",
                "Rate every listed skill before continuing."
            );
            missingControl.focus();
            return;
        }

        const ratings = Object.fromEntries(
            controls.map(control => [control.dataset.skill, Number(control.value)])
        );
        const button = document.getElementById("submitSelfAssessmentBtn");
        button.disabled = true;
        setAssessmentInlineMessage("selfAssessmentError", "");
        setAssessmentStatus("Saving your self-assessment...", "loading");

        try {
            const result = await assessmentRequest(
                `/assessment/${assessmentState.assessmentId}/self-assessment`,
                { ratings },
                "POST"
            );

            renderQuizQuestion();
            showAssessmentPanel("quizPanel");
            setAssessmentStatus(result.message, "success");
        } catch (error) {
            setAssessmentInlineMessage("selfAssessmentError", error.message);
            setAssessmentStatus(error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

function quizSkillName(skillKey) {
    const skill = assessmentState.career?.skills.find(
        item => item.key === skillKey
    );
    return skill ? skill.name : skillKey;
}

function renderQuizQuestion() {
    const question = assessmentState.questions[assessmentState.currentQuestion];
    const progress = document.getElementById("quizProgress");
    const skill = document.getElementById("quizSkill");
    const prompt = document.getElementById("quizQuestion");
    const options = document.getElementById("quizOptions");
    const previousButton = document.getElementById("quizPreviousBtn");
    const nextButton = document.getElementById("quizNextBtn");
    const submitButton = document.getElementById("quizSubmitBtn");
    const progressBar = document.getElementById("quizProgressBar");
    const answerStatus = document.getElementById("quizAnswerStatus");

    if (!progress || !skill || !prompt || !options) return;

    options.replaceChildren();
    setAssessmentInlineMessage("quizError", "");

    if (!question) {
        progress.textContent = "No quiz questions";
        if (progressBar) progressBar.style.width = "0%";
        if (answerStatus) answerStatus.textContent = "No questions assigned";
        skill.textContent = "";
        prompt.textContent = "No quiz questions are available for this career yet.";
        previousButton.disabled = true;
        nextButton.hidden = true;
        submitButton.hidden = false;
        renderQuizQuestionNavigator();
        return;
    }

    progress.textContent = `Question ${assessmentState.currentQuestion + 1} of ${assessmentState.questions.length}`;
    skill.textContent = quizSkillName(question.skill_key);
    prompt.textContent = question.prompt;

    question.options.forEach(option => {
        const label = document.createElement("label");
        label.className = "quiz-option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "quizAnswer";
        input.value = option.key;
        input.checked = assessmentState.answers[question.key] === option.key;
        input.addEventListener("change", () => {
            assessmentState.answers[question.key] = input.value;
            setAssessmentInlineMessage("quizError", "");
            updateQuizProgressIndicators();
        });
        const text = assessmentElement("span", "", option.text);
        label.append(input, text);
        options.append(label);
    });

    previousButton.disabled = assessmentState.currentQuestion === 0;
    nextButton.hidden = assessmentState.currentQuestion === assessmentState.questions.length - 1;
    submitButton.hidden = !nextButton.hidden;
    if (progressBar) {
        progressBar.style.width = `${(
            (assessmentState.currentQuestion + 1) / assessmentState.questions.length
        ) * 100}%`;
    }
    if (answerStatus) {
        const answered = Object.keys(assessmentState.answers).length;
        answerStatus.textContent = `${answered} of ${assessmentState.questions.length} answered · ${assessmentState.questions.length - answered} unanswered`;
    }
    renderQuizQuestionNavigator();
}

function updateQuizProgressIndicators() {
    const answerStatus = document.getElementById("quizAnswerStatus");
    const answered = Object.keys(assessmentState.answers).length;
    const total = assessmentState.questions.length;

    if (answerStatus) {
        answerStatus.textContent = `${answered} of ${total} answered · ${total - answered} unanswered`;
    }

    document.querySelectorAll("#quizQuestionNavigator button").forEach((button, index) => {
        const question = assessmentState.questions[index];
        const isAnswered = Boolean(question && assessmentState.answers[question.key]);
        button.classList.toggle("answered", isAnswered);
        button.setAttribute("aria-label", `Question ${index + 1}${isAnswered ? ", answered" : ", unanswered"}`);
    });
}

function renderQuizQuestionNavigator() {
    const navigator = document.getElementById("quizQuestionNavigator");

    if (!navigator) return;

    navigator.replaceChildren();
    assessmentState.questions.forEach((question, index) => {
        const button = document.createElement("button");
        const isAnswered = Boolean(assessmentState.answers[question.key]);
        button.type = "button";
        button.textContent = String(index + 1);
        button.classList.toggle("answered", isAnswered);
        button.classList.toggle("current", index === assessmentState.currentQuestion);
        button.setAttribute(
            "aria-label",
            `Question ${index + 1}${isAnswered ? ", answered" : ", unanswered"}`
        );
        button.addEventListener("click", () => {
            assessmentState.currentQuestion = index;
            renderQuizQuestion();
        });
        navigator.append(button);
    });
}

document.getElementById("quizPreviousBtn")
    ?.addEventListener("click", () => {
        if (assessmentState.currentQuestion === 0) return;

        assessmentState.currentQuestion -= 1;
        renderQuizQuestion();
    });

document.getElementById("quizNextBtn")
    ?.addEventListener("click", () => {
        assessmentState.currentQuestion += 1;
        renderQuizQuestion();
    });

document.getElementById("quizSubmitBtn")
    ?.addEventListener("click", async () => {
        const unanswered = assessmentState.questions.filter(
            question => !assessmentState.answers[question.key]
        );

        if (unanswered.length) {
            const shouldSubmit = window.confirm(
                `${unanswered.length} question${unanswered.length === 1 ? " is" : "s are"} unanswered. Submit anyway? Unanswered questions count as unanswered in your results.`
            );

            if (!shouldSubmit) {
                const firstUnanswered = assessmentState.questions.findIndex(
                    question => !assessmentState.answers[question.key]
                );
                assessmentState.currentQuestion = firstUnanswered;
                renderQuizQuestion();
                setAssessmentInlineMessage("quizError", "Answer the highlighted questions or confirm submission with unanswered questions.");
                return;
            }
        }

        const button = document.getElementById("quizSubmitBtn");
        button.disabled = true;
        setAssessmentInlineMessage("quizError", "");
        setAssessmentStatus("Scoring your quiz and preparing your roadmap...", "loading");

        try {
            const result = await assessmentRequest(
                `/assessment/${assessmentState.assessmentId}/quiz`,
                { answers: assessmentState.answers },
                "POST"
            );

            renderAssessmentResults(result);
            showAssessmentPanel("assessmentResultsPanel");
            setAssessmentStatus(result.message, "success");
            refreshNotificationCount();
        } catch (error) {
            setAssessmentInlineMessage("quizError", error.message);
            setAssessmentStatus(error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

function renderAssessmentResults(data) {
    const assessment = data.assessment || {};
    const summary = data.summary || {};
    const title = document.getElementById("assessmentResultsTitle");
    const note = document.getElementById("assessmentResultsNote");
    const summaryContainer = document.getElementById("assessmentSummary");
    const skillsContainer = document.getElementById("assessmentResultsSkills");
    const strengthsContainer = document.getElementById("assessmentStrengths");
    const prioritiesContainer = document.getElementById("assessmentPriorities");
    const roadmapContainer = document.getElementById("assessmentRoadmap");
    const rulesContainer = document.getElementById("assessmentScoringRules");

    if (!title || !note || !summaryContainer || !skillsContainer) return;

    title.textContent = `${assessment.career_name || "Career"} skill-gap analysis`;
    note.textContent = `${summary.summary_message || "Review your skill breakdown and learning roadmap."} This initial knowledge assessment is a guide for your learning plan, not a professional certification.`;

    const totalQuestions = Number(summary.total_questions ?? summary.quiz_total ?? 0);
    const correctAnswers = Number(summary.correct_answers ?? summary.quiz_correct ?? 0);
    const attemptedAnswers = Number(summary.quiz_attempted ?? totalQuestions);
    const incorrectAnswers = Number(
        summary.incorrect_answers
        ?? summary.quiz_incorrect
        ?? Math.max(attemptedAnswers - correctAnswers, 0)
    );
    const unansweredQuestions = Number(
        summary.unanswered_questions
        ?? summary.quiz_unanswered
        ?? Math.max(totalQuestions - attemptedAnswers, 0)
    );
    const overallPercent = Number(
        summary.overall_percent
        ?? summary.quiz_percent
        ?? (totalQuestions ? correctAnswers / totalQuestions * 100 : 0)
    );

    summaryContainer.replaceChildren();
    [
        {
            label: "Total questions",
            value: String(totalQuestions),
            detail: "Assigned to this quiz"
        },
        {
            label: "Correct",
            value: String(correctAnswers),
            detail: "Answers scored correct"
        },
        {
            label: "Incorrect",
            value: String(incorrectAnswers),
            detail: "Answers scored incorrect"
        },
        {
            label: "Unanswered",
            value: String(unansweredQuestions),
            detail: "Questions left blank"
        },
        {
            label: "Overall score",
            value: `${overallPercent}%`,
            detail: "Correct / assigned"
        },
        {
            label: "Strengths",
            value: String(summary.strength_count || 0),
            detail: "At or above target"
        },
        {
            label: "Priority skills",
            value: String(summary.priority_count || 0),
            detail: "Areas to develop next"
        }
    ].forEach(item => {
        const card = assessmentElement("article", "assessment-summary-card");
        card.append(
            assessmentElement("p", "stat-label", item.label),
            assessmentElement("strong", "stat-number", item.value),
            assessmentElement("p", "muted", item.detail)
        );
        summaryContainer.append(card);
    });

    skillsContainer.replaceChildren();
    (data.skills || []).forEach(result => {
        const card = assessmentElement("article", "assessment-result-card");
        const header = assessmentElement("div", "assessment-result-card-top");
        const copy = document.createElement("div");
        const quizTotal = Number(result.quiz_total ?? 0);
        const quizCorrect = Number(result.quiz_correct ?? 0);
        const quizAttempted = Number(result.quiz_attempted ?? quizTotal);
        const quizIncorrect = Number(
            result.quiz_incorrect ?? Math.max(quizAttempted - quizCorrect, 0)
        );
        const quizUnanswered = Number(
            result.quiz_unanswered ?? Math.max(quizTotal - quizAttempted, 0)
        );
        const quizPercent = Number(
            result.quiz_percent
            ?? (quizTotal ? quizCorrect / quizTotal * 100 : 0)
        );
        const assessed = result.assessed !== false && quizTotal > 0;
        const requiredLevel = result.required_level ?? result.target_level;
        const estimatedLevel = assessed
            ? (result.estimated_level ?? result.combined_level)
            : null;
        const priority = assessed ? result.priority : "Unassessed";
        copy.append(
            assessmentElement("h3", "", result.skill_name),
            assessmentElement("p", "muted", assessed
                ? `${priority} priority · Required ${requiredLevel}/5`
                : `Unassessed · Required ${requiredLevel}/5`)
        );
        const level = assessmentElement(
            "strong",
            `assessment-priority-${priority.toLowerCase()}`,
            estimatedLevel === null || estimatedLevel === undefined
                ? "Unassessed"
                : `${estimatedLevel}/5`
        );
        header.append(copy, level);
        const track = assessmentElement("div", "assessment-result-track");
        const fill = document.createElement("span");
        fill.style.width = estimatedLevel === null || estimatedLevel === undefined
            ? "0%"
            : `${Math.max(0, Math.min(100, estimatedLevel / 5 * 100))}%`;
        track.append(fill);
        const details = assessmentElement(
            "div",
            "assessment-result-details",
            assessed
                ? `Attempted: ${quizAttempted}/${quizTotal} · Correct: ${quizCorrect} · Incorrect: ${quizIncorrect} · Unanswered: ${quizUnanswered} · Quiz: ${quizPercent}% · Self-rating: ${result.self_rating}/5 · Estimated: ${estimatedLevel}/5 · Gap: ${result.gap}`
                : `Attempted: 0/0 · Quiz: Unassessed · Self-rating: ${result.self_rating}/5 · Estimated level and gap: Unassessed`
        );
        const reason = assessmentElement("p", "assessment-result-reason", result.priority_reason);
        card.append(header, track, details, reason);
        skillsContainer.append(card);
    });

    renderAssessmentTags(strengthsContainer, data.strengths, "No strengths recorded yet.");
    prioritiesContainer.replaceChildren();

    if (!data.priorities || !data.priorities.length) {
        prioritiesContainer.append(
            assessmentElement("p", "assessment-empty", "No improvement priorities yet.")
        );
    } else {
        data.priorities.forEach(priority => {
            const item = assessmentElement("article", "assessment-priority-item");
            item.append(
                assessmentElement("strong", "", `${priority.skill_name} · ${priority.priority}`),
                assessmentElement("p", "muted", priority.priority_reason)
            );
            prioritiesContainer.append(item);
        });
    }

    roadmapContainer.replaceChildren();

    if (!data.roadmap || !data.roadmap.length) {
        roadmapContainer.append(
            assessmentElement("p", "assessment-empty", "You are at or above the current targets. Keep practicing to maintain your strengths.")
        );
    } else {
        data.roadmap.forEach((item, index) => {
            const roadmapItem = assessmentElement("article", "assessment-roadmap-item");
            const rank = assessmentElement("span", "assessment-roadmap-rank", String(index + 1));
            const copy = document.createElement("div");
            copy.append(
                assessmentElement("strong", "", `${item.skill_name} · ${item.priority}`),
                assessmentElement("p", "muted", `Target level: ${item.target_level}/5`),
                assessmentElement("p", "assessment-activity", item.activity)
            );
            roadmapItem.append(rank, copy);
            roadmapContainer.append(roadmapItem);
        });
    }

    rulesContainer.replaceChildren();
    (data.scoring_rules || []).forEach(rule => {
        rulesContainer.append(assessmentElement("li", "", rule));
    });
}

function renderAssessmentTags(container, tags, emptyText) {
    if (!container) return;

    container.replaceChildren();

    if (!tags || !tags.length) {
        container.append(assessmentElement("p", "assessment-empty", emptyText));
        return;
    }

    tags.forEach(tag => {
        container.append(assessmentElement("span", "assessment-result-tag", tag));
    });
}

document.getElementById("startNewAssessmentBtn")
    ?.addEventListener("click", () => {
        assessmentState.assessmentId = null;
        assessmentState.career = null;
        assessmentState.questions = [];
        assessmentState.answers = {};
        assessmentState.currentQuestion = 0;
        const select = document.getElementById("careerSelect");

        if (select) {
            select.value = "";
        }

        renderCareerPreview(null);
        showAssessmentPanel("assessmentSetupPanel");
        setAssessmentStatus("Choose a career goal to begin a new assessment.");
    });


/* ==========================================
   6. NOTIFICATIONS
========================================== */

document.getElementById("notificationBtn")
    ?.addEventListener("click", () => {
        showToast(
            "You're all caught up! Keep learning and growing."
        );
    });


/* ==========================================
   7. CREATE COMMUNITY POSTS
========================================== */

const postForm = document.getElementById("postForm");
const postInput = document.getElementById("postInput");
const postList = document.getElementById("postList");
const postEmptyState = document.getElementById("postEmptyState");
const postStatus = document.getElementById("postStatus");
const postCharacterCount = document.getElementById("postCharacterCount");
const publishPostButton = document.getElementById("publishPostBtn");
const deletePostDialog = document.getElementById("deletePostDialog");
const confirmDeletePostButton = document.getElementById("confirmDeletePostBtn");
const cancelDeletePostButton = document.getElementById("cancelDeletePostBtn");
const deletePostError = document.getElementById("deletePostError");
const postsState = {
    items: [],
    loaded: false,
    listRequest: null,
    pendingDeleteId: null
};

function setPostStatus(message, type = "") {
    if (!postStatus) return;
    postStatus.textContent = message;
    postStatus.className = `post-status${type ? ` ${type}` : ""}`;
    postStatus.hidden = !message;
}

function postInitials(name) {
    return String(name || "Student")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toLocaleUpperCase())
        .join("") || "S";
}

function formatPostDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(date);
}

function makePostAction(label, action, postId, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `post-menu-item${className ? ` ${className}` : ""}`;
    button.dataset.postAction = action;
    button.dataset.postId = String(postId);
    button.textContent = label;
    return button;
}

function createPostCard(post) {
    const card = document.createElement("article");
    card.className = "post-card";
    card.dataset.postId = String(post.id);

    const header = document.createElement("div");
    header.className = "post-card-header";
    const author = document.createElement("div");
    author.className = "post-author";
    const avatar = assessmentElement("span", "post-avatar", postInitials(post.author_name));
    avatar.setAttribute("aria-hidden", "true");
    const details = document.createElement("div");
    details.className = "post-author-details";
    const authorName = assessmentElement("strong", "", post.author_name);
    const createdAt = document.createElement("time");
    createdAt.dateTime = post.created_at;
    createdAt.textContent = formatPostDate(post.created_at);
    details.append(authorName, createdAt);
    author.append(avatar, details);
    header.append(author);

    if (currentAuthenticatedUser && post.user_id === currentAuthenticatedUser.id) {
        const menuContainer = document.createElement("div");
        menuContainer.className = "post-menu-container";
        const menuId = `post-menu-${post.id}`;
        const menuButton = assessmentElement("button", "post-menu-trigger", "⋮");
        menuButton.type = "button";
        menuButton.dataset.postAction = "toggle-menu";
        menuButton.dataset.postId = String(post.id);
        menuButton.setAttribute("aria-label", `Post options for ${post.author_name}`);
        menuButton.setAttribute("aria-haspopup", "true");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-controls", menuId);
        const menu = document.createElement("div");
        menu.className = "post-menu-dropdown";
        menu.id = menuId;
        menu.hidden = true;
        menu.append(
            makePostAction("Edit post", "edit", post.id),
            makePostAction("Delete post", "delete", post.id, "delete")
        );
        menuContainer.append(menuButton, menu);
        header.append(menuContainer);
    }

    const content = assessmentElement("p", "post-text", post.content);
    content.dataset.postContent = "true";

    const editor = document.createElement("form");
    editor.className = "post-editor";
    editor.hidden = true;
    const editorTextarea = document.createElement("textarea");
    editorTextarea.maxLength = 500;
    editorTextarea.setAttribute("aria-label", "Edit post content");
    editorTextarea.value = post.content;
    const editorFooter = document.createElement("div");
    editorFooter.className = "post-editor-footer";
    const editorCount = assessmentElement("span", "post-editor-count", `${post.content.length} / 500`);
    const editorActions = document.createElement("div");
    editorActions.className = "post-editor-actions";
    const cancelButton = assessmentElement("button", "outline-button", "Cancel");
    cancelButton.type = "button";
    cancelButton.dataset.postAction = "cancel-edit";
    cancelButton.dataset.postId = String(post.id);
    const saveButton = assessmentElement("button", "primary-button", "Save Changes");
    saveButton.type = "submit";
    editorActions.append(cancelButton, saveButton);
    editorFooter.append(editorCount, editorActions);
    const editorError = assessmentElement("p", "post-editor-error");
    editorError.hidden = true;
    editorError.dataset.postEditorError = "true";
    editor.append(editorTextarea, editorFooter, editorError);
    editorTextarea.addEventListener("input", () => {
        editorCount.textContent = `${editorTextarea.value.length} / 500`;
        editorError.hidden = true;
    });
    editor.addEventListener("submit", async event => {
        event.preventDefault();
        const contentValue = editorTextarea.value.trim();
        if (!contentValue) {
            editorError.textContent = "Post content cannot be empty.";
            editorError.hidden = false;
            editorTextarea.focus();
            return;
        }

        saveButton.disabled = true;
        try {
            const result = await assessmentRequest(
                `/posts/${post.id}`,
                { content: contentValue },
                "PATCH"
            );
            postsState.items = postsState.items.map(item =>
                item.id === post.id ? result.post : item
            );
            renderPosts();
            setPostStatus("Your post was updated.", "success");
        } catch (error) {
            editorError.textContent = error.message;
            editorError.hidden = false;
            saveButton.disabled = false;
        }
    });

    const actions = document.createElement("div");
    actions.className = "post-actions";
    const likeButton = document.createElement("button");
    likeButton.type = "button";
    likeButton.className = `post-action-button${post.liked_by_me ? " liked" : ""}`;
    likeButton.dataset.postAction = "like";
    likeButton.dataset.postId = String(post.id);
    likeButton.setAttribute("aria-pressed", String(post.liked_by_me));
    likeButton.append(
        assessmentElement("span", "", post.liked_by_me ? "♥" : "♡"),
        assessmentElement("span", "", `${post.like_count} ${post.like_count === 1 ? "like" : "likes"}`)
    );
    const replyButton = assessmentElement("button", "post-action-button", "Reply");
    replyButton.type = "button";
    replyButton.dataset.postAction = "reply";
    replyButton.dataset.postId = String(post.id);
    actions.append(likeButton, replyButton);
    card.append(header, content, editor, actions);
    return card;
}

function renderPosts() {
    if (!postList) return;
    postList.replaceChildren(...postsState.items.map(createPostCard));
    if (postEmptyState) {
        postEmptyState.hidden = !postsState.loaded || postsState.items.length > 0;
    }
}

async function loadPosts(refresh = false) {
    if (!currentAuthenticatedUser || !postList) return;
    if (postsState.listRequest) return postsState.listRequest;
    if (postsState.loaded && !refresh) return postsState.items;

    postsState.loaded = false;
    renderPosts();
    setPostStatus("Loading community posts…");
    postsState.listRequest = assessmentRequest("/posts")
        .then(result => {
            postsState.items = Array.isArray(result.posts) ? result.posts : [];
            postsState.loaded = true;
            renderPosts();
            setPostStatus("");
            return postsState.items;
        })
        .catch(error => {
            setPostStatus(error.message, "error");
            return null;
        })
        .finally(() => {
            postsState.listRequest = null;
        });
    return postsState.listRequest;
}

function updatePostComposer() {
    if (!postInput || !publishPostButton) return;
    const length = postInput.value.length;
    if (postCharacterCount) {
        postCharacterCount.textContent = `${length} / 500`;
        postCharacterCount.classList.toggle("near-limit", length >= 450 && length < 500);
        postCharacterCount.classList.toggle("at-limit", length >= 500);
    }
    publishPostButton.disabled = !postInput.value.trim();
}

if (postForm && postInput && postList) {
    postInput.addEventListener("input", () => {
        updatePostComposer();
        setPostStatus("");
    });
    updatePostComposer();

    postForm.addEventListener("submit", async event => {
        event.preventDefault();
        const content = postInput.value.trim();
        if (!content) {
            updatePostComposer();
            return;
        }

        publishPostButton.disabled = true;
        setPostStatus("Publishing your post…");
        try {
            const result = await assessmentRequest("/posts", { content }, "POST");
            postsState.items.unshift(result.post);
            postsState.loaded = true;
            renderPosts();
            postInput.value = "";
            updatePostComposer();
            setPostStatus("Your post was published.", "success");
        } catch (error) {
            setPostStatus(error.message, "error");
            updatePostComposer();
        }
    });

    postList.addEventListener("click", async event => {
        const button = event.target.closest("[data-post-action]");
        if (!button) return;

        const postId = Number(button.dataset.postId);
        const post = postsState.items.find(item => item.id === postId);
        if (!post) return;
        const action = button.dataset.postAction;

        if (action === "toggle-menu") {
            const menu = button.parentElement.querySelector(".post-menu-dropdown");
            const willOpen = menu.hidden;
            postList.querySelectorAll(".post-menu-dropdown").forEach(item => { item.hidden = true; });
            postList.querySelectorAll(".post-menu-trigger").forEach(item => item.setAttribute("aria-expanded", "false"));
            menu.hidden = !willOpen;
            button.setAttribute("aria-expanded", String(willOpen));
            return;
        }

        if (action === "edit") {
            const card = button.closest(".post-card");
            card.querySelector(".post-menu-dropdown").hidden = true;
            card.querySelector(".post-menu-trigger").setAttribute("aria-expanded", "false");
            card.querySelector("[data-post-content]").hidden = true;
            const editor = card.querySelector(".post-editor");
            editor.hidden = false;
            editor.querySelector("textarea").focus();
            return;
        }

        if (action === "cancel-edit") {
            const card = button.closest(".post-card");
            card.querySelector(".post-editor").hidden = true;
            card.querySelector("[data-post-content]").hidden = false;
            return;
        }

        if (action === "delete") {
            postList.querySelectorAll(".post-menu-dropdown").forEach(item => { item.hidden = true; });
            postList.querySelectorAll(".post-menu-trigger").forEach(item => item.setAttribute("aria-expanded", "false"));
            postsState.pendingDeleteId = postId;
            if (deletePostError) deletePostError.hidden = true;
            if (confirmDeletePostButton) confirmDeletePostButton.disabled = false;
            deletePostDialog?.showModal();
            return;
        }

        if (action === "like") {
            button.disabled = true;
            const method = post.liked_by_me ? "DELETE" : "POST";
            try {
                const result = await assessmentRequest(
                    `/posts/${post.id}/like`,
                    null,
                    method
                );
                postsState.items = postsState.items.map(item => item.id === post.id
                    ? { ...item, liked_by_me: result.liked, like_count: result.like_count }
                    : item);
                renderPosts();
            } catch (error) {
                button.disabled = false;
                setPostStatus(error.message, "error");
            }
            return;
        }

        if (action === "reply") {
            showToast("Comments and replies will be added in a future update.");
        }
    });

    document.addEventListener("click", event => {
        if (event.target.closest(".post-menu-container")) return;
        postList.querySelectorAll(".post-menu-dropdown").forEach(menu => { menu.hidden = true; });
        postList.querySelectorAll(".post-menu-trigger").forEach(button => button.setAttribute("aria-expanded", "false"));
    });

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        postList.querySelectorAll(".post-menu-dropdown").forEach(menu => { menu.hidden = true; });
        postList.querySelectorAll(".post-menu-trigger").forEach(button => button.setAttribute("aria-expanded", "false"));
    });
}

cancelDeletePostButton?.addEventListener("click", () => {
    postsState.pendingDeleteId = null;
    deletePostDialog?.close();
});

confirmDeletePostButton?.addEventListener("click", async () => {
    const postId = postsState.pendingDeleteId;
    if (!postId) return;

    confirmDeletePostButton.disabled = true;
    if (deletePostError) {
        deletePostError.textContent = "Deleting post…";
        deletePostError.hidden = false;
    }
    try {
        await assessmentRequest(`/posts/${postId}`, null, "DELETE");
        postsState.items = postsState.items.filter(post => post.id !== postId);
        postsState.pendingDeleteId = null;
        renderPosts();
        deletePostDialog?.close();
        setPostStatus("Your post was deleted.", "success");
    } catch (error) {
        if (deletePostError) {
            deletePostError.textContent = error.message;
            deletePostError.hidden = false;
        }
        confirmDeletePostButton.disabled = false;
    }
});

deletePostDialog?.addEventListener("close", () => {
    postsState.pendingDeleteId = null;
    if (confirmDeletePostButton) confirmDeletePostButton.disabled = false;
});


/* ==========================================
   10. EDIT PROFILE
========================================== */

const profileFormCard = document.getElementById("profileFormCard");
const profileForm = document.getElementById("profileForm");
const profileNameInput = document.getElementById("nameInput");
const profileFormError = document.getElementById("profileFormError");
const saveProfileButton = document.getElementById("saveProfileBtn");
const cancelProfileButton = document.getElementById("cancelProfileBtn");

document.getElementById("editProfileBtn")
    ?.addEventListener("click", () => {
        if (!profileFormCard || !currentAuthenticatedUser) return;
        profileNameInput.value = currentAuthenticatedUser.name;
        profileFormCard.hidden = false;
        if (profileFormError) profileFormError.hidden = true;
        profileNameInput.focus();
    });

if (profileForm && profileFormCard) {
    profileForm.addEventListener("submit", async event => {
        event.preventDefault();
        const name = profileNameInput?.value.trim();

        if (!name || name.length > 100) {
            if (profileFormError) {
                profileFormError.textContent = !name
                    ? "Enter your name to continue."
                    : "Name must be 100 characters or fewer.";
                profileFormError.hidden = false;
            }
            profileNameInput?.focus();
            return;
        }

        if (saveProfileButton) saveProfileButton.disabled = true;
        if (profileFormError) profileFormError.hidden = true;
        setProfileStatus("Saving your profile…", "loading");
        try {
            const result = await assessmentRequest("/me", { name }, "PATCH");
            currentAuthenticatedUser = result.user;
            setNavbarUser(result.user);
            renderProfile(result.user);
            setProfileStatus("Profile updated successfully.", "success");
        } catch (error) {
            if (profileFormError) {
                profileFormError.textContent = error.message;
                profileFormError.hidden = false;
            }
            setProfileStatus("Your profile could not be saved.", "error");
        } finally {
            if (saveProfileButton) saveProfileButton.disabled = false;
        }
    });
}

cancelProfileButton?.addEventListener("click", () => {
    if (profileNameInput && currentAuthenticatedUser) {
        profileNameInput.value = currentAuthenticatedUser.name;
    }
    if (profileFormError) profileFormError.hidden = true;
    if (profileFormCard) profileFormCard.hidden = true;
    setProfileStatus("");
    document.getElementById("editProfileBtn")?.focus();
});


/* ==========================================
   11. INITIALIZE APPLICATION
   ========================================== */

showView("home");
initializeDashboardAuth();
aiMentorInitHistory();

console.log("SkillGapper loaded successfully!");
