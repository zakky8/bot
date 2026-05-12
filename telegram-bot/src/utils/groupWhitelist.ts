import * as fs from 'fs';
import * as path from 'path';

const WHITELIST_FILE = path.join(__dirname, '..', '..', 'group_whitelist.json');

interface WhitelistEntry {
  chatId: string;
  title: string;
  addedBy: string;
  addedAt: string;
}

// In-memory cache — avoids disk reads on every group message
let cache: WhitelistEntry[] | null = null;

function load(): WhitelistEntry[] {
  if (cache !== null) return cache;
  try {
    if (!fs.existsSync(WHITELIST_FILE)) {
      cache = [];
      return cache;
    }
    cache = JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf-8'));
    return cache!;
  } catch {
    cache = [];
    return cache;
  }
}

async function save(entries: WhitelistEntry[]): Promise<void> {
  cache = entries;
  await fs.promises.writeFile(WHITELIST_FILE, JSON.stringify(entries, null, 2));
}

export function isGroupWhitelisted(chatId: string | number): boolean {
  const id = chatId.toString();
  return load().some(e => e.chatId === id);
}

export async function addGroupToWhitelist(chatId: string | number, title: string, addedBy: string): Promise<boolean> {
  const id = chatId.toString();
  const entries = load();
  if (entries.some(e => e.chatId === id)) return false;
  entries.push({ chatId: id, title, addedBy, addedAt: new Date().toISOString() });
  await save(entries);
  return true;
}

export async function removeGroupFromWhitelist(chatId: string | number): Promise<boolean> {
  const id = chatId.toString();
  const entries = load();
  const filtered = entries.filter(e => e.chatId !== id);
  if (filtered.length === entries.length) return false;
  await save(filtered);
  return true;
}

export function getWhitelistedGroups(): WhitelistEntry[] {
  return load();
}
