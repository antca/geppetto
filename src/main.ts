import chalk from "npm:chalk";

import { ChatGPT } from "./chat_gtp.ts";
import { Geppetto } from "./geppetto.ts";

const fileContents = await Deno.readFile(".chat_gpt_cookie.txt");
const cookie = new TextDecoder().decode(fileContents);

const chatGPT = new ChatGPT(cookie);

const geppetto = new Geppetto(chatGPT, (message: string) => {
  const geppettoName = chalk.blue.bold("Geppetto:");
  const userName = chalk.yellow.bold("You:");

  const userMessage = prompt(`\n${geppettoName} ${message}\n\n${userName}`);
  if (!userMessage) {
    throw new Error("No message from prompt!");
  }
  return Promise.resolve(userMessage);
});
geppetto.start();
