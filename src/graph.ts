import "dotenv/config";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { searchAllMallData, searchAllPropertyData } from "./tools.js";

export const AgentState = Annotation.Root({
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
    reducer: (_current, update) => update,
    default: () => [],
  }),
  answer: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  sources: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;

// ── LLM setup (conditional on API key) ──────────────────────────────
const USE_MOCK = !process.env.ANTHROPIC_API_KEY;

if (USE_MOCK) {
  console.log("[mock-mode] No ANTHROPIC_API_KEY found — running with deterministic mock LLM");
}

async function createLlm() {
  const { ChatAnthropic } = await import("@langchain/anthropic");
  return new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: 0,
  });
}

function extractQuery(state: AgentStateType) {
  const lastMessage = state.messages[state.messages.length - 1];
  const query = typeof lastMessage.content === "string" ? lastMessage.content : "";
  return { query };
}

// ── Mock intent classifier (keyword-based) ──────────────────────────
const MALL_KEYWORDS = [
  "mall", "store", "shop", "event", "food", "dining", "parking",
  "hours", "product", "restaurant", "coffee", "shoe", "korean",
];
const PROPERTY_KEYWORDS = [
  "property", "properties", "condo", "condos", "unit", "bedroom",
  "amenity", "amenities", "price", "development", "tower", "studio",
  "residential", "sqm",
];
const MALL_NAMES = [
  "solana mall", "parkview shopping center", "mercado village", "the atrium",
];
const PROPERTY_NAMES = [
  "central park towers", "the pinnacle", "verde gardens",
  "willow grove", "skyline residences",
];

function mockClassifyIntent(state: AgentStateType): { intent: AgentStateType["intent"] } {
  const q = state.query.toLowerCase();

  // Cross-intent: mall name mentioned but asking about property topics
  const mentionsMall = MALL_NAMES.some((name) => q.includes(name));
  const mentionsProperty = PROPERTY_NAMES.some((name) => q.includes(name));
  const hasPropertyKeyword = PROPERTY_KEYWORDS.some((kw) => q.includes(kw));
  const hasMallKeyword = MALL_KEYWORDS.some((kw) => q.includes(kw));

  if (mentionsMall && hasPropertyKeyword) {
    return { intent: "property_inquiry" };
  }
  if (mentionsProperty && hasMallKeyword) {
    return { intent: "shopper_assistant" };
  }

  if (hasPropertyKeyword || mentionsProperty) {
    return { intent: "property_inquiry" };
  }
  if (hasMallKeyword || mentionsMall) {
    return { intent: "shopper_assistant" };
  }

  return { intent: "unknown" };
}

// ── Mock answer generator (template-based) ──────────────────────────
function mockGenerateAnswer(state: AgentStateType): { answer: string } {
  const lines: string[] = [];
  lines.push(`Here's what I found for your query: "${state.query}"\n`);

  for (const record of state.context) {
    const entries = Object.entries(record)
      .map(([key, value]) => `  - **${key}**: ${String(value)}`)
      .join("\n");
    lines.push(entries);
    lines.push("");
  }

  if (state.sources.length > 0) {
    const citations = state.sources.map((s) => `[${s}]`).join(" ");
    lines.push(`Sources: ${citations}`);
  }

  lines.push("\n*(mock mode — no LLM was used to generate this answer)*");

  return { answer: lines.join("\n") };
}

// ── Real LLM intent classifier ──────────────────────────────────────
async function llmClassifyIntent(state: AgentStateType) {
  try {
    const llm = await createLlm();
    const response = await llm.invoke([
      new SystemMessage(
        `You are an intent classifier for Meridian Properties Corp. customer service chatbot.
Classify the user's message into exactly one category.

Respond with ONLY one of these exact words (no quotes, no extra text):
- shopper_assistant — questions about malls, stores, shopping, events, products, food, dining, parking at malls, mall hours, mall facilities
- property_inquiry — questions about residential properties, condos, units, apartments, townhouses, pricing, amenities, developments, real estate
- unknown — anything outside these two areas (weather, politics, general knowledge, etc.)

Important:
- If the user mentions a mall but asks about nearby condos/properties, classify as "property_inquiry"
- If the user mentions a development but asks about nearby malls/stores, classify as "shopper_assistant"
- Focus on what INFORMATION the user wants, not which entity they mention`
      ),
      new HumanMessage(state.query),
    ]);

    const raw = String(response.content).trim().toLowerCase();
    const validIntents = ["shopper_assistant", "property_inquiry"];
    const intent: AgentStateType["intent"] = validIntents.includes(raw)
      ? (raw as "shopper_assistant" | "property_inquiry")
      : "unknown";

    return { intent };
  } catch (error) {
    console.error("[classify_intent] LLM call failed, defaulting to unknown:", error);
    const intent: AgentStateType["intent"] = "unknown";
    return { intent };
  }
}

