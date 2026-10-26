/**
 * CabGo - Online Cab Booking System
 * API Client & Session Management Module (Day 2)
 * Handles AJAX requests, mock API simulation, session storage, and shared navigation.
 */

"use strict";

const API_CONFIG = {
    USE_MOCK: false,
    BASE_URL: "",
    ENDPOINTS: {
        register: "/api/register",
        login: "/api/login",
        logout: "/api/logout",
        me: "/api/me",
        fareEstimate: "/api/fare/estimate",
        rideRequests: "/api/ride-requests",
        myRideRequests: "/api/ride-requests/mine",
        cancelRideRequest: "/api/ride-requests/:request_id/cancel",
        // Backward-compatible aliases for Day 2/3 references
        searchRides: "/api/rides/search",
        bookings: "/api/ride-requests",
        cancelBooking: "/api/ride-requests/:request_id/cancel"
    },
    /**
     * Resolves the cancel booking endpoint path for a given request ID.
     * @param {number|string} requestId
     * @returns {string}
     */
    getCancelBookingUrl(requestId) {
        const template = this.ENDPOINTS.cancelRideRequest || this.ENDPOINTS.cancelBooking;
        return template.replace(":request_id", encodeURIComponent(requestId));
    }
};

if (typeof window !== "undefined") {
    window.API_CONFIG = API_CONFIG;
}

/* ==========================================================================
   User Normalization & Error Parsing Helpers
   ========================================================================== */

/**
 * Normalizes a user object to support BOTH mock {id, name} and real backend {user_id, full_name} shapes.
 * @param {Object|null} user - Raw user object from server or mock storage.
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
   MOCK API IMPLEMENTATION
   MOCK ONLY - remove mock code and sample users before final submission (Day 7)
   ========================================================================== */

const MOCK_STORAGE_KEY = "mockUsers";
const MOCK_BOOKINGS_PREFIX = "cabgo_bookings_user_";

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
            user_id: 1,
            name: "Alex",
            full_name: "Alex",
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
 * Retrieves mock bookings for a specific user ID from localStorage.
 * MOCK ONLY - remove before Day 7
 * @param {number|string} userId
 * @returns {Array}
 */
function getMockBookings(userId) {
    const key = MOCK_BOOKINGS_PREFIX + (userId || "default");
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (err) {
        console.error("Failed to parse mock bookings:", err);
    }

    // Default sample completed trips for default user (Alex) to demonstrate history/stats on fresh load
    if (userId === 1 || userId === "1") {
        const defaultBookings = [
            {
                request_id: 1001,
                pickup_location: "Chennai Central",
                drop_location: "Marina Beach",
                vehicle_type: "standard",
                estimated_fare: 180.00,
                final_fare: 180.00,
                status: "completed",
                created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
                driver: { full_name: "Ramesh Babu", rating: 4.8 },
                vehicle: { registration_number: "TN-01-AB-1234", model: "Maruti Swift", vehicle_type: "standard" }
            },
            {
                request_id: 1002,
                pickup_location: "Egmore Railway Station",
                drop_location: "T. Nagar",
                vehicle_type: "sedan",
                estimated_fare: 240.00,
                final_fare: 240.00,
                status: "completed",
                created_at: new Date(Date.now() - 86400000).toISOString(),
                driver: { full_name: "Karthik Raja", rating: 4.9 },
                vehicle: { registration_number: "TN-02-CD-5678", model: "Honda City", vehicle_type: "sedan" }
            }
        ];

        try {
            localStorage.setItem(key, JSON.stringify(defaultBookings));
        } catch (e) {
            // ignore
        }
        return defaultBookings;
    }

    return [];
}

/**
 * Persists mock bookings for a specific user ID to localStorage.
 * MOCK ONLY - remove before Day 7
 * @param {number|string} userId
 * @param {Array} bookings
 */
function saveMockBookings(userId, bookings) {
    const key = MOCK_BOOKINGS_PREFIX + (userId || "default");
    try {
        localStorage.setItem(key, JSON.stringify(bookings));
    } catch (err) {
        console.error("Failed to save mock bookings:", err);
    }
}

