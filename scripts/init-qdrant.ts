/**
 * Initialize Qdrant Collections
 *
 * Run with: bun run db:init
 *
 * Creates all required collections for Atlas GTM:
 * - icp_rules: ICP scoring criteria
 * - response_templates: Email response templates
 * - objection_handlers: Objection handling scripts
 * - market_research: Market intelligence
 * - brains: Brain metadata
 */

import { QdrantClient } from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const EMBEDDING_DIM = 1024; // Voyage AI voyage-3 dimension

interface CollectionConfig {
  name: string;
  description: string;
}

const COLLECTIONS: CollectionConfig[] = [
  {
    name: "brains",
    description: "Brain metadata - one per vertical",
  },
  {
    name: "icp_rules",
    description: "ICP scoring rules and criteria",
  },
  {
    name: "response_templates",
    description: "Email response templates by intent",
  },
  {
    name: "objection_handlers",
    description: "Objection handling scripts",
  },
  {
    name: "market_research",
    description: "Market intelligence and insights",
  },
];

async function initCollections() {
  console.log(`Connecting to Qdrant at ${QDRANT_URL}...`);
  const client = new QdrantClient({ url: QDRANT_URL });

  // Check connection
  try {
    await client.getCollections();
    console.log("Connected to Qdrant successfully");
  } catch (error) {
    console.error("Failed to connect to Qdrant:", error);
    console.log("\nMake sure Qdrant is running:");
    console.log("  docker compose up -d qdrant");
    process.exit(1);
  }

  // Create collections
  for (const config of COLLECTIONS) {
    try {
      // Check if collection exists
      const exists = await client
        .getCollection(config.name)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        console.log(`Collection '${config.name}' already exists, skipping`);
        continue;
      }

      // Create collection
      await client.createCollection(config.name, {
        vectors: {
          size: EMBEDDING_DIM,
          distance: "Cosine",
        },
      });

      console.log(`Created collection '${config.name}': ${config.description}`);
    } catch (error) {
      console.error(`Failed to create collection '${config.name}':`, error);
    }
  }

  // Create payload indexes for brain_id filtering
  console.log("\nCreating payload indexes...");
  for (const config of COLLECTIONS) {
    if (config.name === "brains") continue; // brains collection doesn't need brain_id index

    try {
      await client.createPayloadIndex(config.name, {
        field_name: "brain_id",
        field_schema: "keyword",
      });
      console.log(`Created brain_id index on '${config.name}'`);
    } catch (error) {
      // Index might already exist
      console.log(`Index on '${config.name}' might already exist, continuing...`);
    }
  }

  console.log("\nQdrant initialization complete!");
  console.log("\nNext steps:");
  console.log("  1. Seed a brain: bun run seed:brain --vertical=defense");
  console.log("  2. Start development: bun run dev");
}

// Run initialization
initCollections().catch(console.error);
