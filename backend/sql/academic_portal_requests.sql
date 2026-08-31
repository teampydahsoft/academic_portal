-- Request workflow foundation (configuration-driven approval routing)

CREATE TABLE IF NOT EXISTS ap_request_types (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  type_key VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_request_type_key (type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_request_workflows (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  request_type_id INT UNSIGNED NOT NULL,
  workflow_key VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_request_workflow (request_type_id, workflow_key),
  CONSTRAINT fk_rw_type FOREIGN KEY (request_type_id) REFERENCES ap_request_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_request_workflow_steps (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  workflow_id INT UNSIGNED NOT NULL,
  step_order INT NOT NULL,
  step_key VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  approver_role_key VARCHAR(64) NULL,
  required_permission VARCHAR(100) NULL,
  scope_mode ENUM('requester_scope','same_college','same_branch','global') NOT NULL DEFAULT 'requester_scope',
  allow_escalate TINYINT(1) NOT NULL DEFAULT 0,
  is_final TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_workflow_step_order (workflow_id, step_order),
  UNIQUE KEY uq_workflow_step_key (workflow_id, step_key),
  CONSTRAINT fk_rws_workflow FOREIGN KEY (workflow_id) REFERENCES ap_request_workflows(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  request_type_id INT UNSIGNED NOT NULL,
  workflow_id INT UNSIGNED NOT NULL,
  requester_user_id BIGINT UNSIGNED NOT NULL,
  college_id INT NULL,
  branch_id INT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  status ENUM(
    'draft',
    'submitted',
    'pending_approval',
    'approved',
    'rejected',
    'returned',
    'cancelled'
  ) NOT NULL DEFAULT 'draft',
  current_step_id INT UNSIGNED NULL,
  current_step_order INT NULL,
  submitted_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_requests_requester (requester_user_id, status),
  KEY idx_requests_scope (college_id, branch_id, status),
  KEY idx_requests_pending (status, current_step_id),
  CONSTRAINT fk_req_type FOREIGN KEY (request_type_id) REFERENCES ap_request_types(id),
  CONSTRAINT fk_req_workflow FOREIGN KEY (workflow_id) REFERENCES ap_request_workflows(id),
  CONSTRAINT fk_req_requester FOREIGN KEY (requester_user_id) REFERENCES ap_users(id),
  CONSTRAINT fk_req_step FOREIGN KEY (current_step_id) REFERENCES ap_request_workflow_steps(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_request_actions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(50) NULL,
  to_status VARCHAR(50) NULL,
  step_id INT UNSIGNED NULL,
  step_order INT NULL,
  comment TEXT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_request_actions_request (request_id, created_at),
  CONSTRAINT fk_ra_request FOREIGN KEY (request_id) REFERENCES ap_requests(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
