# CabGo Online Cab Booking System

CabGo is a local full-stack cab booking application. The Node.js backend serves
the HTML, CSS, JavaScript, and JSON API from one local server; no deployment or
hosting service is required.

## What is included

- Passenger registration, login, fare estimates, ride booking, cancellation,
  notifications, active-trip tracking, and trip history.
- Driver login, vehicle management, availability, ride acceptance/rejection,
  trip start/completion, and earnings.
- Admin management of drivers, passengers, vehicles, fares, and trips.
- Super-admin management of administrators, settings, and audit logs.

## Prerequisites

Install the following software on the computer running CabGo:

- Node.js 18 or newer (Node.js 20 or 22 LTS is recommended)
- npm (included with Node.js)
- MySQL 8.0 or newer (MySQL 5.7 may work, but MySQL 8 is recommended)
- Git

Check the installations:

```bash
node --version
npm --version
mysql --version
```

## Installation

Clone the repository and install the Node.js dependencies:

```bash
git clone https://github.com/adnahjennifer/onlinecabbookingsystem.git
cd onlinecabbookingsystem
npm install
```

Create a local MySQL database and import the complete portable export. The
following command asks for the MySQL administrator password:

```bash
mysql -u root -p < database.sql
```

The export creates the `cab_booking_system` database, all tables, foreign keys,
indexes, default settings, and the three initial fare rules. It is safe to run
again on the same local database; it does not delete existing records.

If the MySQL `root` account cannot log in from the terminal, create a local
application user first in the MySQL client:

```sql
CREATE USER 'cabgo_user'@'localhost' IDENTIFIED BY 'choose-a-local-password';
GRANT ALL PRIVILEGES ON cab_booking_system.* TO 'cabgo_user'@'localhost';
FLUSH PRIVILEGES;
```

## Environment configuration

Copy the example file and edit the database values:

```bash
cp .env.example .env
```

At minimum, set these values in `.env`:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=cabgo_user
DB_PASSWORD=choose-a-local-password
DB_NAME=cab_booking_system
PORT=3000
```

`.env` is ignored by Git. Never commit database passwords, API keys, or other
local secrets. The optional routing and geocoding variables in
`.env.example` can be left at their defaults.

Verify the database credentials before starting the server:

```bash
npm run db:check
```

## Start CabGo

The backend also serves the frontend, so only one terminal is required:

```bash
npm start
```

Open [http://localhost:3000/](http://localhost:3000/) in a browser. The
application pages and API use the same origin; do not use VS Code Live Server
or another static web server.

To use another port, set `PORT` in `.env` and open the matching URL.

## Create an admin account

Passenger registration creates passenger accounts only. Create the first local
administrator with values supplied in the command environment:

```bash
INITIAL_ADMIN_EMAIL=admin@example.com \
INITIAL_ADMIN_PASSWORD='choose-a-password-8-chars-minimum' \
INITIAL_ADMIN_NAME='CabGo Admin' \
npm run provision:admin
```

Use the email and password you chose at the normal login page. This command
does not print or store the password in the repository. A super-admin account
must be created through the existing administrative workflow after an
authorized account is available.

## Access by role

- Passenger: open `http://localhost:3000/register.html` to register, then use
  `http://localhost:3000/login.html`.
- Driver: use `http://localhost:3000/driver/login.html`. A driver profile and
  vehicle must be approved by an admin before accepting rides.
- Admin: log in through `http://localhost:3000/login.html` with the account
  created by `npm run provision:admin`, then use the admin dashboard.
- Super-admin: use the existing super-admin account or create one through the
  authorized admin workflow; do not hardcode credentials in source files.

## Tests and checks

Run the automated validation tests:

```bash
npm test
```

Run the database connectivity check:

```bash
npm run db:check
```

With `npm start` running, verify the browser pages at the local URL and test
registration/login, a fare estimate, passenger booking/cancellation, and the
existing driver/admin workflows using local accounts. Driver rides require
admin approval, so that workflow is intentionally multi-step.

## Troubleshooting

### `ECONNREFUSED` or `Can't connect to MySQL`

Start the local MySQL service, confirm `mysql --version`, and check `DB_HOST`,
`DB_PORT`, `DB_USER`, and `DB_PASSWORD` in `.env`. Then rerun:

```bash
npm run db:check
```

### `Unknown database 'cab_booking_system'` or missing tables

Run the complete export from the repository root:

```bash
mysql -u root -p < database.sql
```

Do not import only a migration file into a fresh installation.

### `EADDRINUSE: address already in use`

Another process is using port 3000. Stop that process, or set a different
`PORT` in `.env` and use the corresponding browser URL.

### `npm install` fails while compiling `bcrypt`

Install the current Node.js LTS release and the platform build tools required
by your operating system, then run `npm install` again. Do not copy
`node_modules` from another computer.

### The browser shows a database error

Confirm that `npm run db:check` succeeds, that the server was restarted after
editing `.env`, and that the browser is using the same port printed by
`npm start`.

## Project layout

- `backend/server.js` - HTTP server, static-file server, and API routes
- `backend/db.js` - environment-based MySQL connection pool
- `public/` - passenger, driver, admin, and super-admin frontend pages
- `database.sql` - complete portable schema and seed export
- `database/` - source schema, seed, and historical migrations
- `test/` - automated Node.js tests
