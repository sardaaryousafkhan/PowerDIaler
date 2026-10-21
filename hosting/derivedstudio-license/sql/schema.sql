-- DashDialer license store (MySQL on Namecheap)
-- Run once in phpMyAdmin or mysql CLI.

CREATE TABLE IF NOT EXISTS dd_licenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  key_hash CHAR(64) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  customer_label VARCHAR(160) NOT NULL DEFAULT '',
  status ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  max_machines INT UNSIGNED NOT NULL DEFAULT 2,
  expires_at DATETIME NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dd_licenses_key_hash (key_hash),
  KEY idx_dd_licenses_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dd_license_machines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  license_id BIGINT UNSIGNED NOT NULL,
  machine_id VARCHAR(64) NOT NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dd_machine (license_id, machine_id),
  CONSTRAINT fk_dd_machine_license FOREIGN KEY (license_id) REFERENCES dd_licenses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dd_license_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  license_id BIGINT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  detail TEXT NULL,
  actor VARCHAR(80) NOT NULL DEFAULT 'admin',
  ip VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dd_audit_license (license_id),
  KEY idx_dd_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
