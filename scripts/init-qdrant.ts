/**
 * Initialize Qdrant Collections
 *
 * Run with: bun run scripts/init-qdrant.ts
 *
 * Creates all 7 required collections for Atlas GTM:
 * - brains: Brain metadata - one per vertical
 * - icp_rules: ICP scoring criteria
 * - response_templates: Email response templates
 * - objection_handlers: Objection handling scripts
 * - market_research: Market intelligence
 * - insights: Learnings extracted from conversations
 * - verticals: Hierarchy structure for verticals
 */

import { QdrantClient } from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const EMBEDDING_DIM = 1024; // Voyage AI voyage-3.5-lite dimension

interface CollectionConfig {
  name: string;
  description: string;
  indexes: IndexConfig[];
}

interface IndexConfig {
  field: string;
  type: "keyword" | "integer" | "float" | "bool";
}

const COLLECTIONS: CollectionConfig[] = [
  {
    name: "brains",
    description: "Brain metadata - one per vertical",
    indexes: [
      { field: "vertical", type: "keyword" },
      { field: "status", type: "keyword" },
      { field: "updated_at", type: "integer" },
    ],
  },
  {
    name: "icp_rules",
    description: "ICP scoring rules and criteria",
    indexes: [
      { field: "brain_id", type: "keyword" },
      { field: "vertical", type: "keyword" },
      { field: "category", type: "keyword" },
      { field: "updated_at", type: "integer" },
    ],
  },
  {
    name: "response_templates",
    description: "Email response templates by intent",
    indexes: [
      { field: "brain_id", type: "keyword" },
      { field: "vertical", type: "keyword" },
      { field: "category", type: "keyword" },
      { field: "updated_at", type: "integer" },
    ],
  },
  {
    name: "objection_handlers",
    description: "Objection handling scripts",
    indexes: [
      { field: "brain_id", type: "keyword" },
      { field: "vertical", type: "keyword" },
      { field: "category", type: "keyword" },
      { field: "updated_at", type: "integer" },
    ],
  },
  {
    name: "market_research",
    description: "Market intelligence and insights",
    indexes: [
      { field: "brain_id", type: "keyword" },
      { field: "vertical", type: "keyword" },
      { field: "category", type: "keyword" },
      { field: "updated_at", type: "integer" },
    ],
  },
  {
    name: "insights",
    description: "Learnings extracted from conversations",
    indexes: [
      { field: "brain_id", type: "keyword" },
      { field: "vertical", type: "keyword" },
      { field: "category", type: "keyword" },
      { field: "importance", type: "keyword" },
      { field: "validation.status", type: "keyword" },
      { field: "updated_at", type: "integer" },
    ],
  },
  {
    name: "verticals",
    description: "Hierarchy structure for verticals and sub-verticals",
    indexes: [
      { field: "brain_id", type: "keyword" },
      { field: "vertical", type: "keyword" },
      { field: "updated_at", type: "integer" },
    ],
  },
];

async function initCollections() {
  console.log(`Connecting to Qdrant at ${QDRANT_URL}...`);

  // Initialize client with API key authentication
  const clientConfig: { url: string; apiKey?: string } = { url: QDRANT_URL };
  if (QDRANT_API_KEY) {
    clientConfig.apiKey = QDRANT_API_KEY;
    console.log("Using API key authentication");
  } else {
    console.warn("Warning: QDRANT_API_KEY not set, connecting without authentication");
  }

  const client = new QdrantClient(clientConfig);

  // Check connection
  try {
    await client.getCollections();
    console.log("Connected to Qdrant successfully\n");
  } catch (error) {
    console.error("Failed to connect to Qdrant:", error);
    console.log("\nMake sure Qdrant is running:");
    console.log("  docker-compose up -d qdrant");
    console.log("\nAnd that QDRANT_API_KEY is set correctly in your .env file");
    process.exit(1);
  }

  // Create collections
  for (const config of COLLECTIONS) {
    try {
      // Check if collection exists (idempotent)
      const exists = await client
        .getCollection(config.name)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        console.log(`✓ Collection '${config.name}' already exists`);
      } else {
        // Create collection with 1024-dimension vectors
        await client.createCollection(config.name, {
          vectors: {
            size: EMBEDDING_DIM,
            distance: "Cosine",
          },
        });
        console.log(`✓ Created collection: ${config.name}`);
      }

      // Create payload indexes
      for (const index of config.indexes) {
        try {
          await client.createPayloadIndex(config.name, {
            field_name: index.field,
            field_schema: index.type,
          });
          console.log(`  ✓ Created index: ${config.name}.${index.field}`);
        } catch (error) {
          // Index might already exist - this is expected for idempotent runs
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes("already exists") || errorMessage.includes("409")) {
            console.log(`  ✓ Index exists: ${config.name}.${index.field}`);
          } else {
            console.warn(`  ⚠ Could not create index ${config.name}.${index.field}:`, errorMessage);
          }
        }
      }
    } catch (error) {
      console.error(`✗ Failed to create collection '${config.name}':`, error);
    }
  }

  // Verify all collections
  console.log("\n--- Verification ---");
  const { collections } = await client.getCollections();
  console.log(`Total collections: ${collections.length}`);

  for (const collection of collections) {
    const info = await client.getCollection(collection.name);
    console.log(`\n${collection.name}:`);
    console.log(`  Vector size: ${info.config.params.vectors && typeof info.config.params.vectors === 'object' && 'size' in info.config.params.vectors ? info.config.params.vectors.size : 'unknown'}`);
    console.log(`  Points count: ${info.points_count}`);
  }

  console.log("\n✓ All collections initialized successfully!");
}

// Run initialization
initCollections().catch(console.error);
