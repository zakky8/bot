// disconnect and connection commands are handled in connect.ts
// This file is intentionally empty to avoid duplicate command registration.
import { Bot } from 'grammy';
import { BotContext } from '../../types';
export default (_bot: Bot<BotContext>) => { /* no-op */ };
