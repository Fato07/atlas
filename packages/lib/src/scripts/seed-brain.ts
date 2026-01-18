/**
 * Seed Brain Script
 *
 * Populates Qdrant collections with brain data from a JSON file.
 *
 * Usage:
 *   bun run seed:brain --vertical=defense --source=./data/example-brain.json
 *
 * Or:
 *   bun run packages/lib/src/scripts/seed-brain.ts --vertical=defense --source=./data/example-brain.json
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { embedDocument } from "../embeddings";
import type { BrainId } from "../types";

// ===========================================
// Configuration
// ===========================================

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

// ===========================================
// Types for Brain JSON Structure
// ===========================================

interface BrainJsonIcpRule {
  name: string;
  criteria: string;
  weight: number;
  match_condition: string;
}

interface BrainJsonResponseTemplate {
  name: string;
  intent: string;
  template: string;
  variables: string[];
}

interface BrainJsonObjectionHandler {
  objection: string;
  response: string;
  category: string;
}

interface BrainJsonMarketResearch {
  topic: string;
  content: string;
  source: string;
  date: string;
}

interface BrainJson {
  vertical: string;
  description: string;
  icp_rules: BrainJsonIcpRule[];
  response_templates: BrainJsonResponseTemplate[];
  objection_handlers: BrainJsonObjectionHandler[];
  market_research: BrainJsonMarketResearch[];
}

// ===========================================
// CLI Argument Parsing
// ===========================================

function parseArgs(): { vertical: string; source: string } {
  const args = process.argv.slice(2);
  let vertical = "";
  let source = "";

  for (const arg of args) {
    if (arg.startsWith("--vertical=")) {
      vertical = arg.split("=")[1];
    } else if (arg.startsWith("--source=")) {
      source = arg.split("=")[1];
    }
  }

  if (!vertical || !source) {
    console.error("Usage: bun run seed:brain --vertical=<name> --source=<path>");
    console.error("  --vertical  Vertical name (e.g., defense, fintech)");
    console.error("  --source    Path to brain JSON file");
    process.exit(1);
  }

  return { vertical, source };
}

// ===========================================
// UUID Generation
// ===========================================

function generateUUID(): string {
  return crypto.randomUUID();
}

// ===========================================
// Rate Limit Handling
// ===========================================

const DELAY_BETWEEN_REQUESTS_MS = 500; // 500ms between requests to avoid rate limits

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedWithRetry(
  text: string,
  maxRetries = 3
): Promise<{ vector: number[]; tokensUsed: number }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await embedDocument(text);
      await delay(DELAY_BETWEEN_REQUESTS_MS); // Rate limit protection
      return result;
    } catch (error) {
      const isRateLimited =
        error && typeof error === "object" && "code" in error && error.code === "RATE_LIMITED";

      if (isRateLimited && attempt < maxRetries) {
        const waitTime = (error as { retryAfterMs?: number }).retryAfterMs || 60000;
        console.log(`  ⏳ Rate limited, waiting ${waitTime / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

// ===========================================
// Main Seeding Logic
// ===========================================

async function seedBrain(): Promise<void> {
  const { vertical, source } = parseArgs();

  console.log(`\n🧠 Seeding brain for vertical: ${vertical}`);
  console.log(`📄 Source file: ${source}\n`);

  // Initialize Qdrant client
  const clientConfig: { url: string; apiKey?: string } = { url: QDRANT_URL };
  if (QDRANT_API_KEY) {
    clientConfig.apiKey = QDRANT_API_KEY;
  } else {
    console.warn("Warning: QDRANT_API_KEY not set");
  }
  const client = new QdrantClient(clientConfig);

  // Read and parse brain JSON
  let brainData: BrainJson;
  try {
    const file = Bun.file(source);
    brainData = await file.json() as BrainJson;
  } catch (error) {
    console.error(`Failed to read brain file: ${source}`);
    console.error(error);
    process.exit(1);
  }

  // Validate JSON matches vertical
  if (brainData.vertical !== vertical) {
    console.warn(`Warning: JSON vertical "${brainData.vertical}" doesn't match --vertical="${vertical}"`);
    console.warn(`Using --vertical value: ${vertical}`);
  }

  // Generate brain ID
  const brainId = `brain_${vertical}_${Date.now()}` as BrainId;
  const now = new Date().toISOString();

  console.log(`🆔 Brain ID: ${brainId}\n`);

  // Track stats
  const stats = {
    brains: 0,
    icp_rules: 0,
    response_templates: 0,
    objection_handlers: 0,
    market_research: 0,
  };

  // ===========================================
  // 1. Seed Brain Metadata
  // ===========================================
  console.log("📌 Seeding brain metadata...");
  try {
    const brainEmbedding = await embedWithRetry(brainData.description);
    await client.upsert("brains", {
      wait: true,
      points: [
        {
          id: generateUUID(),
          vector: brainEmbedding.vector,
          payload: {
            brain_id: brainId,
            name: `${vertical.charAt(0).toUpperCase() + vertical.slice(1)} Brain`,
            vertical: vertical,
            version: "1.0",
            status: "active",
            description: brainData.description,
            created_at: now,
            updated_at: now,
            config: {
              score_threshold: 50,
              auto_response_threshold: 80,
            },
          },
        },
      ],
    });
    stats.brains = 1;
    console.log(`  ✓ Brain metadata seeded`);
  } catch (error) {
    console.error("  ✗ Failed to seed brain:", error);
  }

  // ===========================================
  // 2. Seed ICP Rules
  // ===========================================
  console.log("\n📌 Seeding ICP rules...");
  for (const rule of brainData.icp_rules) {
    try {
      const textToEmbed = `${rule.name}: ${rule.criteria}`;
      const embedding = await embedWithRetry(textToEmbed);

      await client.upsert("icp_rules", {
        wait: true,
        points: [
          {
            id: generateUUID(),
            vector: embedding.vector,
            payload: {
              brain_id: brainId,
              vertical: vertical,
              category: "firmographic", // Default category
              name: rule.name,
              criteria: rule.criteria,
              weight: rule.weight,
              match_condition: rule.match_condition,
              is_knockout: false,
              validated: false,
              created_at: now,
              updated_at: now,
            },
          },
        ],
      });
      stats.icp_rules++;
      console.log(`  ✓ ${rule.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to seed ICP rule "${rule.name}":`, error);
    }
  }

  // ===========================================
  // 3. Seed Response Templates
  // ===========================================
  console.log("\n📌 Seeding response templates...");
  for (const template of brainData.response_templates) {
    try {
      const embedding = await embedWithRetry(template.template);

      await client.upsert("response_templates", {
        wait: true,
        points: [
          {
            id: generateUUID(),
            vector: embedding.vector,
            payload: {
              brain_id: brainId,
              vertical: vertical,
              category: template.intent,
              name: template.name,
              intent: template.intent,
              template_text: template.template,
              variables: template.variables,
              tier: 2, // Draft tier by default
              created_at: now,
              updated_at: now,
            },
          },
        ],
      });
      stats.response_templates++;
      console.log(`  ✓ ${template.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to seed template "${template.name}":`, error);
    }
  }

  // ===========================================
  // 4. Seed Objection Handlers
  // ===========================================
  console.log("\n📌 Seeding objection handlers...");
  for (const handler of brainData.objection_handlers) {
    try {
      const textToEmbed = `Objection: ${handler.objection}\nResponse: ${handler.response}`;
      const embedding = await embedWithRetry(textToEmbed);

      await client.upsert("objection_handlers", {
        wait: true,
        points: [
          {
            id: generateUUID(),
            vector: embedding.vector,
            payload: {
              brain_id: brainId,
              vertical: vertical,
              category: handler.category,
              objection_type: handler.category,
              objection_text: handler.objection,
              handler_response: handler.response,
              severity: "medium",
              tier: 2,
              created_at: now,
              updated_at: now,
            },
          },
        ],
      });
      stats.objection_handlers++;
      console.log(`  ✓ ${handler.category}: "${handler.objection.slice(0, 40)}..."`);
    } catch (error) {
      console.error(`  ✗ Failed to seed objection handler:`, error);
    }
  }

  // ===========================================
  // 5. Seed Market Research
  // ===========================================
  console.log("\n📌 Seeding market research...");
  for (const research of brainData.market_research) {
    try {
      const embedding = await embedWithRetry(research.content);

      await client.upsert("market_research", {
        wait: true,
        points: [
          {
            id: generateUUID(),
            vector: embedding.vector,
            payload: {
              brain_id: brainId,
              vertical: vertical,
              category: "market_overview", // Default category
              title: research.topic,
              content: research.content,
              source: {
                name: research.source,
                url: null,
                publish_date: research.date,
              },
              confidence_score: 0.9,
              created_at: now,
              updated_at: now,
            },
          },
        ],
      });
      stats.market_research++;
      console.log(`  ✓ ${research.topic}`);
    } catch (error) {
      console.error(`  ✗ Failed to seed research "${research.topic}":`, error);
    }
  }

  // ===========================================
  // Summary
  // ===========================================
  console.log("\n" + "=".repeat(50));
  console.log("🎉 Seeding complete!\n");
  console.log("📊 Summary:");
  console.log(`  • Brain ID: ${brainId}`);
  console.log(`  • Brains: ${stats.brains}`);
  console.log(`  • ICP Rules: ${stats.icp_rules}`);
  console.log(`  • Response Templates: ${stats.response_templates}`);
  console.log(`  • Objection Handlers: ${stats.objection_handlers}`);
  console.log(`  • Market Research: ${stats.market_research}`);
  console.log("\n✅ Brain is ready for use!");
}

// Run
seedBrain().catch(console.error);
