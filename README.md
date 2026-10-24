# Online Cab Booking System

## Passenger Auth Frontend (Day 2)

### API Contract Assumed

All authentication endpoints follow JSON request and response formats:

1. **POST `/api/auth/register`**
   - **Request Headers**: `Content-Type: application/json`
   - **Request Body**:
     ```json
     {
       "name": "Jane Doe",
       "email": "jane@example.com",
       "password": "Password123"
     }
     ```
     *(Note: `confirmPassword` is validated client-side and never sent to the server).*
   - **Success Response (201 Created)**:
     ```json
     {
       "success": true,
       "message": "Account created successfully! You can now log in.",
       "user": {
         "id": 1690000000000,
         "name": "Jane Doe",
         "email": "jane@example.com",
         "role": "passenger"
       }
     }
     ```
   - **Error Response (400 / 409 / 500)**:
     ```json
     {
       "success": false,
       "message": "Email is already registered.",
       "errors": {
         "email": "Email already registered"
       }
     }
     ```

2. **POST `/api/auth/login`**
   - **Request Headers**: `Content-Type: application/json`
   - **Request Body**:
     ```json
     {
       "email": "jane@example.com",
       "password": "Password123"
     }
     ```
   - **Success Response (200 OK)**:
     ```json
     {
       "success": true,
       "message": "Login successful.",
       "token": "mock-jwt-token-1690000000000",
       "user": {
         "id": 1,
         "name": "Alex",
         "email": "alex@example.com",
         "role": "passenger"
       }
     }
     ```
   - **Error Response (401 / 400 / 500)**:
     ```json
     {
       "success": false,
       "message": "Invalid email or password."
     }
     ```

### How to Switch Mock / Live API

In [`public/js/api.js`](public/js/api.js):
```javascript
const API_CONFIG = {
    USE_MOCK: true, // Set to false to connect to the backend server
    BASE_URL: "",   // Set backend URL (e.g. "http://localhost:3000" or relative "")
    ENDPOINTS: {
        register: "/api/auth/register",
        login: "/api/auth/login"
    }
};
```
- When `USE_MOCK: true`: Client simulates ~600ms network delay and maintains test users in `localStorage` (`"mockUsers"`).
- When `USE_MOCK: false`: Standard `fetch` calls are dispatched to `BASE_URL + ENDPOINTS` with session bearer tokens and error handling.

### Mock Test Credentials & Test Cases

- **Existing Demo Account**:
  - Email: `alex@example.com`
  - Password: `Password123`
  - Role: `passenger`
- **Taken Email Test**:
  - `taken@example.com` (triggers 409 Conflict with inline error)
- **New Account Registration**:
  - Any valid name (2–60 chars, letters/spaces/.'-), valid email, and strong password (min 8 chars, 1+ letter, 1+ number).
  - Automatically saved to `localStorage` mock store and immediately usable for login.
- **Wrong Password / Invalid Login**:
  - Any unmatched email/password yields 401 "Invalid email or password." without revealing email existence.
- **Offline / Server Unreachable Test**:
  - Set `API_CONFIG.USE_MOCK = false` with no server running to verify friendly offline error: *"Cannot reach the server. Check your connection and try again."*
