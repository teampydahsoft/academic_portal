-- Timing templates (Academic Portal owned) + timetable plan linkage
-- Safe to re-run: CREATE IF NOT EXISTS + conditional ALTERs in migrate script

CREATE TABLE IF NOT EXISTS ap_timing_templates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  college_id INT NOT NULL,
  academic_year_label VARCHAR(20) NOT NULL,
  semester_number TINYINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  notes TEXT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_timing_scope (college_id, academic_year_label, semester_number, status),
  UNIQUE KEY uq_timing_active_name (college_id, academic_year_label, semester_number, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_timing_template_slots (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  template_id BIGINT UNSIGNED NOT NULL,
  day_of_week ENUM('MON','TUE','WED','THUR','FRI','SAT','SUN') NOT NULL,
  slot_order SMALLINT NOT NULL,
  label VARCHAR(64) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_type ENUM('CLASS','BREAK','LUNCH','ACTIVITY','OTHER') NOT NULL DEFAULT 'CLASS',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_day_order (template_id, day_of_week, slot_order),
  KEY idx_slot_template_day (template_id, day_of_week, is_active),
  CONSTRAINT fk_tts_template FOREIGN KEY (template_id) REFERENCES ap_timing_templates(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
