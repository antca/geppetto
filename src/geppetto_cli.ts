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

function setupSignalTrap(signal: Deno.Signal, handler: () => void) {
  Deno.addSignalListener(signal, handler);
  return () => {
    Deno.removeSignalListener(signal, handler);
  };
}

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

    return useInput;
  }

  private writeOutput(text: string) {
    return Deno.stdout.write(this.textEncoder.encode(text));
  }

  async startInteractive() {
    const geppettoGen = this.geppetto.start();
    let geppettoResponse = await geppettoGen.next();
    while (!geppettoResponse.done) {
      let interrupted = false;
      const removeInterruptTrap = setupSignalTrap("SIGINT", () => {
        interrupted = true;
      });

      let responsePart = await geppettoResponse.value.next();
      while (!responsePart.done && !interrupted) {
        switch (responsePart.value.type) {
          case "NewMessage":
            await this.writeOutput(`${format.boldBlue("Geppetto:")} `);
            break;
          case "MessageChunk":
            await this.writeOutput(responsePart.value.text);
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
            const response =
              (await this.readUserInput()).trim().toLowerCase() === "y";
            responsePart = await geppettoResponse.value.next(response);
            continue;
          }
          case "CommandsResultOverflow": {
            const defaultValue = responsePart.value.defaultValue.toString();
            await this.writeOutput(
              format.green(
                `\nResults length exceeds the limit (${responsePart.value.length}/${responsePart.value.defaultValue}), how many characters do you want to send to ChatGPT? (default: ${defaultValue}): `,
              ),
            );
            let response = await this.readUserInput();
            if (response.trim() === "") {
              response = responsePart.value.defaultValue.toString();
            }
            responsePart = await geppettoResponse.value.next(response);
            continue;
          }
        }
        responsePart = await geppettoResponse.value.next();
      }

      removeInterruptTrap();
      if (interrupted) {
        await geppettoResponse.value.return(undefined);
        Deno.stdout.writeSync(this.textEncoder.encode("\n"));
        interrupted = false;
      }

      await this.writeOutput(format.boldYellow("You: "));

      const userInput = await this.readUserInput();

      if (userInput === "") {
        return;
      }

      geppettoResponse = await geppettoGen.next(userInput.trim());
    }
  }
}
