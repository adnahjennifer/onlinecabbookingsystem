# CabGo – Online Cab Booking System

<p align="center">
  **Web Technologies Mini Project**
  <br/>
  A full-stack cab booking platform for passengers, drivers and administrators.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20JavaScript-orange?style=flat-square"/>
  <img src="https://img.shields.io/badge/Backend-Node.js-green?style=flat-square"/>
  <img src="https://img.shields.io/badge/Database-MySQL-blue?style=flat-square"/>
  <img src="https://img.shields.io/badge/Maps-Leaflet-purple?style=flat-square"/>
</p>

<p align="center">
  <a href="https://drive.google.com/file/d/1MAFrR4oR8iN9IoRXBoxDCIN1tmR7KDEe/view">View Project Demo</a>
</p>

---

## Overview

CabGo is a full-stack online cab booking system that simplifies ride booking and management through a centralized platform. It supports passenger bookings, driver operations and administrative management.

## Features

- **Passenger:** Registration, cab booking, fare estimation, route visualization and booking history.
- **Driver:** Ride requests, vehicle management and trip handling.
- **Admin:** Passenger, driver, vehicle, fare and trip management.
- **Super Admin:** Administrative account management.

## Tech Stack

HTML5 · CSS3 · JavaScript · Node.js · Express.js · MySQL · Leaflet

## Installation & Setup

### Prerequisites

Install [Node.js](https://nodejs.org/), [MySQL Server](https://dev.mysql.com/downloads/mysql/) and [Git](https://git-scm.com/).

### 1. Clone the Repository

```bash
git clone https://github.com/adnahjennifer/onlinecabbookingsystem.git
cd onlinecabbookingsystem
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure the Database

Start MySQL and create the database:

```sql
CREATE DATABASE cab_booking_system;
```

Import and execute `database/schema.sql` using MySQL Workbench.

If required, execute the migration in `database/migrations/`.

### 4. Configure Environment Variables

Create a `.env` file in the project root using `.env.example` as a reference.

Configure your local MySQL credentials and application settings. For example:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=cab_booking_system
PORT=3000
```

Ensure the variable names match the project's actual configuration. Do not upload `.env` to GitHub.

### 5. Run the Application

```bash
node backend/server.js
```

Open your browser and visit:

`http://localhost:3000`

## Notes

- Each user must configure their own MySQL database and environment variables.
- Node.js dependencies must be installed locally.
- CabGo currently runs locally and is not publicly deployed.
- Public access requires separate application and database deployment.

## Project Information

| | |
|---|---|
| Project | CabGo – Online Cab Booking System |
| Category | Web Technologies Mini Project |
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express.js |
| Database | MySQL |
| Repository | [GitHub](https://github.com/adnahjennifer/onlinecabbookingsystem) |
| Demo | [Google Drive](https://drive.google.com/file/d/1MAFrR4oR8iN9IoRXBoxDCIN1tmR7KDEe/view) |

---

<p align="center">
  **CabGo** — Your Journey. Your Destination. One Platform.
</p>
