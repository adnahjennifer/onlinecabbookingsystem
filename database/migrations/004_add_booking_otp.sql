USE cab_booking_system;

SET @otp_code_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ride_requests'
      AND COLUMN_NAME = 'otp_code'
);

SET @add_otp_columns_sql := IF(
    @otp_code_exists = 0,
    'ALTER TABLE ride_requests ADD COLUMN otp_code CHAR(6) NULL AFTER estimated_fare, ADD COLUMN otp_verified_at DATETIME NULL AFTER otp_code',
    'SELECT 1'
);

PREPARE add_otp_columns FROM @add_otp_columns_sql;
EXECUTE add_otp_columns;
DEALLOCATE PREPARE add_otp_columns;

UPDATE ride_requests
SET otp_code = LPAD(FLOOR(100000 + RAND() * 900000), 6, '0')
WHERE otp_code IS NULL OR otp_code = '';

ALTER TABLE ride_requests
    MODIFY COLUMN otp_code CHAR(6) NOT NULL;
