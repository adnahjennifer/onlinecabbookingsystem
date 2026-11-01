# CabGo Backend API

Base URL: `http://localhost:3000`

Authentication uses a persistent, hashed server-side session referenced by the HTTP-only `cab_session` cookie created by `POST /api/login`. Sessions are checked against the current user's role and `account_status` on every protected request. Passenger routes require `passenger`; driver routes require `driver`. A driver must also have an approved profile and, where stated, an approved active matching vehicle. State-changing API requests must include the browser's same-origin `Origin` header.

## Authentication

| Method and URL | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/register` | None | `{ "name": string, "email": string, "password": string }` | `201` with the new passenger | `400` invalid input, `409` duplicate email, `500` database error |
| `POST /api/login` | None | `{ "email": string, "password": string }` | `200` and session cookie | `400` invalid input, `401` invalid credentials, `429` rate limited, `500` database error |
| `GET /api/me` | Logged in | None | `200` current user | `401` invalid or expired session, `500` database error |
| `POST /api/logout` | Optional | None | `200`, clears session cookie | `200` even when already logged out |

## Passenger rides and fares

| Method and URL | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/fare/estimate` | None | `{ "vehicle_type": "standard|sedan|suv", "distance_km": number, "duration_minutes": number }` | `200` calculated fare | `400` invalid input, `404` missing fare rule, `500` database error |
| `POST /api/ride-requests` | Passenger | `{ "pickup_location": string, "drop_location": string, "vehicle_type": string, "distance_km": number, "duration_minutes": number }` | `201` ride request with backend-calculated fare | `400` invalid input/JSON, `401` unauthenticated, `403` wrong role, `404` missing fare rule, `409` active booking exists, `500` database error |
| `GET /api/ride-requests/mine` | Passenger | None | `200` passenger's own requests | `401`, `403`, `500` |
| `POST /api/ride-requests/:request_id/cancel` | Passenger owner | None | `200` cancelled request | `400` invalid ID, `401`, `403`, `404` not owned or not cancellable, `500` |

## Driver workflow

| Method and URL | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/driver/requests` | Approved driver | None | `200` matching available requests and driver's active trip | `401`, `403` unapproved/no profile, `500` |
| `POST /api/driver/requests/:request_id/accept` | Approved driver with matching approved active vehicle | None | `201` creates an accepted trip | `400` invalid ID, `401`, `403`, `409` unavailable/duplicate/no vehicle, `500` |
| `POST /api/driver/requests/:request_id/reject` | Approved driver with matching approved active vehicle | None | `200`; records one rejection and notifies passenger | `400` invalid ID, `401`, `403`, `409` unavailable/duplicate rejection, `500` |
| `POST /api/trips/:trip_id/start` | Owning approved driver | `{ "otp": "123456" }` | `200` trip becomes `started` after OTP verification | `400` invalid ID/JSON/OTP, `401` invalid OTP, `403` not approved, `404` not owned, `409` invalid state, `500` |
| `POST /api/trips/:trip_id/complete` | Owning approved driver | None | `200` completes the trip and creates a pending simulated payment | `400` invalid ID, `401`, `403`, `404`, `409`, `500` |
| `PATCH /api/driver/availability` | Approved driver | `{ "availability_status": "available|offline" }` | `200` updated status | `400` invalid input/JSON, `401`, `403`, `409` active trip, `500` |
| `GET /api/driver/vehicles` | Driver | None | `200` only the logged-in driver's vehicles | `401`, `403`, `500` |
| `POST /api/driver/vehicles` | Driver | `{ "registration_number": string, "vehicle_type": string, "model": string, "capacity": integer }` | `201` pending vehicle | `400` invalid input/JSON, `401`, `403`, `409` duplicate registration, `500` |
| `PUT /api/driver/vehicles/:vehicle_id` | Driver owner | Any of `model`, `vehicle_type`, `capacity`, `is_active` | `200` updated vehicle | `400` invalid ID/input/JSON, `401`, `403`, `404` not owned, `500` |
| `GET /api/driver/earnings` | Driver | None | `200` driver's completed trips and totals | `401`, `403`, `500` |

## Notifications

| Method and URL | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/notifications` | Passenger | None | `200` only that passenger's notifications | `401`, `403`, `500` |
| `PATCH /api/notifications/:notification_id/read` | Passenger owner | None | `200` marks the notification read | `400` invalid ID, `401`, `403`, `404` not owned/not found, `500` |

When a driver rejects a still-requested ride, the ride remains `requested`, a unique `(request_id, driver_id)` rejection is stored, and the passenger receives a notification. Other eligible drivers continue to see the ride.

Each booking receives a server-generated six-digit OTP. The OTP is returned to
the owning passenger in the booking response/status data and must be entered
by the owning approved driver before an accepted trip can become started.

## Simulated payments and driver ratings

| Method and URL | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/payments/pending` | Passenger | None | `200` pending payments for the logged-in passenger, including trip, fare, driver, and payment status | `401`, `403`, `500` |
| `POST /api/payments/:trip_id/pay` | Passenger owner | `{ "payment_method": "upi|card|cash" }` | `200` marks the pending simulated payment as paid and returns the fare/method | `400` invalid ID/JSON/payment method, `401`, `403`, `404` unowned or missing trip/payment, `409` already paid or not payable, `500` |
| `POST /api/trips/:trip_id/rating` | Passenger owner | `{ "rating": 1..5 }` | `201` saves one rating and recalculates `driver_profiles.rating` | `400` invalid ID/rating/JSON, `401`, `403`, `404` unowned trip, `409` unpaid/incomplete/already rated, `500` |

When a driver completes a started trip, the backend saves `final_fare`, marks
the trip completed, and creates exactly one pending row in `payments` inside
the same transaction. The passenger must then confirm a simulated payment using
UPI, card, or cash. No real card numbers, CVVs, UPI PINs, or gateway credentials
are accepted or stored. A passenger may rate only their own completed trip
after its payment is paid, and each trip can be rated once. The driver's
displayed rating is the two-decimal average of `driver_ratings.rating`.

The legacy `POST /api/trips/:trip_id/pay` and
`POST /api/trips/:trip_id/review` paths remain supported for existing callers;
new integrations should use the endpoints above.

Unknown `/api/*` routes return `404`. Malformed JSON and request bodies larger than 1 MB return `400`.
