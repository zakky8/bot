import { Pool } from 'pg';
import { createLogger } from './logger';

const logger = createLogger('Database');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const connectDatabase = async () => {
  if (!process.env.DATABASE_URL) {
    logger.warn('DATABASE_URL not set — running without database');
    return;
  }
  try {
    const client = await pool.connect();
    logger.info('Connected to PostgreSQL database');
    
    // Initialize Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS warnings (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        reason TEXT NOT NULL,
        warned_by BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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
    `);
    logger.info('Database tables initialized');
    
    client.release();
  } catch (error) {
    logger.warn('Failed to connect to database — running without database:', error);
  }
};

export const query = async (text: string, params?: unknown[]) => {
  if (!process.env.DATABASE_URL) {
    throw new Error('Database not configured');
  }
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug('Executed query', { text, duration, rows: res.rowCount });
  return res;
};

export default pool;
