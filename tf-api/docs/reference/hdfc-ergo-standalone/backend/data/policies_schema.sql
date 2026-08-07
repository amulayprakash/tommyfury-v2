-- Stores issued HDFC policies (and the proposal context) in tf_api_dev.
-- Written after a policy is successfully created via /api/hdfc/issue.

CREATE TABLE IF NOT EXISTS hdfc_policies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id       VARCHAR(60),
  status               VARCHAR(20) DEFAULT 'issued',  -- issued / failed

  -- vehicle
  vehicle_type         VARCHAR(20),
  model_code           VARCHAR(20),
  rto_code             VARCHAR(20),
  registration_no      VARCHAR(30),
  engine_number        VARCHAR(50),
  chassis_number       VARCHAR(50),

  -- customer
  customer_name        VARCHAR(150),
  customer_pan         VARCHAR(20),
  customer_mobile      VARCHAR(20),
  customer_email       VARCHAR(120),
  pehchaan_id          VARCHAR(40),

  -- amounts
  idv                  INT,
  net_premium          INT,
  total_premium        INT,

  -- HDFC references
  proposal_number      VARCHAR(60),
  policy_number        VARCHAR(60),
  policy_document      MEDIUMTEXT,

  -- full payloads for audit
  quote_data           JSON,
  proposal_data        JSON,
  issue_response       JSON,

  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_policy_number (policy_number),
  INDEX idx_transaction (transaction_id),
  INDEX idx_pan (customer_pan)
);
