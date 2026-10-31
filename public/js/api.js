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
        // Notifications (Member 2 - added backend/API.md)
        notifications: "/api/notifications",
        markNotificationRead: "/api/notifications/:notification_id/read",
        // Backward-compatible aliases for Day 2/3 references
        searchRides: "/api/rides/search",
        bookings: "/api/ride-requests",
        cancelBooking: "/api/ride-requests/:request_id/cancel",
        // Driver endpoints (Member 3 - Day 4)
        driverRequests: "/api/driver/requests",
        driverAcceptRequest: "/api/driver/requests/:request_id/accept",
        driverRejectRequest: "/api/driver/requests/:request_id/reject",
        driverStartTrip: "/api/trips/:trip_id/start",
        driverCompleteTrip: "/api/trips/:trip_id/complete",
        driverVehicles: "/api/driver/vehicles",
        driverVehicleItem: "/api/driver/vehicles/:vehicle_id",
        driverEarnings: "/api/driver/earnings",
        driverAvailability: "/api/driver/availability"
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

    // 2b. Mock Session Verification (/api/me)
    if ((path === API_CONFIG.ENDPOINTS.me || path === "/api/me") && methodUpper === "GET") {
        const session = getSession();
        if (!session || !session.user) {
            return {
                ok: false,
                status: 401,
                data: {
                    error: {
                        code: "UNAUTHENTICATED",
                        message: "Please log in to continue."
                    }
                }
            };
        }
        return {
            ok: true,
            status: 200,
            data: {
                user: session.user
            }
        };
    }

    // 2c. Mock Fare Estimation (/api/fare/estimate)
    if ((path === API_CONFIG.ENDPOINTS.fareEstimate || path === "/api/fare/estimate") && methodUpper === "POST") {
        const vType = (body && body.vehicle_type ? String(body.vehicle_type).toLowerCase() : "standard");
        const distanceKm = (body && typeof body.distance_km === "number" ? body.distance_km : 10);
        const durationMinutes = (body && typeof body.duration_minutes === "number" ? body.duration_minutes : 20);

        const rates = {
            standard: { base: 40, perKm: 10, perMin: 1 },
            sedan: { base: 60, perKm: 13, perMin: 1.5 },
            suv: { base: 90, perKm: 18, perMin: 2 }
        };
        const rule = rates[vType] || rates.standard;
        const estimatedFare = Number((rule.base + (distanceKm * rule.perKm) + (durationMinutes * rule.perMin)).toFixed(2));

        return {
            ok: true,
            status: 200,
            data: {
                vehicle_type: vType,
                distance_km: distanceKm,
                duration_minutes: durationMinutes,
                estimated_fare: estimatedFare
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

    // 4. Mock Create Booking (POST /api/ride-requests or POST /api/bookings)
    if ((path === API_CONFIG.ENDPOINTS.rideRequests || path === API_CONFIG.ENDPOINTS.bookings || path === "/api/ride-requests") && methodUpper === "POST") {
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
        const vType = body && body.vehicle_type ? String(body.vehicle_type).trim().toLowerCase() : "standard";
        let estimatedFare = body && body.estimated_fare !== undefined ? parseFloat(body.estimated_fare) : 0;
        if (!estimatedFare) {
            const fallbackFares = { standard: 160.00, sedan: 220.00, suv: 310.00 };
            estimatedFare = fallbackFares[vType] || 160.00;
        }

        const newBooking = {
            request_id: requestId,
            pickup_location: body && body.pickup_location ? String(body.pickup_location).trim() : "",
            drop_location: body && body.drop_location ? String(body.drop_location).trim() : "",
            vehicle_type: vType,
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
                request: newBooking,
                booking: newBooking
            }
        };
    }

    // 5. Mock Get Bookings (GET /api/ride-requests/mine or GET /api/bookings)
    if ((path === API_CONFIG.ENDPOINTS.myRideRequests || path === API_CONFIG.ENDPOINTS.bookings || path === "/api/ride-requests/mine") && methodUpper === "GET") {
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
                requests: bookings,
                bookings: bookings
            }
        };
    }

    // 6. Mock Cancel Booking (POST /api/ride-requests/:request_id/cancel or /api/bookings/:request_id/cancel)
    const cancelMatch = path.match(/^\/api\/(?:ride-requests|bookings)\/([^/]+)\/cancel$/);
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
                request_id: booking.request_id,
                status: "cancelled",
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

    // 10. POST /api/trips/:trip_id/start
    const driverStartMatch = path.match(/^\/api\/trips\/([^/]+)\/start$/);
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

    // 11. POST /api/trips/:trip_id/complete
    const driverCompleteMatch = path.match(/^\/api\/trips\/([^/]+)\/complete$/);
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
                } else if (response.status === 405) {
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
    }

    // Auto-redirect on 401 Unauthorized (unless it's an intentional login/register check)
    if (result && result.status === 401 && !path.includes("/login") && !path.includes("/register")) {
        clearSession();
        window.location.replace("login.html?expired=1");
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
 * Controls button loading state safely with disabled and aria-busy attributes.
 * Preserves original text content in dataset so it can be restored reliably in finally.
 * @param {HTMLButtonElement|null} button
 * @param {boolean} isLoading
 * @param {string} [loadingText="Loading..."]
 */
function setButtonLoading(button, isLoading, loadingText = "Loading...") {
    if (!button) return;

    if (isLoading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "";
        button.appendChild(createSpinner(false));
        button.appendChild(document.createTextNode(" " + loadingText));
    } else {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
        }
    }
}

