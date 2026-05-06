import * as dotenv from 'dotenv';
dotenv.config();

import { query } from './src/core/database';
import { readFileSync } from 'fs';
import { join } from 'path';

async function run() {
    try {
        const sql = readFileSync(join(process.cwd(), 'scripts', 'federation_schema.sql'), 'utf8');
        await query(sql);
        console.log('✅ Federation schema applied successfully');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    }
}
run();
