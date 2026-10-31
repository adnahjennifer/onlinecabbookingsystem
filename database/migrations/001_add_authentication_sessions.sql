-- Authentication migration for existing cab_booking_system databases.
-- Run this file once with an account that can ALTER TABLE and CREATE TABLE.
-- It is safe to run repeatedly and does not delete or reset existing data.

USE cab_booking_system;

SET @account_status_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'account_status'
);

SET @add_account_status_sql := IF(
    @account_status_exists = 0,
    'ALTER TABLE users ADD COLUMN account_status ENUM(''active'', ''blocked'', ''disabled'') NOT NULL DEFAULT ''active'' AFTER role',
    'SELECT 1'
);

PREPARE add_account_status FROM @add_account_status_sql;
EXECUTE add_account_status;
DEALLOCATE PREPARE add_account_status;

DELIMITER //

DROP PROCEDURE IF EXISTS verify_authentication_schema//

CREATE PROCEDURE verify_authentication_schema()
BEGIN
    DECLARE session_table_exists INT DEFAULT 0;
    DECLARE required_columns INT DEFAULT 0;
    DECLARE required_indexes INT DEFAULT 0;
    DECLARE required_foreign_keys INT DEFAULT 0;
    DECLARE session_engine VARCHAR(64);
    DECLARE account_status_compatible INT DEFAULT 0;

    SELECT COUNT(*)
    INTO account_status_compatible
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'account_status'
      AND COLUMN_TYPE = 'enum(''active'',''blocked'',''disabled'')'
      AND IS_NULLABLE = 'NO';

    IF account_status_compatible <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migration stopped: users.account_status has an incompatible definition.';
    END IF;

    SELECT COUNT(*)
    INTO session_table_exists
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_sessions';

    IF session_table_exists = 0 THEN
        CREATE TABLE user_sessions (
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
    ELSE
        SELECT ENGINE
        INTO session_engine
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'user_sessions';

        IF session_engine <> 'InnoDB' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migration stopped: existing user_sessions must use InnoDB.';
        END IF;

        SELECT COUNT(*)
        INTO required_columns
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'user_sessions'
          AND (
              (COLUMN_NAME = 'session_id' AND COLUMN_TYPE = 'bigint' AND IS_NULLABLE = 'NO' AND EXTRA LIKE '%auto_increment%')
              OR (COLUMN_NAME = 'user_id' AND COLUMN_TYPE = 'int' AND IS_NULLABLE = 'NO')
              OR (COLUMN_NAME = 'token_hash' AND COLUMN_TYPE = 'char(64)' AND IS_NULLABLE = 'NO')
              OR (COLUMN_NAME = 'expires_at' AND COLUMN_TYPE = 'datetime' AND IS_NULLABLE = 'NO')
              OR (COLUMN_NAME = 'created_at' AND COLUMN_TYPE = 'timestamp')
              OR (COLUMN_NAME = 'last_seen_at' AND COLUMN_TYPE = 'timestamp')
              OR (COLUMN_NAME = 'revoked_at' AND COLUMN_TYPE = 'datetime' AND IS_NULLABLE = 'YES')
          )
        ;

        IF required_columns <> 7 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migration stopped: existing user_sessions has incompatible or missing columns.';
        END IF;

        SELECT COUNT(*)
        INTO required_indexes
        FROM (
            SELECT
                INDEX_NAME,
                CASE
                    WHEN INDEX_NAME = 'PRIMARY'
                         AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'session_id'
                    THEN 1
                    WHEN NON_UNIQUE = 0
                         AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'token_hash'
                    THEN 1
                    WHEN INDEX_NAME = 'idx_user_sessions_user_active'
                         AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'user_id,revoked_at,expires_at'
                    THEN 1
                    ELSE 0
                END AS matches_required_index
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_sessions'
            GROUP BY INDEX_NAME, NON_UNIQUE
        ) existing_indexes
        WHERE matches_required_index = 1;

        IF required_indexes <> 3 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migration stopped: existing user_sessions has incompatible or missing indexes.';
        END IF;

        SELECT COUNT(*)
        INTO required_foreign_keys
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'user_sessions'
          AND COLUMN_NAME = 'user_id'
          AND REFERENCED_TABLE_NAME = 'users'
          AND REFERENCED_COLUMN_NAME = 'user_id';

        IF required_foreign_keys <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Migration stopped: existing user_sessions lacks the required users foreign key.';
        END IF;
    END IF;
END//

CALL verify_authentication_schema()//
DROP PROCEDURE verify_authentication_schema//

DELIMITER ;

UPDATE users
SET account_status = 'active'
WHERE account_status IS NULL;
