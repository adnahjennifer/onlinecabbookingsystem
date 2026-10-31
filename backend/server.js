
const http = require('http');
const bcrypt = require('bcrypt');
const pool = require('./db');
const crypto = require('crypto');
const {
    validCoordinate,
    validateCoordinates,
    normalizeLocation,
    validateRouteMetrics,
    validateSettings
} = require('./validation');

const fs = require('fs');
const path = require('path');


const PORT = 3000;

const SESSION_COOKIE = 'cab_session';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_TRACKING_LIMIT = 10000;
const loginAttempts = new Map();

const MAX_DISTANCE_KM = 200;
const MAX_DURATION_MINUTES = 600;
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const OSRM_ROUTE_URL = process.env.OSRM_ROUTE_URL || 'https://router.project-osrm.org/route/v1/driving';
const GEOCODE_TIMEOUT_MS = Number(process.env.GEOCODE_TIMEOUT_MS || 8000);
const ROUTE_TIMEOUT_MS = Number(process.env.ROUTE_TIMEOUT_MS || 10000);
const geocodeCache = new Map();
const routeCache = new Map();
let lastGeocodeAt = 0;

function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timeout));
}

function isAbortError(error) {
    return error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

async function getAllowedLocations(connection = pool) {
    const [rows] = await connection.execute(
        `SELECT location
         FROM (
             SELECT DISTINCT pickup_location AS location
             FROM ride_requests
             WHERE pickup_location IS NOT NULL AND TRIM(pickup_location) <> ''
             UNION
             SELECT DISTINCT drop_location AS location
             FROM ride_requests
             WHERE drop_location IS NOT NULL AND TRIM(drop_location) <> ''
         ) AS locations
         ORDER BY location`
    );
    return rows.map(row => row.location);
}

async function verifyLocationCoordinates(location, coordinates) {
    const query = `${location}, Chennai, India`.toLowerCase();
    let results = geocodeCache.get(query);
    if (!results) {
        const response = await fetchWithTimeout(
            `${NOMINATIM_URL}?format=jsonv2&limit=5&q=${encodeURIComponent(`${location}, Chennai, India`)}`,
            { headers: { Accept: 'application/json', 'User-Agent': 'CabGo demo location search' } },
            GEOCODE_TIMEOUT_MS
        );
        if (!response.ok) {
            const error = new Error('The geocoding service is unavailable.');
            error.code = 'GEOCODING_UNAVAILABLE';
            throw error;
        }
        const data = await response.json();
        results = data
            .filter(item => validCoordinate(Number(item.lat), -90, 90) && validCoordinate(Number(item.lon), -180, 180))
            .map(item => ({ lat: Number(item.lat), lon: Number(item.lon), display_name: item.display_name }));
        geocodeCache.set(query, results);
    }
    return results.some(result =>
        Math.abs(result.lat - coordinates.lat) <= 0.005 &&
        Math.abs(result.lon - coordinates.lon) <= 0.005
    );
}

async function getAuthoritativeRoute(coordinates) {
    if (!validateCoordinates(coordinates)) {
        const error = new Error('Valid, different pickup and destination coordinates are required.');
        error.code = 'INVALID_COORDINATES';
        throw error;
    }

    const key = [
        coordinates.pickup_lon.toFixed(5),
        coordinates.pickup_lat.toFixed(5),
        coordinates.drop_lon.toFixed(5),
        coordinates.drop_lat.toFixed(5)
    ].join(',');
    if (routeCache.has(key)) {
        return routeCache.get(key);
    }

    let response;
    try {
        response = await fetchWithTimeout(
        `${OSRM_ROUTE_URL}/${coordinates.pickup_lon},${coordinates.pickup_lat};${coordinates.drop_lon},${coordinates.drop_lat}?overview=full&geometries=geojson`,
            { headers: { Accept: 'application/json' } },
            ROUTE_TIMEOUT_MS
        );
    } catch (error) {
        const timeoutError = new Error(isAbortError(error) ? 'The routing service timed out.' : 'The routing service is unavailable.');
        timeoutError.code = isAbortError(error) ? 'ROUTING_TIMEOUT' : 'ROUTING_UNAVAILABLE';
        throw timeoutError;
    }
    if (!response.ok) {
        const error = new Error('The routing service is unavailable.');
        error.code = 'ROUTING_UNAVAILABLE';
        throw error;
    }
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
        const error = new Error('No drivable route was found between the selected locations.');
        error.code = 'ROUTE_NOT_FOUND';
        throw error;
    }

    const route = {
        distance_km: Number((data.routes[0].distance / 1000).toFixed(1)),
        duration_minutes: Math.max(1, Math.round(data.routes[0].duration / 60)),
        geometry: data.routes[0].geometry
    };
    const cacheEntry = routeCache.size >= 100 ? routeCache.keys().next().value : key;
    if (cacheEntry !== key) {
        routeCache.delete(cacheEntry);
    }
    routeCache.set(key, route);
    return route;
}

function calculateFare(rule, distanceKm, durationMinutes) {
    return Number((
        Number(rule.base_fare) +
        distanceKm * Number(rule.per_km_rate) +
        durationMinutes * Number(rule.per_minute_rate)
    ).toFixed(2));
}

async function recordAuditLog(actorUserId, action, targetType = null, targetId = null, metadata = null) {
    try {
        await pool.execute(
            `INSERT INTO audit_logs
                (actor_user_id, action, target_type, target_id, metadata)
             VALUES (?, ?, ?, ?, ?)`,
            [actorUserId, action, targetType, targetId === null ? null : String(targetId), metadata ? JSON.stringify(metadata) : null]
        );
    } catch (error) {
        if (error.code !== 'ER_NO_SUCH_TABLE') {
            console.error('Audit log error:', error.message);
        }
    }
}


function getSessionTokenFromRequest(req) {
    const cookies = req.headers.cookie || '';
    const sessionCookie = cookies
        .split(';')
        .map(cookie => cookie.trim())
        .find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));
    return sessionCookie
        ? sessionCookie.substring(SESSION_COOKIE.length + 1)
        : null;
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function getLoginAttemptKey(req, email) {
    return `${req.socket.remoteAddress || 'unknown'}:${email}`;
}

function isLoginRateLimited(key) {
    const attempt = loginAttempts.get(key);
    if (!attempt) {
        return false;
    }

    if (attempt.resetAt <= Date.now()) {
        loginAttempts.delete(key);
        return false;
    }

    return attempt.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(key) {
    const now = Date.now();
    for (const [attemptKey, attempt] of loginAttempts) {
        if (attempt.resetAt <= now) {
            loginAttempts.delete(attemptKey);
        }
    }

    if (loginAttempts.size >= LOGIN_TRACKING_LIMIT && !loginAttempts.has(key)) {
        const oldestKey = loginAttempts.keys().next().value;
        loginAttempts.delete(oldestKey);
    }

    const attempt = loginAttempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
        loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
        return;
    }

    attempt.count += 1;
}

function clearLoginFailures(key) {
    loginAttempts.delete(key);
}

async function getSessionFromRequest(req) {
    const token = getSessionTokenFromRequest(req);
    if (!token) {
        return null;
    }

    const [sessions] = await pool.execute(
        `SELECT s.session_id, s.user_id, u.role, u.account_status
         FROM user_sessions s
         JOIN users u ON u.user_id = s.user_id
         WHERE s.token_hash = ?
           AND s.revoked_at IS NULL
           AND s.expires_at > NOW()`,
        [hashSessionToken(token)]
    );

    if (sessions.length === 0) {
        return null;
    }

    if (sessions[0].account_status !== 'active') {
        await pool.execute(
            'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_id = ?',
            [sessions[0].session_id]
        );
        return null;
    }

    await pool.execute(
        'UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = ?',
        [sessions[0].session_id]
    );

    return {
        token,
        sessionId: sessions[0].session_id,
        userId: sessions[0].user_id,
        role: sessions[0].role
    };
}

async function requireRole(req, allowedRoles) {
    let session;
    try {
        session = await getSessionFromRequest(req);
    } catch (error) {
        console.error('Session lookup error:', error.message);
        return {
            ok: false,
            status: 500,
            error: {
                code: 'SERVER_ERROR',
                message: 'Could not validate the session.'
            }
        };
    }

    if (!session) {
        return {
            ok: false,
            status: 401,
            error: {
                code: 'UNAUTHENTICATED',
                message: 'Please log in to continue.'
            }
        };
    }

    if (!allowedRoles.includes(session.role)) {
        return {
            ok: false,
            status: 403,
            error: {
                code: 'FORBIDDEN',
                message: 'You do not have permission to access this resource.'
            }
        };
    }

    return {
        ok: true,
        session
    };
}

function validateSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) {
        return {
            ok: false,
            message: 'A same-origin request is required.'
        };
    }

    try {
        const requestOrigin = new URL(
            `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`
        ).origin;
        return {
            ok: new URL(origin).origin === requestOrigin,
            message: 'The request origin is not allowed.'
        };
    } catch {
        return {
            ok: false,
            message: 'The request origin is not allowed.'
        };
    }
}

function sendJson(res, status, payload, headers = {}) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...headers
    });
    res.end(JSON.stringify(payload));
}

function parsePositiveId(value) {
    if (!/^\d+$/.test(value)) {
        return null;
    }

    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}


// Read and parse JSON request bodies
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let rejected = false;

        req.on('data', (chunk) => {
            if (rejected) {
                return;
            }

            body += chunk;

            if (body.length > 1_000_000) {
                rejected = true;
                const error = new Error('Request body is too large');
                error.code = 'REQUEST_BODY_TOO_LARGE';
                reject(error);
            }
        });

        req.on('end', () => {
            if (rejected) {
                return;
            }

            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                const error = new Error('Invalid JSON in request body');
                error.code = 'INVALID_JSON';
                reject(error);
            }
        });

        req.on('error', reject);
    });
}



