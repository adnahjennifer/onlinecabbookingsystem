
-- Online Cab Booking System
-- Shared database schema
-- Database: cab_booking_system

USE cab_booking_system;

-- 1. All system users
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('passenger', 'driver', 'admin', 'super_admin')
        NOT NULL DEFAULT 'passenger',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Driver-specific information
CREATE TABLE IF NOT EXISTS driver_profiles (
    driver_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    license_number VARCHAR(100) NOT NULL UNIQUE,
    license_expiry DATE NOT NULL,
    verification_status ENUM('pending', 'approved', 'rejected')
        NOT NULL DEFAULT 'pending',
    availability_status ENUM('offline', 'available', 'on_trip')
        NOT NULL DEFAULT 'offline',
    rating DECIMAL(3,2) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5))
) ENGINE=InnoDB;

-- 3. Vehicles; a driver may own multiple vehicles
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
    driver_id INT NOT NULL,
    registration_number VARCHAR(30) NOT NULL UNIQUE,
    vehicle_type ENUM('standard', 'sedan', 'suv') NOT NULL,
    model VARCHAR(100) NOT NULL,
    capacity INT NOT NULL DEFAULT 4,
    approval_status ENUM('pending', 'approved', 'rejected')
        NOT NULL DEFAULT 'pending',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id)
        REFERENCES driver_profiles(driver_id),
    CHECK (capacity > 0)
) ENGINE=InnoDB;

-- 4. Fare rules
CREATE TABLE IF NOT EXISTS fare_rules (
    fare_rule_id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_type ENUM('standard', 'sedan', 'suv') NOT NULL UNIQUE,
    base_fare DECIMAL(10,2) NOT NULL DEFAULT 0,
    per_km_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
    per_minute_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CHECK (base_fare >= 0),
    CHECK (per_km_rate >= 0),
    CHECK (per_minute_rate >= 0)
) ENGINE=InnoDB;

-- 5. Passenger ride requests
CREATE TABLE IF NOT EXISTS ride_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    passenger_id INT NOT NULL,
    pickup_location VARCHAR(255) NOT NULL,
    drop_location VARCHAR(255) NOT NULL,
    vehicle_type ENUM('standard', 'sedan', 'suv') NOT NULL,
    estimated_fare DECIMAL(10,2) NOT NULL,
    status ENUM('requested', 'accepted', 'started', 'completed', 'cancelled')
        NOT NULL DEFAULT 'requested',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (passenger_id) REFERENCES users(user_id),
    CHECK (estimated_fare >= 0)
) ENGINE=InnoDB;

-- 6. Trips created when a driver accepts a request
CREATE TABLE IF NOT EXISTS trips (
    trip_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL UNIQUE,
    driver_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    status ENUM('accepted', 'started', 'completed', 'cancelled')
        NOT NULL DEFAULT 'accepted',
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    final_fare DECIMAL(10,2) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES ride_requests(request_id),
    FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id),
    CHECK (final_fare IS NULL OR final_fare >= 0)
) ENGINE=InnoDB;

-- 7. Driver rejections for passenger ride requests
CREATE TABLE IF NOT EXISTS driver_rejections (
    rejection_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    driver_id INT NOT NULL,
    rejected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (request_id, driver_id),

    FOREIGN KEY (request_id)
        REFERENCES ride_requests(request_id),

    FOREIGN KEY (driver_id)
        REFERENCES driver_profiles(driver_id)
) ENGINE=InnoDB;

-- 8. Notifications for passengers
CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    request_id INT NOT NULL,
    message VARCHAR(255) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(user_id),

    FOREIGN KEY (request_id)
        REFERENCES ride_requests(request_id)
) ENGINE=InnoDB;