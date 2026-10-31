# Online Cab Booking System (CabGo)

CabGo is a full-stack Online Cab Booking System built as a Web Technology mini-project. It allows passengers to book rides, view dynamic fare estimates across cab categories, track active trips in real time, view driver details, review recent trip history, and receive notification updates.

---

## Prerequisites
- **Node.js** (v18 or higher)
- **MySQL** (v8 or higher)

---

## Setup & Installation

1. **Clone the repository and install dependencies:**
   ```bash
   git clone <repository_url>
   cd onlinecabbookingsystem
   npm install
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the project root with the following configuration:
   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=your_mysql_username
   DB_PASSWORD=your_mysql_password
   DB_NAME=cab_booking_system
   ```

3. **Initialize the Database:**
   Execute `schema.sql` and `seed.sql` in MySQL to initialize tables and standard fare rules:
   ```bash
   mysql -u your_mysql_username -p < database/schema.sql
   mysql -u your_mysql_username -p < database/seed.sql
   ```

4. **Start the Backend Server:**
   ```bash
   node backend/server.js
   ```
   The application and APIs will be running at:
   **`http://localhost:3000`**

   > [!IMPORTANT]
   > **Do not use VS Code Live Server or static web servers.**
   > The Node.js server at `http://localhost:3000` serves both the frontend pages and the backend API endpoints. Always open:
   > **`http://localhost:3000/login.html`** or **`http://localhost:3000/index.html`**

To create an administrator for local testing, provision one after configuring the
database credentials:
```bash
INITIAL_ADMIN_EMAIL=admin@example.com INITIAL_ADMIN_PASSWORD='Demo2026!' \
INITIAL_ADMIN_NAME='CabGo Admin' npm run provision:admin
```

---

## Passenger Portal Features (Member 1)

- **Registration & Authentication:** Secure passenger registration and login with client-side validation, password toggles, and session handling.
- **Cab Search & Dynamic Fare Estimation:** Search for rides between distinct pickup and drop points with real-time rate lookup across categories (`standard`, `sedan`, `suv`), including optional custom route distance (km) and travel duration (minutes).
- **Interactive Booking Confirmation Modal:** Focus-trapped accessible dialog showing ride summary, estimated time, and fare breakdown before confirming.
- **Duplicate Booking Prevention:** Prevents double submissions and blocks creating additional rides while an active booking is in progress.
- **Live Active Booking Tracking:** Real-time status display (`REQUESTED`, `ACCEPTED`, `STARTED`), driver name, star rating, vehicle model, and registration number.
- **Booking Cancellation Dialog:** In-page modal with booking details and one-click cancellation for unassigned requests.
- **Notifications Panel:** Displays real-time alerts (e.g., driver rejections) with unread count badges and click-to-read functionality.
- **Trip History & Account Stats:** Overview statistics (Total, Completed, Active) and historical trips with mobile-responsive card stacking for screens from 320px to desktop.
- **Accessibility & Robust UX:** ARIA live regions (`aria-live="polite"`), visible loading spinners, inline error cards with functional Retry buttons, and strict prevention of XSS via safe DOM APIs.

---

## Passenger API Endpoints Used

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/register` | Creates a new passenger account |
| `POST` | `/api/login` | Authenticates passenger and issues session cookie |
| `GET` | `/api/me` | Validates session and retrieves current user details |
| `POST` | `/api/logout` | Clears active user session |
| `POST` | `/api/fare/estimate` | Calculates estimated fares per vehicle category |
| `POST` | `/api/ride-requests` | Creates a new cab ride request |
| `GET` | `/api/ride-requests/mine` | Retrieves active and completed bookings for the passenger |
| `POST` | `/api/ride-requests/:request_id/cancel` | Cancels an unaccepted ride request |
| `GET` | `/api/notifications` | Retrieves passenger notification alerts |
| `PATCH` | `/api/notifications/:notification_id/read` | Marks a notification as read |

---

## Team Contributions
- **Member 1 (Passenger Frontend):** Designed, built, and polished all passenger-facing pages (`index.html`, `login.html`, `register.html`, `passenger-dashboard.html`), styling (`style.css`), client-side authentication (`auth.js`), notification tracking, ride booking & cancellation workflows, and shared API integration (`api.js`, `passenger.js`).
