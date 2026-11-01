USE cab_booking_system;

SET @payment_status_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'trips'
      AND COLUMN_NAME = 'payment_status'
);
SET @add_payment_status_sql := IF(
    @payment_status_exists = 0,
    'ALTER TABLE trips ADD COLUMN payment_status ENUM(''unpaid'', ''pending'', ''paid'') NOT NULL DEFAULT ''unpaid'', ADD COLUMN paid_at DATETIME NULL',
    'SELECT 1'
);
PREPARE add_payment_status FROM @add_payment_status_sql;
EXECUTE add_payment_status;
DEALLOCATE PREPARE add_payment_status;

CREATE TABLE IF NOT EXISTS payments (
    payment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trip_id INT NOT NULL UNIQUE,
    passenger_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method ENUM('upi', 'card', 'cash') NULL,
    payment_status ENUM('pending', 'paid') NOT NULL DEFAULT 'pending',
    paid_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
    FOREIGN KEY (passenger_id) REFERENCES users(user_id),
    CHECK (amount >= 0),
    INDEX idx_payments_passenger_status (passenger_id, payment_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trip_reviews (
    review_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trip_id INT NOT NULL UNIQUE,
    passenger_id INT NOT NULL,
    driver_id INT NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
    FOREIGN KEY (passenger_id) REFERENCES users(user_id),
    FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id),
    CHECK (rating BETWEEN 1 AND 5),
    INDEX idx_trip_reviews_driver (driver_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driver_ratings (
    rating_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trip_id INT NOT NULL UNIQUE,
    passenger_id INT NOT NULL,
    driver_id INT NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
    FOREIGN KEY (passenger_id) REFERENCES users(user_id),
    FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id),
    CHECK (rating BETWEEN 1 AND 5),
    INDEX idx_driver_ratings_driver (driver_id)
) ENGINE=InnoDB;
