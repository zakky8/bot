-- Upgraded Bot System Database Initialization
-- PostgreSQL 14+

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    is_bot BOOLEAN DEFAULT FALSE,
    language_code VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chats table
CREATE TABLE IF NOT EXISTS guilds (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    name VARCHAR(255),
    type VARCHAR(50),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Moderation logs
CREATE TABLE IF NOT EXISTS moderation_logs (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(id),
    moderator_id BIGINT REFERENCES users(id),
    target_id BIGINT REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    reason TEXT,
    duration INTEGER,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Warnings
CREATE TABLE IF NOT EXISTS warnings (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(id),
    user_id BIGINT REFERENCES users(id),
    moderator_id BIGINT REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notes
CREATE TABLE IF NOT EXISTS notes (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(id),
    name VARCHAR(255) NOT NULL,
    content TEXT,
    file_id VARCHAR(255),
    file_type VARCHAR(50),
    buttons JSONB,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, name)
);

-- Filters
CREATE TABLE IF NOT EXISTS filters (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(id),
    trigger VARCHAR(255) NOT NULL,
    response TEXT,
    file_id VARCHAR(255),
    is_phrase BOOLEAN DEFAULT FALSE,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Blacklist
CREATE TABLE IF NOT EXISTS blacklist (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(id),
    word VARCHAR(255) NOT NULL,
    reason TEXT,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Federations
CREATE TABLE IF NOT EXISTS federations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    owner_id BIGINT REFERENCES users(id),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Federation admins
CREATE TABLE IF NOT EXISTS federation_admins (
    federation_id UUID REFERENCES federations(id),
    user_id BIGINT REFERENCES users(id),
    promoted_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (federation_id, user_id)
);

-- Federation bans
CREATE TABLE IF NOT EXISTS federation_bans (
    id BIGSERIAL PRIMARY KEY,
    federation_id UUID REFERENCES federations(id),
    user_id BIGINT REFERENCES users(id),
    banned_by BIGINT REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_guilds_telegram_id ON guilds(telegram_id);
CREATE INDEX idx_moderation_logs_guild ON moderation_logs(guild_id);
CREATE INDEX idx_moderation_logs_created_at ON moderation_logs(created_at DESC);
CREATE INDEX idx_warnings_user ON warnings(user_id);
CREATE INDEX idx_warnings_guild ON warnings(guild_id);
CREATE INDEX idx_notes_guild ON notes(guild_id);
CREATE INDEX idx_filters_guild ON filters(guild_id);

-- Create update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_guilds_updated_at BEFORE UPDATE ON guilds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO botuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO botuser;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Telegram Bot Database initialized successfully!';
END $$;
