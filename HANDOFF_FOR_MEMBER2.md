# Backend & Database Handoff for Member 2

This document details required backend and database adjustments to ensure full end-to-end integration with the passenger frontend.

---

### 1. Database Creation in `database/schema.sql`
- **Location:** `database/schema.sql` (Line 1)
- **Problem:** Currently `schema.sql` starts directly with `USE cab_booking_system;`. On a clean database installation, this throws an error (`Unknown database 'cab_booking_system'`) if the database has not been manually created beforehand.
- **Requested Change:** Add at the very beginning of `schema.sql`:
  ```sql
  CREATE DATABASE IF NOT EXISTS cab_booking_system;
  USE cab_booking_system;
  ```

---

### 2. Fare Rules Seeding (`database/seed.sql`)
- **Location:** `database/seed.sql`
- **Problem:** Without initial active fare rules, any call to `POST /api/fare/estimate` or `POST /api/ride-requests` returns `HTTP 404 FARE_RULE_NOT_FOUND`.
- **Action Taken / Requested:** `database/seed.sql` has been provided with active rates for `standard`, `sedan`, and `suv`. Please ensure instructions reflect running `seed.sql` directly after `schema.sql`:
  ```sql
  USE cab_booking_system;

  INSERT INTO fare_rules (vehicle_type, base_fare, per_km_rate, per_minute_rate, is_active)
  VALUES 
      ('standard', 50, 12, 1, TRUE),
      ('sedan', 80, 15, 1.5, TRUE),
      ('suv', 120, 20, 2, TRUE)
  ON DUPLICATE KEY UPDATE 
      base_fare = VALUES(base_fare),
      per_km_rate = VALUES(per_km_rate),
      per_minute_rate = VALUES(per_minute_rate),
      is_active = VALUES(is_active);
  ```

---

### 3. Join Driver and Vehicle Details in `GET /api/ride-requests/mine`
- **Location:** `backend/server.js` (`GET /api/ride-requests/mine`)
- **Problem:** Currently, `GET /api/ride-requests/mine` only queries the `ride_requests` table:
  ```sql
  SELECT request_id, pickup_location, drop_location, vehicle_type, estimated_fare, status, created_at
  FROM ride_requests WHERE passenger_id = ? ORDER BY created_at DESC
  ```
  It does not return the accepted trip's driver or vehicle information. As a result, when a driver accepts a passenger's request, the passenger dashboard cannot show the driver's name, rating, or vehicle registration.
- **Requested Change:** Use `LEFT JOIN` on `trips`, `driver_profiles`, `users`, and `vehicles` to include:
  - `trip_id`, `started_at`, `completed_at`, `final_fare`
  - `driver`: `{ full_name, rating }` (or `null` if unaccepted)
  - `vehicle`: `{ model, registration_number, vehicle_type }` (or `null` if unaccepted)
  The frontend UI is already built to render these nested objects.

---

### 4. Backend Duplicate Booking Prevention in `POST /api/ride-requests`
- **Location:** `backend/server.js` (`POST /api/ride-requests`)
- **Problem:** The backend currently allows a passenger to insert multiple simultaneous ride requests.
- **Requested Change:** Add a validation check in `POST /api/ride-requests` before inserting:
  Check if the passenger already has a request with `status IN ('requested', 'accepted', 'started')`.
  If found, reject with:
  - **HTTP Status:** `409 Conflict`
  - **JSON Response:**
    ```json
    {
      "error": {
        "code": "ACTIVE_BOOKING_EXISTS",
        "message": "You already have an active booking. Please complete or cancel it before booking another ride."
      }
    }
    ```

---

### 5. Forward `GET /` to `public/index.html`
- **Location:** `backend/server.js` (lines 144–150)
- **Problem:** Currently, visiting the root URL `http://localhost:3000/` responds with a JSON message (`{"message":"Online Cab Booking System API is running!"}`), completely hiding `public/index.html`. Users must manually type `http://localhost:3000/index.html` or `login.html`.
- **Requested Change:** Remove the hardcoded `GET /` JSON route (or relocate it to a health check route like `GET /api/health`), allowing the static file server at the bottom of `server.js` to serve `public/index.html` when visiting `/`.

---

### 6. Support Optional `distance_km` and `duration_minutes` in `POST /api/ride-requests`
- **Location:** `backend/server.js` (`POST /api/ride-requests`)
- **Problem:** Currently `POST /api/ride-requests` ignores user-provided route distances and calculates `estimated_fare` using hardcoded dummy constants (`10 km` and `20 mins`). This causes the estimated fare stored in the database to differ from the fare estimated on `POST /api/fare/estimate` when custom distance/time are provided.
- **Requested Change:** Accept optional `distance_km` (number) and `duration_minutes` (number) in the request body of `POST /api/ride-requests`, validate them, and calculate `estimated_fare` with those values (falling back to 10 km / 20 mins if omitted).

