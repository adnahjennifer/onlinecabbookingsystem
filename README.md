# Online Cab Booking System


Driver, Admin, and Super Admin dashboard layout prototypes for the Online Cab Booking System.

## Technology
- HTML5
- CSS3
- Vanilla JavaScript and DOM events
- No frontend frameworks

## Run locally
1. Open this folder in VS Code.
2. Use the VS Code Live Server extension, or from the project root run `python3 -m http.server 5500`.
3. Open:
   - `http://localhost:5500/public/driver/dashboard.html`
   - `http://localhost:5500/public/admin/dashboard.html`
   - `http://localhost:5500/public/superadmin/dashboard.html`

If using Python's server, stop it with `Ctrl+C` in the terminal.

## What works today
- Three responsive dashboard layouts with fictional sample data.
- Driver availability button toggles a demo state.
- Request/admin/super-admin action buttons show demo messages.
- Shared CSS and JavaScript reduce duplicate code.

## Not implemented yet
No authentication, database, API calls, authorization, or persistent changes are implemented. Buttons are UI previews only. Coordinate API endpoint names and JSON contracts with Member 2 before integrating Fetch calls.

## Ownership
Member 3 — Driver + Administration (Day 1 layout prototype).
