
const http = require('http');
const bcrypt = require('bcrypt');
const pool = require('./db');
const crypto = require('crypto');


const PORT = 3000;
// Temporary in-memory session store for development
const sessions = new Map();

const SESSION_COOKIE = 'cab_session';
const SESSION_DURATION = 60 * 60 * 1000; // 1 hour


function getSessionFromRequest(req) {
    const cookies = req.headers.cookie || '';

    const sessionCookie = cookies
        .split(';')
        .map(cookie => cookie.trim())
        .find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));

    if (!sessionCookie) {
        return null;
    }

    const token = sessionCookie.substring(
        SESSION_COOKIE.length + 1
    );

    const session = sessions.get(token);

    if (!session || session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }

    return {
        token,
        userId: session.userId,
        role: session.role
    };
}

function requireRole(req, allowedRoles) {
    const session = getSessionFromRequest(req);

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


// Read and parse JSON request bodies
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk;

            if (body.length > 1_000_000) {
                reject(new Error('Request body is too large'));
                req.destroy();
            }
        });

        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error('Invalid JSON in request body'));
            }
        });

        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // 1. Home route
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200);
        res.end(JSON.stringify({
            message: 'Online Cab Booking System API is running!'
        }));
        return;
    }

    // 2. Test JSON request-body parsing
    if (req.method === 'POST' && req.url === '/test-body') {
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

    // 3. Passenger registration
    if (req.method === 'POST' && req.url === '/api/register') {
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
                !email ||
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

            if (password.length < 8) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'WEAK_PASSWORD',
                        message: 'Password must be at least 8 characters long.'
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

            if (
                error.message === 'Invalid JSON in request body' ||
                error.message === 'Request body is too large'
            ) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_REQUEST',
                        message: error.message
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
    if (req.method === 'POST' && req.url === '/api/login') {
        try {
            const data = await readRequestBody(req);

            const email =
                typeof data.email === 'string'
                    ? data.email.trim().toLowerCase()
                    : '';

            const password = data.password;

            if (!email || typeof password !== 'string' || !password) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Email and password are required.'
                    }
                }));
                return;
            }

            const [users] = await pool.execute(
                `SELECT user_id, full_name, email, password_hash, role
                 FROM users
                 WHERE email = ?`,
                [email]
            );

            if (users.length === 0) {
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

            if (!passwordMatches) {
                res.writeHead(401);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_CREDENTIALS',
                        message: 'Invalid email or password.'
                    }
                }));
                return;
            }

            // Create a random session token
            const sessionToken = crypto.randomBytes(32).toString('hex');

            sessions.set(sessionToken, {
                userId: user.user_id,
                role: user.role,
                expiresAt: Date.now() + SESSION_DURATION
            });

            res.writeHead(200, {
                'Set-Cookie':
                    `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`
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

            if (error.message === 'Invalid JSON in request body') {
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
    if (req.method === 'GET' && req.url === '/api/me') {
        const cookies = req.headers.cookie || '';

        const sessionCookie = cookies
            .split(';')
            .map(cookie => cookie.trim())
            .find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));

        const sessionToken = sessionCookie
            ? sessionCookie.substring(SESSION_COOKIE.length + 1)
            : null;

        const session = sessionToken
            ? sessions.get(sessionToken)
            : null;

        if (!session || session.expiresAt <= Date.now()) {
            if (sessionToken) {
                sessions.delete(sessionToken);
            }

            res.writeHead(401);
            res.end(JSON.stringify({
                error: {
                    code: 'UNAUTHENTICATED',
                    message: 'Please log in to continue.'
                }
            }));
            return;
        }

        try {
            const [users] = await pool.execute(
                `SELECT user_id, full_name, email, role
                 FROM users
                 WHERE user_id = ?`,
                [session.userId]
            );

            if (users.length === 0) {
                sessions.delete(sessionToken);

                res.writeHead(401);
                res.end(JSON.stringify({
                    error: {
                        code: 'UNAUTHENTICATED',
                        message: 'User account not found.'
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
    if (req.method === 'POST' && req.url === '/api/logout') {
        const cookies = req.headers.cookie || '';

        const sessionCookie = cookies
            .split(';')
            .map(cookie => cookie.trim())
            .find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));

        const sessionToken = sessionCookie
            ? sessionCookie.substring(SESSION_COOKIE.length + 1)
            : null;

        if (sessionToken) {
            sessions.delete(sessionToken);
        }

        res.writeHead(200, {
            'Set-Cookie':
                `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
        });

        res.end(JSON.stringify({
            message: 'Logout successful'
        }));

        return;
    }


    // Estimate fare using the database fare rules
    if (req.method === 'POST' && req.url === '/api/fare/estimate') {
        try {
            const data = await readRequestBody(req);

            const vehicleType = data.vehicle_type;
            const distanceKm = data.distance_km;
            const durationMinutes = data.duration_minutes;

            if (
                !['standard', 'sedan', 'suv'].includes(vehicleType) ||
                typeof distanceKm !== 'number' ||
                !Number.isFinite(distanceKm) ||
                distanceKm <= 0 ||
                typeof durationMinutes !== 'number' ||
                !Number.isFinite(durationMinutes) ||
                durationMinutes < 0
            ) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Provide a valid vehicle_type, positive distance_km, and non-negative duration_minutes.'
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

            const estimatedFare =
                Number(rule.base_fare) +
                distanceKm * Number(rule.per_km_rate) +
                durationMinutes * Number(rule.per_minute_rate);

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

            if (error.message === 'Invalid JSON in request body') {
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
    if (req.method === 'POST' && req.url === '/api/ride-requests') {
        const auth = requireRole(req, ['passenger']);

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

            if (
                !pickupLocation ||
                !dropLocation ||
                pickupLocation.length > 255 ||
                dropLocation.length > 255 ||
                pickupLocation.toLowerCase() === dropLocation.toLowerCase() ||
                !['standard', 'sedan', 'suv'].includes(vehicleType)
            ) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Provide different pickup and drop locations and a valid vehicle type.'
                    }
                }));
                return;
            }

            // Retrieve the active fare rule
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

            // Temporary estimate until real route-distance calculation is integrated.
            // These values are placeholders, not actual route measurements.
            const estimatedDistanceKm = 10;
            const estimatedDurationMinutes = 20;
            const rule = rules[0];

            const estimatedFare = Number((
                Number(rule.base_fare) +
                estimatedDistanceKm * Number(rule.per_km_rate) +
                estimatedDurationMinutes * Number(rule.per_minute_rate)
            ).toFixed(2));

            const [result] = await pool.execute(
                `INSERT INTO ride_requests
                    (passenger_id, pickup_location, drop_location,
                     vehicle_type, estimated_fare, status)
                 VALUES (?, ?, ?, ?, ?, 'requested')`,
                [
                    auth.session.userId,
                    pickupLocation,
                    dropLocation,
                    vehicleType,
                    estimatedFare
                ]
            );

            res.writeHead(201);
            res.end(JSON.stringify({
                message: 'Ride request created successfully',
                request: {
                    request_id: result.insertId,
                    pickup_location: pickupLocation,
                    drop_location: dropLocation,
                    vehicle_type: vehicleType,
                    estimated_fare: estimatedFare,
                    status: 'requested'
                }
            }));
        } catch (error) {
            console.error('Ride request creation error:', error.message);

            if (res.destroyed || res.writableEnded) {
                return;
            }

            if (error.message === 'Invalid JSON in request body') {
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


if (req.method === 'GET' && req.url === '/api/ride-requests/mine') {
    const auth = requireRole(req, ['passenger']);

    if (!auth.ok) {
        res.writeHead(auth.status, {
            'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({ error: auth.error }));
        return;
    }

    try {
        const [requests] = await pool.execute(
            `SELECT request_id, pickup_location, drop_location,
                    vehicle_type, estimated_fare, status, created_at
             FROM ride_requests
             WHERE passenger_id = ?
             ORDER BY created_at DESC`,
            [auth.session.userId]
        );

        res.writeHead(200, {
            'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({ requests }));
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

    

    //cancel api

const cancelRideMatch = req.url.match(
    /^\/api\/ride-requests\/(\d+)\/cancel$/
);

if (req.method === 'POST' && cancelRideMatch) {
    const auth = requireRole(req, ['passenger']);

    if (!auth.ok) {
        res.writeHead(auth.status, {
            'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({ error: auth.error }));
        return;
    }

    try {
        const requestId = Number(cancelRideMatch[1]);

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




    // 4. Route not found
    res.writeHead(404);
    res.end(JSON.stringify({
        error: {
            code: 'NOT_FOUND',
            message: 'Route not found'
        }
    }));
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
