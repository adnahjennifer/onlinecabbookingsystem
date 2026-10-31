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

