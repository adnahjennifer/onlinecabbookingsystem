
const http = require('http');
const bcrypt = require('bcrypt');
const pool = require('./db');
const crypto = require('crypto');

const fs = require('fs');
const path = require('path');


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


        // Driver accepts a passenger ride request
        const acceptRideMatch = req.url.match(
            /^\/api\/driver\/requests\/(\d+)\/accept$/
        );

        if (req.method === 'POST' && acceptRideMatch) {
            const auth = requireRole(req, ['driver']);

            if (!auth.ok) {
                res.writeHead(auth.status, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ error: auth.error }));
                return;
            }

            const requestId = Number(acceptRideMatch[1]);
            const connection = await pool.getConnection();

            try {
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
            await connection.rollback();
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
            connection.release();
        }

        return;
    }


    // Driver starts an accepted trip
    const startTripMatch = req.url.match(
        /^\/api\/trips\/(\d+)\/start$/
    );

    if (req.method === 'POST' && startTripMatch) {
        const auth = requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const tripId = Number(startTripMatch[1]);
        const connection = await pool.getConnection();

        try {
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
            await connection.rollback();
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
            connection.release();
        }

        return;
    }


    // Driver completes a started trip
    const completeTripMatch = req.url.match(
        /^\/api\/trips\/(\d+)\/complete$/
    );

    if (req.method === 'POST' && completeTripMatch) {
        const auth = requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const tripId = Number(completeTripMatch[1]);
        const connection = await pool.getConnection();

        try {
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
                        r.vehicle_type
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

            const [rules] = await connection.execute(
                `SELECT base_fare, per_km_rate, per_minute_rate
                 FROM fare_rules
                 WHERE vehicle_type = ? AND is_active = TRUE`,
                [trip.vehicle_type]
            );

            if (rules.length === 0) {
                await connection.rollback();
                res.writeHead(409, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: {
                        code: 'FARE_RULE_NOT_FOUND',
                        message: 'No active fare rule exists for this vehicle type.'
                    }
                }));
                return;
            }

            let finalFare;
            try {
                const bodyData = await readRequestBody(req);
                if (bodyData && bodyData.final_fare !== undefined && bodyData.final_fare !== null) {
                    finalFare = Number(parseFloat(bodyData.final_fare).toFixed(2));
                }
            } catch (e) {
                // ignore body parsing errors and fall back to calculation
            }

            if (finalFare === undefined || isNaN(finalFare)) {
                // Sample values only; replace with actual trip measurements later.
                const distanceKm = 10;
                const durationMinutes = 20;
                const rule = rules[0];

                finalFare = Number((
                    Number(rule.base_fare) +
                    distanceKm * Number(rule.per_km_rate) +
                    durationMinutes * Number(rule.per_minute_rate)
                ).toFixed(2));
            }

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
            await connection.rollback();
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
            connection.release();
        }

        return;
    }


    // Driver: Get incoming ride requests
    if (req.method === 'GET' && req.url === '/api/driver/requests') {
        const auth = requireRole(req, ['driver']);

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
                     WHERE ((rr.status IN ('requested') AND rr.vehicle_type IN (${placeholders}))
                        OR (t.driver_id = ? AND rr.status IN ('accepted', 'started')))
                     ORDER BY rr.created_at ASC`,
                    [driver.driver_id, ...vehicleTypes, driver.driver_id]
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
    if (req.method === 'GET' && req.url === '/api/driver/vehicles') {
        const auth = requireRole(req, ['driver']);

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
    if (req.method === 'POST' && req.url === '/api/driver/vehicles') {
        const auth = requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const registration_number = data.registration_number?.toString().trim().toUpperCase();
                const vehicle_type = data.vehicle_type?.toString().trim().toLowerCase();
                const model = data.model?.toString().trim();
                const capacity = parseInt(data.capacity);

                if (!registration_number || !vehicle_type || !model || isNaN(capacity)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'All fields are required.' } }));
                    return;
                }

                const [drivers] = await pool.execute(
                    `SELECT driver_id FROM driver_profiles WHERE user_id = ?`,
                    [auth.session.userId]
                );

                if (drivers.length === 0) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { code: 'NO_DRIVER_PROFILE', message: 'Driver profile not found.' } }));
                    return;
                }

                const [result] = await pool.execute(
                    `INSERT INTO vehicles (driver_id, registration_number, vehicle_type, model, capacity, approval_status, is_active)
                     VALUES (?, ?, ?, ?, ?, 'pending', TRUE)`,
                    [drivers[0].driver_id, registration_number, vehicle_type, model, capacity]
                );

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    message: 'Vehicle added successfully. Status is pending administrator approval.',
                    vehicle: {
                        vehicle_id: result.insertId,
                        driver_id: drivers[0].driver_id,
                        registration_number,
                        vehicle_type,
                        model,
                        capacity,
                        approval_status: 'pending',
                        is_active: true
                    }
                }));
            } catch (error) {
                console.error('Add vehicle error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not add vehicle.' } }));
            }
        });
        return;
    }


    // Driver: Update vehicle
    const driverUpdateVehicleMatch = req.url.match(/^\/api\/driver\/vehicles\/(\d+)$/);
    if (req.method === 'PUT' && driverUpdateVehicleMatch) {
        const auth = requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const vehicleId = Number(driverUpdateVehicleMatch[1]);
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const [drivers] = await pool.execute(
                    `SELECT driver_id FROM driver_profiles WHERE user_id = ?`,
                    [auth.session.userId]
                );

                if (drivers.length === 0) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { code: 'NO_DRIVER_PROFILE', message: 'Driver profile not found.' } }));
                    return;
                }

                const updates = [];
                const values = [];
                if (data.model) { updates.push('model = ?'); values.push(data.model.toString().trim()); }
                if (data.vehicle_type) { updates.push('vehicle_type = ?'); values.push(data.vehicle_type.toString().trim().toLowerCase()); }
                if (data.capacity) { updates.push('capacity = ?'); values.push(parseInt(data.capacity)); }
                if (data.is_active !== undefined) { updates.push('is_active = ?'); values.push(data.is_active ? 1 : 0); }

                if (updates.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { code: 'NO_CHANGES', message: 'No fields to update.' } }));
                    return;
                }

                values.push(vehicleId, drivers[0].driver_id);
                await pool.execute(
                    `UPDATE vehicles SET ${updates.join(', ')} WHERE vehicle_id = ? AND driver_id = ?`,
                    values
                );

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Vehicle updated successfully.' }));
            } catch (error) {
                console.error('Update vehicle error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not update vehicle.' } }));
            }
        });
        return;
    }


    // Driver: Get earnings
    if (req.method === 'GET' && req.url === '/api/driver/earnings') {
        const auth = requireRole(req, ['driver']);

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
    if (req.method === 'PATCH' && req.url === '/api/driver/availability') {
        const auth = requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const availability_status = data.availability_status?.toString().trim().toLowerCase();

                if (!['available', 'offline'].includes(availability_status)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { code: 'INVALID_STATUS', message: 'Invalid availability status.' } }));
                    return;
                }

                const [drivers] = await pool.execute(
                    `SELECT driver_id FROM driver_profiles WHERE user_id = ?`,
                    [auth.session.userId]
                );

                if (drivers.length === 0) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { code: 'NO_DRIVER_PROFILE', message: 'Driver profile not found.' } }));
                    return;
                }

                await pool.execute(
                    `UPDATE driver_profiles SET availability_status = ? WHERE driver_id = ?`,
                    [availability_status, drivers[0].driver_id]
                );

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: `Availability updated to ${availability_status}.`, availability_status }));
            } catch (error) {
                console.error('Update availability error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not update availability.' } }));
            }
        });
        return;
    }


    // Driver: Reject request
    const driverRejectMatch = req.url.match(/^\/api\/driver\/requests\/(\d+)\/reject$/);
    if (req.method === 'POST' && driverRejectMatch) {
        const auth = requireRole(req, ['driver']);

        if (!auth.ok) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.error }));
            return;
        }

        const requestId = Number(driverRejectMatch[1]);
        try {
            // Just mark as rejected/cancelled - in this system maybe just update
            const [result] = await pool.execute(
                `UPDATE ride_requests SET status = 'cancelled' WHERE request_id = ? AND status = 'requested'`,
                [requestId]
            );

            if (result.affectedRows === 0) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { code: 'CANNOT_REJECT', message: 'Cannot reject this request.' } }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: `Request #${requestId} was rejected.` }));
        } catch (error) {
            console.error('Reject request error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Could not reject request.' } }));
        }
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
