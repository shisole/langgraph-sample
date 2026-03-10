/**
 * LESSON 6: Conditional Routing
 *
 * In Lesson 5, the retrieve node had an if/else inside it:
 *   if (intent === "shopper_assistant") → mall data
 *   if (intent === "property_inquiry")  → property data
 *
 * That works, but it's all hidden inside one function.
 * With conditional routing, the GRAPH itself decides which path to take.
 * This is what the Algoritmo test means by "conditional routing based on intent."
 *
 * Graph structure:
 *
 *   START → [extract_query] → [classify_intent] → [route]
 *                                                    ↓
 *                               ┌────────────────────┼────────────────────┐
 *                               ↓                    ↓                    ↓
 *                     [retrieve_mall]      [retrieve_property]     [handle_unknown]
 *                               ↓                    ↓                    ↓
 *                               └────────────────────┼────────────────────┘
 *                                                    ↓
 *                                            [generate_answer]
 *                                                    ↓
 *                                                  END
 */

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

// ============================================
// STEP 1: Same state from Lesson 5
// ============================================
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  query: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  intent: Annotation<"shopper_assistant" | "property_inquiry" | "unknown">({
    reducer: (_current, update) => update,
    default: () => "unknown",
  }),
  context: Annotation<Record<string, unknown>[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  answer: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  sources: Annotation<string[]>({
    reducer: (current, update) => [...new Set([...current, ...update])],
    default: () => [],
  }),
});

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
});

// ============================================
// STEP 2: Nodes (same as Lesson 5, but retrieve is SPLIT)
// ============================================

function extractQuery(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  const query = typeof lastMessage.content === "string" ? lastMessage.content : "";
  console.log(`[extract_query] "${query}"`);
  return { query };
}

async function classifyIntent(state: typeof AgentState.State) {
  const response = await llm.invoke([
    new SystemMessage(
      `Classify the user's intent. Respond with ONLY one of these exact words:
      - "shopper_assistant" — if asking about malls, stores, events, products, food, parking
      - "property_inquiry" — if asking about condos, units, properties, amenities, pricing
      - "unknown" — if the question is out of scope`
    ),
    new HumanMessage(state.query),
  ]);

  const raw = (response.content as string).trim().toLowerCase();
  // Ensure we get a valid intent
  const intent = (["shopper_assistant", "property_inquiry"].includes(raw) ? raw : "unknown") as typeof state.intent;
  console.log(`[classify_intent] "${state.query}" → ${intent}`);
  return { intent };
}

// NOW SEPARATE RETRIEVE NODES — each one focuses on its own domain

async function retrieveMall(state: typeof AgentState.State) {
  // In the real test: search mall_directory.csv, mall_events.csv, mall_products.csv
  const mockDirectory = [
    { store: "Seoul Kitchen", category: "Restaurant - Korean", location: "Food Village", mall: "Mercado Village", hours: "11:00-22:00" },
    { store: "Grill House", category: "Restaurant - Filipino", location: "Food Village", mall: "Mercado Village", hours: "11:00-22:00" },
    { store: "Nike", category: "Sportswear", location: "2F", mall: "Solana Mall", hours: "10:00-21:00" },
    { store: "Starbucks", category: "Coffee & Cafe", location: "GF", mall: "Solana Mall", hours: "07:00-22:00" },
    { store: "Samsung", category: "Electronics", location: "2F", mall: "Solana Mall", hours: "10:00-21:00" },
  ];

  const mockEvents = [
    { event: "Pet Adoption Drive", mall: "Mercado Village", dates: "2026-03-22 to 2026-03-23", location: "Pet Village" },
    { event: "Weekend Food Market", mall: "Mercado Village", dates: "2026-03-08 to 2026-03-09", location: "Food Village" },
    { event: "Tiangge Sale", mall: "Parkview Shopping Center", dates: "2026-03-01 to 2026-03-31", location: "Halls A-D" },
  ];

  // Simple keyword search
  const queryLower = state.query.toLowerCase();
  const dirMatches = mockDirectory.filter(
    (r) =>
      queryLower.includes(r.mall.toLowerCase()) ||
      queryLower.includes(r.category.toLowerCase()) ||
      queryLower.includes(r.store.toLowerCase())
  );
  const eventMatches = mockEvents.filter(
    (r) => queryLower.includes(r.mall.toLowerCase())
  );

  const context = [...dirMatches, ...eventMatches];
  const sources = [];
  if (dirMatches.length > 0) sources.push("mall_directory.csv");
  if (eventMatches.length > 0) sources.push("mall_events.csv");

  console.log(`[retrieve_mall] Found ${context.length} records from [${sources}]`);
  return { context, sources };
}

async function retrieveProperty(state: typeof AgentState.State) {
  // In the real test: search property_listings.csv, property_amenities.txt
  const mockListings = [
    { development: "Central Park Towers", unit_type: "Studio", bedrooms: 0, area: 28, price: "8M-10M", status: "Available" },
    { development: "Central Park Towers", unit_type: "2BR", bedrooms: 2, area: 68, price: "25M-35M", status: "Available" },
    { development: "Verde Gardens", unit_type: "Studio", bedrooms: 0, area: 24, price: "4.5M-6M", status: "Available" },
    { development: "Willow Grove", unit_type: "Studio", bedrooms: 0, area: 22, price: "3.8M-5M", status: "Available" },
    { development: "The Pinnacle", unit_type: "2BR", bedrooms: 2, area: 85, price: "32M-40M", status: "Available" },
  ];

  const queryLower = state.query.toLowerCase();
  let results = mockListings;

  // Filter by development name if mentioned
  const devNames = ["central park towers", "verde gardens", "willow grove", "the pinnacle", "skyline residences"];
  const mentionedDev = devNames.find((d) => queryLower.includes(d));
  if (mentionedDev) {
    results = results.filter((r) => r.development.toLowerCase() === mentionedDev);
  }

  // Filter by unit type if mentioned
  if (queryLower.includes("studio")) results = results.filter((r) => r.bedrooms === 0);
  if (queryLower.includes("2-bedroom") || queryLower.includes("2br")) results = results.filter((r) => r.bedrooms === 2);

  console.log(`[retrieve_property] Found ${results.length} records from [property_listings.csv]`);
  return { context: results, sources: ["property_listings.csv"] };
}

