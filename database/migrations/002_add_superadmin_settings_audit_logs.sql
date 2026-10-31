-- Persistent superadmin settings and audit logs.
-- Execute once against cab_booking_system after reviewing the schema.

USE cab_booking_system;

CREATE TABLE IF NOT EXISTS system_settings (
    setting_id TINYINT PRIMARY KEY,
    platform_name VARCHAR(100) NOT NULL DEFAULT 'CabGo',
    driver_commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    max_search_radius_km DECIMAL(6,2) NOT NULL DEFAULT 15.00,
    support_email VARCHAR(255) NOT NULL DEFAULT '',
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