// ── Dispatchers (pick mock or real based on API key) ────────────────
async function classifyIntent(state: AgentStateType) {
  if (USE_MOCK) {
    return mockClassifyIntent(state);
  }
  return llmClassifyIntent(state);
}

function retrieveMall(state: AgentStateType) {
  const results = searchAllMallData(state.query);
  const context: Record<string, unknown>[] = results.map((r) => ({ ...r.data }));
  const sources = [...new Set(results.map((r) => r.source))];
  return { context, sources };
}

function retrieveProperty(state: AgentStateType) {
  const results = searchAllPropertyData(state.query);
  const context: Record<string, unknown>[] = results.map((r) => ({ ...r.data }));
  const sources = [...new Set(results.map((r) => r.source))];
  return { context, sources };
}

function handleUnknown(_state: AgentStateType) {
  return {
    answer:
      "I appreciate your question, but that falls outside my area of expertise. " +
      "I'm the Meridian Properties assistant and I can help you with:\n\n" +
      "- **Mall & Shopping**: Store directories, events, products, parking, and mall hours " +
      "at Solana Mall, Parkview Shopping Center, Mercado Village, and The Atrium\n" +
      "- **Property Inquiries**: Unit availability, pricing, amenities, and features " +
      "at Central Park Towers, The Pinnacle, Verde Gardens, Willow Grove, and Skyline Residences\n\n" +
      "Please feel free to ask about any of these topics!",
    sources: [],
    context: [],
  };
}

async function llmGenerateAnswer(state: AgentStateType) {
  try {
    const llm = await createLlm();
    const contextStr = JSON.stringify(state.context, null, 2);
    const sourcesStr = state.sources.join(", ");

    const response = await llm.invoke([
      new SystemMessage(
        `You are a friendly, professional customer service assistant for Meridian Properties Corp.
You help customers with mall/shopping inquiries and property/residential questions.

STRICT RULES:
1. Answer based ONLY on the provided context data. Never invent information.
2. Cite your sources using brackets, e.g., [mall_directory.csv] or [property_listings.csv].
3. If the context does not contain enough information to fully answer the question, explicitly state what information is missing and suggest the customer contact Meridian Properties directly.
4. Format prices clearly (e.g., PHP 14,000,000 or PHP 14M).
5. Be conversational and helpful — you represent Meridian Properties to customers.
6. When listing multiple items, use a clear format (bullet points or numbered list).
7. Include relevant details like hours, location, contact info when available.`
      ),
      new HumanMessage(
        `User question: ${state.query}\n\n` +
          `Intent: ${state.intent}\n\n` +
          `Retrieved context:\n${contextStr}\n\n` +
          `Data sources: ${sourcesStr}\n\n` +
          `Provide a helpful, grounded answer with source citations.`
      ),
    ]);

    const answer = String(response.content);
    return { answer, messages: [response] };
  } catch (error) {
    console.error("[generate_answer] LLM call failed:", error);
    return {
      answer:
        "I'm sorry, I'm having trouble generating a response right now. " +
        "Please try again in a moment. If the issue persists, you can contact " +
        "Meridian Properties directly for assistance.",
    };
  }
}

async function generateAnswer(state: AgentStateType) {
  if (USE_MOCK) {
    return mockGenerateAnswer(state);
  }
  return llmGenerateAnswer(state);
}

function routeByIntent(state: AgentStateType) {
  switch (state.intent) {
    case "shopper_assistant":
      return "retrieve_mall";
    case "property_inquiry":
      return "retrieve_property";
    default:
      return "handle_unknown";
  }
}

const workflow = new StateGraph(AgentState)
  // Classification and retrieval nodes
  .addNode("extract_query", extractQuery)
  .addNode("classify_intent", classifyIntent)
  .addNode("retrieve_mall", retrieveMall)
  .addNode("retrieve_property", retrieveProperty)
  .addNode("handle_unknown", handleUnknown)
  .addNode("generate_answer", generateAnswer)

  // Where it starts
  .addEdge(START, "extract_query")
  .addEdge("extract_query", "classify_intent")
  .addConditionalEdges("classify_intent", routeByIntent, {
    retrieve_mall: "retrieve_mall",
    retrieve_property: "retrieve_property",
    handle_unknown: "handle_unknown",
  })
  .addEdge("retrieve_mall", "generate_answer")
  .addEdge("retrieve_property", "generate_answer")
  .addEdge("generate_answer", END)
  .addEdge("handle_unknown", END);

export const graph = workflow.compile();
