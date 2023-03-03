import chalk from "npm:chalk";

import { ChatGPT } from "./chat_gtp.ts";
import { Geppetto } from "./geppetto.ts";

const cookieFileContent = await Deno.readFile(".chat_gpt_cookie.txt");
const cookie = new TextDecoder().decode(cookieFileContent);

const chatGPT = new ChatGPT(cookie);

const geppetto = new Geppetto(chatGPT, (messages: string[]) => {
  const geppettoMessages = messages
    .map((geppettoMessage) => {
      const geppettoName = chalk.blue.bold("Geppetto:");
      return `${geppettoName} ${geppettoMessage}`;
    })
    .join("\n");
  const userName = chalk.yellow.bold("You:");

  const userMessage = prompt(`${geppettoMessages}\n${userName}`);
  if (!userMessage) {
    throw new Error("No message from prompt!");
  }
  return Promise.resolve(userMessage);
});
geppetto.start();
