import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const baseDir = join(process.cwd(), 'src', 'commands');

function walk(dir: string) {
    const files = readdirSync(dir);
    for (const file of files) {
        const path = join(dir, file);
        if (statSync(path).isDirectory()) {
            walk(path);
        } else if (file.endsWith('.ts')) {
            let content = readFileSync(path, 'utf8');
            if (content.includes('FIRING DELETE FOR')) {
                // Replace the noisy log block with a clean one
                const noisyPattern = /\.then\(msg => \{ setTimeout\(\(\) => \{ console\.log\("FIRING DELETE FOR", msg\.message_id\); .*? \}, 5000\); \}\)/g;
                const cleanBlock = `.then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); })`;
                content = content.replace(noisyPattern, cleanBlock);
                writeFileSync(path, content);
                console.log(`Cleaned: ${path}`);
            }
        }
    }
}

walk(baseDir);
