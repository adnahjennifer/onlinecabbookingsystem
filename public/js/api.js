/**
 * CabGo - Online Cab Booking System
 * API Client & Session Management Module (Day 2)
 * Handles AJAX requests, session storage, and shared navigation.
 */

"use strict";

const API_CONFIG = {
    BASE_URL: "",
    ENDPOINTS: {
        register: "/api/register",
        login: "/api/login",
        logout: "/api/logout",
        me: "/api/me",
        locations: "/api/locations",
        geocode: "/api/geocode",
        route: "/api/route",
        fareEstimate: "/api/fare/estimate",
        rideRequests: "/api/ride-requests",
        myRideRequests: "/api/ride-requests/mine",
        cancelRideRequest: "/api/ride-requests/:request_id/cancel",
        // Notifications (Member 2 - added backend/API.md)
        notifications: "/api/notifications",
        markNotificationRead: "/api/notifications/:notification_id/read",
        // Backward-compatible aliases for Day 2/3 references
        searchRides: "/api/rides/search",
        bookings: "/api/ride-requests",
        cancelBooking: "/api/ride-requests/:request_id/cancel",
        // Driver endpoints
        driverRequests: "/api/driver/requests",
        driverAcceptRequest: "/api/driver/requests/:request_id/accept",
        driverRejectRequest: "/api/driver/requests/:request_id/reject",
        driverStartTrip: "/api/trips/:trip_id/start",
        driverCompleteTrip: "/api/trips/:trip_id/complete",
        driverVehicles: "/api/driver/vehicles",
        driverVehicleItem: "/api/driver/vehicles/:vehicle_id",
        driverEarnings: "/api/driver/earnings",
        driverAvailability: "/api/driver/availability",
        // Admin endpoints
        adminStats: "/api/admin/stats",
        adminDrivers: "/api/admin/drivers",
        adminDriverApprove: "/api/admin/drivers/:driver_id/approve",
        adminDriverReject: "/api/admin/drivers/:driver_id/reject",
        adminDriverBlock: "/api/admin/drivers/:driver_id/block",
        adminPassengers: "/api/admin/passengers",
        adminPassengerToggle: "/api/admin/passengers/:user_id/toggle-block",
        adminVehicles: "/api/admin/vehicles",
        adminVehicleApprove: "/api/admin/vehicles/:vehicle_id/approve",
        adminVehicleReject: "/api/admin/vehicles/:vehicle_id/reject",
        adminFareRules: "/api/admin/fare-rules",
        adminFareRuleItem: "/api/admin/fare-rules/:rule_id",
        adminTrips: "/api/admin/trips",
        // Super admin endpoints
        superadminStats: "/api/superadmin/stats",
        superadminAdmins: "/api/superadmin/admins",
        superadminAdminToggle: "/api/superadmin/admins/:user_id/toggle",
        superadminLogs: "/api/superadmin/logs",
        superadminSettings: "/api/superadmin/settings"
    },
    /**
     * Resolves the cancel booking endpoint path for a given request ID.
     * @param {number|string} requestId
     * @returns {string}
     */
    getCancelBookingUrl(requestId) {
        const template = this.ENDPOINTS.cancelRideRequest || this.ENDPOINTS.cancelBooking;
        return template.replace(":request_id", encodeURIComponent(requestId));
    },
    getMarkNotificationReadUrl(notificationId) {
        const template = this.ENDPOINTS.markNotificationRead || "/api/notifications/:notification_id/read";
        return template.replace(":notification_id", encodeURIComponent(notificationId));
    },
    getDriverAcceptUrl(requestId) {
        return this.ENDPOINTS.driverAcceptRequest.replace(":request_id", encodeURIComponent(requestId));
    },
    getDriverRejectUrl(requestId) {
        return this.ENDPOINTS.driverRejectRequest.replace(":request_id", encodeURIComponent(requestId));
    },
    getDriverStartTripUrl(tripId) {
        return this.ENDPOINTS.driverStartTrip.replace(":trip_id", encodeURIComponent(tripId));
    },
    getDriverCompleteTripUrl(tripId) {
        return this.ENDPOINTS.driverCompleteTrip.replace(":trip_id", encodeURIComponent(tripId));
    },
    getDriverVehicleItemUrl(vehicleId) {
        return this.ENDPOINTS.driverVehicleItem.replace(":vehicle_id", encodeURIComponent(vehicleId));
    },
    getAdminDriverApproveUrl(driverId) {
        return this.ENDPOINTS.adminDriverApprove.replace(":driver_id", encodeURIComponent(driverId));
    },
    getAdminDriverRejectUrl(driverId) {
        return this.ENDPOINTS.adminDriverReject.replace(":driver_id", encodeURIComponent(driverId));
    },
    getAdminDriverBlockUrl(driverId) {
        return this.ENDPOINTS.adminDriverBlock.replace(":driver_id", encodeURIComponent(driverId));
    },
    getAdminPassengerToggleUrl(userId) {
        return this.ENDPOINTS.adminPassengerToggle.replace(":user_id", encodeURIComponent(userId));
    },
    getAdminVehicleApproveUrl(vehicleId) {
        return this.ENDPOINTS.adminVehicleApprove.replace(":vehicle_id", encodeURIComponent(vehicleId));
    },
    getAdminVehicleRejectUrl(vehicleId) {
        return this.ENDPOINTS.adminVehicleReject.replace(":vehicle_id", encodeURIComponent(vehicleId));
    },
    getAdminFareRuleItemUrl(ruleId) {
        return this.ENDPOINTS.adminFareRuleItem.replace(":rule_id", encodeURIComponent(ruleId));
    },
    getSuperadminAdminToggleUrl(userId) {
        return this.ENDPOINTS.superadminAdminToggle.replace(":user_id", encodeURIComponent(userId));
    }
};

