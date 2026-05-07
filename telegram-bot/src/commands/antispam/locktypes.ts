// This file is intentionally a no-op.
// /locktypes is registered by lockmenu.ts with the correct interactive keyboard.
import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (_bot: Bot<BotContext>) => {
    // No-op: /locktypes handled in lockmenu.ts
};
