-- CabGo portable database export.
-- Run this file once as a MySQL user that can create databases and tables:
--   mysql -u root -p < database.sql

CREATE DATABASE IF NOT EXISTS cab_booking_system
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE cab_booking_system;

CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('passenger', 'driver', 'admin', 'super_admin')
        NOT NULL DEFAULT 'passenger',
    account_status ENUM('active', 'blocked', 'disabled')
        NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

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
    FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id),
    CHECK (capacity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fare_rules (
    fare_rule_id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_type ENUM('standard', 'sedan', 'suv') NOT NULL UNIQUE,
    base_fare DECIMAL(10,2) NOT NULL DEFAULT 0,
    per_km_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
    per_minute_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CHECK (base_fare >= 0),
    CHECK (per_km_rate >= 0),
    CHECK (per_minute_rate >= 0)
) ENGINE=InnoDB;

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
    CHECK (estimated_fare >= 0),
    INDEX idx_ride_requests_passenger_status (passenger_id, status)
) ENGINE=InnoDB;

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

CREATE TABLE IF NOT EXISTS driver_rejections (
    rejection_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    driver_id INT NOT NULL,
    rejected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (request_id, driver_id),
    FOREIGN KEY (request_id) REFERENCES ride_requests(request_id),
    FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    request_id INT NOT NULL,
    message VARCHAR(255) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (request_id) REFERENCES ride_requests(request_id),
    INDEX idx_notifications_user_read (user_id, is_read, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
    session_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    INDEX idx_user_sessions_user_active (user_id, revoked_at, expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS system_settings (
    setting_id TINYINT PRIMARY KEY,
    platform_name VARCHAR(100) NOT NULL DEFAULT 'CabGo',
    driver_commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    max_search_radius_km DECIMAL(6,2) NOT NULL DEFAULT 15.00,
    support_email VARCHAR(255) NOT NULL DEFAULT 'support@cabgo.local',
    maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
    booking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by INT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_settings_commission CHECK (driver_commission_percentage BETWEEN 0 AND 100),
    CONSTRAINT chk_settings_radius CHECK (max_search_radius_km > 0 AND max_search_radius_km <= 200),
    CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

INSERT INTO system_settings (setting_id)
VALUES (1)
ON DUPLICATE KEY UPDATE setting_id = VALUES(setting_id);

CREATE TABLE IF NOT EXISTS audit_logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_user_id INT NULL,
    action VARCHAR(120) NOT NULL,
    target_type VARCHAR(60) NULL,
    target_id VARCHAR(100) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(user_id),
    INDEX idx_audit_logs_created_at (created_at),
    INDEX idx_audit_logs_actor (actor_user_id)
) ENGINE=InnoDB;

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
