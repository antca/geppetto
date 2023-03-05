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
  let responsePart = await geppettoResponse.value.next();
  while (!responsePart.done) {
    switch (responsePart.value.type) {
      case "NewMessage":
        await Deno.stdout.write(
          textEncoder.encode(`${chalk.blue.bold("Geppetto:")} `)
        );
        break;
      case "MessageChunk":
        await Deno.stdout.write(textEncoder.encode(responsePart.value.text));
        break;
      case "CommandResult":
        await Deno.stdout.write(
          textEncoder.encode(chalk.green(responsePart.value.text))
        );
        break;
      case "ConfirmRunCommand": {
        const response = confirm(chalk.green("\nRun command?"));
        responsePart = await geppettoResponse.value.next(response);
        continue;
      }
    }
    responsePart = await geppettoResponse.value.next();
  }
  const userMessage = prompt(chalk.yellow.bold("You:"));
  if (!userMessage) {
    throw new Error("No message from prompt!");
  }
  geppettoResponse = await geppettoGen.next(userMessage);
}