/**
 * Checks for status progression: after ~15s a 'requested' booking transitions to 'accepted' with driver and vehicle.
 * MOCK ONLY - remove before Day 7
 * @param {Array} bookings
 * @returns {boolean} true if any booking transitioned
 */
function updateMockStatusProgression(bookings) {
    let updated = false;
    const now = Date.now();
    for (const booking of bookings) {
        if (booking.status === "requested") {
            const createdAtTime = new Date(booking.created_at).getTime();
            if (now - createdAtTime >= 15000) {
                booking.status = "accepted";
                booking.driver = {
                    full_name: "Rajesh Kumar",
                    rating: 4.85
                };
                booking.vehicle = {
                    registration_number: "TN-09-XY-9081",
                    model: booking.vehicle_type === "suv" ? "Toyota Innova Crysta" : (booking.vehicle_type === "sedan" ? "Hyundai Verna" : "Maruti Suzuki WagonR"),
                    vehicle_type: booking.vehicle_type
                };
                updated = true;
            }
        }
    }
    return updated;
}

/**
 * Simulates server responses for registration, login, cab search, bookings, and cancellation.
 * MOCK ONLY - remove mock code and sample users before final submission (Day 7)
 */
async function mockApiRequest(path, method, body) {
    // Simulate ~400ms network latency
    await new Promise((resolve) => setTimeout(resolve, 400));

    const methodUpper = (method || "GET").toUpperCase();

    // 1. Mock Registration (/api/register or /api/auth/register)
    if ((path === API_CONFIG.ENDPOINTS.register || path === "/api/auth/register") && methodUpper === "POST") {
        const name = (body && body.name ? String(body.name).trim() : "");
        const email = (body && body.email ? String(body.email).trim().toLowerCase() : "");
        const password = (body && body.password ? String(body.password) : "");

        const users = getMockUsers();
        const isTaken = email === "taken@example.com" || users.some((u) => u.email.toLowerCase() === email);

        if (isTaken) {
            return {
                ok: false,
                status: 409,
                data: {
                    error: {
                        code: "EMAIL_EXISTS",
                        message: "An account with this email already exists."
                    },
                    message: "An account with this email already exists.",
                    errors: {
                        email: "Email already registered"
                    }
                }
            };
        }

        const newUser = {
            id: Date.now(),
            user_id: Date.now(),
            name: name,
            full_name: name,
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
                message: "Registration successful. You can now log in.",
                user: {
                    user_id: newUser.user_id,
                    full_name: newUser.full_name,
                    email: newUser.email,
                    role: newUser.role
                }
            }
        };
    }

    // 2. Mock Login (/api/login or /api/auth/login)
    if ((path === API_CONFIG.ENDPOINTS.login || path === "/api/auth/login") && methodUpper === "POST") {
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
                    error: {
                        code: "INVALID_CREDENTIALS",
                        message: "Invalid email or password."
                    },
                    message: "Invalid email or password."
                }
            };
        }

        return {
            ok: true,
            status: 200,
            data: {
                message: "Login successful.",
                token: "mock-jwt-token-" + Date.now(),
                user: {
                    user_id: matchedUser.user_id || matchedUser.id,
                    full_name: matchedUser.full_name || matchedUser.name,
                    email: matchedUser.email,
                    role: matchedUser.role || "passenger"
                }
            }
        };
    }

    // 3. Mock Cab Search (/api/rides/search)
    if (path === API_CONFIG.ENDPOINTS.searchRides && methodUpper === "POST") {
        const pickup = body && body.pickup_location ? String(body.pickup_location).trim() : "";
        const drop = body && body.drop_location ? String(body.drop_location).trim() : "";

        // Failure simulation flags for manual testing
        if (pickup.toLowerCase() === "error" || drop.toLowerCase() === "error") {
            return {
                ok: false,
                status: 500,
                data: {
                    error: {
                        code: "SERVER_ERROR",
                        message: "Simulated internal server error. Please try again."
                    }
                }
            };
        }
        if (pickup.toLowerCase() === "offline" || drop.toLowerCase() === "offline") {
            return {
                ok: false,
                status: 0,
                data: {
                    message: "Cannot reach the server. Check your connection and try again."
                }
            };
        }

        if (!pickup || !drop) {
            return {
                ok: false,
                status: 400,
                data: {
                    error: {
                        code: "INVALID_INPUT",
                        message: "Pickup and destination locations are required."
                    }
                }
            };
        }

        if (pickup.toLowerCase() === drop.toLowerCase()) {
            return {
                ok: false,
                status: 400,
                data: {
                    error: {
                        code: "INVALID_ROUTE",
                        message: "Pickup and destination must be different."
                    }
                }
            };
        }

        // Deterministic pseudo-distance derived from pickup + drop strings
        const combined = (pickup + "->" + drop).toLowerCase();
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            hash = (hash << 5) - hash + combined.charCodeAt(i);
            hash |= 0;
        }
        const absHash = Math.abs(hash);

        // Distance between 4.0 km and 26.0 km
        const distanceKm = parseFloat((4.0 + (absHash % 220) / 10).toFixed(1));
        const minutes = Math.max(10, Math.round(distanceKm * 2.2));

        // Sample rates:
        // standard: base 40, per km 10, per minute 1
        // sedan:    base 60, per km 13, per minute 1.5
        // suv:      base 90, per km 18, per minute 2
        const standardFare = parseFloat((40 + (10 * distanceKm) + (1 * minutes)).toFixed(2));
        const sedanFare = parseFloat((60 + (13 * distanceKm) + (1.5 * minutes)).toFixed(2));
        const suvFare = parseFloat((90 + (18 * distanceKm) + (2 * minutes)).toFixed(2));

        return {
            ok: true,
            status: 200,
            data: {
                rides: [
                    {
                        vehicle_type: "standard",
                        estimated_fare: standardFare,
                        estimated_distance_km: distanceKm,
                        estimated_minutes: minutes,
                        available_drivers: 3 + (absHash % 3)
                    },
                    {
                        vehicle_type: "sedan",
                        estimated_fare: sedanFare,
                        estimated_distance_km: distanceKm,
                        estimated_minutes: minutes,
                        available_drivers: 2 + (absHash % 2)
                    },
                    {
                        vehicle_type: "suv",
                        estimated_fare: suvFare,
                        estimated_distance_km: distanceKm,
                        estimated_minutes: minutes,
                        available_drivers: 1 + (absHash % 2)
                    }
                ]
            }
        };
    }

    // 4. Mock Create Booking (POST /api/bookings)
    if (path === API_CONFIG.ENDPOINTS.bookings && methodUpper === "POST") {
        const session = getSession();
        if (!session || !session.user) {
            return {
                ok: false,
                status: 401,
                data: {
                    error: {
                        code: "UNAUTHORIZED",
                        message: "Session expired or missing. Please log in again."
                    }
                }
            };
        }

        const userId = session.user.id || session.user.user_id;
        const bookings = getMockBookings(userId);

        if (updateMockStatusProgression(bookings)) {
            saveMockBookings(userId, bookings);
        }

        // Check if user already has an active booking ('requested', 'accepted', 'started')
        const activeBooking = bookings.find((b) => ["requested", "accepted", "started"].includes(b.status));
        if (activeBooking) {
            return {
                ok: false,
                status: 409,
                data: {
                    error: {
                        code: "ACTIVE_BOOKING_EXISTS",
                        message: "You already have an active booking. Please complete or cancel it before booking a new cab."
                    }
                }
            };
        }

        const requestId = (Date.now() % 90000) + 10000;
        const createdAt = new Date().toISOString();
        const estimatedFare = body && body.estimated_fare !== undefined ? parseFloat(body.estimated_fare) : 0;

        const newBooking = {
            request_id: requestId,
            pickup_location: body && body.pickup_location ? String(body.pickup_location).trim() : "",
            drop_location: body && body.drop_location ? String(body.drop_location).trim() : "",
            vehicle_type: body && body.vehicle_type ? String(body.vehicle_type).trim().toLowerCase() : "standard",
            estimated_fare: estimatedFare,
            final_fare: null,
            status: "requested",
            created_at: createdAt,
            driver: null,
            vehicle: null
        };

        bookings.unshift(newBooking);
        saveMockBookings(userId, bookings);

        return {
            ok: true,
            status: 201,
            data: {
                message: "Booking confirmed! Searching for nearby drivers...",
                booking: {
                    request_id: newBooking.request_id,
                    pickup_location: newBooking.pickup_location,
                    drop_location: newBooking.drop_location,
                    vehicle_type: newBooking.vehicle_type,
                    estimated_fare: newBooking.estimated_fare,
                    status: newBooking.status,
                    created_at: newBooking.created_at
                }
            }
        };
    }

    // 5. Mock Get Bookings (GET /api/bookings)
    if (path === API_CONFIG.ENDPOINTS.bookings && methodUpper === "GET") {
        const session = getSession();
        if (!session || !session.user) {
            return {
                ok: false,
                status: 401,
                data: {
                    error: {
                        code: "UNAUTHORIZED",
                        message: "Session expired or missing. Please log in again."
                    }
                }
            };
        }

        const userId = session.user.id || session.user.user_id;
        const bookings = getMockBookings(userId);

        if (updateMockStatusProgression(bookings)) {
            saveMockBookings(userId, bookings);
        }

        return {
            ok: true,
            status: 200,
            data: {
                bookings: bookings
            }
        };
    }

    // 6. Mock Cancel Booking (POST /api/bookings/:request_id/cancel)
    const cancelMatch = path.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
    if (cancelMatch && methodUpper === "POST") {
        const session = getSession();
        if (!session || !session.user) {
            return {
                ok: false,
                status: 401,
                data: {
                    error: {
                        code: "UNAUTHORIZED",
                        message: "Session expired or missing. Please log in again."
                    }
                }
            };
        }

        const targetId = cancelMatch[1];
        const userId = session.user.id || session.user.user_id;
        const bookings = getMockBookings(userId);

        updateMockStatusProgression(bookings);

        const booking = bookings.find((b) => String(b.request_id) === String(targetId));
        if (!booking) {
            return {
                ok: false,
                status: 404,
                data: {
                    error: {
                        code: "NOT_FOUND",
                        message: "Booking not found."
                    }
                }
            };
        }

        if (booking.status !== "requested" && booking.status !== "accepted") {
            return {
                ok: false,
                status: 409,
                data: {
                    error: {
                        code: "CANNOT_CANCEL",
                        message: `Cannot cancel booking with status "${booking.status}". Trips already started or completed cannot be cancelled.`
                    }
                }
            };
        }

        booking.status = "cancelled";
        saveMockBookings(userId, bookings);

        return {
            ok: true,
            status: 200,
            data: {
                message: "Booking cancelled successfully.",
                booking: booking
            }
        };
    }

    return {
        ok: false,
        status: 404,
        data: {
            error: {
                code: "NOT_FOUND",
                message: "Endpoint not found."
            },
            message: "Endpoint not found."
        }
    };
}

