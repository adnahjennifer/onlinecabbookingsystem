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
        cancelBooking: "/api/ride-requests/:request_id/cancel",
        // Driver endpoints (Member 3 - Day 4)
        driverRequests: "/api/driver/requests",
        driverAcceptRequest: "/api/driver/requests/:request_id/accept",
        driverRejectRequest: "/api/driver/requests/:request_id/reject",
        driverStartTrip: "/api/driver/trips/:trip_id/start",
        driverCompleteTrip: "/api/driver/trips/:trip_id/complete",
        driverVehicles: "/api/driver/vehicles",
        driverVehicleItem: "/api/driver/vehicles/:vehicle_id",
        driverEarnings: "/api/driver/earnings",
        driverAvailability: "/api/driver/availability",
        // Admin endpoints (Member 3 - Day 5)
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
        // Super Admin endpoints (Member 3 - Day 6)
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
    let users = [];
    try {
        const stored = localStorage.getItem(MOCK_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                users = parsed;
            }
        }
    } catch (err) {
        console.error("Failed to parse mockUsers from localStorage:", err);
    }

    let modified = false;

    // Default sample passenger for quick test login
    if (!users.some((u) => u.email && u.email.toLowerCase() === "alex@example.com")) {
        users.push({
            id: 1,
            user_id: 1,
            name: "Alex",
            full_name: "Alex",
            email: "alex@example.com",
            password: "Password123",
            role: "passenger"
        });
        modified = true;
    }

    // Default sample driver for quick test login
    if (!users.some((u) => u.email && u.email.toLowerCase() === "driver@example.com")) {
        users.push({
            id: 102,
            user_id: 102,
            driver_id: 102,
            name: "Arjun S.",
            full_name: "Arjun S.",
            email: "driver@example.com",
            password: "Password123",
            role: "driver"
        });
        modified = true;
    }

    // Default sample admin for quick test login (Member 3 - Day 5)
    if (!users.some((u) => u.email && u.email.toLowerCase() === "admin@example.com")) {
        users.push({
            id: 201,
            user_id: 201,
            name: "Meera K.",
            full_name: "Meera K.",
            email: "admin@example.com",
            password: "Password123",
            role: "admin"
        });
        modified = true;
    }

    // Default sample super admin for quick test login (Member 3 - Day 6)
    if (!users.some((u) => u.email && u.email.toLowerCase() === "superadmin@example.com")) {
        users.push({
            id: 301,
            user_id: 301,
            name: "Suresh V.",
            full_name: "Suresh V.",
            email: "superadmin@example.com",
            password: "Password123",
            role: "super_admin"
        });
        modified = true;
    }

    if (modified || users.length === 0) {
        try {
            localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(users));
        } catch (err) {
            console.error("Failed to save default mockUsers:", err);
        }
    }

    return users;
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

    /* ======================================================================
       DRIVER MOCK ENDPOINTS (Member 3 - Day 4)
       ====================================================================== */

    const MOCK_DRIVER_REQUESTS_KEY = "cabgo_mock_driver_requests";
    const MOCK_DRIVER_VEHICLES_KEY = "cabgo_mock_driver_vehicles";
    const MOCK_DRIVER_TRIPS_KEY = "cabgo_mock_driver_completed_trips";
    const MOCK_DRIVER_PROFILE_KEY = "cabgo_mock_driver_profile";

    function getMockDriverRequests() {
        try {
            const raw = localStorage.getItem(MOCK_DRIVER_REQUESTS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {
            console.error("Failed to parse mock driver requests:", e);
        }

        const defaults = [
            {
                request_id: 2041,
                passenger_id: 101,
                passenger_name: "Priya S.",
                pickup_location: "Adyar",
                drop_location: "T. Nagar",
                vehicle_type: "standard",
                estimated_fare: 320.00,
                status: "requested",
                created_at: new Date(Date.now() - 1000 * 60 * 14).toISOString()
            },
            {
                request_id: 2042,
                passenger_id: 102,
                passenger_name: "Rahul M.",
                pickup_location: "Guindy",
                drop_location: "Velachery",
                vehicle_type: "sedan",
                estimated_fare: 210.00,
                status: "requested",
                created_at: new Date(Date.now() - 1000 * 60 * 6).toISOString()
            }
        ];

        // Also check if any passenger booked rides in mock storage and import them
        try {
            const passengerBookingsRaw = localStorage.getItem("cabgo_bookings_user_1");
            if (passengerBookingsRaw) {
                const pBookings = JSON.parse(passengerBookingsRaw);
                pBookings.forEach((b) => {
                    if (!defaults.some((d) => String(d.request_id) === String(b.request_id))) {
                        defaults.unshift({
                            request_id: b.request_id,
                            passenger_id: 1,
                            passenger_name: "Alex",
                            pickup_location: b.pickup_location,
                            drop_location: b.drop_location,
                            vehicle_type: b.vehicle_type || "standard",
                            estimated_fare: b.estimated_fare,
                            status: b.status || "requested",
                            created_at: b.created_at || new Date().toISOString()
                        });
                    }
                });
            }
        } catch (e) {
            // ignore
        }

        try {
            localStorage.setItem(MOCK_DRIVER_REQUESTS_KEY, JSON.stringify(defaults));
        } catch (e) {}

        return defaults;
    }

    function saveMockDriverRequests(requests) {
        try {
            localStorage.setItem(MOCK_DRIVER_REQUESTS_KEY, JSON.stringify(requests));
        } catch (e) {
            console.error("Failed to save mock driver requests:", e);
        }
    }

    function getMockDriverVehicles() {
        try {
            const raw = localStorage.getItem(MOCK_DRIVER_VEHICLES_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {
            console.error("Failed to parse mock driver vehicles:", e);
        }

        const defaults = [
            {
                vehicle_id: 1,
                driver_id: 102,
                registration_number: "TN 09 AB 1234",
                vehicle_type: "standard",
                model: "Maruti Swift",
                capacity: 4,
                approval_status: "approved",
                is_active: true,
                created_at: "2026-10-15T10:00:00.000Z"
            },
            {
                vehicle_id: 2,
                driver_id: 102,
                registration_number: "TN 07 CD 5678",
                vehicle_type: "sedan",
                model: "Hyundai Verna",
                capacity: 4,
                approval_status: "pending",
                is_active: true,
                created_at: "2026-10-20T14:30:00.000Z"
            }
        ];

        try {
            localStorage.setItem(MOCK_DRIVER_VEHICLES_KEY, JSON.stringify(defaults));
        } catch (e) {}

        return defaults;
    }

    function saveMockDriverVehicles(vehicles) {
        try {
            localStorage.setItem(MOCK_DRIVER_VEHICLES_KEY, JSON.stringify(vehicles));
        } catch (e) {
            console.error("Failed to save mock driver vehicles:", e);
        }
    }

    function getMockDriverTrips() {
        try {
            const raw = localStorage.getItem(MOCK_DRIVER_TRIPS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {
            console.error("Failed to parse mock driver trips:", e);
        }

        const defaults = [
            {
                trip_id: 1008,
                request_id: 2038,
                driver_id: 102,
                passenger_name: "Suresh Kumar",
                pickup_location: "Adyar",
                drop_location: "T. Nagar",
                vehicle_model: "Maruti Swift",
                registration_number: "TN 09 AB 1234",
                status: "completed",
                final_fare: 280.00,
                started_at: new Date(Date.now() - 1000 * 60 * 150).toISOString(),
                completed_at: new Date(Date.now() - 1000 * 60 * 120).toISOString()
            },
            {
                trip_id: 1007,
                request_id: 2035,
                driver_id: 102,
                passenger_name: "Ananya Roy",
                pickup_location: "Airport",
                drop_location: "Nungambakkam",
                vehicle_model: "Maruti Swift",
                registration_number: "TN 09 AB 1234",
                status: "completed",
                final_fare: 360.00,
                started_at: new Date(Date.now() - 1000 * 60 * 280).toISOString(),
                completed_at: new Date(Date.now() - 1000 * 60 * 240).toISOString()
            },
            {
                trip_id: 1006,
                request_id: 2031,
                driver_id: 102,
                passenger_name: "Vikas Reddy",
                pickup_location: "Egmore",
                drop_location: "Anna Nagar",
                vehicle_model: "Maruti Swift",
                registration_number: "TN 09 AB 1234",
                status: "completed",
                final_fare: 240.00,
                started_at: new Date(Date.now() - 1000 * 60 * 400).toISOString(),
                completed_at: new Date(Date.now() - 1000 * 60 * 360).toISOString()
            }
        ];

        try {
            localStorage.setItem(MOCK_DRIVER_TRIPS_KEY, JSON.stringify(defaults));
        } catch (e) {}

        return defaults;
    }

    function saveMockDriverTrips(trips) {
        try {
            localStorage.setItem(MOCK_DRIVER_TRIPS_KEY, JSON.stringify(trips));
        } catch (e) {
            console.error("Failed to save mock driver trips:", e);
        }
    }

    function getMockDriverProfile() {
        try {
            const raw = localStorage.getItem(MOCK_DRIVER_PROFILE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}

        const profile = {
            driver_id: 102,
            availability_status: "available",
            rating: 4.80,
            verification_status: "approved"
        };
        try {
            localStorage.setItem(MOCK_DRIVER_PROFILE_KEY, JSON.stringify(profile));
        } catch (e) {}
        return profile;
    }

    function saveMockDriverProfile(p) {
        try {
            localStorage.setItem(MOCK_DRIVER_PROFILE_KEY, JSON.stringify(p));
        } catch (e) {}
    }

    // 7. GET /api/driver/requests
    if (path === API_CONFIG.ENDPOINTS.driverRequests && methodUpper === "GET") {
        const requests = getMockDriverRequests();
        const profile = getMockDriverProfile();
        return {
            ok: true,
            status: 200,
            data: {
                message: "Driver requests retrieved successfully.",
                requests: requests,
                driver: profile
            }
        };
    }

    // 8. POST /api/driver/requests/:request_id/accept
    const driverAcceptMatch = path.match(/^\/api\/driver\/requests\/([^/]+)\/accept$/);
    if (driverAcceptMatch && methodUpper === "POST") {
        const reqId = driverAcceptMatch[1];
        const requests = getMockDriverRequests();
        const reqItem = requests.find((r) => String(r.request_id) === String(reqId));

        if (!reqItem) {
            return {
                ok: false,
                status: 404,
                data: {
                    error: {
                        code: "REQUEST_NOT_FOUND",
                        message: "Ride request not found."
                    }
                }
            };
        }

        if (reqItem.status !== "requested") {
            return {
                ok: false,
                status: 409,
                data: {
                    error: {
                        code: "INVALID_STATUS_TRANSITION",
                        message: `Cannot accept request with status "${reqItem.status}". It must be in "requested" status.`
                    }
                }
            };
        }

        reqItem.status = "accepted";
        reqItem.accepted_at = new Date().toISOString();
        reqItem.trip_id = reqItem.trip_id || (Math.floor(Date.now() / 1000) % 10000);
        saveMockDriverRequests(requests);

        // Update driver availability to on_trip
        const profile = getMockDriverProfile();
        profile.availability_status = "on_trip";
        saveMockDriverProfile(profile);

        // Synchronize with passenger bookings if present
        try {
            const pKey = "cabgo_bookings_user_1";
            const pRaw = localStorage.getItem(pKey);
            if (pRaw) {
                const pBookings = JSON.parse(pRaw);
                const pb = pBookings.find((b) => String(b.request_id) === String(reqId));
                if (pb) {
                    pb.status = "accepted";
                    pb.driver = { full_name: "Arjun S.", rating: 4.80 };
                    pb.vehicle = { registration_number: "TN 09 AB 1234", model: "Maruti Swift", vehicle_type: reqItem.vehicle_type || "standard" };
                    localStorage.setItem(pKey, JSON.stringify(pBookings));
                }
            }
        } catch (e) {}

        return {
            ok: true,
            status: 200,
            data: {
                message: `Request #${reqId} accepted successfully. You can now start the trip.`,
                request: reqItem,
                trip: {
                    trip_id: reqItem.trip_id,
                    request_id: reqItem.request_id,
                    status: "accepted",
                    started_at: null,
                    completed_at: null
                }
            }
        };
    }

    // 9. POST /api/driver/requests/:request_id/reject
    const driverRejectMatch = path.match(/^\/api\/driver\/requests\/([^/]+)\/reject$/);
    if (driverRejectMatch && methodUpper === "POST") {
        const reqId = driverRejectMatch[1];
        const requests = getMockDriverRequests();
        const reqItem = requests.find((r) => String(r.request_id) === String(reqId));

        if (!reqItem) {
            return {
                ok: false,
                status: 404,
                data: {
                    error: {
                        code: "REQUEST_NOT_FOUND",
                        message: "Ride request not found."
                    }
                }
            };
        }

        if (reqItem.status !== "requested") {
            return {
                ok: false,
                status: 409,
                data: {
                    error: {
                        code: "INVALID_STATUS_TRANSITION",
                        message: `Cannot reject request with status "${reqItem.status}". It must be in "requested" status.`
                    }
                }
            };
        }

        reqItem.status = "rejected";
        saveMockDriverRequests(requests);

        return {
            ok: true,
            status: 200,
            data: {
                message: `Request #${reqId} was rejected.`,
                request: reqItem
            }
        };
    }

    // 10. POST /api/driver/trips/:trip_id/start
    const driverStartMatch = path.match(/^\/api\/driver\/trips\/([^/]+)\/start$/);
    if (driverStartMatch && methodUpper === "POST") {
        const tripOrReqId = driverStartMatch[1];
        const requests = getMockDriverRequests();
        const reqItem = requests.find((r) => String(r.trip_id) === String(tripOrReqId) || String(r.request_id) === String(tripOrReqId));

        if (!reqItem) {
            return {
                ok: false,
                status: 404,
                data: {
                    error: {
                        code: "TRIP_NOT_FOUND",
                        message: "Trip or ride request not found."
                    }
                }
            };
        }

        if (reqItem.status !== "accepted") {
            return {
                ok: false,
                status: 409,
                data: {
                    error: {
                        code: "INVALID_STATUS_TRANSITION",
                        message: `Cannot start trip with status "${reqItem.status}". Trip must be accepted first.`
                    }
                }
            };
        }

        reqItem.status = "started";
        reqItem.started_at = new Date().toISOString();
        saveMockDriverRequests(requests);

        // Synchronize with passenger bookings if present
        try {
            const pKey = "cabgo_bookings_user_1";
            const pRaw = localStorage.getItem(pKey);
            if (pRaw) {
                const pBookings = JSON.parse(pRaw);
                const pb = pBookings.find((b) => String(b.request_id) === String(reqItem.request_id));
                if (pb) {
                    pb.status = "started";
                    localStorage.setItem(pKey, JSON.stringify(pBookings));
                }
            }
        } catch (e) {}

        return {
            ok: true,
            status: 200,
            data: {
                message: `Trip #${reqItem.trip_id || reqItem.request_id} has started. Drive safely!`,
                trip: {
                    trip_id: reqItem.trip_id || reqItem.request_id,
                    request_id: reqItem.request_id,
                    status: "started",
                    started_at: reqItem.started_at
                }
            }
        };
    }

    // 11. POST /api/driver/trips/:trip_id/complete
    const driverCompleteMatch = path.match(/^\/api\/driver\/trips\/([^/]+)\/complete$/);
    if (driverCompleteMatch && methodUpper === "POST") {
        const tripOrReqId = driverCompleteMatch[1];
        const requests = getMockDriverRequests();
        const reqItem = requests.find((r) => String(r.trip_id) === String(tripOrReqId) || String(r.request_id) === String(tripOrReqId));

        if (!reqItem) {
            return {
                ok: false,
                status: 404,
                data: {
                    error: {
                        code: "TRIP_NOT_FOUND",
                        message: "Trip or ride request not found."
                    }
                }
            };
        }

        if (reqItem.status !== "started") {
            return {
                ok: false,
                status: 409,
                data: {
                    error: {
                        code: "INVALID_STATUS_TRANSITION",
                        message: `Cannot complete trip with status "${reqItem.status}". Trip must be in "started" status.`
                    }
                }
            };
        }

        const finalFare = body && body.final_fare !== undefined ? parseFloat(body.final_fare) : parseFloat(reqItem.estimated_fare);

        reqItem.status = "completed";
        reqItem.completed_at = new Date().toISOString();
        reqItem.final_fare = finalFare;
        saveMockDriverRequests(requests);

        // Update driver availability back to available
        const profile = getMockDriverProfile();
        profile.availability_status = "available";
        saveMockDriverProfile(profile);

        // Record completed trip into driver trips
        const trips = getMockDriverTrips();
        const completedRecord = {
            trip_id: reqItem.trip_id || (Math.floor(Date.now() / 1000) % 10000),
            request_id: reqItem.request_id,
            driver_id: 102,
            passenger_name: reqItem.passenger_name || "Passenger",
            pickup_location: reqItem.pickup_location,
            drop_location: reqItem.drop_location,
            vehicle_model: "Maruti Swift",
            registration_number: "TN 09 AB 1234",
            status: "completed",
            final_fare: finalFare,
            started_at: reqItem.started_at,
            completed_at: reqItem.completed_at
        };
        trips.unshift(completedRecord);
        saveMockDriverTrips(trips);

        // Synchronize with passenger bookings if present
        try {
            const pKey = "cabgo_bookings_user_1";
            const pRaw = localStorage.getItem(pKey);
            if (pRaw) {
                const pBookings = JSON.parse(pRaw);
                const pb = pBookings.find((b) => String(b.request_id) === String(reqItem.request_id));
                if (pb) {
                    pb.status = "completed";
                    pb.final_fare = finalFare;
                    localStorage.setItem(pKey, JSON.stringify(pBookings));
                }
            }
        } catch (e) {}

        return {
            ok: true,
            status: 200,
            data: {
                message: `Trip completed successfully. Recorded fare: ₹${finalFare.toFixed(2)}.`,
                trip: completedRecord
            }
        };
    }

    // 12. GET /api/driver/vehicles
    if (path === API_CONFIG.ENDPOINTS.driverVehicles && methodUpper === "GET") {
        const vehicles = getMockDriverVehicles();
        return {
            ok: true,
            status: 200,
            data: {
                message: "Vehicles retrieved successfully.",
                vehicles: vehicles
            }
        };
    }

    // 13. POST /api/driver/vehicles (Add vehicle)
    if (path === API_CONFIG.ENDPOINTS.driverVehicles && methodUpper === "POST") {
        const regNum = body && body.registration_number ? String(body.registration_number).trim().toUpperCase() : "";
        const vType = body && body.vehicle_type ? String(body.vehicle_type).trim().toLowerCase() : "";
        const model = body && body.model ? String(body.model).trim() : "";
        const capacity = body && body.capacity !== undefined ? parseInt(body.capacity, 10) : 0;

        if (!regNum || !vType || !model || !capacity) {
            return {
                ok: false,
                status: 400,
                data: {
                    error: {
                        code: "INVALID_INPUT",
                        message: "All fields are required (registration number, vehicle type, model, capacity)."
                    }
                }
            };
        }

        if (!["standard", "sedan", "suv"].includes(vType)) {
            return {
                ok: false,
                status: 400,
                data: {
                    error: {
                        code: "INVALID_VEHICLE_TYPE",
                        message: "Vehicle type must be 'standard', 'sedan', or 'suv'."
                    }
                }
            };
        }

        if (isNaN(capacity) || capacity < 1 || capacity > 10) {
            return {
                ok: false,
                status: 400,
                data: {
                    error: {
                        code: "INVALID_CAPACITY",
                        message: "Capacity must be a positive integer between 1 and 10."
                    }
                }
            };
        }

        const vehicles = getMockDriverVehicles();
        if (vehicles.some((v) => v.registration_number.replace(/\s+/g, "") === regNum.replace(/\s+/g, ""))) {
            return {
                ok: false,
                status: 409,
                data: {
                    error: {
                        code: "DUPLICATE_REGISTRATION",
                        message: `A vehicle with registration number "${regNum}" already exists.`
                    }
                }
            };
        }

        const newVehicle = {
            vehicle_id: (Date.now() % 9000) + 1000,
            driver_id: 102,
            registration_number: regNum,
            vehicle_type: vType,
            model: model,
            capacity: capacity,
            approval_status: "pending",
            is_active: true,
            created_at: new Date().toISOString()
        };

        vehicles.push(newVehicle);
        saveMockDriverVehicles(vehicles);

        return {
            ok: true,
            status: 201,
            data: {
                message: "Vehicle added successfully. Status is pending administrator approval.",
                vehicle: newVehicle
            }
        };
    }

    // 14. PUT /api/driver/vehicles/:vehicle_id (Edit vehicle)
    const driverEditVehicleMatch = path.match(/^\/api\/driver\/vehicles\/([^/]+)$/);
    if (driverEditVehicleMatch && (methodUpper === "PUT" || methodUpper === "PATCH")) {
        const vId = driverEditVehicleMatch[1];
        const vehicles = getMockDriverVehicles();
        const targetVehicle = vehicles.find((v) => String(v.vehicle_id) === String(vId));

        if (!targetVehicle) {
            return {
                ok: false,
                status: 404,
                data: {
                    error: {
                        code: "VEHICLE_NOT_FOUND",
                        message: "Vehicle not found."
                    }
                }
            };
        }

        if (body.model) targetVehicle.model = String(body.model).trim();
        if (body.vehicle_type && ["standard", "sedan", "suv"].includes(String(body.vehicle_type).toLowerCase())) {
            targetVehicle.vehicle_type = String(body.vehicle_type).toLowerCase();
        }
        if (body.capacity) {
            const cap = parseInt(body.capacity, 10);
            if (!isNaN(cap) && cap >= 1 && cap <= 10) {
                targetVehicle.capacity = cap;
            }
        }
        if (body.is_active !== undefined) {
            targetVehicle.is_active = Boolean(body.is_active);
        }

        saveMockDriverVehicles(vehicles);

        return {
            ok: true,
            status: 200,
            data: {
                message: "Vehicle updated successfully.",
                vehicle: targetVehicle
            }
        };
    }

    // 15. GET /api/driver/earnings
    if (path === API_CONFIG.ENDPOINTS.driverEarnings && methodUpper === "GET") {
        const trips = getMockDriverTrips();
        const totalEarnings = trips.reduce((sum, t) => sum + (parseFloat(t.final_fare) || 0), 0);
        const count = trips.length;
        const avg = count > 0 ? totalEarnings / count : 0;

        return {
            ok: true,
            status: 200,
            data: {
                message: "Earnings summary retrieved successfully.",
                earnings: {
                    total_earnings: parseFloat(totalEarnings.toFixed(2)),
                    completed_trips_count: count,
                    average_fare: parseFloat(avg.toFixed(2)),
                    trips: trips
                }
            }
        };
    }

    // 16. PATCH /api/driver/availability
    if (path === API_CONFIG.ENDPOINTS.driverAvailability && (methodUpper === "PATCH" || methodUpper === "POST")) {
        const nextStatus = body && body.availability_status ? String(body.availability_status).trim().toLowerCase() : "available";
        const profile = getMockDriverProfile();
        profile.availability_status = ["available", "offline", "on_trip"].includes(nextStatus) ? nextStatus : "available";
        saveMockDriverProfile(profile);

        return {
            ok: true,
            status: 200,
            data: {
                message: `Availability updated to ${profile.availability_status}.`,
                availability_status: profile.availability_status
            }
        };
    }

    /* ======================================================================
       ADMIN & SUPER ADMIN MOCK ENDPOINTS (Member 3 - Days 5 & 6)
       ====================================================================== */

    const MOCK_ADMIN_DRIVERS_KEY = "cabgo_mock_admin_drivers";
    const MOCK_ADMIN_PASSENGERS_KEY = "cabgo_mock_admin_passengers";
    const MOCK_ADMIN_FARE_RULES_KEY = "cabgo_mock_admin_fare_rules";
    const MOCK_SUPERADMIN_ADMINS_KEY = "cabgo_mock_superadmin_admins";
    const MOCK_SUPERADMIN_LOGS_KEY = "cabgo_mock_superadmin_logs";
    const MOCK_SUPERADMIN_SETTINGS_KEY = "cabgo_mock_superadmin_settings";

    function getMockAdminDrivers() {
        try {
            const raw = localStorage.getItem(MOCK_ADMIN_DRIVERS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}

        const defaults = [
            {
                driver_id: 101,
                user_id: 201,
                full_name: "Kavya R.",
                email: "kavya@example.com",
                license_number: "TN-DRV-2024-018",
                license_expiry: "2028-05-12",
                verification_status: "pending",
                availability_status: "offline",
                rating: null,
                created_at: "2026-10-18T09:30:00.000Z"
            },
            {
                driver_id: 102,
                user_id: 102,
                full_name: "Arjun S.",
                email: "driver@example.com",
                license_number: "TN-DRV-2023-042",
                license_expiry: "2027-11-20",
                verification_status: "approved",
                availability_status: "available",
                rating: 4.80,
                created_at: "2026-09-10T11:00:00.000Z"
            },
            {
                driver_id: 103,
                user_id: 203,
                full_name: "Ramesh Babu",
                email: "ramesh@example.com",
                license_number: "TN-DRV-2022-099",
                license_expiry: "2026-12-31",
                verification_status: "approved",
                availability_status: "offline",
                rating: 4.75,
                created_at: "2026-08-05T14:15:00.000Z"
            },
            {
                driver_id: 104,
                user_id: 204,
                full_name: "Dinesh K.",
                email: "dinesh@example.com",
                license_number: "TN-DRV-2024-110",
                license_expiry: "2029-01-15",
                verification_status: "rejected",
                availability_status: "offline",
                rating: null,
                created_at: "2026-10-22T16:40:00.000Z"
            }
        ];

        try {
            localStorage.setItem(MOCK_ADMIN_DRIVERS_KEY, JSON.stringify(defaults));
        } catch (e) {}
        return defaults;
    }

    function saveMockAdminDrivers(drivers) {
        try {
            localStorage.setItem(MOCK_ADMIN_DRIVERS_KEY, JSON.stringify(drivers));
        } catch (e) {}
    }

    function getMockAdminPassengers() {
        try {
            const raw = localStorage.getItem(MOCK_ADMIN_PASSENGERS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}

        const defaults = [
            {
                user_id: 1,
                full_name: "Alex",
                email: "alex@example.com",
                role: "passenger",
                status: "active",
                total_trips: 4,
                created_at: "2026-09-01T10:00:00.000Z"
            },
            {
                user_id: 101,
                full_name: "Priya S.",
                email: "priya@example.com",
                role: "passenger",
                status: "active",
                total_trips: 8,
                created_at: "2026-09-14T12:30:00.000Z"
            },
            {
                user_id: 102,
                full_name: "Rahul M.",
                email: "rahul@example.com",
                role: "passenger",
                status: "active",
                total_trips: 3,
                created_at: "2026-10-02T15:20:00.000Z"
            },
            {
                user_id: 105,
                full_name: "Sneha V.",
                email: "sneha@example.com",
                role: "passenger",
                status: "blocked",
                total_trips: 1,
                created_at: "2026-10-10T18:00:00.000Z"
            }
        ];

        try {
            localStorage.setItem(MOCK_ADMIN_PASSENGERS_KEY, JSON.stringify(defaults));
        } catch (e) {}
        return defaults;
    }

    function saveMockAdminPassengers(passengers) {
        try {
            localStorage.setItem(MOCK_ADMIN_PASSENGERS_KEY, JSON.stringify(passengers));
        } catch (e) {}
    }

    function getMockAdminFareRules() {
        try {
            const raw = localStorage.getItem(MOCK_ADMIN_FARE_RULES_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}

        const defaults = [
            {
                fare_rule_id: 1,
                vehicle_type: "standard",
                base_fare: 50.00,
                per_km_rate: 12.00,
                per_minute_rate: 1.50,
                is_active: true,
                updated_at: "2026-10-25T10:00:00.000Z"
            },
            {
                fare_rule_id: 2,
                vehicle_type: "sedan",
                base_fare: 75.00,
                per_km_rate: 15.00,
                per_minute_rate: 2.00,
                is_active: true,
                updated_at: "2026-10-25T10:00:00.000Z"
            },
            {
                fare_rule_id: 3,
                vehicle_type: "suv",
                base_fare: 110.00,
                per_km_rate: 20.00,
                per_minute_rate: 2.50,
                is_active: true,
                updated_at: "2026-10-25T10:00:00.000Z"
            }
        ];

        try {
            localStorage.setItem(MOCK_ADMIN_FARE_RULES_KEY, JSON.stringify(defaults));
        } catch (e) {}
        return defaults;
    }

    function saveMockAdminFareRules(rules) {
        try {
            localStorage.setItem(MOCK_ADMIN_FARE_RULES_KEY, JSON.stringify(rules));
        } catch (e) {}
    }

    function getMockSuperadminAdmins() {
        try {
            const raw = localStorage.getItem(MOCK_SUPERADMIN_ADMINS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}

        const defaults = [
            {
                user_id: 201,
                full_name: "Meera K.",
                email: "admin@example.com",
                role: "admin",
                department: "Operations",
                status: "active",
                created_at: "2026-09-01T09:00:00.000Z"
            },
            {
                user_id: 302,
                full_name: "Dev P.",
                email: "dev@example.com",
                role: "admin",
                department: "Reports & Auditing",
                status: "inactive",
                created_at: "2026-09-15T11:30:00.000Z"
            },
            {
                user_id: 303,
                full_name: "Karthik N.",
                email: "karthik@example.com",
                role: "admin",
                department: "Driver Management",
                status: "active",
                created_at: "2026-10-05T14:00:00.000Z"
            },
            {
                user_id: 301,
                full_name: "Suresh V.",
                email: "superadmin@example.com",
                role: "super_admin",
                department: "System Owner",
                status: "active",
                created_at: "2026-08-01T00:00:00.000Z"
            }
        ];

        try {
            localStorage.setItem(MOCK_SUPERADMIN_ADMINS_KEY, JSON.stringify(defaults));
        } catch (e) {}
        return defaults;
    }

    function saveMockSuperadminAdmins(admins) {
        try {
            localStorage.setItem(MOCK_SUPERADMIN_ADMINS_KEY, JSON.stringify(admins));
        } catch (e) {}
    }

    function getMockSuperadminLogs() {
        try {
            const raw = localStorage.getItem(MOCK_SUPERADMIN_LOGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}

        const defaults = [
            {
                log_id: 101,
                timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString().replace("T", " ").substring(0, 19),
                actor: "ADM-01 (Meera K.)",
                action: "Approved driver registration",
                status: "success",
                details: "Driver #102 (Arjun S.) verification completed."
            },
            {
                log_id: 102,
                timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString().replace("T", " ").substring(0, 19),
                actor: "SA-01 (Suresh V.)",
                action: "Updated fare rules",
                status: "info",
                details: "Standard base fare set to ₹50.00, per km ₹12.00."
            },
            {
                log_id: 103,
                timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString().replace("T", " ").substring(0, 19),
                actor: "System",
                action: "Database backup & check",
                status: "success",
                details: "Daily transaction snapshot created successfully."
            },
            {
                log_id: 104,
                timestamp: new Date(Date.now() - 1000 * 60 * 240).toISOString().replace("T", " ").substring(0, 19),
                actor: "ADM-02 (Dev P.)",
                action: "Passenger account flag",
                status: "warning",
                details: "Passenger #105 (Sneha V.) placed on hold."
            },
            {
                log_id: 105,
                timestamp: new Date(Date.now() - 1000 * 60 * 360).toISOString().replace("T", " ").substring(0, 19),
                actor: "SA-01 (Suresh V.)",
                action: "Security audit",
                status: "info",
                details: "Reviewed session tokens and authentication roles."
            }
        ];

        try {
            localStorage.setItem(MOCK_SUPERADMIN_LOGS_KEY, JSON.stringify(defaults));
        } catch (e) {}
        return defaults;
    }

    function addMockLog(actor, action, status, details) {
        try {
            const logs = getMockSuperadminLogs();
            logs.unshift({
                log_id: Date.now() % 100000,
                timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
                actor: actor || "Admin",
                action: action,
                status: status || "info",
                details: details || ""
            });
            localStorage.setItem(MOCK_SUPERADMIN_LOGS_KEY, JSON.stringify(logs.slice(0, 50)));
        } catch (e) {}
    }

    function getMockSuperadminSettings() {
        try {
            const raw = localStorage.getItem(MOCK_SUPERADMIN_SETTINGS_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}

        const defaults = {
            platform_name: "CabGo Online Cab Booking",
            maintenance_mode: false,
            booking_enabled: true,
            driver_commission_percentage: 15,
            max_search_radius_km: 15,
            support_email: "support@cabgo.local",
            surge_pricing_enabled: true
        };

        try {
            localStorage.setItem(MOCK_SUPERADMIN_SETTINGS_KEY, JSON.stringify(defaults));
        } catch (e) {}
        return defaults;
    }

    function saveMockSuperadminSettings(settings) {
        try {
            localStorage.setItem(MOCK_SUPERADMIN_SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {}
    }

    // 17. GET /api/admin/stats
    if (path === API_CONFIG.ENDPOINTS.adminStats && methodUpper === "GET") {
        const drivers = getMockAdminDrivers();
        const passengers = getMockAdminPassengers();
        const vehicles = getMockDriverVehicles();
        const pendingDrivers = drivers.filter(d => d.verification_status === "pending").length;
        const pendingVehicles = vehicles.filter(v => v.approval_status === "pending").length;

        return {
            ok: true,
            status: 200,
            data: {
                total_passengers: passengers.length + 1244,
                total_drivers: drivers.length + 82,
                active_trips: 24,
                today_revenue: 42650.00,
                pending_verifications: pendingDrivers,
                pending_vehicles: pendingVehicles
            }
        };
    }

    // 18. GET /api/admin/drivers
    if (path === API_CONFIG.ENDPOINTS.adminDrivers && methodUpper === "GET") {
        const drivers = getMockAdminDrivers();
        return {
            ok: true,
            status: 200,
            data: {
                message: "Drivers retrieved successfully.",
                drivers: drivers
            }
        };
    }

    // 19. POST /api/admin/drivers/:driver_id/approve
    const adminDriverApproveMatch = path.match(/^\/api\/admin\/drivers\/([^/]+)\/approve$/);
    if (adminDriverApproveMatch && methodUpper === "POST") {
        const driverId = adminDriverApproveMatch[1];
        const drivers = getMockAdminDrivers();
        const driver = drivers.find(d => String(d.driver_id) === String(driverId));
        if (!driver) {
            return { ok: false, status: 404, data: { message: "Driver not found." } };
        }
        driver.verification_status = "approved";
        saveMockAdminDrivers(drivers);
        addMockLog("Admin", "Approved driver registration", "success", `Driver #${driverId} (${driver.full_name}) approved.`);
        return {
            ok: true,
            status: 200,
            data: { message: `Driver ${driver.full_name} has been approved.`, driver }
        };
    }

    // 20. POST /api/admin/drivers/:driver_id/reject
    const adminDriverRejectMatch = path.match(/^\/api\/admin\/drivers\/([^/]+)\/reject$/);
    if (adminDriverRejectMatch && methodUpper === "POST") {
        const driverId = adminDriverRejectMatch[1];
        const drivers = getMockAdminDrivers();
        const driver = drivers.find(d => String(d.driver_id) === String(driverId));
        if (!driver) {
            return { ok: false, status: 404, data: { message: "Driver not found." } };
        }
        driver.verification_status = "rejected";
        saveMockAdminDrivers(drivers);
        addMockLog("Admin", "Rejected driver registration", "warning", `Driver #${driverId} (${driver.full_name}) rejected.`);
        return {
            ok: true,
            status: 200,
            data: { message: `Driver ${driver.full_name} has been rejected.`, driver }
        };
    }

    // 21. POST /api/admin/drivers/:driver_id/block
    const adminDriverBlockMatch = path.match(/^\/api\/admin\/drivers\/([^/]+)\/block$/);
    if (adminDriverBlockMatch && methodUpper === "POST") {
        const driverId = adminDriverBlockMatch[1];
        const drivers = getMockAdminDrivers();
        const driver = drivers.find(d => String(d.driver_id) === String(driverId));
        if (!driver) {
            return { ok: false, status: 404, data: { message: "Driver not found." } };
        }
        driver.verification_status = "rejected";
        driver.availability_status = "offline";
        saveMockAdminDrivers(drivers);
        addMockLog("Admin", "Blocked driver account", "warning", `Driver #${driverId} (${driver.full_name}) blocked.`);
        return {
            ok: true,
            status: 200,
            data: { message: `Driver ${driver.full_name} blocked successfully.`, driver }
        };
    }

    // 22. GET /api/admin/passengers
    if (path === API_CONFIG.ENDPOINTS.adminPassengers && methodUpper === "GET") {
        const passengers = getMockAdminPassengers();
        return {
            ok: true,
            status: 200,
            data: {
                message: "Passengers retrieved successfully.",
                passengers: passengers
            }
        };
    }

    // 23. POST /api/admin/passengers/:user_id/toggle-block
    const adminPassengerToggleMatch = path.match(/^\/api\/admin\/passengers\/([^/]+)\/toggle-block$/);
    if (adminPassengerToggleMatch && methodUpper === "POST") {
        const userId = adminPassengerToggleMatch[1];
        const passengers = getMockAdminPassengers();
        const p = passengers.find(item => String(item.user_id) === String(userId));
        if (!p) {
            return { ok: false, status: 404, data: { message: "Passenger not found." } };
        }
        p.status = p.status === "active" ? "blocked" : "active";
        saveMockAdminPassengers(passengers);
        addMockLog("Admin", `Passenger status changed to ${p.status}`, "info", `Passenger #${userId} (${p.full_name}) is now ${p.status}.`);
        return {
            ok: true,
            status: 200,
            data: { message: `Passenger ${p.full_name} is now ${p.status}.`, passenger: p }
        };
    }

    // 24. GET /api/admin/vehicles
    if (path === API_CONFIG.ENDPOINTS.adminVehicles && methodUpper === "GET") {
        const vehicles = getMockDriverVehicles();
        return {
            ok: true,
            status: 200,
            data: {
                message: "Fleet vehicles retrieved successfully.",
                vehicles: vehicles
            }
        };
    }

    // 25. POST /api/admin/vehicles/:vehicle_id/approve
    const adminVehicleApproveMatch = path.match(/^\/api\/admin\/vehicles\/([^/]+)\/approve$/);
    if (adminVehicleApproveMatch && methodUpper === "POST") {
        const vId = adminVehicleApproveMatch[1];
        const vehicles = getMockDriverVehicles();
        const vehicle = vehicles.find(v => String(v.vehicle_id) === String(vId));
        if (!vehicle) {
            return { ok: false, status: 404, data: { message: "Vehicle not found." } };
        }
        vehicle.approval_status = "approved";
        saveMockDriverVehicles(vehicles);
        addMockLog("Admin", "Approved vehicle", "success", `Vehicle ${vehicle.registration_number} (${vehicle.model}) approved.`);
        return {
            ok: true,
            status: 200,
            data: { message: `Vehicle ${vehicle.registration_number} approved.`, vehicle }
        };
    }

    // 26. POST /api/admin/vehicles/:vehicle_id/reject
    const adminVehicleRejectMatch = path.match(/^\/api\/admin\/vehicles\/([^/]+)\/reject$/);
    if (adminVehicleRejectMatch && methodUpper === "POST") {
        const vId = adminVehicleRejectMatch[1];
        const vehicles = getMockDriverVehicles();
        const vehicle = vehicles.find(v => String(v.vehicle_id) === String(vId));
        if (!vehicle) {
            return { ok: false, status: 404, data: { message: "Vehicle not found." } };
        }
        vehicle.approval_status = "rejected";
        saveMockDriverVehicles(vehicles);
        addMockLog("Admin", "Rejected vehicle", "warning", `Vehicle ${vehicle.registration_number} rejected.`);
        return {
            ok: true,
            status: 200,
            data: { message: `Vehicle ${vehicle.registration_number} rejected.`, vehicle }
        };
    }

    // 27. GET /api/admin/fare-rules
    if (path === API_CONFIG.ENDPOINTS.adminFareRules && methodUpper === "GET") {
        const rules = getMockAdminFareRules();
        return {
            ok: true,
            status: 200,
            data: {
                message: "Fare rules retrieved successfully.",
                fare_rules: rules
            }
        };
    }

    // 28. PUT /api/admin/fare-rules/:rule_id
    const adminFareRuleMatch = path.match(/^\/api\/admin\/fare-rules\/([^/]+)$/);
    if (adminFareRuleMatch && (methodUpper === "PUT" || methodUpper === "PATCH")) {
        const ruleId = adminFareRuleMatch[1];
        const rules = getMockAdminFareRules();
        const rule = rules.find(r => String(r.fare_rule_id) === String(ruleId) || r.vehicle_type === ruleId);
        if (!rule) {
            return { ok: false, status: 404, data: { message: "Fare rule not found." } };
        }

        if (body.base_fare !== undefined) rule.base_fare = parseFloat(body.base_fare) || rule.base_fare;
        if (body.per_km_rate !== undefined) rule.per_km_rate = parseFloat(body.per_km_rate) || rule.per_km_rate;
        if (body.per_minute_rate !== undefined) rule.per_minute_rate = parseFloat(body.per_minute_rate) || rule.per_minute_rate;
        rule.updated_at = new Date().toISOString();

        saveMockAdminFareRules(rules);
        addMockLog("Admin", `Updated fare rules for ${rule.vehicle_type}`, "info", `Base: ₹${rule.base_fare}, Per Km: ₹${rule.per_km_rate}`);
        return {
            ok: true,
            status: 200,
            data: { message: `Fare rule for ${rule.vehicle_type} updated successfully.`, fare_rule: rule }
        };
    }

    // 29. GET /api/admin/trips
    if (path === API_CONFIG.ENDPOINTS.adminTrips && methodUpper === "GET") {
        const trips = [
            {
                trip_id: 1008,
                request_id: 2038,
                passenger_name: "Suresh Kumar",
                driver_name: "Arjun S.",
                pickup_location: "Adyar",
                drop_location: "T. Nagar",
                vehicle_type: "standard",
                final_fare: 280.00,
                status: "completed",
                started_at: "2026-10-29T18:00:00.000Z",
                completed_at: "2026-10-29T18:30:00.000Z"
            },
            {
                trip_id: 1009,
                request_id: 2041,
                passenger_name: "Priya S.",
                driver_name: "Kavya R.",
                pickup_location: "Guindy",
                drop_location: "Velachery",
                vehicle_type: "sedan",
                final_fare: 210.00,
                status: "in_progress",
                started_at: "2026-10-29T19:10:00.000Z",
                completed_at: null
            },
            {
                trip_id: 1010,
                request_id: 2042,
                passenger_name: "Rahul M.",
                driver_name: "Ramesh Babu",
                pickup_location: "Mylapore",
                drop_location: "Egmore",
                vehicle_type: "standard",
                final_fare: 190.00,
                status: "completed",
                started_at: "2026-10-29T17:15:00.000Z",
                completed_at: "2026-10-29T17:45:00.000Z"
            },
            {
                trip_id: 1011,
                request_id: 2043,
                passenger_name: "Alex",
                driver_name: "Arjun S.",
                pickup_location: "Chennai Central",
                drop_location: "Marina Beach",
                vehicle_type: "standard",
                final_fare: 180.00,
                status: "completed",
                started_at: "2026-10-28T14:00:00.000Z",
                completed_at: "2026-10-28T14:25:00.000Z"
            }
        ];
        return {
            ok: true,
            status: 200,
            data: {
                message: "Trips retrieved successfully.",
                trips: trips
            }
        };
    }

    // 30. GET /api/superadmin/stats
    if (path === API_CONFIG.ENDPOINTS.superadminStats && methodUpper === "GET") {
        const admins = getMockSuperadminAdmins();
        const activeAdmins = admins.filter(a => a.status === "active").length;
        return {
            ok: true,
            status: 200,
            data: {
                total_admins: admins.length,
                active_admins: activeAdmins,
                permission_groups: 4,
                events_today: 128
            }
        };
    }

    // 31. GET /api/superadmin/admins
    if (path === API_CONFIG.ENDPOINTS.superadminAdmins && methodUpper === "GET") {
        const admins = getMockSuperadminAdmins();
        return {
            ok: true,
            status: 200,
            data: {
                message: "Administrators retrieved successfully.",
                admins: admins
            }
        };
    }

    // 32. POST /api/superadmin/admins (Add admin)
    if (path === API_CONFIG.ENDPOINTS.superadminAdmins && methodUpper === "POST") {
        const name = body && body.full_name ? String(body.full_name).trim() : "";
        const email = body && body.email ? String(body.email).trim().toLowerCase() : "";
        const department = body && body.department ? String(body.department).trim() : "Operations";
        const password = body && body.password ? String(body.password) : "Admin123";

        if (!name || !email) {
            return {
                ok: false,
                status: 400,
                data: { message: "Name and email are required." }
            };
        }

        const admins = getMockSuperadminAdmins();
        if (admins.some(a => a.email === email)) {
            return {
                ok: false,
                status: 409,
                data: { message: "An administrator with this email already exists." }
            };
        }

        const newAdmin = {
            user_id: Date.now() % 100000,
            full_name: name,
            email: email,
            role: "admin",
            department: department,
            status: "active",
            created_at: new Date().toISOString()
        };

        admins.push(newAdmin);
        saveMockSuperadminAdmins(admins);

        // Also add to mockUsers so they can log in
        const mockUsers = getMockUsers();
        mockUsers.push({
            id: newAdmin.user_id,
            user_id: newAdmin.user_id,
            name: newAdmin.full_name,
            full_name: newAdmin.full_name,
            email: newAdmin.email,
            password: password,
            role: "admin"
        });
        saveMockUsers(mockUsers);

        addMockLog("Super Admin", "Created new administrator", "success", `Added admin ${name} (${email}) with department ${department}.`);

        return {
            ok: true,
            status: 201,
            data: {
                message: `Administrator ${name} created successfully.`,
                admin: newAdmin
            }
        };
    }

    // 33. POST /api/superadmin/admins/:user_id/toggle
    const superAdminToggleMatch = path.match(/^\/api\/superadmin\/admins\/([^/]+)\/toggle$/);
    if (superAdminToggleMatch && methodUpper === "POST") {
        const uId = superAdminToggleMatch[1];
        const admins = getMockSuperadminAdmins();
        const target = admins.find(a => String(a.user_id) === String(uId));
        if (!target) {
            return { ok: false, status: 404, data: { message: "Administrator not found." } };
        }

        target.status = target.status === "active" ? "inactive" : "active";
        saveMockSuperadminAdmins(admins);
        addMockLog("Super Admin", `Changed admin status to ${target.status}`, "warning", `Admin #${uId} (${target.full_name}) is now ${target.status}.`);

        return {
            ok: true,
            status: 200,
            data: {
                message: `Administrator ${target.full_name} is now ${target.status}.`,
                admin: target
            }
        };
    }

    // 34. GET /api/superadmin/logs
    if (path === API_CONFIG.ENDPOINTS.superadminLogs && methodUpper === "GET") {
        const logs = getMockSuperadminLogs();
        return {
            ok: true,
            status: 200,
            data: {
                message: "System logs retrieved successfully.",
                logs: logs
            }
        };
    }

    // 35. GET /api/superadmin/settings
    if (path === API_CONFIG.ENDPOINTS.superadminSettings && methodUpper === "GET") {
        const settings = getMockSuperadminSettings();
        return {
            ok: true,
            status: 200,
            data: {
                message: "System settings retrieved successfully.",
                settings: settings
            }
        };
    }

    // 36. PUT /api/superadmin/settings
    if (path === API_CONFIG.ENDPOINTS.superadminSettings && (methodUpper === "PUT" || methodUpper === "POST")) {
        const current = getMockSuperadminSettings();
        if (body.platform_name !== undefined) current.platform_name = String(body.platform_name).trim();
        if (body.maintenance_mode !== undefined) current.maintenance_mode = Boolean(body.maintenance_mode);
        if (body.booking_enabled !== undefined) current.booking_enabled = Boolean(body.booking_enabled);
        if (body.driver_commission_percentage !== undefined) current.driver_commission_percentage = Number(body.driver_commission_percentage);
        if (body.max_search_radius_km !== undefined) current.max_search_radius_km = Number(body.max_search_radius_km);
        if (body.support_email !== undefined) current.support_email = String(body.support_email).trim();

        saveMockSuperadminSettings(current);
        addMockLog("Super Admin", "Updated system settings", "info", `Commission: ${current.driver_commission_percentage}%, Maintenance: ${current.maintenance_mode}`);

        return {
            ok: true,
            status: 200,
            data: {
                message: "System settings updated successfully.",
                settings: current
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

        // Automatic seamless fallback to mock simulator when running on static servers (like python http.server returning 501)
        // or when backend routes are not yet mounted (returning 404), or network is unavailable (status 0)
        if (!result.ok && (result.status === 404 || result.status === 501 || result.status === 0)) {
            console.warn(`[CabGo API] Endpoint ${method} ${path} returned HTTP ${result.status}. Falling back to mock simulation.`);
            result = await mockApiRequest(path, method, body);
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