if (typeof window !== "undefined") {
    window.API_CONFIG = API_CONFIG;
}

/* ==========================================================================
   User Normalization & Error Parsing Helpers
   ========================================================================== */

/**
 * Normalizes a user object to support {user_id, full_name} and {id, name} shapes.
 * @param {Object|null} user - Raw user object from server.
 * @returns {Object|null} Normalized user object.
 */
function normalizeUser(user) {
    if (!user || typeof user !== "object") {
        return null;
    }
    const id = user.user_id !== undefined ? user.user_id : user.id;
    const name = user.full_name || user.name || "";
    return {
        ...user,
        id: id,
        user_id: id,
        name: name,
        full_name: name,
        email: user.email || "",
        role: user.role || "passenger"
    };
}

/**
 * Extracts a human-readable error message from an API response payload.
 * Supports both { error: { message } } (backend) and { message } (simple) error shapes.
 * @param {Object|null} data - API response payload.
 * @param {string} fallback - Fallback message if extraction fails.
 * @returns {string}
 */
function getErrorMessage(data, fallback = "An unexpected error occurred.") {
    if (!data) {
        return fallback;
    }
    if (data.error && typeof data.error.message === "string" && data.error.message.trim().length > 0) {
        return data.error.message;
    }
    if (typeof data.message === "string" && data.message.trim().length > 0) {
        return data.message;
    }
    return fallback;
}

/**
 * Formats a numeric fare amount as Indian Rupees (₹) with 2 decimals using Intl.NumberFormat ('en-IN').
 * @param {number|string} amount
 * @returns {string}
 */
