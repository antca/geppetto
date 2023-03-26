import chalk from "npm:chalk";

import { Geppetto } from "./geppetto.ts";

export class GeppettoCLI {
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  constructor(private readonly geppetto: Geppetto) {}

  private async readUserInput() {
    const reader = Deno.stdin.readable.getReader();

    let useInput = "";

    while (!useInput.endsWith("\n")) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      useInput += this.textDecoder.decode(value);
    }

    reader.releaseLock();

    return useInput.trim();
  }

  private writeOutput(text: string) {
    return Deno.stdout.write(this.textEncoder.encode(text));
  }

  async startInteractive() {
    const geppettoGen = this.geppetto.start();
    let geppettoResponse = await geppettoGen.next();
    while (!geppettoResponse.done) {
      let responsePart = await geppettoResponse.value.next();
      while (!responsePart.done) {
        switch (responsePart.value.type) {
          case "NewMessage":
            await Deno.stdout.write(
              this.textEncoder.encode(`${chalk.blue.bold("Geppetto:")} `)
            );
            break;
          case "MessageChunk":
            await Deno.stdout.write(
              this.textEncoder.encode(responsePart.value.text)
            );
            break;
          case "CommandResult":
            {
              const color = responsePart.value.ignored
                ? chalk.gray
                : chalk.green;
              await this.writeOutput(color(responsePart.value.text));
            }
            break;
          case "ConfirmRunCommand": {
            await this.writeOutput(chalk.green("\nRun command? [y/N]: "));
            const response = (await this.readUserInput()).toLowerCase() === "y";
            responsePart = await geppettoResponse.value.next(response);
            continue;
          }
          case "CommandsResultOverflow": {
            const defaultValue = responsePart.value.defaultValue.toString();
            await this.writeOutput(
              chalk.green(
                `\nResults length exceeds the limit (${responsePart.value.length}/${responsePart.value.defaultValue}), how many characters do you want to send to ChatGPT? (default: ${defaultValue}): `
              )
            );
            let response = await this.readUserInput();
            if (response === "") {
              response = responsePart.value.defaultValue.toString();
            }
            responsePart = await geppettoResponse.value.next(response);
            continue;
          }
        }
        responsePart = await geppettoResponse.value.next();
      }

      await Deno.stdout.write(
        this.textEncoder.encode(chalk.yellow.bold("You: "))
      );

      const userInput = await this.readUserInput();
      geppettoResponse = await geppettoGen.next(userInput);
    }
  }
}
