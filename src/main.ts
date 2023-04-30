import { ChatGPTWebUI } from "./chat_gtp_web_ui.ts";
import { ChatGPTCompletionAPI } from "./chat_gpt_completion_api.ts";
import { Geppetto } from "./geppetto.ts";
import { GeppettoCLI } from "./geppetto_cli.ts";
import { ChatGPTWebUIChromiumAuth } from "./chat_gpt_web_ui_chromium_auth.ts";
import { ChatGPTWebUIEnvAuth } from "./chat_gpt_web_ui_env_auth.ts";

async function getChatGPTWebUIAuthProvider() {
  const cookie = Deno.env.get("CHAT_GPT_COOKIE");
  if (cookie) {
    const userAgent = Deno.env.get("CHAT_GPT_USER_AGENT");
    if (!userAgent) {
      throw new Error(
        "The CHAT_GPT_USER_AGENT environment variable must be set when using cookie authentication!",
      );
    }
    return new ChatGPTWebUIEnvAuth(cookie, userAgent);
  }

  const chromiumAuth = new ChatGPTWebUIChromiumAuth();
  if (await chromiumAuth.hasStoredHeaders()) {
    return chromiumAuth;
  }
  const useChromiumAuthProvider = confirm(
    `It seems that an authentication method has not been set up yet.

You can choose from the following options:

- (Official, Manual) Obtain a valid API key from https://platform.openai.com/account/api-keys and assign it to the OPENAI_API_KEY variable.
- (Unofficial, Manual) Configure both CHAT_GPT_COOKIE and CHAT_GPT_USER_AGENT environment variables. Find their values in the developer tools while visiting https://chat.openai.com.
- (Unofficial, Automatic) Use Chromium in debug mode to authenticate at https://chat.openai.com.

For further details, please consult the documentation.

To proceed with one of the manual methods, respond with "n" and the program will exit.
If you'd like to authenticate automatically using Chromium in debug mode (Chromium required), reply with "y".

Would you like to authenticate using Chromium now?`,
  );
  if (useChromiumAuthProvider) {
    return chromiumAuth;
  }
}

async function getChatGPTClient() {
  const openAIAPIKey = Deno.env.get("OPENAI_API_KEY");
  if (openAIAPIKey) {
    return new ChatGPTCompletionAPI(openAIAPIKey);
  }

  const chatGPTWebUIAuthProvider = await getChatGPTWebUIAuthProvider();
  if (!chatGPTWebUIAuthProvider) {
    return null;
  }
  return new ChatGPTWebUI(chatGPTWebUIAuthProvider);
}

const chatGPT = await getChatGPTClient();

if (!chatGPT) {
  console.info("No ChatGPT client configured, exiting...");
  Deno.exit(0);
}

const geppetto = new Geppetto(chatGPT);
const geppetoCLI = new GeppettoCLI(geppetto);

await geppetoCLI.startInteractive();