function formatFare(amount) {
    const num = parseFloat(amount) || 0;
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
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
            const normalized = normalizeUser(user);
            sessionStorage.setItem(SESSION_KEYS.USER, JSON.stringify(normalized));
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
 * Retrieves the current session from sessionStorage with normalized user.
 * @returns {{ user: Object, token: string|null } | null}
 */
function getSession() {
    try {
        const userJson = sessionStorage.getItem(SESSION_KEYS.USER);
        const token = sessionStorage.getItem(SESSION_KEYS.TOKEN);

        if (!userJson) {
            return null;
        }

        const rawUser = JSON.parse(userJson);
        const user = normalizeUser(rawUser);
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
   Primary API Request Function
   Uses fetch with JSON headers, same-origin credentials, and session token.
   ALWAYS resolves to { ok, status, data } and never throws.
   Handles 401 redirection to login.html automatically.
   ========================================================================== */

/**
 * Sends an API request using fetch.
 * @param {string} path - Target API endpoint path.
 * @param {string} method - HTTP method (GET, POST, etc.).
 * @param {Object|null} body - Request payload object.
 * @returns {Promise<{ ok: boolean, status: number, data: Object }>}
 */
async function apiRequest(path, method = "GET", body = null) {
    let result;

    const url = (API_CONFIG.BASE_URL || "") + path;
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    };

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

        let data = null;
        try {
            data = await response.json();
        } catch (jsonErr) {
            // Response body is not valid JSON (e.g. static 404 text, HTML error, empty body)
            data = null;
        }

        // If the server did not return a JSON object, construct friendly structured error data
        if (!data || typeof data !== "object") {
            if (response.status === 405) {
                data = {
                    error: {
                        code: "METHOD_NOT_ALLOWED",
                        message: "Method Not Allowed (405). This occurs when running through a static server (such as VS Code Live Server). Please open http://localhost:3000/login.html with the Node backend running."
                    },
                    message: "Method Not Allowed (405). Please open http://localhost:3000/login.html instead of a static server (Live Server)."
                };
            } else if (response.status === 404) {
                data = {
                    error: { code: "NOT_FOUND", message: "The requested service or page was not found (404)." },
                    message: "The requested service was not found."
                };
            } else if (response.status === 401) {
                data = {
                    error: { code: "UNAUTHENTICATED", message: "Please log in to continue." },
                    message: "Please log in to continue."
                };
            } else if (response.status === 403) {
                data = {
                    error: { code: "FORBIDDEN", message: "You do not have permission to access this resource." },
                    message: "Access forbidden."
                };
            } else if (response.status >= 500) {
                data = {
                    error: { code: "SERVER_ERROR", message: "The server encountered an error. Please try again later." },
                    message: "The server encountered an error. Please try again later."
                };
            } else if (response.ok) {
                data = { message: "Operation completed." };
            } else {
                data = {
                    error: { code: "REQUEST_FAILED", message: `Request failed with status ${response.status}.` },
                    message: `Request failed with status ${response.status}.`
                };
            }
        }

        result = {
            ok: response.ok,
            status: response.status,
            data: data
        };
    } catch (networkErr) {
        result = {
            ok: false,
            status: 0,
            data: {
                error: {
                    code: "NETWORK_ERROR",
                    message: "Cannot reach the server. Make sure the server is running on http://localhost:3000 and check your connection."
                },
                message: "Cannot reach the server. Make sure the server is running on http://localhost:3000 and check your connection."
            }
        };
    }

    // Auto-redirect on 401 Unauthorized (unless it's an intentional login/register check)
    if (result && result.status === 401 && !path.includes("/login") && !path.includes("/register")) {
        clearSession();
        const loginPath = window.location.pathname.split("/").filter(Boolean).length > 1
            ? "../login.html?expired=1"
            : "login.html?expired=1";
        window.location.replace(loginPath);
    }

    return result;
}

/* ==========================================================================
   Shared UI Helpers: Spinners, Loading, Error, Empty & Modal Utilities (Day 5)
   ========================================================================== */

/**
 * Creates an inline spinner element.
 * @param {boolean} [isDark=false]
 * @param {boolean} [isLarge=false]
 * @returns {HTMLSpanElement}
 */
function createSpinner(isDark = false, isLarge = false) {
    const spinner = document.createElement("span");
    spinner.className = "spinner" + (isDark ? " spinner-dark" : "") + (isLarge ? " spinner-large" : "");
    spinner.setAttribute("aria-hidden", "true");
    return spinner;
}

/**
 * Sets button loading state with spinner and accessibility attributes.
 * @param {HTMLButtonElement} button
 * @param {boolean} isLoading
 * @param {string} [loadingText="Processing..."]
 */
function setButtonLoading(button, isLoading, loadingText = "Processing...") {
    if (!button) return;

    if (isLoading) {
        if (!button.dataset.originalHtml) {
            button.dataset.originalHtml = button.innerHTML;
        }
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.innerHTML = "";
        button.appendChild(createSpinner(false, false));
        const textSpan = document.createElement("span");
        textSpan.style.marginLeft = "8px";
        textSpan.textContent = loadingText;
        button.appendChild(textSpan);
    } else {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
            delete button.dataset.originalHtml;
        }
    }
}

/**
 * Renders a standardized loading state inside a container.
 * @param {HTMLElement} container
 * @param {string} [message="Loading data, please wait..."]
 */
function showContainerLoading(container, message = "Loading data, please wait...") {
    if (!container) return;
    container.innerHTML = `
        <div class="state-container loading-state" role="status" aria-live="polite">
            <span class="spinner spinner-large spinner-dark" aria-hidden="true"></span>
            <p>${message}</p>
        </div>
    `;
}

/**
 * Renders an inline error alert inside a container with a retry button.
 * @param {HTMLElement} container
 * @param {string} message
 * @param {Function|null} [retryFn=null]
 */
function showContainerError(container, message, retryFn = null) {
    if (!container) return;
    container.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "state-container error-state";
    wrap.setAttribute("role", "alert");

    const msg = document.createElement("p");
    msg.textContent = message;
    wrap.appendChild(msg);

    if (typeof retryFn === "function") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "button button-secondary button-small";
        btn.textContent = "Retry";
        btn.style.marginTop = "8px";
        btn.addEventListener("click", () => retryFn());
        wrap.appendChild(btn);
    }

    container.appendChild(wrap);
}

/**
 * Renders an empty state placeholder.
 * @param {HTMLElement} container
 * @param {string} title
 * @param {string} [description=""]
 * @param {string} [actionLabel=""]
 * @param {string} [actionHref=""]
 */
function showContainerEmpty(container, title, description = "", actionLabel = "", actionHref = "") {
    if (!container) return;
    let html = `
        <div class="state-container empty-state">
            <div class="empty-state-icon" aria-hidden="true">🚕</div>
            <h3>${title}</h3>
            ${description ? `<p>${description}</p>` : ""}
            ${actionLabel && actionHref ? `<a href="${actionHref}" class="button button-small" style="margin-top:12px;display:inline-block;">${actionLabel}</a>` : ""}
        </div>
    `;
    container.innerHTML = html;
}

