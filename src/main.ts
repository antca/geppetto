import chalk from "npm:chalk";

import { ChatGPT } from "./chat_gtp.ts";
import { Geppetto } from "./geppetto.ts";

const textEncoder = new TextEncoder();

const cookie = Deno.env.get("CHAT_GPT_COOKIE");

if (!cookie) {
  throw new Error("CHAT_GPT_COOKIE env variable is not set!");
}

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
        {
          const color = responsePart.value.ignored ? chalk.gray : chalk.green;
          await Deno.stdout.write(
            textEncoder.encode(color(responsePart.value.text))
          );
        }
        break;
      case "ConfirmRunCommand": {
        const response = confirm(chalk.green("\nRun command?"));
        responsePart = await geppettoResponse.value.next(response);
        continue;
      }
      case "CommandsResultOverflow": {
        const response = prompt(
          chalk.green(
            `\nResults length exceeds the limit (${responsePart.value.length}/${responsePart.value.defaultValue}), how many characters do you want to send to ChatGPT?`
          ),
          responsePart.value.defaultValue.toString()
        );
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
