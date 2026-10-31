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
| `POST /api/trips/:trip_id/start` | Owning approved driver | None | `200` trip becomes `started` | `400` invalid ID, `401`, `403`, `404` not owned, `409` invalid state, `500` |
| `POST /api/trips/:trip_id/complete` | Owning approved driver | Optional `{ "final_fare": number }` | `200` trip becomes `completed` | `400` invalid ID/JSON/fare, `401`, `403`, `404`, `409`, `500` |
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

Unknown `/api/*` routes return `404`. Malformed JSON and request bodies larger than 1 MB return `400`.
