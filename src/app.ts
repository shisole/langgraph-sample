import "dotenv/config";
import * as readline from "readline";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { graph } from "./graph.js";

const DEBUG = process.env.DEBUG === "true";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Meridian Properties Corp. — AI Assistant      ║");
  console.log("║                                                 ║");
  console.log("║   Ask about our malls, stores, events,          ║");
  console.log("║   products, or residential properties.          ║");
  console.log("║                                                 ║");
  console.log("║   Type 'quit' or 'exit' to end the session.     ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();

  const conversationHistory: BaseMessage[] = [];

  while (true) {
    const input = await prompt("You: ");
    const trimmed = input.trim();

    if (!trimmed) continue;
    if (["quit", "exit", "q"].includes(trimmed.toLowerCase())) {
      console.log("\nThank you for using the Meridian Properties assistant. Goodbye!");
      break;
    }

    try {
      conversationHistory.push(new HumanMessage(trimmed));

      const result = await graph.invoke({
        messages: conversationHistory,
      });

      conversationHistory.push(new AIMessage(result.answer));

      if (DEBUG) {
        console.log(`\n[Intent: ${result.intent}]`);
      }
      console.log("─".repeat(50));
      console.log(result.answer);

      if (result.sources.length > 0) {
        console.log("─".repeat(50));
        console.log("Sources:", result.sources.join(", "));
      }
      console.log();
    } catch (error) {
      console.error("\nSorry, I encountered an error processing your request.");
      console.error("Please try again or rephrase your question.\n");
    }
  }

  rl.close();
}

main().catch(console.error);