/**
 * Traps focus within an open modal dialog for keyboard accessibility.
 * Returns a cleanup function that must be called when the modal closes.
 * @param {HTMLElement} modal
 * @param {HTMLElement} [initialFocusElement]
 * @returns {Function} cleanup
 */
function trapModalFocus(modal, initialFocusElement = null) {
    if (!modal) return () => {};

    const previouslyFocused = document.activeElement;
    const focusableSelectors = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusableElements = Array.from(modal.querySelectorAll(focusableSelectors));

    if (initialFocusElement && typeof initialFocusElement.focus === "function") {
        initialFocusElement.focus();
    } else if (focusableElements.length > 0) {
        focusableElements[0].focus();
    }

    function handleKeyDown(e) {
        if (e.key === "Tab") {
            const currentFocusables = Array.from(modal.querySelectorAll(focusableSelectors));
            if (currentFocusables.length === 0) {
                e.preventDefault();
                return;
            }
            const firstElement = currentFocusables[0];
            const lastElement = currentFocusables[currentFocusables.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        }
    }

    function handleBackdropClick(e) {
        if (e.target === modal) {
            const cancelBtn = modal.querySelector("[data-modal-close], .modal-cancel-btn");
            if (cancelBtn) cancelBtn.click();
        }
    }

    document.addEventListener("keydown", handleKeyDown);
    modal.addEventListener("click", handleBackdropClick);

    return function cleanup() {
        document.removeEventListener("keydown", handleKeyDown);
        modal.removeEventListener("click", handleBackdropClick);
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
            previouslyFocused.focus();
        }
    };
}

/* ==========================================================================
   Shared UI Helpers: Messages and Navigation
   ========================================================================== */

/**
 * Displays a formatted status message in the given element.
 * Safe from XSS: sets textContent only.
 * @param {HTMLElement|null} element
 * @param {string} text
 * @param {"success"|"error"|string} [type]
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
    // Port detection: Alert developer/user if viewing through a static server (e.g. VS Code Live Server 5500)
    if (typeof window !== "undefined" && window.location && window.location.port && window.location.port !== "3000") {
        if (!document.getElementById("cabgoPortWarningBanner") && document.body) {
            const warningBanner = document.createElement("div");
            warningBanner.id = "cabgoPortWarningBanner";
            warningBanner.style.background = "#fff3cd";
            warningBanner.style.color = "#856404";
            warningBanner.style.borderBottom = "2px solid #ffeeba";
            warningBanner.style.padding = "10px 16px";
            warningBanner.style.textAlign = "center";
            warningBanner.style.fontSize = "13px";
            warningBanner.style.fontWeight = "600";
            warningBanner.style.position = "sticky";
            warningBanner.style.top = "0";
            warningBanner.style.zIndex = "9999";

            const currentFile = window.location.pathname.split("/").pop() || "login.html";
            const targetUrl = `http://localhost:3000/${currentFile}`;

            const textPart = document.createTextNode(
                `⚠️ Note: You are viewing on port ${window.location.port} (static server). The CabGo server runs on port 3000. `
            );
            const link = document.createElement("a");
            link.href = targetUrl;
            link.textContent = `Open http://localhost:3000/${currentFile}`;
            link.style.color = "#533f03";
            link.style.textDecoration = "underline";
            link.style.marginLeft = "6px";

            warningBanner.appendChild(textPart);
            warningBanner.appendChild(link);
            document.body.insertBefore(warningBanner, document.body.firstChild);
        }
    }

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
        btn.addEventListener("click", async function (event) {
            event.preventDefault();
            try {
                await apiRequest(API_CONFIG.ENDPOINTS.logout || "/api/logout", "POST");
            } catch (err) {
                // Silently proceed with local cleanup
            } finally {
                clearSession();
                window.location.href = "login.html";
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", initNavigation);

if (typeof window !== "undefined") {
    window.API_CONFIG = API_CONFIG;
    window.normalizeUser = normalizeUser;
    window.getErrorMessage = getErrorMessage;
    window.formatFare = formatFare;
    window.saveSession = saveSession;
    window.getSession = getSession;
    window.clearSession = clearSession;
    window.apiRequest = apiRequest;
    window.showMessage = showMessage;
    window.initNavigation = initNavigation;
    window.createSpinner = createSpinner;
    window.setButtonLoading = setButtonLoading;
    window.showContainerLoading = showContainerLoading;
    window.showContainerError = showContainerError;
    window.showContainerEmpty = showContainerEmpty;
    window.trapModalFocus = trapModalFocus;
}
