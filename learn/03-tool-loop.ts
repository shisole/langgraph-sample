/**
 * LESSON 3: The Manual Tool Loop
 *
 * In Lesson 2, the LLM wanted to call tools multiple times but we only
 * handled one round. This lesson shows the full manual loop.
 *
 * After this, you'll see why LangGraph exists — it automates this exact loop.
 */

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  BaseMessage,
  AIMessage,
} from "@langchain/core/messages";

// Same tools from Lesson 2
const searchMallDirectory = tool(
  async ({ mallName, category }) => {
    const mockData: Record<string, Record<string, string[]>> = {
      "Solana Mall": {
        Sportswear: ["Nike - 2F, 10:00-21:00"],
        "Coffee & Cafe": ["Starbucks - GF, 07:00-22:00"],
        Electronics: ["Samsung - 2F, 10:00-21:00"],
        Apparel: ["Uniqlo - 1F, 10:00-21:00"],
        "Health & Beauty": ["Watsons - GF, 10:00-21:00"],
      },
      "Mercado Village": {
        "Restaurant - Korean": ["Seoul Kitchen - Food Village, 11:00-22:00"],
        "Restaurant - Filipino": ["Grill House - Food Village, 11:00-22:00"],
      },
    };

    const mall = mockData[mallName];
    if (!mall) return JSON.stringify({ error: `Mall "${mallName}" not found`, source: "mall_directory.csv" });

    if (category) {
      const matches = Object.entries(mall)
        .filter(([cat]) => cat.toLowerCase().includes(category.toLowerCase()))
        .flatMap(([cat, stores]) => stores.map((s) => `[${cat}] ${s}`));
      return JSON.stringify({ mall: mallName, results: matches, source: "mall_directory.csv" });
    }

    const allStores = Object.entries(mall).flatMap(([cat, stores]) =>
      stores.map((s) => `[${cat}] ${s}`)
    );
    return JSON.stringify({ mall: mallName, results: allStores, source: "mall_directory.csv" });
  },
  {
    name: "search_mall_directory",
    description: "Search for stores, restaurants, or services in a specific mall.",
    schema: z.object({
      mallName: z.string().describe("The name of the mall"),
      category: z.string().optional().describe("Optional category filter"),
    }),
  }
);

const searchProperties = tool(
  async ({ development, bedrooms }) => {
    const mockData = [
      { development: "Central Park Towers", unit_type: "2BR", bedrooms: 2, area: 68, price: "25M-35M", status: "Available" },
      { development: "Central Park Towers", unit_type: "Studio", bedrooms: 0, area: 28, price: "8M-10M", status: "Available" },
      { development: "Verde Gardens", unit_type: "Studio", bedrooms: 0, area: 24, price: "4.5M-6M", status: "Available" },
      { development: "Willow Grove", unit_type: "Studio", bedrooms: 0, area: 22, price: "3.8M-5M", status: "Available" },
    ];

    let results = mockData;
    if (development) results = results.filter((r) => r.development.toLowerCase().includes(development.toLowerCase()));
    if (bedrooms !== undefined) results = results.filter((r) => r.bedrooms === bedrooms);

    return JSON.stringify({ results, source: "property_listings.csv" });
  },
  {
    name: "search_properties",
    description: "Search for available property listings by development name and bedrooms.",
    schema: z.object({
      development: z.string().optional().describe("Development name"),
      bedrooms: z.number().optional().describe("Number of bedrooms (0 for studio)"),
    }),
  }
);

// Map tool names to tool instances for easy lookup
const toolMap: Record<string, typeof searchMallDirectory | typeof searchProperties> = {
  search_mall_directory: searchMallDirectory,
  search_properties: searchProperties,
};

async function main() {
  const llm = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: 0,
  });

  const llmWithTools = llm.bindTools([searchMallDirectory, searchProperties]);

  // The conversation messages array — this is our "state"
  const messages: BaseMessage[] = [
    new SystemMessage(
      "You are a helpful assistant for Meridian Properties. " +
      "Always use your tools to search for information before responding. " +
      "If the user doesn't specify a development or mall, search across all. " +
      "Always cite your sources like [mall_directory.csv] when referencing data."
    ),
    new HumanMessage("Do you have studio units under 5 million pesos? any development"),
  ];

  // console.log("User: What stores sell running shoes at Solana Mall?\n");

  // ============================================
  // THE LOOP — this is what LangGraph automates
  // ============================================
  let iteration = 0;
  const MAX_ITERATIONS = 5; // Safety limit to prevent infinite loops

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`--- Iteration ${iteration} ---`);

    // Step 1: Call the LLM
    const response = await llmWithTools.invoke(messages);
    messages.push(response); // Add AI response to history

    // Step 2: Check if LLM wants to call tools
    if (!response.tool_calls || response.tool_calls.length === 0) {
      // No tool calls — LLM is done, print final answer
      console.log("LLM is done (no more tool calls)");
      console.log("\nFinal Answer:", response.content);
      break;
    }

    // Step 3: Execute each tool call
    for (const toolCall of response.tool_calls) {
      console.log(`LLM calls: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

      const toolFn = toolMap[toolCall.name];
      if (!toolFn) {
        console.log(`Unknown tool: ${toolCall.name}`);
        continue;
      }

      const result = await toolFn.invoke(toolCall.args);
      console.log(`Tool result: ${result}\n`);

      // Step 4: Add tool result to messages
      messages.push(
        new ToolMessage({
          content: result,
          tool_call_id: toolCall.id!,
        })
      );
    }

    // Loop back — LLM will see the tool results and either
    // call another tool or give a final answer
  }

  if (iteration >= MAX_ITERATIONS) {
    console.log("Hit max iterations — stopping.");
  }

  console.log(`\nTotal iterations: ${iteration}`);
  console.log(`Total messages: ${messages.length}`);
}

main().catch(console.error);