function handleUnknown(state: typeof AgentState.State) {
  console.log(`[handle_unknown] Out of scope question`);
  return {
    answer:
      "I'm sorry, that question is outside my area of expertise. " +
      "I can help you with:\n" +
      "- Mall information (stores, events, products, parking)\n" +
      "- Property inquiries (units, pricing, amenities)\n\n" +
      "Please feel free to ask about any of these topics!",
    sources: [],
  };
}

async function generateAnswer(state: typeof AgentState.State) {
  const response = await llm.invoke([
    new SystemMessage(
      "You are a helpful assistant for Meridian Properties Corp. " +
      "Answer based ONLY on the provided context. " +
      "Cite sources in brackets like [mall_directory.csv]. " +
      "If context is empty or insufficient, say so honestly."
    ),
    new HumanMessage(
      `User question: ${state.query}\n\n` +
      `Intent: ${state.intent}\n\n` +
      `Retrieved context:\n${JSON.stringify(state.context, null, 2)}\n\n` +
      `Sources: ${state.sources.join(", ")}`
    ),
  ]);

  const answer = response.content as string;
  console.log(`[generate_answer] Generated ${answer.length} chars`);
  return { answer, messages: [response] };
}

// ============================================
// STEP 3: The routing function
// ============================================
// This is the KEY — it reads state.intent and returns
// the NAME of the next node to go to

function routeByIntent(state: typeof AgentState.State) {
  console.log(`[route] Routing to → ${state.intent}`);

  switch (state.intent) {
    case "shopper_assistant":
      return "retrieve_mall";
    case "property_inquiry":
      return "retrieve_property";
    default:
      return "handle_unknown";
  }
}

// ============================================
// STEP 4: Build the graph with conditional edges
// ============================================
const graph = new StateGraph(AgentState)
  // Add all nodes
  .addNode("extract_query", extractQuery)
  .addNode("classify_intent", classifyIntent)
  .addNode("retrieve_mall", retrieveMall)
  .addNode("retrieve_property", retrieveProperty)
  .addNode("handle_unknown", handleUnknown)
  .addNode("generate_answer", generateAnswer)

  // Linear edges
  .addEdge(START, "extract_query")
  .addEdge("extract_query", "classify_intent")

  // CONDITIONAL EDGE — this is the intent router!
  // After classify_intent, call routeByIntent() to decide next node
  .addConditionalEdges("classify_intent", routeByIntent, {
    retrieve_mall: "retrieve_mall",
    retrieve_property: "retrieve_property",
    handle_unknown: "handle_unknown",
  })

  // All retrieval paths converge to generate_answer
  .addEdge("retrieve_mall", "generate_answer")
  .addEdge("retrieve_property", "generate_answer")
  .addEdge("handle_unknown", END)  // unknown skips answer generation — already has answer

  .addEdge("generate_answer", END)
  .compile();

// ============================================
// STEP 5: Test all three paths
// ============================================
async function main() {
  // PATH 1: shopper_assistant
  console.log("═══════════════════════════════════════");
  console.log("  Question 1: Mall query (shopper path)");
  console.log("═══════════════════════════════════════");
  const result1 = await graph.invoke({
    messages: [new HumanMessage("Where can I find Korean food at Mercado Village?")],
  });
  console.log("\n  intent:", result1.intent);
  console.log("  sources:", result1.sources);
  console.log("  answer:", result1.answer.substring(0, 200));

  // PATH 2: property_inquiry
  console.log("\n═══════════════════════════════════════");
  console.log("  Question 2: Property query (property path)");
  console.log("═══════════════════════════════════════");
  const result2 = await graph.invoke({
    messages: [new HumanMessage("Do you have studio units under 5 million?")],
  });
  console.log("\n  intent:", result2.intent);
  console.log("  sources:", result2.sources);
  console.log("  answer:", result2.answer.substring(0, 200));

  // PATH 3: unknown
  console.log("\n═══════════════════════════════════════");
  console.log("  Question 3: Out of scope (unknown path)");
  console.log("═══════════════════════════════════════");
  const result3 = await graph.invoke({
    messages: [new HumanMessage("What is the weather today?")],
  });
  console.log("\n  intent:", result3.intent);
  console.log("  sources:", result3.sources);
  console.log("  answer:", result3.answer.substring(0, 200));

  // PATH 4: Cross-intent (tricky one from the test!)
  console.log("\n═══════════════════════════════════════");
  console.log("  Question 4: Cross-intent (mall → property)");
  console.log("═══════════════════════════════════════");
  const result4 = await graph.invoke({
    messages: [new HumanMessage("I am at Solana Mall, tell me about the nearby condos.")],
  });
  console.log("\n  intent:", result4.intent);
  console.log("  sources:", result4.sources);
  console.log("  answer:", result4.answer.substring(0, 200));
}

main().catch(console.error);
