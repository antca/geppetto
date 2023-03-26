import { Geppetto } from "./geppetto.ts";

const format = {
  boldYellow(text: string) {
    return `\x1b[33m\x1b[1m${text}\x1b[22m\x1b[39m`;
  },
  boldBlue(text: string) {
    return `\x1b[34m\x1b[1m${text}\x1b[22m\x1b[39m`;
  },
  gray(text: string) {
    return `\x1b[90m${text}\x1b[39m`;
  },
  green(text: string) {
    return `\x1b[32m${text}\x1b[39m`;
  },
};

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
              this.textEncoder.encode(`${format.boldBlue("Geppetto:")} `)
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
                ? format.gray
                : format.green;
              await this.writeOutput(color(responsePart.value.text));
            }
            break;
          case "ConfirmRunCommand": {
            await this.writeOutput(format.green("\nRun command? [y/N]: "));
            const response = (await this.readUserInput()).toLowerCase() === "y";
            responsePart = await geppettoResponse.value.next(response);
            continue;
          }
          case "CommandsResultOverflow": {
            const defaultValue = responsePart.value.defaultValue.toString();
            await this.writeOutput(
              format.green(
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
        this.textEncoder.encode(format.boldYellow("You: "))
      );

      const userInput = await this.readUserInput();
      geppettoResponse = await geppettoGen.next(userInput);
    }
  }
}
