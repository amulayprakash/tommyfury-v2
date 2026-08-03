-- HDFC ERGO Private Car integration — persistence schema (tf_api_dev)
-- Tracks each quote-to-policy transaction and the HDFC step responses.
-- Replace the uatSeed.js lookups with the *_master tables below in production.

CREATE DATABASE IF NOT EXISTS tf_api_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tf_api_dev;

-- ---- Master lookups (load from HDFC master files) ----

-- Product codes per line of business (mirrors data/productMaster.js).
-- Fill two_wheeler / commercial codes once received from HDFC.
CREATE TABLE IF NOT EXISTS product_master (
  lob          VARCHAR(16) NOT NULL,            -- pvtcar / twowheeler / commercial
  sub_type     VARCHAR(8)  NOT NULL DEFAULT '', -- '' | gcv | pcv
  label        VARCHAR(60),
  product_code VARCHAR(10),                     -- HDFC PRODUCT_CODE header value
  req_block    VARCHAR(16),                     -- Req_PvtCar / Req_TW / Req_GCV / Req_PCV
  is_active    TINYINT(1) DEFAULT 0,
  PRIMARY KEY (lob, sub_type)
);

INSERT INTO product_master (lob, sub_type, label, product_code, req_block, is_active) VALUES
  ('pvtcar',     '',    'Private Car',               '2311', 'Req_PvtCar', 1),
  ('twowheeler', '',    'Two Wheeler',               NULL,   'Req_TW',     0),
  ('commercial', 'gcv', 'Goods Carrying Vehicle',    NULL,   'Req_GCV',    0),
  ('commercial', 'pcv', 'Passenger Carrying Vehicle',NULL,   'Req_PCV',    0)
ON DUPLICATE KEY UPDATE label = VALUES(label);

CREATE TABLE IF NOT EXISTS model_master (
  vehicle_model_code   VARCHAR(12) NOT NULL,
  manufacturer         VARCHAR(120),
  vehicle_model        VARCHAR(120),
  number_of_wheels     TINYINT,
  cubic_capacity       INT,
  gross_vehicle_weight INT,
  seating_capacity     TINYINT,
  carrying_capacity    INT,
  fuel_type            VARCHAR(20),
  variant              VARCHAR(160),
  PRIMARY KEY (vehicle_model_code, variant(60)),
  KEY idx_mm_fuel (fuel_type),
  KEY idx_mm_mfr (manufacturer)
);

CREATE TABLE IF NOT EXISTS rto_master (
  rto_code        VARCHAR(12) PRIMARY KEY,
  registration_state_city VARCHAR(120),
  vehicle_class_code VARCHAR(12),
  state_sub_name  VARCHAR(20),
  state_id        INT
);

CREATE TABLE IF NOT EXISTS pincode_master (
  pincode         VARCHAR(10),
  state_cd        INT,
  citydistrict_cd INT,
  pincode_locality VARCHAR(120),
  KEY idx_pin (pincode)
);

-- ---- Transaction lifecycle ----
CREATE TABLE IF NOT EXISTS quotes (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  transaction_id  VARCHAR(40) NOT NULL UNIQUE,
  vehicle_type    VARCHAR(24) NOT NULL,           -- four_wheeler / ev / new_vehicle / two_wheeler / commercial
  lob             VARCHAR(16) NOT NULL,           -- pvtcar / twowheeler / commercial
  business_type   VARCHAR(24),                    -- New Vehicle / Used Vehicle / Rollover
  product_code    VARCHAR(10),                    -- 2311 for pvt car
  model_code      VARCHAR(12),
  rto_code        VARCHAR(12),
  fuel_type       VARCHAR(20),
  policy_type     VARCHAR(24),
  tenure          TINYINT,
  idv             DECIMAL(14,2),
  net_premium     DECIMAL(14,2),
  tax             DECIMAL(14,2),
  total_premium   DECIMAL(14,2),
  request_json    JSON,
  premium_json    JSON,
  status          VARCHAR(24) DEFAULT 'quoted',   -- quoted / proposed / paid / issued / failed
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_q_status (status),
  KEY idx_q_created (created_at)
);

CREATE TABLE IF NOT EXISTS proposals (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  quote_id        BIGINT,
  transaction_id  VARCHAR(40),
  proposal_number VARCHAR(40) UNIQUE,
  customer_json   JSON,
  proposal_json   JSON,
  document_json   JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prop_quote FOREIGN KEY (quote_id) REFERENCES quotes(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  proposal_id     BIGINT,
  transaction_id  VARCHAR(40),
  proposal_number VARCHAR(40),
  amount          DECIMAL(14,2),
  payment_mode_cd VARCHAR(8),
  instrument_number VARCHAR(40),
  payment_date    DATE,
  response_json   JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_prop FOREIGN KEY (proposal_id) REFERENCES proposals(id)
);

CREATE TABLE IF NOT EXISTS policies (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  proposal_id     BIGINT,
  transaction_id  VARCHAR(40),
  policy_number   VARCHAR(40) UNIQUE,
  policy_start    DATE,
  policy_end      DATE,
  document_json   JSON,
  issued_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pol_prop FOREIGN KEY (proposal_id) REFERENCES proposals(id)
);

-- Audit trail of every HDFC API call (debugging + reconciliation).
CREATE TABLE IF NOT EXISTS hdfc_api_log (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  transaction_id  VARCHAR(40),
  step            VARCHAR(32),        -- authenticate / getCalculateIDV / ...
  request_json    JSON,
  response_json   JSON,
  status_code     VARCHAR(16),
  error_text      TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_log_txn (transaction_id),
  KEY idx_log_step (step)
);
