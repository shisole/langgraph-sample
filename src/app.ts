import "dotenv/config";
import * as readline from "readline";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { graph, type AgentStateType } from "./graph.js";

const DEBUG = process.env.DEBUG === "true";
const VERBOSE = process.env.VERBOSE === "true";

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

      const stream = await graph.stream(
        { messages: conversationHistory },
        { streamMode: ["messages", "values"] }
      );

      let streamedAnswer = "";
      let finalState: AgentStateType | null = null;
      let hasStreamed = false;

      console.log("─".repeat(50));

      for await (const chunk of stream) {
        if (chunk[0] === "messages") {
          const [, [message, metadata]] = chunk as unknown as [string, [{ content: unknown }, { langgraph_node: string }]];
          if (
            metadata.langgraph_node === "generate_answer" &&
            typeof message.content === "string" &&
            message.content.length > 0
          ) {
            process.stdout.write(message.content);
            streamedAnswer += message.content;
            hasStreamed = true;
          }
        } else if (chunk[0] === "values") {
          finalState = chunk[1] as AgentStateType;
        }
      }

      const answer = hasStreamed ? streamedAnswer : (finalState?.answer ?? "");

      if (hasStreamed) {
        process.stdout.write("\n");
      } else {
        // handle_unknown or LLM error fallback — print as a block
        console.log(answer);
      }

      // Note: [Intent:] now prints after the answer (previously printed before).
      // This is intentional — the intent is only known after the stream completes.
      if (DEBUG && finalState) {
        console.log(`\n[Intent: ${finalState.intent}]`);
      }
      if (VERBOSE && finalState && finalState.sources.length > 0) {
        console.log("─".repeat(50));
        console.log("Sources:", finalState.sources.join(", "));
      }
      console.log();

      // Only push a non-empty answer to avoid corrupting conversation history
      if (answer) {
        conversationHistory.push(new AIMessage(answer));
      }
    } catch (error) {
      console.error("\nSorry, I encountered an error processing your request.");
      console.error("Please try again or rephrase your question.\n");
    }
  }

  rl.close();
}

main().catch(console.error);
