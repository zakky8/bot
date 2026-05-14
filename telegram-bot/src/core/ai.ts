import { AIService, MemoryRedis } from '../../../shared';
import { createLogger } from './logger';
import { Redis } from 'ioredis';

const logger = createLogger('AI');

let redisClient: Redis | MemoryRedis;

if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on('error', (err: unknown) => logger.error('AI Redis Error:', err));
} else {
    logger.warn('REDIS_URL not set for AI Service. Using in-memory fallback.');
    redisClient = new MemoryRedis();
}

// Function to create AIService with current environment variables
function createAIService() {
    return new AIService({
        anthropicApiKey:  process.env.AI_API_KEY                || '',
        awsAccessKey:     process.env.AWS_ACCESS_KEY            || '',
        awsSecretKey:     process.env.AWS_SECRET_KEY            || '',
        awsRegion:        process.env.AWS_REGION                || 'us-east-1',
        ollamaHost:       process.env.AI_BASE_URL               || 'http://localhost:11434',
        defaultModel:     process.env.AI_MODEL                  || 'openai.gpt-oss-20b-1:0',
        fallbackModel:    process.env.AI_FALLBACK_MODEL         || 'llama3.2:3b',
        botName:          process.env.BOT_NAME                  || 'TENET',
        escalationUserId: process.env.HUMAN_MODERATOR_CHAT_ID  || '',
    }, redisClient, logger);
}

// Initialize aiService
export let aiService = createAIService();

// Function to reinitialize service (used when API key/model changes)
export function reinitializeAIService() {
    aiService = createAIService();
    logger.info('AI Service reinitialized with new configuration');
}
