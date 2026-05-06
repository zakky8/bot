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
            } catch (err) {
                console.error('Failed to load vector data:', err);
            }
        }
    }

    private async getEmbedding(text: string): Promise<number[]> {
        const payload = {
            inputText: text.trim(),
        };

        const command = new InvokeModelCommand({
            modelId: this.modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(payload),
        });

        const response = await this.bedrock.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.embedding;
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

    async addDocuments(text: string, metadata: any = {}) {
        // Simple chunking: split by paragraphs
        const chunks = text.split(/\n\n+/).filter(c => c.trim().length > 0);
        
        for (const chunk of chunks) {
            try {
                const embedding = await this.getEmbedding(chunk);
                this.docs.push({
                    pageContent: chunk.trim(),
                    metadata,
                    embedding
                });
            } catch (err) {
                console.error(`Failed to embed chunk: ${err}`);
            }
        }

        // Persist to JSON
        if (!fs.existsSync(path.dirname(this.storagePath))) {
            fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
        }
        fs.writeFileSync(this.storagePath, JSON.stringify(this.docs, null, 2));
    }

    async search(query: string, k: number = 3): Promise<{ pageContent: string; metadata: any }[]> {
        if (this.docs.length === 0) return [];

        try {
            const queryEmbedding = await this.getEmbedding(query);

            const scored = this.docs.map(doc => ({
                ...doc,
                score: this.cosineSimilarity(queryEmbedding, doc.embedding)
            }));

            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, k).map(d => ({ pageContent: d.pageContent, metadata: d.metadata }));
        } catch (err) {
            console.error(`Search embedding failed: ${err}`);
            return [];
        }
    }

    async removeBySource(sourceName: string) {
        this.docs = this.docs.filter(doc => doc.metadata.source !== sourceName);
        fs.writeFileSync(this.storagePath, JSON.stringify(this.docs, null, 2));
    }

    async clear() {
        if (fs.existsSync(this.storagePath)) {
            fs.unlinkSync(this.storagePath);
        }
        this.docs = [];
    }
}