const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (
        pathname.startsWith('/api/') &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
        !['/api/login', '/api/register'].includes(pathname)
    ) {
        const originCheck = validateSameOrigin(req);
        if (!originCheck.ok) {
            sendJson(res, 403, {
                error: {
                    code: 'INVALID_ORIGIN',
                    message: originCheck.message
                }
            });
            return;
        }
    }

    // 1. Test JSON request-body parsing
    if (req.method === 'POST' && pathname === '/test-body') {
        try {
            const data = await readRequestBody(req);

            res.writeHead(200);
            res.end(JSON.stringify({
                message: 'Request body received successfully',
                receivedData: data
            }));
        } catch (error) {
            if (!res.destroyed && !res.writableEnded) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_JSON',
                        message: error.message
                    }
                }));
            }
        }

        return;
    }

    // 2. Passenger registration
    if (req.method === 'POST' && pathname === '/api/register') {
        try {
            const data = await readRequestBody(req);

            const name =
                typeof data.name === 'string' ? data.name.trim() : '';

            const email =
                typeof data.email === 'string'
                    ? data.email.trim().toLowerCase()
                    : '';

            const password = data.password;

            // Validate input
            if (
                !name ||
                name.length > 100 ||
                !email ||
                email.length > 255 ||
                typeof password !== 'string' ||
                !password ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            ) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Please provide a valid name, email, and password.'
                    }
                }));
                return;
            }

            if (password.length < 8 || password.length > 72) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'WEAK_PASSWORD',
                        message: 'Password must be between 8 and 72 characters long.'
                    }
                }));
                return;
            }

            // Check whether the email already exists
            const [existingUsers] = await pool.execute(
                'SELECT user_id FROM users WHERE email = ?',
                [email]
            );

            if (existingUsers.length > 0) {
                res.writeHead(409);
                res.end(JSON.stringify({
                    error: {
                        code: 'EMAIL_EXISTS',
                        message: 'An account with this email already exists.'
                    }
                }));
                return;
            }

            // Hash the password before storing it
            const passwordHash = await bcrypt.hash(password, 12);

            const [result] = await pool.execute(
                `INSERT INTO users
                    (full_name, email, password_hash, role)
                 VALUES (?, ?, ?, 'passenger')`,
                [name, email, passwordHash]
            );

            // Return the agreed user response
            res.writeHead(201);
            res.end(JSON.stringify({
                message: 'Registration successful',
                user: {
                    user_id: result.insertId,
                    full_name: name,
                    email: email,
                    role: 'passenger'
                }
            }));
        } catch (error) {
            console.error('Registration error:', error.message);

            if (res.destroyed || res.writableEnded) {
                return;
            }

            if (error.code === 'INVALID_JSON' || error.code === 'REQUEST_BODY_TOO_LARGE') {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_REQUEST',
                        message: error.message
                    }
                }));
                return;
            }

            if (error.code === 'ER_DUP_ENTRY') {
                res.writeHead(409);
                res.end(JSON.stringify({
                    error: {
                        code: 'EMAIL_EXISTS',
                        message: 'An account with this email already exists.'
                    }
                }));
                return;
            }

            res.writeHead(500);
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'An unexpected server error occurred.'
                }
            }));
        }

        return;
    }


    // Passenger login
    if (req.method === 'POST' && pathname === '/api/login') {
        try {
            const data = await readRequestBody(req);

            const email =
                typeof data.email === 'string'
                    ? data.email.trim().toLowerCase()
                    : '';

            const password = data.password;

            if (!email ||
    email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' ||
    !password ||
    password.length > 72) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Email and password are required.'
                    }
                }));
                return;
            }

            const loginAttemptKey = getLoginAttemptKey(req, email);
            if (isLoginRateLimited(loginAttemptKey)) {
                sendJson(res, 429, {
                    error: {
                        code: 'LOGIN_RATE_LIMITED',
                        message: 'Too many login attempts. Please try again later.'
                    }
                });
                return;
            }

            const [users] = await pool.execute(
                `SELECT user_id, full_name, email, password_hash, role, account_status
                 FROM users
                 WHERE email = ?`,
                [email]
            );

            if (users.length === 0) {
                recordLoginFailure(loginAttemptKey);
                res.writeHead(401);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_CREDENTIALS',
                        message: 'Invalid email or password.'
                    }
                }));
                return;
            }

            const user = users[0];
            const passwordMatches = await bcrypt.compare(
                password,
                user.password_hash
            );

            if (!passwordMatches || user.account_status !== 'active') {
                recordLoginFailure(loginAttemptKey);
                res.writeHead(401);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_CREDENTIALS',
                        message: 'Invalid email or password.'
                    }
                }));
                return;
            }

            clearLoginFailures(loginAttemptKey);
            const sessionToken = crypto.randomBytes(32).toString('hex');
            await pool.execute(
                `INSERT INTO user_sessions
                    (user_id, token_hash, expires_at)
                 VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
                [user.user_id, hashSessionToken(sessionToken)]
            );

            res.writeHead(200, {
                'Set-Cookie':
                `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
            });

            res.end(JSON.stringify({
                message: 'Login successful',
                user: {
                    user_id: user.user_id,
                    full_name: user.full_name,
                    email: user.email,
                    role: user.role
                }
            }));
        } catch (error) {
            console.error('Login error:', error.message);

            if (res.destroyed || res.writableEnded) {
                return;
            }

            if (error.code === 'INVALID_JSON' || error.code === 'REQUEST_BODY_TOO_LARGE') {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_JSON',
                        message: 'Request body must contain valid JSON.'
                    }
                }));
                return;
            }

            res.writeHead(500);
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'An unexpected server error occurred.'
                }
            }));
        }

        return;
    }


    // Check the current logged-in user
    if (req.method === 'GET' && pathname === '/api/me') {
        try {
            const session = await getSessionFromRequest(req);
            if (!session) {
                res.writeHead(401);
                res.end(JSON.stringify({
                    error: {
                        code: 'UNAUTHENTICATED',
                        message: 'Please log in to continue.'
                    }
                }));
                return;
            }

            const [users] = await pool.execute(
                `SELECT user_id, full_name, email, role
                 FROM users
                 WHERE user_id = ? AND account_status = 'active'`,
                [session.userId]
            );

            if (users.length === 0) {
                res.writeHead(401);
                res.end(JSON.stringify({
                    error: {
                        code: 'UNAUTHENTICATED',
                        message: 'User account is not active.'
                    }
                }));
                return;
            }

            res.writeHead(200);
            res.end(JSON.stringify({
                user: users[0]
            }));
        } catch (error) {
            console.error('Session check error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'An unexpected server error occurred.'
                }
            }));
        }
        return;
    }

    // Log out the current user
    if (req.method === 'POST' && pathname === '/api/logout') {
        try {
            const sessionToken = getSessionTokenFromRequest(req);
            if (sessionToken) {
                await pool.execute(
                    'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL',
                    [hashSessionToken(sessionToken)]
                );
            }

            res.writeHead(200, {
                'Set-Cookie':
                    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
            });

            res.end(JSON.stringify({
                message: 'Logout successful'
            }));
        } catch (error) {
            console.error('Logout error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Could not log out safely.'
                }
            }));
        }
        return;
    }

    // Location search via Nominatim.
    if (req.method === 'GET' && pathname === '/api/locations') {
        try {
            sendJson(res, 200, { locations: await getAllowedLocations() });
        } catch (error) {
            console.error('Location list error:', error.message);
            sendJson(res, 500, {
                error: { code: 'LOCATION_LIST_UNAVAILABLE', message: 'Could not load booking locations.' }
            });
        }
        return;
    }

    if (req.method === 'GET' && pathname === '/api/geocode') {
        const query = new URL(req.url, 'http://localhost').searchParams.get('q')?.trim() || '';
        if (query.length < 3 || query.length > 120) {
            sendJson(res, 400, { error: { code: 'INVALID_QUERY', message: 'Enter at least 3 characters to search for a location.' } });
            return;
        }
        const key = query.toLowerCase();
        if (geocodeCache.has(key)) {
            sendJson(res, 200, { locations: geocodeCache.get(key) });
            return;
        }
        const waitMs = Math.max(0, 1000 - (Date.now() - lastGeocodeAt));
        if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        lastGeocodeAt = Date.now();
        try {
            const response = await fetchWithTimeout(
                `${NOMINATIM_URL}?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
                { headers: { Accept: 'application/json', 'User-Agent': 'CabGo demo location search' } },
                GEOCODE_TIMEOUT_MS
            );
            if (!response.ok) {
                sendJson(res, 503, { error: { code: 'GEOCODING_UNAVAILABLE', message: 'Location search is temporarily unavailable.' } });
                return;
            }
            const results = await response.json();
            const locations = results
                .filter(item => validCoordinate(Number(item.lat), -90, 90) && validCoordinate(Number(item.lon), -180, 180))
                .map(item => ({ display_name: item.display_name, lat: Number(item.lat), lon: Number(item.lon) }));
            if (geocodeCache.size >= 100) geocodeCache.delete(geocodeCache.keys().next().value);
            geocodeCache.set(key, locations);
            sendJson(res, 200, { locations });
        } catch (error) {
            console.error('Geocoding error:', error.message);
            sendJson(res, 503, {
                error: {
                    code: isAbortError(error) ? 'GEOCODING_TIMEOUT' : 'GEOCODING_UNAVAILABLE',
                    message: isAbortError(error) ? 'Location search timed out. Please try again.' : 'Location search is temporarily unavailable.'
                }
            });
        }
        return;
    }

    // Authoritative road routing via OSRM.
    if (req.method === 'POST' && pathname === '/api/route') {
        try {
            const route = await getAuthoritativeRoute(await readRequestBody(req));
            sendJson(res, 200, route);
        } catch (error) {
            const status = ['INVALID_COORDINATES', 'ROUTE_NOT_FOUND'].includes(error.code) ? 400 : 503;
            sendJson(res, status, { error: { code: error.code || 'ROUTING_UNAVAILABLE', message: error.message } });
        }
        return;
    }

    // Estimate fare using the database fare rules
    if (req.method === 'POST' && pathname === '/api/fare/estimate') {
        const auth = await requireRole(req, ['passenger']);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        try {
            const data = await readRequestBody(req);

            const vehicleType = data.vehicle_type;
            let distanceKm;
            let durationMinutes;
            if (!validateCoordinates(data)) {
                sendJson(res, 400, {
                    error: { code: 'INVALID_COORDINATES', message: 'Pickup and destination coordinates are required.' }
                });
                return;
            }
            try {
                const route = await getAuthoritativeRoute(data);
                distanceKm = route.distance_km;
                durationMinutes = route.duration_minutes;
            } catch (error) {
                const status = ['INVALID_COORDINATES', 'ROUTE_NOT_FOUND'].includes(error.code) ? 400 : 503;
                sendJson(res, status, { error: { code: error.code || 'ROUTING_UNAVAILABLE', message: error.message } });
                return;
            }

            const routeMetricsError = validateRouteMetrics(distanceKm, durationMinutes);
            if (!['standard', 'sedan', 'suv'].includes(vehicleType) || routeMetricsError) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_INPUT',
                        message: routeMetricsError ||
                            'Provide a valid vehicle_type and verified pickup and destination coordinates.'
                    }
                }));
                return;
            }

            const [rules] = await pool.execute(
                `SELECT base_fare, per_km_rate, per_minute_rate
                 FROM fare_rules
                 WHERE vehicle_type = ? AND is_active = TRUE`,
                [vehicleType]
            );

            if (rules.length === 0) {
                res.writeHead(404);
                res.end(JSON.stringify({
                    error: {
                        code: 'FARE_RULE_NOT_FOUND',
                        message: 'No active fare rule exists for this vehicle type.'
                    }
                }));
                return;
            }

            const rule = rules[0];

            const estimatedFare = calculateFare(rule, distanceKm, durationMinutes);

            res.writeHead(200);
            res.end(JSON.stringify({
                vehicle_type: vehicleType,
                distance_km: distanceKm,
                duration_minutes: durationMinutes,
                estimated_fare: Number(estimatedFare.toFixed(2))
            }));
        } catch (error) {
            console.error('Fare estimate error:', error.message);

            if (res.destroyed || res.writableEnded) {
                return;
            }

            if (error.code === 'INVALID_JSON' || error.code === 'REQUEST_BODY_TOO_LARGE') {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_JSON',
                        message: 'Request body must contain valid JSON.'
                    }
                }));
                return;
            }

            res.writeHead(500);
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'An unexpected server error occurred.'
                }
            }));
        }

        return;
    }


    // Create a passenger ride request
    if (req.method === 'POST' && pathname === '/api/ride-requests') {
        const auth = await requireRole(req, ['passenger']);

        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const data = await readRequestBody(req);

            const pickupLocation =
                typeof data.pickup_location === 'string'
                    ? data.pickup_location.trim()
                    : '';

            const dropLocation =
                typeof data.drop_location === 'string'
                    ? data.drop_location.trim()
                    : '';

            const vehicleType = data.vehicle_type;
            const allowedLocations = await getAllowedLocations();
            const allowedByName = new Map(allowedLocations.map(location => [normalizeLocation(location), location]));
            const canonicalPickup = allowedByName.get(normalizeLocation(pickupLocation));
            const canonicalDrop = allowedByName.get(normalizeLocation(dropLocation));
            if (!canonicalPickup || !canonicalDrop) {
                sendJson(res, 400, {
                    error: { code: 'INVALID_LOCATION', message: 'Select pickup and destination from the approved location list.' }
                });
                return;
            }
            if (normalizeLocation(canonicalPickup) === normalizeLocation(canonicalDrop)) {
                sendJson(res, 400, {
                    error: { code: 'INVALID_LOCATION', message: 'Pickup and destination locations must be different.' }
                });
                return;
            }
            try {
                const coordinatesMatch = await Promise.all([
                    verifyLocationCoordinates(canonicalPickup, { lat: data.pickup_lat, lon: data.pickup_lon }),
                    verifyLocationCoordinates(canonicalDrop, { lat: data.drop_lat, lon: data.drop_lon })
                ]);
                if (!coordinatesMatch[0] || !coordinatesMatch[1]) {
                    sendJson(res, 400, {
                        error: { code: 'LOCATION_COORDINATES_MISMATCH', message: 'Selected coordinates do not match the approved locations.' }
                    });
                    return;
                }
            } catch (error) {
                sendJson(res, 503, {
                    error: {
                        code: error.code || 'GEOCODING_UNAVAILABLE',
                        message: error.message
                    }
                });
                return;
            }
            let distanceKm;
            let durationMinutes;
            try {
                const route = await getAuthoritativeRoute(data);
                distanceKm = route.distance_km;
                durationMinutes = route.duration_minutes;
            } catch (error) {
                const status = ['INVALID_COORDINATES', 'ROUTE_NOT_FOUND'].includes(error.code) ? 400 : 503;
                sendJson(res, status, { error: { code: error.code || 'ROUTING_UNAVAILABLE', message: error.message } });
                return;
            }
            const routeMetricsError = validateRouteMetrics(distanceKm, durationMinutes);

            if (
                !pickupLocation ||
                !dropLocation ||
                pickupLocation.length > 255 ||
                dropLocation.length > 255 ||
                pickupLocation.toLowerCase() === dropLocation.toLowerCase() ||
                !['standard', 'sedan', 'suv'].includes(vehicleType) ||
                routeMetricsError
            ) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_INPUT',
                        message: routeMetricsError ||
                            'Provide different pickup and drop locations, a valid vehicle type, distance_km, and duration_minutes.'
                    }
                }));
                return;
            }

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                const [passengers] = await connection.execute(
                    `SELECT user_id
                     FROM users
                     WHERE user_id = ?
                     FOR UPDATE`,
                    [auth.session.userId]
                );

                if (passengers.length === 0) {
                    await connection.rollback();
                    res.writeHead(401);
                    res.end(JSON.stringify({
                        error: {
                            code: 'UNAUTHENTICATED',
                            message: 'User account not found.'
                        }
                    }));
                    return;
                }

                const [activeRequests] = await connection.execute(
                    `SELECT request_id
                     FROM ride_requests
                     WHERE passenger_id = ?
                       AND status IN ('requested', 'accepted', 'started')
                     LIMIT 1
                     FOR UPDATE`,
                    [auth.session.userId]
                );

                if (activeRequests.length > 0) {
                    await connection.rollback();
                    res.writeHead(409);
                    res.end(JSON.stringify({
                        error: {
                            code: 'ACTIVE_BOOKING_EXISTS',
                            message: 'You already have an active booking. Please complete or cancel it before booking another ride.'
                        }
                    }));
                    return;
                }

                const [rules] = await connection.execute(
                    `SELECT base_fare, per_km_rate, per_minute_rate
                     FROM fare_rules
                     WHERE vehicle_type = ? AND is_active = TRUE`,
                    [vehicleType]
                );

                if (rules.length === 0) {
                    await connection.rollback();
                    res.writeHead(404);
                    res.end(JSON.stringify({
                        error: {
                            code: 'FARE_RULE_NOT_FOUND',
                            message: 'No active fare rule exists for this vehicle type.'
                        }
                    }));
                    return;
                }

                const rule = rules[0];
                const estimatedFare = calculateFare(rule, distanceKm, durationMinutes);

                const [[eligibleVehicleCount]] = await connection.execute(
                    `SELECT COUNT(*) AS count
                     FROM vehicles v
                     JOIN driver_profiles dp ON dp.driver_id = v.driver_id
                     JOIN users du ON du.user_id = dp.user_id
                     WHERE v.vehicle_type = ?
                       AND v.approval_status = 'approved'
                       AND v.is_active = TRUE
                       AND dp.verification_status = 'approved'
                       AND du.account_status = 'active'`,
                    [vehicleType]
                );

                if (Number(eligibleVehicleCount.count) === 0) {
                    await connection.rollback();
                    sendJson(res, 409, {
                        error: {
                            code: 'NO_ELIGIBLE_VEHICLE',
                            message: `No approved active ${vehicleType} vehicle is currently available for this booking.`
                        }
                    });
                    return;
                }

                const [result] = await connection.execute(
                    `INSERT INTO ride_requests
                        (passenger_id, pickup_location, drop_location,
                         vehicle_type, estimated_fare, status)
                     VALUES (?, ?, ?, ?, ?, 'requested')`,
                    [
                        auth.session.userId,
                        canonicalPickup,
                        canonicalDrop,
                        vehicleType,
                        estimatedFare
                    ]
                );

                await connection.commit();

                res.writeHead(201);
                res.end(JSON.stringify({
                    message: 'Ride request created successfully',
                    request: {
                        request_id: result.insertId,
                        pickup_location: pickupLocation,
                        drop_location: dropLocation,
                        vehicle_type: vehicleType,
                        distance_km: distanceKm,
                        duration_minutes: durationMinutes,
                        estimated_fare: estimatedFare,
                        status: 'requested'
                    }
                }));
            } catch (error) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error('Ride request rollback error:', rollbackError.message);
                }
                throw error;
            } finally {
                connection.release();
            }
        } catch (error) {
            console.error('Ride request creation error:', error.message);

            if (res.destroyed || res.writableEnded) {
                return;
            }

            if (error.code === 'INVALID_JSON' || error.code === 'REQUEST_BODY_TOO_LARGE') {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_JSON',
                        message: 'Request body must contain valid JSON.'
                    }
                }));
                return;
            }

            res.writeHead(500);
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'An unexpected server error occurred.'
                }
            }));
        }

        return;
    }


    if (req.method === 'GET' && pathname === '/api/ride-requests/mine') {
        const auth = await requireRole(req, ['passenger']);

        if (!auth.ok) {
            res.writeHead(auth.status, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [requests] = await pool.execute(
                `SELECT rr.request_id, rr.pickup_location, rr.drop_location,
                        rr.vehicle_type, rr.estimated_fare, rr.status, rr.created_at,
                        t.trip_id, t.started_at, t.completed_at, t.final_fare,
                        du.full_name AS driver_full_name, dp.rating AS driver_rating,
                        v.model AS vehicle_model, v.registration_number,
                        v.vehicle_type AS assigned_vehicle_type
                 FROM ride_requests rr
                 LEFT JOIN trips t ON t.request_id = rr.request_id
                 LEFT JOIN driver_profiles dp ON dp.driver_id = t.driver_id
                 LEFT JOIN users du ON du.user_id = dp.user_id
                 LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
                 WHERE rr.passenger_id = ?
                 ORDER BY rr.created_at DESC`,
                [auth.session.userId]
            );

            const normalizedRequests = requests.map((request) => ({
                request_id: request.request_id,
                pickup_location: request.pickup_location,
                drop_location: request.drop_location,
                vehicle_type: request.vehicle_type,
                estimated_fare: request.estimated_fare,
                status: request.status,
                created_at: request.created_at,
                trip_id: request.trip_id,
                started_at: request.started_at,
                completed_at: request.completed_at,
                final_fare: request.final_fare,
                driver: request.driver_full_name
                    ? {
                        full_name: request.driver_full_name,
                        rating: request.driver_rating
                    }
                    : null,
                vehicle: request.vehicle_model || request.registration_number
                    ? {
                        model: request.vehicle_model,
                        registration_number: request.registration_number,
                        vehicle_type: request.assigned_vehicle_type
                    }
                    : null
            }));

            res.writeHead(200, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ requests: normalizedRequests }));
        } catch (error) {
            console.error('Get ride requests error:', error);

            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Could not retrieve ride requests.'
                }
            }));
        }

        return;
    }


        // Passenger: Get notifications
        if (req.method === 'GET' && pathname === '/api/notifications') {
            const auth = await requireRole(req, ['passenger']);

            if (!auth.ok) {
                res.writeHead(auth.status, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ error: auth.error }));
                return;
            }

            try {
                const [notifications] = await pool.execute(
                    `SELECT notification_id, request_id, message,
                            is_read, created_at
                    FROM notifications
                    WHERE user_id = ?
                    ORDER BY created_at DESC`,
                    [auth.session.userId]
                );

                res.writeHead(200, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ notifications }));

            } catch (error) {
                console.error('Get notifications error:', error);

                res.writeHead(500, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'SERVER_ERROR',
                        message: 'Could not retrieve notifications.'
                    }
                }));
            }

            return;
        }


    // Passenger: Mark notification as read
    const readNotificationMatch = pathname.match(
        /^\/api\/notifications\/([^/]+)\/read$/
    );

    if (req.method === 'PATCH' && readNotificationMatch) {
        const auth = await requireRole(req, ['passenger']);

        if (!auth.ok) {
            res.writeHead(auth.status, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const notificationId = parsePositiveId(readNotificationMatch[1]);

        if (notificationId === null) {
            sendJson(res, 400, {
                error: {
                    code: 'INVALID_ID',
                    message: 'Notification ID must be a positive integer.'
                }
            });
            return;
        }

        try {
            const [result] = await pool.execute(
                `UPDATE notifications
                 SET is_read = TRUE
                 WHERE notification_id = ? AND user_id = ?`,
                [notificationId, auth.session.userId]
            );

            if (result.affectedRows === 0) {
                res.writeHead(404, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'NOTIFICATION_NOT_FOUND',
                        message: 'Notification not found.'
                    }
                }));
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                message: 'Notification marked as read.'
            }));

        } catch (error) {
            console.error('Mark notification read error:', error);

            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Could not update notification.'
                }
            }));
        }

        return;
    }





    

            //cancel api

        const cancelRideMatch = pathname.match(
            /^\/api\/ride-requests\/([^/]+)\/cancel$/
        );

        if (req.method === 'POST' && cancelRideMatch) {
            const auth = await requireRole(req, ['passenger']);

            if (!auth.ok) {
                res.writeHead(auth.status, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ error: auth.error }));
                return;
            }

            try {
                const requestId = parsePositiveId(cancelRideMatch[1]);

                if (requestId === null) {
                    sendJson(res, 400, {
                        error: {
                            code: 'INVALID_ID',
                            message: 'Request ID must be a positive integer.'
                        }
                    });
                    return;
                }

                const [result] = await pool.execute(
                    `UPDATE ride_requests
                    SET status = 'cancelled'
                    WHERE request_id = ?
                    AND passenger_id = ?
                    AND status = 'requested'`,
                    [requestId, auth.session.userId]
                );

                if (result.affectedRows === 0) {
                    res.writeHead(404, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: {
                            code: 'REQUEST_NOT_FOUND_OR_NOT_CANCELLABLE',
                            message: 'Ride request not found or cannot be cancelled.'
                        }
                    }));
                    return;
                }

                res.writeHead(200, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    message: 'Ride request cancelled successfully.',
                    request_id: requestId,
                    status: 'cancelled'
                }));
            } catch (error) {
                console.error('Cancel ride request error:', error);

                res.writeHead(500, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'SERVER_ERROR',
                        message: 'Could not cancel ride request.'
                    }
                }));
            }

            return;
        }


        // Driver accepts a passenger ride request
        const acceptRideMatch = pathname.match(
            /^\/api\/driver\/requests\/([^/]+)\/accept$/
        );

        if (req.method === 'POST' && acceptRideMatch) {
            const auth = await requireRole(req, ['driver']);

            if (!auth.ok) {
                res.writeHead(auth.status, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ error: auth.error }));
                return;
            }

            const requestId = parsePositiveId(acceptRideMatch[1]);

            if (requestId === null) {
                sendJson(res, 400, {
                    error: {
                        code: 'INVALID_ID',
                        message: 'Request ID must be a positive integer.'
                    }
                });
                return;
            }
            let connection;

            try {
                connection = await pool.getConnection();
                await connection.beginTransaction();

                // Find the driver's profile and lock it during acceptance
                const [drivers] = await connection.execute(
                    `SELECT driver_id, verification_status, availability_status
                    FROM driver_profiles
                    WHERE user_id = ?
                    FOR UPDATE`,
                    [auth.session.userId]
                );

                if (
                    drivers.length === 0 ||
                    drivers[0].verification_status !== 'approved'
                ) {
                    await connection.rollback();
                    res.writeHead(403, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: {
                            code: 'DRIVER_NOT_APPROVED',
                            message: 'An approved driver profile is required.'
                        }
                    }));
                    return;
                }

                const driver = drivers[0];

                if (driver.availability_status !== 'available') {
                    await connection.rollback();
                    res.writeHead(409, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: {
                            code: 'DRIVER_NOT_AVAILABLE',
                            message: 'You must be available to accept a ride.'
                        }
                    }));
                    return;
                }

                // Ensure this driver has no accepted or started trip
                const [activeTrips] = await connection.execute(
                    `SELECT trip_id
                    FROM trips
                    WHERE driver_id = ?
                    AND status IN ('accepted', 'started')
                    LIMIT 1
                    FOR UPDATE`,
                    [driver.driver_id]
                );

                if (activeTrips.length > 0) {
                    await connection.rollback();
                    res.writeHead(409, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: {
                            code: 'ACTIVE_TRIP_EXISTS',
                            message: 'Complete your active trip before accepting another.'
                        }
                    }));
                    return;
                }

                // Lock the ride request so two drivers cannot accept it
                const [requests] = await connection.execute(
                    `SELECT request_id, vehicle_type, status
                    FROM ride_requests
                    WHERE request_id = ?
                    FOR UPDATE`,
                    [requestId]
                );

                if (
                    requests.length === 0 ||
                    requests[0].status !== 'requested'
                ) {
                    await connection.rollback();
                    res.writeHead(409, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: {
                            code: 'RIDE_NOT_AVAILABLE',
                            message: 'This ride request does not exist or has already been accepted.'
                        }
                    }));
                    return;
                }

            const ride = requests[0];

            const [rejections] = await connection.execute(
                `SELECT rejection_id
                 FROM driver_rejections
                 WHERE request_id = ? AND driver_id = ?
                 LIMIT 1`,
                [requestId, driver.driver_id]
            );

            if (rejections.length > 0) {
                await connection.rollback();
                res.writeHead(409, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'ALREADY_REJECTED',
                        message: 'You cannot accept a ride request you previously rejected.'
                    }
                }));
                return;
            }

            // Find an approved, active vehicle matching the requested type
            const [vehicles] = await connection.execute(
                `SELECT vehicle_id
                 FROM vehicles
                 WHERE driver_id = ?
                   AND vehicle_type = ?
                   AND approval_status = 'approved'
                   AND is_active = TRUE
                 LIMIT 1
                 FOR UPDATE`,
                [driver.driver_id, ride.vehicle_type]
            );

            if (vehicles.length === 0) {
                await connection.rollback();
                res.writeHead(409, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'NO_ELIGIBLE_VEHICLE',
                        message: 'No approved active vehicle matches this ride.'
                    }
                }));
                return;
            }

            const vehicleId = vehicles[0].vehicle_id;

            // Create the trip
            const [tripResult] = await connection.execute(
                `INSERT INTO trips (request_id, driver_id, vehicle_id, status)
                 VALUES (?, ?, ?, 'accepted')`,
                [requestId, driver.driver_id, vehicleId]
            );

            // Update the passenger's ride request
            await connection.execute(
                `UPDATE ride_requests
                 SET status = 'accepted'
                 WHERE request_id = ? AND status = 'requested'`,
                [requestId]
            );

            // Mark the driver as on a trip
            await connection.execute(
                `UPDATE driver_profiles
                 SET availability_status = 'on_trip'
                 WHERE driver_id = ?`,
                [driver.driver_id]
            );

            await connection.commit();

            res.writeHead(201, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                message: 'Ride accepted successfully.',
                trip: {
                    trip_id: tripResult.insertId,
                    request_id: requestId,
                    driver_id: driver.driver_id,
                    vehicle_id: vehicleId,
                    status: 'accepted'
                }
            }));
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error('Accept ride rollback error:', rollbackError.message);
                }
            }
            console.error('Accept ride error:', error);

            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Could not accept the ride request.'
                }
            }));
        } finally {
            if (connection) {
                connection.release();
            }
        }

        return;
    }


    // Driver starts an accepted trip
    const startTripMatch = pathname.match(
        /^\/api\/trips\/([^/]+)\/start$/
    );

    if (req.method === 'POST' && startTripMatch) {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const tripId = parsePositiveId(startTripMatch[1]);

        if (tripId === null) {
            sendJson(res, 400, {
                error: {
                    code: 'INVALID_ID',
                    message: 'Trip ID must be a positive integer.'
                }
            });
            return;
        }
        let connection;

        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            const [drivers] = await connection.execute(
                `SELECT driver_id
                 FROM driver_profiles
                 WHERE user_id = ?
                   AND verification_status = 'approved'
                 FOR UPDATE`,
                [auth.session.userId]
            );

            if (drivers.length === 0) {
                await connection.rollback();
                res.writeHead(403, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'DRIVER_NOT_APPROVED',
                        message: 'An approved driver profile is required.'
                    }
                }));
                return;
            }

            const driverId = drivers[0].driver_id;

            const [trips] = await connection.execute(
                `SELECT trip_id, request_id, status
                 FROM trips
                 WHERE trip_id = ? AND driver_id = ?
                 FOR UPDATE`,
                [tripId, driverId]
            );

            if (trips.length === 0) {
                await connection.rollback();
                res.writeHead(404, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'TRIP_NOT_FOUND',
                        message: 'Trip not found for this driver.'
                    }
                }));
                return;
            }

            if (trips[0].status !== 'accepted') {
                await connection.rollback();
                res.writeHead(409, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'TRIP_NOT_STARTABLE',
                        message: 'Only an accepted trip can be started.'
                    }
                }));
                return;
            }

            await connection.execute(
                `UPDATE trips
                 SET status = 'started', started_at = NOW()
                 WHERE trip_id = ?`,
                [tripId]
            );

            await connection.execute(
                `UPDATE ride_requests
                 SET status = 'started'
                 WHERE request_id = ?`,
                [trips[0].request_id]
            );

            await connection.commit();

            res.writeHead(200, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                message: 'Trip started successfully.',
                trip_id: tripId,
                status: 'started'
            }));
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error('Start trip rollback error:', rollbackError.message);
                }
            }
            console.error('Start trip error:', error);

            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Could not start the trip.'
                }
            }));
        } finally {
            if (connection) {
                connection.release();
            }
        }

        return;
    }


    // Driver completes a started trip
    const completeTripMatch = pathname.match(
        /^\/api\/trips\/([^/]+)\/complete$/
    );

    if (req.method === 'POST' && completeTripMatch) {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const tripId = parsePositiveId(completeTripMatch[1]);

        if (tripId === null) {
            sendJson(res, 400, {
                error: {
                    code: 'INVALID_ID',
                    message: 'Trip ID must be a positive integer.'
                }
            });
            return;
        }
        let connection;

        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            const [drivers] = await connection.execute(
                `SELECT driver_id
                 FROM driver_profiles
                 WHERE user_id = ?
                   AND verification_status = 'approved'
                 FOR UPDATE`,
                [auth.session.userId]
            );

            if (drivers.length === 0) {
                await connection.rollback();
                res.writeHead(403, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'DRIVER_NOT_APPROVED',
                        message: 'An approved driver profile is required.'
                    }
                }));
                return;
            }

            const driverId = drivers[0].driver_id;

            const [trips] = await connection.execute(
                `SELECT t.trip_id, t.request_id, t.status,
                        r.vehicle_type, r.estimated_fare
                 FROM trips t
                 JOIN ride_requests r ON r.request_id = t.request_id
                 WHERE t.trip_id = ? AND t.driver_id = ?
                 FOR UPDATE`,
                [tripId, driverId]
            );

            if (trips.length === 0) {
                await connection.rollback();
                res.writeHead(404, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'TRIP_NOT_FOUND',
                        message: 'Trip not found for this driver.'
                    }
                }));
                return;
            }

            const trip = trips[0];

            if (trip.status !== 'started') {
                await connection.rollback();
                res.writeHead(409, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'TRIP_NOT_COMPLETABLE',
                        message: 'Only a started trip can be completed.'
                    }
                }));
                return;
            }

            const finalFare = Number(Number(trip.estimated_fare).toFixed(2));

            await connection.execute(
                `UPDATE trips
                 SET status = 'completed',
                     completed_at = NOW(),
                     final_fare = ?
                 WHERE trip_id = ?`,
                [finalFare, tripId]
            );

            await connection.execute(
                `UPDATE ride_requests
                 SET status = 'completed'
                 WHERE request_id = ?`,
                [trip.request_id]
            );

            await connection.execute(
                `UPDATE driver_profiles
                 SET availability_status = 'available'
                 WHERE driver_id = ?`,
                [driverId]
            );

            await connection.commit();

            res.writeHead(200, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                message: 'Trip completed successfully.',
                trip_id: tripId,
                status: 'completed',
                final_fare: finalFare
            }));
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error('Complete trip rollback error:', rollbackError.message);
                }
            }
            console.error('Complete trip error:', error);

            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Could not complete the trip.'
                }
            }));
        } finally {
            if (connection) {
                connection.release();
            }
        }

        return;
    }


    // Driver: Get incoming ride requests
    if (req.method === 'GET' && pathname === '/api/driver/requests') {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [drivers] = await pool.execute(
                `SELECT driver_id, verification_status, availability_status, rating
                 FROM driver_profiles
                 WHERE user_id = ?`,
                [auth.session.userId]
            );

            if (drivers.length === 0 || drivers[0].verification_status !== 'approved') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        code: 'DRIVER_NOT_APPROVED',
                        message: 'An approved driver profile is required.'
                    }
                }));
                return;
            }

            const driver = drivers[0];

            // Get pending ride requests that match driver's vehicles
            const [vehicles] = await pool.execute(
                `SELECT vehicle_type FROM vehicles 
                 WHERE driver_id = ? AND approval_status = 'approved' AND is_active = TRUE`,
                [driver.driver_id]
            );

            const vehicleTypes = [...new Set(vehicles.map(v => v.vehicle_type))];

            let requests = [];
            if (vehicleTypes.length > 0) {
                const placeholders = vehicleTypes.map(() => '?').join(',');
                const [rows] = await pool.execute(
                    `SELECT rr.request_id, rr.passenger_id, rr.pickup_location, rr.drop_location,
                            rr.vehicle_type, rr.estimated_fare, rr.status, rr.created_at,
                            u.full_name as passenger_name,
                            t.trip_id
                     FROM ride_requests rr
                     JOIN users u ON u.user_id = rr.passenger_id
                     LEFT JOIN trips t ON t.request_id = rr.request_id AND t.driver_id = ?
                    WHERE (
    (
        rr.status = 'requested'
        AND rr.vehicle_type IN (${placeholders})
        AND NOT EXISTS (
            SELECT 1
            FROM driver_rejections dr
            WHERE dr.request_id = rr.request_id
              AND dr.driver_id = ?
        )
    )
    OR (t.driver_id = ? AND rr.status IN ('accepted', 'started'))
)
                     ORDER BY rr.created_at ASC`,
                    [driver.driver_id, ...vehicleTypes, driver.driver_id, driver.driver_id]
                );
                requests = rows;
            } else {
                const [rows] = await pool.execute(
                    `SELECT rr.request_id, rr.passenger_id, rr.pickup_location, rr.drop_location,
                            rr.vehicle_type, rr.estimated_fare, rr.status, rr.created_at,
                            u.full_name as passenger_name,
                            t.trip_id
                     FROM ride_requests rr
                     JOIN users u ON u.user_id = rr.passenger_id
                     LEFT JOIN trips t ON t.request_id = rr.request_id AND t.driver_id = ?
                     WHERE t.driver_id = ? AND rr.status IN ('accepted', 'started')
                     ORDER BY rr.created_at ASC`,
                    [driver.driver_id, driver.driver_id]
                );
                requests = rows;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ requests, driver }));
        } catch (error) {
            console.error('Get driver requests error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not retrieve ride requests.' } }));
        }
        return;
    }


    // Driver: Get vehicles
    if (req.method === 'GET' && pathname === '/api/driver/vehicles') {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [drivers] = await pool.execute(
                `SELECT driver_id FROM driver_profiles WHERE user_id = ?`,
                [auth.session.userId]
            );

            if (drivers.length === 0) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { code: 'NO_DRIVER_PROFILE', message: 'Driver profile not found.' } }));
                return;
            }

            const [vehicles] = await pool.execute(
                `SELECT vehicle_id, driver_id, registration_number, vehicle_type, model, capacity, 
                        approval_status, is_active, created_at
                 FROM vehicles
                 WHERE driver_id = ?
                 ORDER BY created_at DESC`,
                [drivers[0].driver_id]
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ vehicles }));
        } catch (error) {
            console.error('Get driver vehicles error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not retrieve vehicles.' } }));
        }
        return;
    }


    // Driver: Add vehicle
    if (req.method === 'POST' && pathname === '/api/driver/vehicles') {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const data = await readRequestBody(req);
            const registrationNumber = typeof data.registration_number === 'string'
                ? data.registration_number.trim().toUpperCase()
                : '';
            const vehicleType = typeof data.vehicle_type === 'string'
                ? data.vehicle_type.trim().toLowerCase()
                : '';
            const model = typeof data.model === 'string' ? data.model.trim() : '';
            const capacity = data.capacity;

            if (
                !registrationNumber || registrationNumber.length > 30 ||
                !['standard', 'sedan', 'suv'].includes(vehicleType) ||
                !model || model.length > 100 ||
                !Number.isInteger(capacity) || capacity <= 0 || capacity > 100
            ) {
                sendJson(res, 400, {
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Provide a valid registration number, vehicle type, model, and capacity.'
                    }
                });
                return;
            }

            const [drivers] = await pool.execute(
                `SELECT driver_id FROM driver_profiles WHERE user_id = ?`,
                [auth.session.userId]
            );

            if (drivers.length === 0) {
                sendJson(res, 403, { error: { code: 'NO_DRIVER_PROFILE', message: 'Driver profile not found.' } });
                return;
            }

            const [result] = await pool.execute(
                `INSERT INTO vehicles (driver_id, registration_number, vehicle_type, model, capacity, approval_status, is_active)
                 VALUES (?, ?, ?, ?, ?, 'pending', TRUE)`,
                [drivers[0].driver_id, registrationNumber, vehicleType, model, capacity]
            );

            sendJson(res, 201, {
                message: 'Vehicle added successfully. Status is pending administrator approval.',
                vehicle: {
                    vehicle_id: result.insertId,
                    driver_id: drivers[0].driver_id,
                    registration_number: registrationNumber,
                    vehicle_type: vehicleType,
                    model,
                    capacity,
                    approval_status: 'pending',
                    is_active: true
                }
            });
        } catch (error) {
            console.error('Add vehicle error:', error.message);
            if (error.code === 'INVALID_JSON' || error.code === 'REQUEST_BODY_TOO_LARGE') {
                sendJson(res, 400, { error: { code: error.code, message: error.message } });
                return;
            }
            if (error.code === 'ER_DUP_ENTRY') {
                sendJson(res, 409, { error: { code: 'DUPLICATE_VEHICLE', message: 'Registration number already exists.' } });
                return;
            }
            sendJson(res, 500, { error: { code: 'SERVER_ERROR', message: 'Could not add vehicle.' } });
        }
        return;
    }


    // Driver: Update vehicle
    const driverUpdateVehicleMatch = pathname.match(/^\/api\/driver\/vehicles\/([^/]+)$/);
    if (req.method === 'PUT' && driverUpdateVehicleMatch) {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const vehicleId = parsePositiveId(driverUpdateVehicleMatch[1]);
        if (vehicleId === null) {
            sendJson(res, 400, { error: { code: 'INVALID_ID', message: 'Vehicle ID must be a positive integer.' } });
            return;
        }

        try {
            const data = await readRequestBody(req);
            const [drivers] = await pool.execute(
                `SELECT driver_id FROM driver_profiles WHERE user_id = ?`,
                [auth.session.userId]
            );

            if (drivers.length === 0) {
                sendJson(res, 403, { error: { code: 'NO_DRIVER_PROFILE', message: 'Driver profile not found.' } });
                return;
            }

            const updates = [];
            const values = [];
            if (data.model !== undefined) {
                if (typeof data.model !== 'string' || !data.model.trim() || data.model.trim().length > 100) {
                    sendJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Model must be 1 to 100 characters.' } });
                    return;
                }
                updates.push('model = ?');
                values.push(data.model.trim());
            }
            if (data.vehicle_type !== undefined) {
                if (typeof data.vehicle_type !== 'string' || !['standard', 'sedan', 'suv'].includes(data.vehicle_type.trim().toLowerCase())) {
                    sendJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Vehicle type is invalid.' } });
                    return;
                }
                updates.push('vehicle_type = ?');
                values.push(data.vehicle_type.trim().toLowerCase());
            }
            if (data.capacity !== undefined) {
                if (!Number.isInteger(data.capacity) || data.capacity <= 0 || data.capacity > 100) {
                    sendJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Capacity must be a positive integer up to 100.' } });
                    return;
                }
                updates.push('capacity = ?');
                values.push(data.capacity);
            }
            if (data.is_active !== undefined) {
                if (typeof data.is_active !== 'boolean') {
                    sendJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'is_active must be boolean.' } });
                    return;
                }
                updates.push('is_active = ?');
                values.push(data.is_active ? 1 : 0);
            }

            if (updates.length === 0) {
                sendJson(res, 400, { error: { code: 'NO_CHANGES', message: 'No valid fields to update.' } });
                return;
            }

            values.push(vehicleId, drivers[0].driver_id);
            const [result] = await pool.execute(
                `UPDATE vehicles SET ${updates.join(', ')} WHERE vehicle_id = ? AND driver_id = ?`,
                values
            );

            if (result.affectedRows === 0) {
                sendJson(res, 404, { error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found for this driver.' } });
                return;
            }
            sendJson(res, 200, { message: 'Vehicle updated successfully.' });
        } catch (error) {
            console.error('Update vehicle error:', error.message);
            if (error.code === 'INVALID_JSON' || error.code === 'REQUEST_BODY_TOO_LARGE') {
                sendJson(res, 400, { error: { code: error.code, message: error.message } });
                return;
            }
            sendJson(res, 500, { error: { code: 'SERVER_ERROR', message: 'Could not update vehicle.' } });
        }
        return;
    }


    // Driver: Get earnings
    if (req.method === 'GET' && pathname === '/api/driver/earnings') {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [drivers] = await pool.execute(
                `SELECT driver_id FROM driver_profiles WHERE user_id = ?`,
                [auth.session.userId]
            );

            if (drivers.length === 0) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { code: 'NO_DRIVER_PROFILE', message: 'Driver profile not found.' } }));
                return;
            }

            const driverId = drivers[0].driver_id;

            const [trips] = await pool.execute(
                `SELECT t.trip_id, t.request_id, t.final_fare, t.started_at, t.completed_at,
                        rr.pickup_location, rr.drop_location,
                        u.full_name as passenger_name,
                        v.model as vehicle_model, v.registration_number
                 FROM trips t
                 JOIN ride_requests rr ON rr.request_id = t.request_id
                 JOIN users u ON u.user_id = rr.passenger_id
                 LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
                 WHERE t.driver_id = ? AND t.status = 'completed'
                 ORDER BY t.completed_at DESC`,
                [driverId]
            );

            const totalEarnings = trips.reduce((sum, t) => sum + parseFloat(t.final_fare || 0), 0);
            const count = trips.length;
            const avg = count > 0 ? totalEarnings / count : 0;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                earnings: {
                    total_earnings: parseFloat(totalEarnings.toFixed(2)),
                    completed_trips_count: count,
                    average_fare: parseFloat(avg.toFixed(2)),
                    trips
                }
            }));
        } catch (error) {
            console.error('Get driver earnings error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not retrieve earnings.' } }));
        }
        return;
    }


    // Driver: Update availability
    if (req.method === 'PATCH' && pathname === '/api/driver/availability') {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const data = await readRequestBody(req);
            const availabilityStatus = typeof data.availability_status === 'string'
                ? data.availability_status.trim().toLowerCase()
                : '';

            if (!['available', 'offline'].includes(availabilityStatus)) {
                sendJson(res, 400, { error: { code: 'INVALID_STATUS', message: 'Invalid availability status.' } });
                return;
            }

            const [drivers] = await pool.execute(
                `SELECT driver_id, verification_status, availability_status
                 FROM driver_profiles WHERE user_id = ?`,
                [auth.session.userId]
            );

            if (drivers.length === 0) {
                sendJson(res, 403, { error: { code: 'NO_DRIVER_PROFILE', message: 'Driver profile not found.' } });
                return;
            }
            if (drivers[0].verification_status !== 'approved') {
                sendJson(res, 403, { error: { code: 'DRIVER_NOT_APPROVED', message: 'An approved driver profile is required.' } });
                return;
            }
            if (drivers[0].availability_status === 'on_trip' && availabilityStatus === 'offline') {
                sendJson(res, 409, { error: { code: 'ACTIVE_TRIP_EXISTS', message: 'Availability cannot change while on a trip.' } });
                return;
            }

            await pool.execute(
                `UPDATE driver_profiles SET availability_status = ? WHERE driver_id = ?`,
                [availabilityStatus, drivers[0].driver_id]
            );

            sendJson(res, 200, {
                message: `Availability updated to ${availabilityStatus}.`,
                availability_status: availabilityStatus
            });
        } catch (error) {
            console.error('Update availability error:', error.message);
            if (error.code === 'INVALID_JSON' || error.code === 'REQUEST_BODY_TOO_LARGE') {
                sendJson(res, 400, { error: { code: error.code, message: error.message } });
                return;
            }
            sendJson(res, 500, { error: { code: 'SERVER_ERROR', message: 'Could not update availability.' } });
        }
        return;
    }


    // Driver: Reject request
    const driverRejectMatch = pathname.match(
        /^\/api\/driver\/requests\/([^/]+)\/reject$/
    );

    if (req.method === 'POST' && driverRejectMatch) {
        const auth = await requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const requestId = parsePositiveId(driverRejectMatch[1]);

        if (requestId === null) {
            sendJson(res, 400, {
                error: {
                    code: 'INVALID_ID',
                    message: 'Request ID must be a positive integer.'
                }
            });
            return;
        }
        let connection;

        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // Check that the driver is approved
            const [drivers] = await connection.execute(
                `SELECT driver_id, verification_status
                 FROM driver_profiles
                 WHERE user_id = ?
                 FOR UPDATE`,
                [auth.session.userId]
            );

            if (
                drivers.length === 0 ||
                drivers[0].verification_status !== 'approved'
            ) {
                await connection.rollback();
                res.writeHead(403, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'DRIVER_NOT_APPROVED',
                        message: 'An approved driver profile is required.'
                    }
                }));
                return;
            }

            const driverId = drivers[0].driver_id;

            // Check that the ride request exists and is still available
            const [requests] = await connection.execute(
                `SELECT request_id, passenger_id, vehicle_type, status
                 FROM ride_requests
                 WHERE request_id = ?
                 FOR UPDATE`,
                [requestId]
            );

            if (
                requests.length === 0 ||
                requests[0].status !== 'requested'
            ) {
                await connection.rollback();
                res.writeHead(409, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'CANNOT_REJECT',
                        message: 'This ride request is no longer available.'
                    }
                }));
                return;
            }

            const ride = requests[0];

            // Check that the driver has a matching approved, active vehicle
            const [vehicles] = await connection.execute(
                `SELECT vehicle_id
                 FROM vehicles
                 WHERE driver_id = ?
                   AND vehicle_type = ?
                   AND approval_status = 'approved'
                   AND is_active = TRUE
                 LIMIT 1`,
                [driverId, ride.vehicle_type]
            );

            if (vehicles.length === 0) {
                await connection.rollback();
                res.writeHead(403, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'NO_ELIGIBLE_VEHICLE',
                        message: 'You do not have an approved active vehicle matching this ride.'
                    }
                }));
                return;
            }

            // Record this driver's rejection without cancelling the ride
            await connection.execute(
                `INSERT INTO driver_rejections (request_id, driver_id)
                 VALUES (?, ?)`,
                [requestId, driverId]
            );

            // Notify the passenger
            await connection.execute(
                `INSERT INTO notifications (user_id, request_id, message)
                 VALUES (?, ?, ?)`,
                [
                    ride.passenger_id,
                    requestId,
                    'A driver rejected your ride request. CabGo is looking for another driver.'
                ]
            );

            await connection.commit();

            res.writeHead(200, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                message: 'Ride request rejected successfully. The passenger has been notified.'
            }));

        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error('Reject request rollback error:', rollbackError.message);
                }
            }
            console.error('Reject request error:', error);

            if (error.code === 'ER_DUP_ENTRY') {
                res.writeHead(409, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'ALREADY_REJECTED',
                        message: 'You have already rejected this ride request.'
                    }
                }));
                return;
            }

            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Could not reject this request.'
                }
            }));
        } finally {
            if (connection) {
                connection.release();
            }
        }

        return;
    }

    /* ======================================================================
       MEMBER 3: ADMIN ROUTES (Day 5)
       ====================================================================== */

    // GET /api/admin/stats
    if (req.method === 'GET' && pathname === '/api/admin/stats') {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [[passengers]] = await pool.execute("SELECT COUNT(*) AS count FROM users WHERE role = 'passenger'");
            const [[drivers]] = await pool.execute("SELECT COUNT(*) AS count FROM driver_profiles");
            const [[activeTrips]] = await pool.execute("SELECT COUNT(*) AS count FROM trips WHERE status IN ('accepted', 'started')");
            const [[revenue]] = await pool.execute("SELECT COALESCE(SUM(final_fare), 0) AS total FROM trips WHERE status = 'completed' AND completed_at >= CURRENT_DATE");

            res.writeHead(200);
            res.end(JSON.stringify({
                total_passengers: passengers.count,
                total_drivers: drivers.count,
                active_trips: activeTrips.count,
                today_revenue: Number(revenue.total)
            }));
        } catch (error) {
            console.error('Admin stats error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not fetch admin stats.' } }));
        }
        return;
    }

    // GET /api/admin/drivers
    if (req.method === 'GET' && pathname === '/api/admin/drivers') {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [drivers] = await pool.execute(`
                SELECT dp.driver_id, dp.user_id, u.full_name, u.email,
                       u.account_status,
                       dp.license_number, dp.license_expiry, dp.verification_status,
                       dp.availability_status, dp.rating, dp.created_at
                FROM driver_profiles dp
                JOIN users u ON dp.user_id = u.user_id
                ORDER BY dp.created_at DESC
            `);

            res.writeHead(200);
            res.end(JSON.stringify({ drivers }));
        } catch (error) {
            console.error('Admin drivers error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not fetch drivers.' } }));
        }
        return;
    }

    // POST /api/admin/drivers/:driver_id/approve
    const adminApproveDriverMatch = pathname.match(/^\/api\/admin\/drivers\/(\d+)\/approve$/);
    if (req.method === 'POST' && adminApproveDriverMatch) {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const driverId = adminApproveDriverMatch[1];
        try {
            const [result] = await pool.execute(
                "UPDATE driver_profiles SET verification_status = 'approved' WHERE driver_id = ?",
                [driverId]
            );

            if (result.affectedRows === 0) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Driver not found.' } }));
                return;
            }

            res.writeHead(200);
            res.end(JSON.stringify({ message: `Driver #${driverId} approved successfully.` }));
            await recordAuditLog(auth.session.userId, 'Approved driver', 'driver', driverId);
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // POST /api/admin/drivers/:driver_id/reject
    const adminRejectDriverMatch = pathname.match(/^\/api\/admin\/drivers\/(\d+)\/reject$/);
    if (req.method === 'POST' && adminRejectDriverMatch) {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const driverId = adminRejectDriverMatch[1];
        try {
            const [result] = await pool.execute(
                "UPDATE driver_profiles SET verification_status = 'rejected' WHERE driver_id = ?",
                [driverId]
            );

            if (result.affectedRows === 0) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Driver not found.' } }));
                return;
            }

            res.writeHead(200);
            res.end(JSON.stringify({ message: `Driver #${driverId} rejected.` }));
            await recordAuditLog(auth.session.userId, 'Rejected driver', 'driver', driverId);
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // POST /api/admin/drivers/:driver_id/block
    const adminBlockDriverMatch = pathname.match(/^\/api\/admin\/drivers\/(\d+)\/block$/);
    if (req.method === 'POST' && adminBlockDriverMatch) {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const driverId = adminBlockDriverMatch[1];
        try {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                const [result] = await connection.execute(
                    `UPDATE driver_profiles dp
                     JOIN users u ON u.user_id = dp.user_id
                     SET dp.verification_status = 'rejected',
                         dp.availability_status = 'offline',
                         u.account_status = 'blocked'
                     WHERE dp.driver_id = ?`,
                    [driverId]
                );
                if (result.affectedRows === 0) {
                    await connection.rollback();
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Driver not found.' } }));
                    return;
                }
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

            res.writeHead(200);
            res.end(JSON.stringify({ message: `Driver #${driverId} blocked successfully.` }));
            await recordAuditLog(auth.session.userId, 'Blocked driver', 'driver', driverId);
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // GET /api/admin/passengers
    if (req.method === 'GET' && pathname === '/api/admin/passengers') {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [passengers] = await pool.execute(`
                SELECT u.user_id, u.full_name, u.email, u.created_at,
                       u.account_status AS status,
                       COUNT(r.request_id) AS total_trips
                FROM users u
                LEFT JOIN ride_requests r ON u.user_id = r.passenger_id
                WHERE u.role = 'passenger'
                GROUP BY u.user_id
                ORDER BY u.created_at DESC
            `);

            res.writeHead(200);
            res.end(JSON.stringify({ passengers }));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not fetch passengers.' } }));
        }
        return;
    }

    // POST /api/admin/passengers/:user_id/toggle-block
    const adminTogglePassengerMatch = pathname.match(/^\/api\/admin\/passengers\/(\d+)\/toggle-block$/);
    if (req.method === 'POST' && adminTogglePassengerMatch) {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const userId = adminTogglePassengerMatch[1];
        try {
            const [result] = await pool.execute(
                `UPDATE users
                 SET account_status = CASE
                     WHEN account_status = 'blocked' THEN 'active'
                     ELSE 'blocked'
                 END
                 WHERE user_id = ? AND role = 'passenger'`,
                [userId]
            );

            if (result.affectedRows === 0) {
                res.writeHead(404);
                res.end(JSON.stringify({
                    error: { code: 'PASSENGER_NOT_FOUND', message: 'Passenger not found.' }
                }));
                return;
            }

            const [[passenger]] = await pool.execute(
                'SELECT account_status FROM users WHERE user_id = ?',
                [userId]
            );
            res.writeHead(200);
            res.end(JSON.stringify({
                message: `Passenger ${passenger.account_status === 'blocked' ? 'blocked' : 'unblocked'} successfully.`,
                status: passenger.account_status
            }));
            await recordAuditLog(auth.session.userId, `${passenger.account_status === 'blocked' ? 'Blocked' : 'Unblocked'} passenger`, 'passenger', userId);
        } catch (error) {
            console.error('Toggle passenger block error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not update passenger access.' } }));
        }
        return;
    }

    // GET /api/admin/vehicles
    if (req.method === 'GET' && pathname === '/api/admin/vehicles') {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [vehicles] = await pool.execute(`
                SELECT v.vehicle_id, v.driver_id, u.full_name AS driver_name,
                       v.registration_number, v.vehicle_type, v.model,
                       v.capacity, v.approval_status, v.is_active, v.created_at
                FROM vehicles v
                JOIN driver_profiles dp ON v.driver_id = dp.driver_id
                JOIN users u ON dp.user_id = u.user_id
                ORDER BY v.created_at DESC
            `);

            res.writeHead(200);
            res.end(JSON.stringify({ vehicles }));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not fetch vehicles.' } }));
        }
        return;
    }

    // POST /api/admin/vehicles/:vehicle_id/approve
    const adminApproveVehicleMatch = pathname.match(/^\/api\/admin\/vehicles\/(\d+)\/approve$/);
    if (req.method === 'POST' && adminApproveVehicleMatch) {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const vehicleId = adminApproveVehicleMatch[1];
        try {
            const [result] = await pool.execute("UPDATE vehicles SET approval_status = 'approved' WHERE vehicle_id = ?", [vehicleId]);
            if (result.affectedRows === 0) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Vehicle not found.' } }));
                return;
            }
            res.writeHead(200);
            res.end(JSON.stringify({ message: `Vehicle #${vehicleId} approved successfully.` }));
            await recordAuditLog(auth.session.userId, 'Approved vehicle', 'vehicle', vehicleId);
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // POST /api/admin/vehicles/:vehicle_id/reject
    const adminRejectVehicleMatch = pathname.match(/^\/api\/admin\/vehicles\/(\d+)\/reject$/);
    if (req.method === 'POST' && adminRejectVehicleMatch) {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const vehicleId = adminRejectVehicleMatch[1];
        try {
            const [result] = await pool.execute("UPDATE vehicles SET approval_status = 'rejected' WHERE vehicle_id = ?", [vehicleId]);
            if (result.affectedRows === 0) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Vehicle not found.' } }));
                return;
            }
            res.writeHead(200);
            res.end(JSON.stringify({ message: `Vehicle #${vehicleId} rejected.` }));
            await recordAuditLog(auth.session.userId, 'Rejected vehicle', 'vehicle', vehicleId);
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // GET /api/admin/fare-rules
    if (req.method === 'GET' && pathname === '/api/admin/fare-rules') {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [rules] = await pool.execute("SELECT * FROM fare_rules ORDER BY fare_rule_id ASC");
            res.writeHead(200);
            res.end(JSON.stringify({ fare_rules: rules }));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // PUT /api/admin/fare-rules/:rule_id
    const adminFareRuleMatch = pathname.match(/^\/api\/admin\/fare-rules\/(\d+)$/);
    if ((req.method === 'PUT' || req.method === 'PATCH') && adminFareRuleMatch) {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const ruleId = adminFareRuleMatch[1];
        try {
            const data = await readRequestBody(req);
            const fareValues = [data.base_fare, data.per_km_rate, data.per_minute_rate];
            if (fareValues.some((value) =>
                value !== undefined &&
                (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            )) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: { code: 'INVALID_INPUT', message: 'Fare values must be non-negative finite numbers.' }
                }));
                return;
            }

            const [result] = await pool.execute(
                `UPDATE fare_rules
                 SET base_fare = COALESCE(?, base_fare),
                     per_km_rate = COALESCE(?, per_km_rate),
                     per_minute_rate = COALESCE(?, per_minute_rate)
                 WHERE fare_rule_id = ?`,
                [data.base_fare, data.per_km_rate, data.per_minute_rate, ruleId]
            );
            if (result.affectedRows === 0) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Fare rule not found.' } }));
                return;
            }

            res.writeHead(200);
            res.end(JSON.stringify({ message: 'Fare rule updated successfully.' }));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // GET /api/admin/trips
    if (req.method === 'GET' && pathname === '/api/admin/trips') {
        const auth = await requireRole(req, ['admin', 'super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [trips] = await pool.execute(`
                SELECT t.trip_id, t.request_id, u_p.full_name AS passenger_name,
                       u_d.full_name AS driver_name, r.pickup_location, r.drop_location,
                       r.vehicle_type, t.final_fare, t.status, t.started_at, t.completed_at
                FROM trips t
                JOIN ride_requests r ON t.request_id = r.request_id
                JOIN users u_p ON r.passenger_id = u_p.user_id
                JOIN driver_profiles dp ON t.driver_id = dp.driver_id
                JOIN users u_d ON dp.user_id = u_d.user_id
                ORDER BY t.created_at DESC
                LIMIT 50
            `);

            res.writeHead(200);
            res.end(JSON.stringify({ trips }));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    /* ======================================================================
       MEMBER 3: SUPER ADMIN ROUTES (Day 6)
       ====================================================================== */

    // GET /api/superadmin/stats
    if (req.method === 'GET' && pathname === '/api/superadmin/stats') {
        const auth = await requireRole(req, ['super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [[admins]] = await pool.execute("SELECT COUNT(*) AS count FROM users WHERE role IN ('admin', 'super_admin')");
            const [[activeAdmins]] = await pool.execute("SELECT COUNT(*) AS count FROM users WHERE role IN ('admin', 'super_admin') AND account_status = 'active'");
            res.writeHead(200);
            res.end(JSON.stringify({
                total_admins: admins.count,
                active_admins: activeAdmins.count,
                permission_groups: null,
                events_today: null
            }));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // GET /api/superadmin/admins
    if (req.method === 'GET' && pathname === '/api/superadmin/admins') {
        const auth = await requireRole(req, ['super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const [admins] = await pool.execute(`
                SELECT user_id, full_name, email, role,
                       'Operations' AS department, account_status AS status, created_at
                FROM users
                WHERE role IN ('admin', 'super_admin')
                ORDER BY created_at ASC
            `);

            res.writeHead(200);
            res.end(JSON.stringify({ admins }));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    // POST /api/superadmin/admins
    if (req.method === 'POST' && pathname === '/api/superadmin/admins') {
        const auth = await requireRole(req, ['super_admin']);
        if (!auth.ok) {
            res.writeHead(auth.status);
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        try {
            const data = await readRequestBody(req);
            const name = typeof data.full_name === 'string' ? data.full_name.trim() : '';
            const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
            const password = data.password;

            if (!name || !email || typeof password !== 'string' || password.length < 8 || password.length > 72) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Name, email, and a password between 8 and 72 characters are required.' } }));
                return;
            }

            const passwordHash = await bcrypt.hash(password, 12);
            const [result] = await pool.execute(
                "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
                [name, email, passwordHash]
            );

            res.writeHead(201);
            res.end(JSON.stringify({
                message: `Administrator ${name} created successfully.`,
                admin: {
                    user_id: result.insertId,
                    full_name: name,
                    email: email,
                    role: 'admin',
                    department: data.department || 'Operations',
                    status: 'active'
                }
            }));
            await recordAuditLog(auth.session.userId, 'Created administrator', 'user', result.insertId, { role: 'admin' });
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: error.message } }));
        }
        return;
    }

    const superadminToggleAdminMatch = pathname.match(/^\/api\/superadmin\/admins\/(\d+)\/toggle$/);
    if (req.method === 'POST' && superadminToggleAdminMatch) {
        const auth = await requireRole(req, ['super_admin']);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        const userId = superadminToggleAdminMatch[1];
        try {
            const [rows] = await pool.execute(
                `SELECT role, account_status
                 FROM users
                 WHERE user_id = ? AND role = 'admin'`,
                [userId]
            );
            if (rows.length === 0) {
                sendJson(res, 404, { error: { code: 'ADMIN_NOT_FOUND', message: 'Administrator not found.' } });
                return;
            }
            const nextStatus = rows[0].account_status === 'active' ? 'blocked' : 'active';
            await pool.execute(
                'UPDATE users SET account_status = ? WHERE user_id = ? AND role = ?',
                [nextStatus, userId, 'admin']
            );
            await recordAuditLog(auth.session.userId, `${nextStatus === 'active' ? 'Activated' : 'Blocked'} administrator`, 'user', userId);
            sendJson(res, 200, { message: `Administrator access is now ${nextStatus}.`, status: nextStatus });
        } catch (error) {
            console.error('Toggle administrator error:', error.message);
            sendJson(res, 500, { error: { code: 'SERVER_ERROR', message: 'Could not update administrator access.' } });
        }
        return;
    }



    // Superadmin: persistent system settings.
    if (req.method === 'GET' && pathname === '/api/superadmin/settings') {
        const auth = await requireRole(req, ['super_admin']);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        try {
            const [rows] = await pool.execute(
                `SELECT platform_name, driver_commission_percentage, max_search_radius_km,
                        support_email, maintenance_mode, booking_enabled, updated_at
                 FROM system_settings
                 WHERE setting_id = 1`
            );
            if (rows.length === 0) {
                sendJson(res, 503, { error: { code: 'SETTINGS_UNAVAILABLE', message: 'System settings have not been initialized.' } });
                return;
            }
            sendJson(res, 200, { settings: rows[0] });
        } catch (error) {
            console.error('Get system settings error:', error.message);
            sendJson(res, 503, { error: { code: 'SETTINGS_UNAVAILABLE', message: 'System settings are unavailable. Apply the settings migration first.' } });
        }
        return;
    }

    if (req.method === 'PUT' && pathname === '/api/superadmin/settings') {
        const auth = await requireRole(req, ['super_admin']);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        try {
            const data = await readRequestBody(req);
            const platformName = typeof data.platform_name === 'string' ? data.platform_name.trim() : '';
            const supportEmail = typeof data.support_email === 'string' ? data.support_email.trim() : '';
            const commission = Number(data.driver_commission_percentage);
            const radius = Number(data.max_search_radius_km);
            if (!validateSettings({
                platform_name: platformName,
                support_email: supportEmail,
                driver_commission_percentage: commission,
                max_search_radius_km: radius,
                maintenance_mode: data.maintenance_mode,
                booking_enabled: data.booking_enabled
            })) {
                sendJson(res, 400, { error: { code: 'INVALID_SETTINGS', message: 'Provide valid system settings.' } });
                return;
            }
            await pool.execute(
                `UPDATE system_settings
                 SET platform_name = ?, driver_commission_percentage = ?,
                     max_search_radius_km = ?, support_email = ?,
                     maintenance_mode = ?, booking_enabled = ?, updated_by = ?
                 WHERE setting_id = 1`,
                [platformName, commission, radius, supportEmail, data.maintenance_mode, data.booking_enabled, auth.session.userId]
            );
            await recordAuditLog(auth.session.userId, 'Updated system settings', 'system_settings', '1', {
                maintenance_mode: data.maintenance_mode,
                booking_enabled: data.booking_enabled,
                driver_commission_percentage: commission,
                max_search_radius_km: radius
            });
            sendJson(res, 200, { message: 'System settings updated successfully.' });
        } catch (error) {
            console.error('Update system settings error:', error.message);
            sendJson(res, 503, { error: { code: 'SETTINGS_UNAVAILABLE', message: 'System settings are unavailable. Apply the settings migration first.' } });
        }
        return;
    }

    // Superadmin: persistent audit logs.
    if (req.method === 'GET' && pathname === '/api/superadmin/logs') {
        const auth = await requireRole(req, ['super_admin']);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        try {
            const [rows] = await pool.execute(
                `SELECT al.log_id, al.created_at AS timestamp,
                        COALESCE(u.full_name, 'System') AS actor,
                        al.action, al.target_type, al.target_id,
                        al.metadata
                 FROM audit_logs al
                 LEFT JOIN users u ON u.user_id = al.actor_user_id
                 ORDER BY al.created_at DESC
                 LIMIT 500`
            );
            sendJson(res, 200, {
                logs: rows.map(row => ({
                    log_id: row.log_id,
                    timestamp: row.timestamp,
                    actor: row.actor,
                    action: row.action,
                    status: 'success',
                    details: row.metadata ? JSON.stringify(row.metadata) : ''
                }))
            });
        } catch (error) {
            console.error('Get audit logs error:', error.message);
            sendJson(res, 503, { error: { code: 'AUDIT_LOGS_UNAVAILABLE', message: 'Audit logs are unavailable. Apply the audit-log migration first.' } });
        }
        return;
    }

    if (pathname.startsWith('/api/')) {
        sendJson(res, 404, {
            error: {
                code: 'NOT_FOUND',
                message: 'API endpoint not found.'
            }
        });
        return;
    }

    // 4. Route not found
        // Serve frontend files from the public folder
    const publicDir = path.resolve(__dirname, '..', 'public');

    let requestedPath;

    try {
        requestedPath = decodeURIComponent(
            new URL(req.url, 'http://localhost').pathname
        );
    } catch {
        res.writeHead(400);
        res.end('Bad Request');
        return;
    }

    if (requestedPath === '/') {
        requestedPath = '/index.html';
    }

    const actualPath = path.resolve(
        publicDir,
        '.' + requestedPath
    );

    if (
        actualPath !== publicDir &&
        !actualPath.startsWith(publicDir + path.sep)
    ) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(actualPath, (error, content) => {
        if (error) {
            res.writeHead(404, {
                'Content-Type': 'text/plain; charset=utf-8'
            });
            res.end('File not found');
            return;
        }

        const contentTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        };

        res.writeHead(200, {
            'Content-Type':
                contentTypes[path.extname(actualPath)] ||
                'application/octet-stream'
        });

        res.end(content);
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
