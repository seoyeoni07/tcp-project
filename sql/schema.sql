CREATE DATABASE IF NOT EXISTS unistudyhub
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE unistudyhub;

-- 사용자(user) 정보 테이블
CREATE TABLE IF NOT EXISTS users (
  user_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_name  VARCHAR(50)  NOT NULL,
  email      VARCHAR(100) NOT NULL,
  password   VARCHAR(255) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role       ENUM('user','admin') DEFAULT 'user',
  PRIMARY KEY (user_id),
  UNIQUE KEY email (email)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- 게시판 글(boards)
-- 일반 게시글 + 공지
CREATE TABLE IF NOT EXISTS boards (
  post_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  title       VARCHAR(200) NOT NULL,
  content     TEXT         NOT NULL,
  is_notice   TINYINT(1)   NOT NULL DEFAULT 0,
  view_count  INT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id),
  KEY fk_boards_user (user_id),
  CONSTRAINT fk_boards_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- 게시판 댓글(comments)
-- 게시글(post_id)에 달린 댓글
CREATE TABLE IF NOT EXISTS comments (
  comment_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  content    TEXT         NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id),
  KEY fk_comments_post (post_id),
  KEY fk_comments_user (user_id),
  CONSTRAINT fk_comments_post
    FOREIGN KEY (post_id) REFERENCES boards(post_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_comments_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- 업무일지(worklogs)
-- 업무일지 저장
CREATE TABLE IF NOT EXISTS worklogs (
  log_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  title      VARCHAR(200) NOT NULL,
  content    TEXT         NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (log_id),
  KEY worklogs_user (user_id),
  CONSTRAINT worklogs_ibfk_1
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_general_ci;

-- 회의실 정보(meeting_rooms)
-- 
CREATE TABLE IF NOT EXISTS meeting_rooms (
  room_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_name VARCHAR(100) NOT NULL,
  capacity  INT UNSIGNED DEFAULT 4,
  PRIMARY KEY (room_id),
  UNIQUE KEY room_name (room_name)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- 회의실 예약(meeting_reservations)
-- 회의실 예약 정보
CREATE TABLE IF NOT EXISTS meeting_reservations (
  reservation_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  room_id        INT UNSIGNED NOT NULL,
  start_time     DATETIME     NOT NULL,
  end_time       DATETIME     NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reservation_id),
  KEY mr_user (user_id),
  KEY mr_room (room_id),
  CONSTRAINT meeting_reservations_ibfk_1
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT meeting_reservations_ibfk_2
    FOREIGN KEY (room_id) REFERENCES meeting_rooms(room_id)
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- 채팅방(chat_rooms)
-- 1:1 / 그룹 여부
CREATE TABLE IF NOT EXISTS chat_rooms (
  room_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_name  VARCHAR(100) NOT NULL,
  is_group   TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id),
  UNIQUE KEY room_name (room_name),
  KEY fk_chat_rooms_created_by (created_by),
  CONSTRAINT fk_chat_rooms_created_by
    FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- 채팅방 참여자(chat_participants)
-- 어떤 사용자가 어떤 채팅방에 속하는지
CREATE TABLE IF NOT EXISTS chat_participants (
  participant_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id        INT UNSIGNED NOT NULL,
  user_id        INT UNSIGNED NOT NULL,
  PRIMARY KEY (participant_id),
  KEY cp_room (room_id),
  KEY cp_user (user_id),
  CONSTRAINT chat_participants_ibfk_1
    FOREIGN KEY (room_id) REFERENCES chat_rooms(room_id)
    ON DELETE CASCADE,
  CONSTRAINT chat_participants_ibfk_2
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- 채팅 메시지(messages)
-- 채팅 메시지 내용 저장
CREATE TABLE IF NOT EXISTS messages (
  message_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  room_id    INT UNSIGNED NOT NULL DEFAULT 1,
  content    TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id),
  KEY user_id (user_id),
  KEY fk_messages_room (room_id),
  CONSTRAINT fk_messages_room
    FOREIGN KEY (room_id) REFERENCES chat_rooms(room_id)
    ON DELETE CASCADE,
  CONSTRAINT messages_ibfk_1
    FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_general_ci;