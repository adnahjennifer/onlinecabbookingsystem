/**
 * CabGo - Online Cab Booking System
 * API Client & Session Management Module (Day 2)
 * Handles AJAX requests, mock API simulation, session storage, and shared navigation.
 */

"use strict";

const API_CONFIG = {
    USE_MOCK: true,
    BASE_URL: "",
    ENDPOINTS: {
        register: "/api/auth/register",
        login: "/api/auth/login"
    }
};

if (typeof window !== "undefined") {
    window.API_CONFIG = API_CONFIG;
}

/* ==========================================================================
   Session Helpers (sessionStorage keys: "cabgo_user", "cabgo_token")
   ========================================================================== */

const SESSION_KEYS = {
    USER: "cabgo_user",
    TOKEN: "cabgo_token"
};

/**
 * Saves the current user and auth token to sessionStorage.
 * @param {Object} user - The authenticated user object.
 * @param {string|null} token - The auth token.
 */
function saveSession(user, token) {
    try {
        if (user) {
            sessionStorage.setItem(SESSION_KEYS.USER, JSON.stringify(user));
        } else {
            sessionStorage.removeItem(SESSION_KEYS.USER);
        }

        if (token) {
            sessionStorage.setItem(SESSION_KEYS.TOKEN, token);
        } else {
            sessionStorage.removeItem(SESSION_KEYS.TOKEN);
        }
    } catch (err) {
        console.error("Failed to save session:", err);
    }
}

/**
 * Retrieves the current session from sessionStorage.
 * @returns {{ user: Object, token: string|null } | null}
 */
function getSession() {
    try {
        const userJson = sessionStorage.getItem(SESSION_KEYS.USER);
        const token = sessionStorage.getItem(SESSION_KEYS.TOKEN);

        if (!userJson) {
            return null;
        }

        const user = JSON.parse(userJson);
        return { user, token };
    } catch (err) {
        console.error("Failed to retrieve session:", err);
        return null;
    }
}

/**
 * Clears current session from sessionStorage.
 */
function clearSession() {
    try {
        sessionStorage.removeItem(SESSION_KEYS.USER);
        sessionStorage.removeItem(SESSION_KEYS.TOKEN);
    } catch (err) {
        console.error("Failed to clear session:", err);
    }
}

/* ==========================================================================
   MOCK API IMPLEMENTATION
   MOCK ONLY - remove mock code and sample users before final submission (Day 7)
   ========================================================================== */

const MOCK_STORAGE_KEY = "mockUsers";

/**
 * Retrieves mock users from localStorage or initializes sample users.
 * MOCK ONLY - remove mock code and sample users before final submission (Day 7)
 */
function getMockUsers() {
    try {
        const stored = localStorage.getItem(MOCK_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (err) {
        console.error("Failed to parse mockUsers from localStorage:", err);
    }

    // Default sample user for quick test login
    const defaultUsers = [
        {
            id: 1,
            name: "Alex",
            email: "alex@example.com",
            password: "Password123",
            role: "passenger"
        }
    ];

    try {
        localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(defaultUsers));
    } catch (err) {
        console.error("Failed to initialize mockUsers in localStorage:", err);
    }

    return defaultUsers;
}

/**
 * Saves mock users array to localStorage.
 * MOCK ONLY - remove mock code and sample users before final submission (Day 7)
 */
function saveMockUsers(users) {
    try {
        localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(users));
    } catch (err) {
        console.error("Failed to save mockUsers:", err);
    }
}

/**
 * Simulates server responses for registration and login.
 * MOCK ONLY - remove mock code and sample users before final submission (Day 7)
 */