/* ==========================================================================
   Primary API Request Function
   Uses fetch with JSON headers, same-origin credentials, and session token.
   ALWAYS resolves to { ok, status, data } and never throws.
   Handles 401 redirection to login.html automatically.
   ========================================================================== */

/**
 * Sends an API request or runs the mock simulator when USE_MOCK is true.
 * @param {string} path - Target API endpoint path.
 * @param {string} method - HTTP method (GET, POST, etc.).
 * @param {Object|null} body - Request payload object.
 * @returns {Promise<{ ok: boolean, status: number, data: Object }>}
 */
async function apiRequest(path, method = "GET", body = null) {
    let result;

    if (API_CONFIG.USE_MOCK) {
        result = await mockApiRequest(path, method, body);
    } else {
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
                data = {
                    message: "Unexpected server response."
                };
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
                        message: "Cannot reach the server. Check your connection and try again."
                    },
                    message: "Cannot reach the server. Check your connection and try again."
                }
            };
        }
    }

    // Auto-redirect on 401 Unauthorized (unless it's an intentional login/register check)
    if (result && result.status === 401 && !path.includes("/login") && !path.includes("/register")) {
        clearSession();
        window.location.replace("login.html");
    }

    return result;
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
    window.getMockUsers = getMockUsers;
}
