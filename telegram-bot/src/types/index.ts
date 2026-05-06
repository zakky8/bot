import { Context } from 'grammy';
import { I18nFlavor } from '@grammyjs/i18n';

export type LockAction = 'off' | 'warn' | 'kick' | 'mute' | 'ban';

export interface LockSetting {
  mode: LockAction;
  delete: boolean;
}

export interface SessionData {
  captcha: {
    enabled: boolean;
    mode: 'button' | 'math' | 'text';
    text?: string;
    kickTime?: number;
  };
  locks: Record<string, LockSetting>;
  approvals: number[]; // User IDs immune to locks/filters
  rules?: string;
  welcomeMessage?: string;
  notes: Record<string, string>;
  warnings: Record<string, Array<{ by: string; reason: string; date: number }>>;
  filters: Record<string, string>;
  blacklist: string[];
  blacklistMode: 'delete' | 'warn' | 'mute' | 'kick' | 'ban';
  antiraid: {
    enabled: boolean;
    recentJoins: Array<{ id: number; joinedAt: number }>;
  };
  flood: {
    limit: number;
    interval: number;
    action: 'mute' | 'kick' | 'ban';
  };
  logChannel?: number;
  goodbyeMessage?: string;
  federations: Record<string, { name: string; owner: number; admins: number[]; members: number[]; banned: number[] }>;
  language: string;
  userData: Record<string, unknown>;
}

export type BotContext = Context & I18nFlavor & {
  session: SessionData;
};

export interface Command {
  name: string;
  description: string;
  category: string;
  adminOnly?: boolean;
}
