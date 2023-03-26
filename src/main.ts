import { ChatGPTWebUI } from "./chat_gtp_web_ui.ts";
import { ChatGPTCompletionAPI } from "./chat_gpt_completion_api.ts";
import { Geppetto } from "./geppetto.ts";
import { GeppettoCLI } from "./geppetto_cli.ts";

function getChatGPTClient() {
  const cookie = Deno.env.get("CHAT_GPT_COOKIE");
  if (cookie) {
    return new ChatGPTWebUI(cookie);
  }

  const openAIAPIKey = Deno.env.get("OPENAI_API_KEY");
  if (openAIAPIKey) {
    return new ChatGPTCompletionAPI(openAIAPIKey);
  }

  throw new Error(
    "Neither the CHAT_GPT_COOKIE nor the OPENAI_API_KEY environment variable is set!"
  );
}

const chatGPT = getChatGPTClient();
const geppetto = new Geppetto(chatGPT);
const geppetoCLI = new GeppettoCLI(geppetto);

await geppetoCLI.startInteractive();
