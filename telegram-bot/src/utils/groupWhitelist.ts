import * as fs from 'fs';
import * as path from 'path';

const WHITELIST_FILE = path.join(__dirname, '..', '..', 'group_whitelist.json');

interface WhitelistEntry {
  chatId: string;
  title: string;
  addedBy: string;
  addedAt: string;
}

function load(): WhitelistEntry[] {
  try {
    if (!fs.existsSync(WHITELIST_FILE)) return [];
    return JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function save(entries: WhitelistEntry[]): void {
  fs.writeFileSync(WHITELIST_FILE, JSON.stringify(entries, null, 2));
}

export function isGroupWhitelisted(chatId: string | number): boolean {
  const id = chatId.toString();
  return load().some(e => e.chatId === id);
}

export function addGroupToWhitelist(chatId: string | number, title: string, addedBy: string): boolean {
  const id = chatId.toString();
  const entries = load();
  if (entries.some(e => e.chatId === id)) return false; // already exists
  entries.push({ chatId: id, title, addedBy, addedAt: new Date().toISOString() });
  save(entries);
  return true;
}

export function removeGroupFromWhitelist(chatId: string | number): boolean {
  const id = chatId.toString();
  const entries = load();
  const filtered = entries.filter(e => e.chatId !== id);
  if (filtered.length === entries.length) return false; // not found
  save(filtered);
  return true;
}

export function getWhitelistedGroups(): WhitelistEntry[] {
  return load();
}
