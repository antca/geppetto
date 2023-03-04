import chalk from "npm:chalk";

import { ChatGPT } from "./chat_gtp.ts";
import { Geppetto } from "./geppetto.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const cookieFileContent = await Deno.readFile(".chat_gpt_cookie.txt");
const cookie = textDecoder.decode(cookieFileContent);

const chatGPT = new ChatGPT(cookie);
const geppetto = new Geppetto(chatGPT);

const geppettoGen = geppetto.start();
let geppettoResponse = await geppettoGen.next();
while (!geppettoResponse.done) {
  for await (const responsePart of geppettoResponse.value) {
    switch (responsePart.type) {
      case "NewMessage":
        Deno.stdout.write(
          textEncoder.encode(`${chalk.blue.bold("Geppetto:")} `)
        );
        break;
      case "MessageChunk":
        Deno.stdout.write(textEncoder.encode(responsePart.text));
        break;
      case "CommandResult":
        Deno.stdout.write(textEncoder.encode(chalk.green(responsePart.text)));
        break;
    }
  }
  const userMessage = prompt(chalk.yellow.bold("You:"));
  if (!userMessage) {
    throw new Error("No message from prompt!");
  }
  geppettoResponse = await geppettoGen.next(userMessage);
}