async function mockApiRequest(path, method, body) {
    // Simulate ~600ms network latency
    await new Promise((resolve) => setTimeout(resolve, 600));

    const methodUpper = (method || "GET").toUpperCase();

    // 1. Mock Registration
    if (path === API_CONFIG.ENDPOINTS.register && methodUpper === "POST") {
        const name = (body && body.name ? String(body.name).trim() : "");
        const email = (body && body.email ? String(body.email).trim().toLowerCase() : "");
        const password = (body && body.password ? String(body.password) : "");

        // Check for test taken email or existing registration
        const users = getMockUsers();
        const isTaken = email === "taken@example.com" || users.some((u) => u.email.toLowerCase() === email);

        if (isTaken) {
            return {
                ok: false,
                status: 409,
                data: {
                    success: false,
                    message: "Email is already registered.",
                    errors: {
                        email: "Email already registered"
                    }
                }
            };
        }

        const newUser = {
            id: Date.now(),
            name: name,
            email: email,
            password: password,
            role: "passenger"
        };

        users.push(newUser);
        saveMockUsers(users);

        return {
            ok: true,
            status: 201,
            data: {
                success: true,
                message: "Account created successfully! You can now log in.",
                user: {
                    id: newUser.id,
                    name: newUser.name,
                    email: newUser.email,
                    role: newUser.role
                }
            }
        };
    }

    // 2. Mock Login
    if (path === API_CONFIG.ENDPOINTS.login && methodUpper === "POST") {
        const email = (body && body.email ? String(body.email).trim().toLowerCase() : "");
        const password = (body && body.password ? String(body.password) : "");

        const users = getMockUsers();
        const matchedUser = users.find(
            (u) => u.email.toLowerCase() === email && u.password === password
        );

        if (!matchedUser) {
            return {
                ok: false,
                status: 401,
                data: {
                    success: false,
                    message: "Invalid email or password."
                }
            };
        }

        return {
            ok: true,
            status: 200,
            data: {
                success: true,
                message: "Login successful.",
                token: "mock-jwt-token-" + Date.now(),
                user: {
                    id: matchedUser.id,
                    name: matchedUser.name,
                    email: matchedUser.email,
                    role: matchedUser.role || "passenger"
                }
            }
        };
    }

    return {
        ok: false,
        status: 404,
        data: {
            success: false,
            message: "Endpoint not found."
        }
    };
}

/* ==========================================================================
   Primary API Request Function
   Uses fetch with JSON headers, same-origin credentials, and session token.
   ALWAYS resolves to { ok, status, data } and never throws.
   ========================================================================== */

/**
 * Sends an API request or runs the mock simulator when USE_MOCK is true.
 * @param {string} path - Target API endpoint path.
 * @param {string} method - HTTP method (GET, POST, etc.).
 * @param {Object|null} body - Request payload object.
 * @returns {Promise<{ ok: boolean, status: number, data: Object }>}
 */
async function apiRequest(path, method = "GET", body = null) {
    if (API_CONFIG.USE_MOCK) {
        return await mockApiRequest(path, method, body);
    }

    const url = (API_CONFIG.BASE_URL || "") + path;
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    };

    const session = getSession();
    if (session && session.token) {
        headers["Authorization"] = "Bearer " + session.token;
    }

    const options = {
        method: method.toUpperCase(),
        headers: headers,
        credentials: "same-origin"
    };

    if (body && ["POST", "PUT", "PATCH"].includes(options.method)) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);

        let data;
        try {
            data = await response.json();
        } catch (jsonErr) {
            return {
                ok: false,
                status: response.status,
                data: {
                    success: false,
                    message: "Unexpected server response."
                }
            };
        }

        return {
            ok: response.ok,
            status: response.status,
            data: data
        };
    } catch (networkErr) {
        return {
            ok: false,
            status: 0,
            data: {
                success: false,
                message: "Cannot reach the server. Check your connection and try again."
            }
        };
    }
}

/* ==========================================================================
   Shared UI Helpers: Messages and Navigation
   ========================================================================== */

/**
 * Displays a formatted status message in the given element.
 * Safe from XSS: sets textContent only.
 */
function showMessage(element, text, type) {
    if (!element) {
        return;
    }
    element.textContent = text;
    element.className = "message " + (type || "");
    element.hidden = false;
}

/**
 * Synchronizes navigation links based on current session.
 * Hides login/register and reveals dashboard/logout when logged in.
 */
function initNavigation() {
    const session = getSession();
    const guestLinks = document.querySelectorAll('[data-nav="guest"]');
    const authLinks = document.querySelectorAll('[data-nav="auth"]');
    const logoutBtns = document.querySelectorAll('#navLogout, .nav-logout-btn');

    if (session && session.user) {
        guestLinks.forEach((el) => {
            el.hidden = true;
            el.style.display = "none";
        });
        authLinks.forEach((el) => {
            el.hidden = false;
            el.style.display = "";
        });
    } else {
        guestLinks.forEach((el) => {
            el.hidden = false;
            el.style.display = "";
        });
        authLinks.forEach((el) => {
            el.hidden = true;
            el.style.display = "none";
        });
    }

    logoutBtns.forEach((btn) => {
        btn.addEventListener("click", function (event) {
            event.preventDefault();
            clearSession();
            window.location.href = "login.html";
        });
    });
}

document.addEventListener("DOMContentLoaded", initNavigation);

if (typeof window !== "undefined") {
    window.API_CONFIG = API_CONFIG;
    window.saveSession = saveSession;
    window.getSession = getSession;
    window.clearSession = clearSession;
    window.apiRequest = apiRequest;
    window.showMessage = showMessage;
    window.initNavigation = initNavigation;
    window.getMockUsers = getMockUsers;
}