/**
 * Renders a full container loading indicator with spinner and aria-busy.
 * @param {HTMLElement|null} container
 * @param {string} [text="Loading data..."]
 */
function showContainerLoading(container, text = "Loading data...") {
    if (!container) return;
    container.textContent = "";
    container.setAttribute("aria-busy", "true");

    const loadingDiv = document.createElement("div");
    loadingDiv.className = "loading-container";
    loadingDiv.setAttribute("role", "status");

    loadingDiv.appendChild(createSpinner(true, true));

    const p = document.createElement("p");
    p.textContent = text;
    loadingDiv.appendChild(p);

    container.appendChild(loadingDiv);
}

/**
 * Renders an inline error message with an optional Retry button.
 * Safe from XSS: sets textContent only.
 * @param {HTMLElement|null} container
 * @param {string} message
 * @param {Function|null} [onRetry=null]
 */
function showContainerError(container, message, onRetry = null) {
    if (!container) return;
    container.textContent = "";
    container.removeAttribute("aria-busy");

    const errorDiv = document.createElement("div");
    errorDiv.className = "inline-error-card";
    errorDiv.setAttribute("role", "alert");

    const p = document.createElement("p");
    p.textContent = message || "An unexpected error occurred.";
    errorDiv.appendChild(p);

    if (typeof onRetry === "function") {
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "retry-button";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", () => {
            onRetry();
        });
        errorDiv.appendChild(retryBtn);
    }

    container.appendChild(errorDiv);
}

/**
 * Renders a standard empty state with icon, message, and optional CTA button.
 * Safe from XSS: sets textContent only.
 * @param {HTMLElement|null} container
 * @param {Object} options
 * @param {string} [options.icon="📭"]
 * @param {string} [options.title=""]
 * @param {string} options.message
 * @param {string} [options.ctaText]
 * @param {Function} [options.ctaCallback]
 */
function showContainerEmpty(container, options = {}) {
    if (!container) return;
    container.textContent = "";
    container.removeAttribute("aria-busy");

    const emptyDiv = document.createElement("div");
    emptyDiv.className = "empty-state";

    const iconSpan = document.createElement("span");
    iconSpan.className = "empty-state-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.textContent = options.icon || "📭";
    emptyDiv.appendChild(iconSpan);

    if (options.title) {
        const titleEl = document.createElement("div");
        titleEl.className = "empty-state-title";
        titleEl.textContent = options.title;
        emptyDiv.appendChild(titleEl);
    }

    const p = document.createElement("p");
    p.textContent = options.message || "No records found.";
    emptyDiv.appendChild(p);

    if (options.ctaText && typeof options.ctaCallback === "function") {
        const ctaBtn = document.createElement("button");
        ctaBtn.type = "button";
        ctaBtn.className = "button";
        ctaBtn.textContent = options.ctaText;
        ctaBtn.addEventListener("click", (event) => {
            event.preventDefault();
            options.ctaCallback();
        });
        emptyDiv.appendChild(ctaBtn);
    }

    container.appendChild(emptyDiv);
}

/**
 * Focus-trapping modal controller that closes on Escape and backdrop click.
 * @param {HTMLElement} modal
 * @param {Function} onClose
 * @returns {Function} Teardown/cleanup function
 */
function trapModalFocus(modal, onClose) {
    if (!modal) return () => {};

    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    function handleKeyDown(event) {
        if (modal.hidden) return;

        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
        }

        if (event.key === "Tab") {
            const focusables = Array.from(modal.querySelectorAll(focusableSelectors)).filter(
                (el) => !el.disabled && el.offsetParent !== null
            );

            if (focusables.length === 0) return;

            const first = focusables[0];
            const last = focusables[focusables.length - 1];

            if (event.shiftKey) {
                if (document.activeElement === first || !modal.contains(document.activeElement)) {
                    event.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last || !modal.contains(document.activeElement)) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }
    }

    function handleBackdropClick(event) {
        if (event.target === modal) {
            onClose();
        }
    }

    document.addEventListener("keydown", handleKeyDown);
    modal.addEventListener("click", handleBackdropClick);

    return function cleanup() {
        document.removeEventListener("keydown", handleKeyDown);
        modal.removeEventListener("click", handleBackdropClick);
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
    window.getMockUsers = getMockUsers;
    window.createSpinner = createSpinner;
    window.setButtonLoading = setButtonLoading;
    window.showContainerLoading = showContainerLoading;
    window.showContainerError = showContainerError;
    window.showContainerEmpty = showContainerEmpty;
    window.trapModalFocus = trapModalFocus;
}
