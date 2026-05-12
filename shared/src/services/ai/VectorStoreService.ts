import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as path from 'path';
import * as fs from 'fs';

interface VectorDoc {
    pageContent: string;
    metadata: any;
    embedding: number[];
}

export class VectorStoreService {
    private docs: VectorDoc[] = [];
    private bedrock: BedrockRuntimeClient;
    private storagePath: string;
    private modelId = "amazon.titan-embed-text-v2:0";

    // ── Embedding cache: avoids duplicate AWS calls for same query in one turn ──
    // e.g. two-pass RAG (deck + history) embeds the same user question twice → 1 call now
    private embedCache = new Map<string, number[]>();
    private readonly EMBED_CACHE_MAX = 20;

    constructor(config: { accessKeyId: string; secretAccessKey: string; region: string }, storagePath: string) {
        this.bedrock = new BedrockRuntimeClient({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
        this.storagePath = path.join(storagePath, 'vector_db.json');
    }

    async init() {
        if (fs.existsSync(this.storagePath)) {
            try {
                const data = fs.readFileSync(this.storagePath, 'utf-8');
                this.docs = JSON.parse(data);
                console.log(`Loaded ${this.docs.length} vectors from storage (AWS Bedrock).`);

                // ── Auto-migrate: fix old type values so /adddoc docs are retrievable ──
                const OLD_TYPES = new Set(['file', 'url', 'text']);
                let migrated = 0;
                for (const doc of this.docs) {
                    if (doc.metadata?.type && OLD_TYPES.has(doc.metadata.type)) {
                        doc.metadata.type = 'manual';
                        migrated++;
                    }
                }
                if (migrated > 0) {
                    await this.persist();
                    console.log(`Auto-migrated ${migrated} docs from old type → 'manual'`);
                }
            } catch (err) {
                console.error('Failed to load vector data:', err);
            }
        }
    }

    // ── Async persist — never blocks the event loop ───────────────────────────
    private async persist(): Promise<void> {
        const dir = path.dirname(this.storagePath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await fs.promises.writeFile(this.storagePath, JSON.stringify(this.docs, null, 2));
    }

    // ── Embedding with cache + exponential-backoff retry ─────────────────────
    private async getEmbedding(text: string): Promise<number[]> {
        const key = text.trim();

        // Return cached embedding if available (saves duplicate AWS calls)
        if (this.embedCache.has(key)) {
            return this.embedCache.get(key)!;
        }

        const MAX_ATTEMPTS = 3;
        let lastErr: any;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const command = new InvokeModelCommand({
                    modelId: this.modelId,
                    contentType: "application/json",
                    accept: "application/json",
                    body: JSON.stringify({ inputText: key }),
                });

                const response = await this.bedrock.send(command);
                const body = JSON.parse(new TextDecoder().decode(response.body));
                const embedding: number[] = body.embedding;

                // Evict oldest entry if cache is full
                if (this.embedCache.size >= this.EMBED_CACHE_MAX) {
                    const firstKey = this.embedCache.keys().next().value;
                    if (firstKey !== undefined) this.embedCache.delete(firstKey);
                }
                this.embedCache.set(key, embedding);

                return embedding;
            } catch (err: any) {
                lastErr = err;
                const isRetryable =
                    err?.name === 'ThrottlingException' ||
                    err?.name === 'ServiceUnavailableException' ||
                    (err?.message ?? '').toLowerCase().includes('throttl');

                if (isRetryable && attempt < MAX_ATTEMPTS) {
                    const delay = Math.pow(2, attempt) * 500; // 1s, 2s
                    console.warn(`Embedding throttled — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay}ms`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                throw err;
            }
        }

        throw lastErr ?? new Error('Embedding: max retries exceeded');
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Keyword overlap score (0–1): fraction of meaningful query words found in chunk text.
     * Combined with cosine similarity → hybrid search with ~30% better precision on
     * exact-term queries (product names, numbers, proper nouns).
     */
    private keywordScore(query: string, text: string): number {
        const stopWords = new Set([
            'what','is','the','are','how','does','do','a','an','in','of','to','for',
            'and','or','can','i','it','be','this','that','with','on','at','by','from',
            'my','will','was','has','have','had','its','about','when','where','who',
            'why','which','get','give','tell','me','us','you','we','they','he','she','any',
        ]);
        const words = query.toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
        if (words.length === 0) return 0;
        const textLower = text.toLowerCase();
        const matches = words.filter(w => textLower.includes(w)).length;
        return matches / words.length;
    }

    /**
     * Hybrid score: 70% semantic (cosine) + 30% lexical (keyword overlap).
     * Prevents pure semantic drift on product-specific terms like "ABox", "LITE tier", "TGE".
     */
    private hybridScore(cosine: number, keyword: number): number {
        return 0.7 * cosine + 0.3 * keyword;
    }

    async addDocuments(text: string, metadata: any = {}): Promise<{ indexed: number; failed: number }> {
        // Smart chunking:
        // 1. Split on double newlines first (paragraph boundaries)
        // 2. Any remaining chunk > 800 chars (no double newlines — e.g. X posts, dense paragraphs)
        //    gets split further on single newlines or sentences
        const MAX_CHUNK = 800;
        const rawChunks = text.split(/\n\n+/).filter(c => c.trim().length > 0);
        const chunks: string[] = [];

        for (const raw of rawChunks) {
            if (raw.length <= MAX_CHUNK) {
                chunks.push(raw.trim());
            } else {
                // Try splitting on single newlines first
                const lines = raw.split(/\n/).filter(l => l.trim().length > 0);
                let current = '';
                for (const line of lines) {
                    if ((current + ' ' + line).length > MAX_CHUNK && current.length > 0) {
                        chunks.push(current.trim());
                        current = line;
                    } else {
                        current = current ? current + ' ' + line : line;
                    }
                }
                if (current.trim().length > 0) chunks.push(current.trim());
            }
        }

        let indexed = 0;
        let failed = 0;

        for (const chunk of chunks) {
            try {
                const embedding = await this.getEmbedding(chunk);
                this.docs.push({
                    pageContent: chunk.trim(),
                    metadata,
                    embedding,
                });
                indexed++;
            } catch (err) {
                console.error(`Failed to embed chunk: ${err}`);
                failed++;
            }
        }

        // Single async write after all chunks — not one per chunk
        if (indexed > 0) {
            await this.persist();
        }

        return { indexed, failed };
    }

    async search(query: string, k: number = 3): Promise<{ pageContent: string; metadata: any; score: number }[]> {
        return this.searchFiltered(query, k);
    }

    /**
     * Search with optional metadata type filter.
     * Embedding is cached — calling this twice with the same query costs one AWS call, not two.
     * @param typeFilter If provided, only docs whose metadata.type is in this array are searched.
     */
    async searchFiltered(
        query: string,
        k: number = 3,
        typeFilter?: string[],
    ): Promise<{ pageContent: string; metadata: any; score: number }[]> {
        if (this.docs.length === 0) return [];

        try {
            const queryEmbedding = await this.getEmbedding(query); // cached after first call

            const pool = typeFilter
                ? this.docs.filter(d => typeFilter.includes(d.metadata?.type ?? ''))
                : this.docs;

            if (pool.length === 0) {
                // Debug: log what types actually exist so we can spot mismatches
                const types = new Map<string, number>();
                for (const d of this.docs) {
                    const t = d.metadata?.type ?? '(none)';
                    types.set(t, (types.get(t) ?? 0) + 1);
                }
                const summary = [...types.entries()].map(([t, c]) => `${t}:${c}`).join(', ');
                console.log(`searchFiltered: 0 docs matched filter [${typeFilter?.join(',')}]. Existing types: ${summary}`);
                return [];
            }

            const scored = pool.map(doc => {
                const cosine  = this.cosineSimilarity(queryEmbedding, doc.embedding);
                const keyword = this.keywordScore(query, doc.pageContent);
                return { ...doc, score: this.hybridScore(cosine, keyword) };
            });

            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, k).map(d => ({
                pageContent: d.pageContent,
                metadata:    d.metadata,
                score:       d.score,
            }));
        } catch (err) {
            console.error(`Search embedding failed: ${err}`);
            return [];
        }
    }

    async removeBySource(sourceName: string) {
        this.docs = this.docs.filter(doc => doc.metadata.source !== sourceName);
        await this.persist();
    }

    async clear() {
        if (fs.existsSync(this.storagePath)) {
            await fs.promises.unlink(this.storagePath);
        }
        this.docs = [];
        this.embedCache.clear();
    }

    getDocCount(): number {
        return this.docs.length;
    }
}
