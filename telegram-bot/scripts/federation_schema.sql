-- Federation System Schema
CREATE TABLE IF NOT EXISTS federations (
    id VARCHAR(50) PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS federation_chats (
    federation_id VARCHAR(50) REFERENCES federations(id) ON DELETE CASCADE,
    chat_id BIGINT NOT NULL,
    PRIMARY KEY (federation_id, chat_id)
);

CREATE TABLE IF NOT EXISTS federation_bans (
    federation_id VARCHAR(50) REFERENCES federations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    reason TEXT,
    banned_by BIGINT,
    banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (federation_id, user_id)
);

CREATE TABLE IF NOT EXISTS federation_admins (
    federation_id VARCHAR(50) REFERENCES federations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    PRIMARY KEY (federation_id, user_id)
);
