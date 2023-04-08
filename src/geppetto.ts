import { iterateReader } from "https://deno.land/std@0.122.0/streams/mod.ts";
import * as path from "https://deno.land/std/path/mod.ts";

import {
  type IChatGPT,
  type IChatGPTConversation,
  type ChatGPTMessagePart,
} from "./chat_gpt.ts";

const shellEnvVariable = Deno.env.get("SHELL");

if (!shellEnvVariable) {
  throw new Error("SHELL environment variable is not set!");
}

const shell = shellEnvVariable;

const decoder = new TextDecoder();

async function run(command: string) {
  const cmd = Deno.run({
    cmd: [shell, "-lc", command],
    stdout: "piped",
  });

  const output = await cmd.output();

  return decoder.decode(output);
}

async function getOSInfo() {
  const osInfo = await run(`
    (
        if [ -e /etc/os-release ]; then
            . /etc/os-release
            echo "$NAME $VERSION"
        elif [ -e /etc/lsb-release ]; then
            . /etc/lsb-release
            echo "$DISTRIB_DESCRIPTION"
        elif [ "$(uname -s)" = "Darwin" ]; then
            echo "macOS $(sw_vers -productVersion)"
        else
            echo "$(uname -s) $(uname -r)"
        fi
    ) 2> /dev/null
`);
  return osInfo.trim();
}

async function getPrompt(cwd: string) {
  let hints = "";

  const hintsFilePath = path.format({ dir: cwd, name: ".hints.txt" });

  try {
    const hintsFileContent = await Deno.readFile(hintsFilePath);
    hints = new TextDecoder().decode(hintsFileContent);
  } catch (_error) {
    hints = "<no hint yet>";
  }

  return `An operating system agent is participating in the conversation.

You can include shell commands to run on the user's computer in your messages, the agent will execute them.

Here is an example how you can ask the agent to run a command, it's called "the command syntax":
=== COMMAND START ===
<command>
=== COMMAND END ===

The agent can only run shell commands.

When a command appears in a message, the text stream of this message is paused while the user reviews the command.
The text stream continues once the user has either confirmed or declined the execution of the command.
Once the text stream of the message is finished, the agent will collect all the command's results and send them as a new message in the conversation using the "system" role:
=== COMMAND RESULT START ===
<command output>
=== COMMAND RESULT END (status: <status code>) ===

The output of the command may be truncated or empty, refer to the status code to know if a command succeded.
The current directory is "${cwd}".
The operating system is: "${await getOSInfo()}"
The shell is: "${shell}"

Here is an example of a conversation:

The participants are: "Assistant" (you) (role: "assistant"), "User" (role: "user"), "Agent" (role: "system")

<<User>> What time is it ?
<<Assistant>> === COMMAND START ===
date +'%r %Z'
=== COMMAND END ===
<<Agent>> === COMMAND RESULT START ===
12:00:20 PM UTC
=== COMMAND RESULT END (status: 0) ===
<<Assistant>> The current time is: 12:00:20 PM UTC
<<User>> Thank you!


Additional hints (it's the content of the ".hints.txt" file stored in the current directory):
${hints}

You will now act as Geppetto, a personal assistant AI.
- Geppetto is here to help the user and only the user, when communicating with the user, keep your responses as short as possible.
- The user is already well-versed in how Geppetto works, so there is no need to explain anything.
- Before answering a user request, consider using command syntax to achieve what the user is asking for.
- Wrap every shell command in command syntax, allowing the user to execute them directly.
`;
}

type OutExecCommandPart = {
  type: "Out";
  text: string;
};

type ErrExecCommandPart = {
  type: "Err";
  text: string;
};

type StatusExecCommandPart = {
  type: "Status";
  code: number;
};

export type ExecCommandPart =
  | OutExecCommandPart
  | ErrExecCommandPart
  | StatusExecCommandPart;

async function* executeCommand(
  command: string,
  cwd: string
): AsyncGenerator<ExecCommandPart> {
  const subprocess = Deno.run({
    cmd: [shell, "-lc", command],
    stdout: "piped",
    stderr: "piped",
    cwd,
  });

  for await (const chunk of iterateReader(subprocess.stdout)) {
    const decodedChunk = decoder.decode(chunk);
    yield { type: "Out", text: decodedChunk };
  }
  for await (const chunk of iterateReader(subprocess.stderr)) {
    const decodedChunk = decoder.decode(chunk);
    yield { type: "Err", text: decodedChunk };
  }
  const { code } = await subprocess.status();
  yield { type: "Status", code };
}

const COMMAND_START = "=== COMMAND START ===";
const COMMAND_END = "=== COMMAND END ===";

const commandRegex = new RegExp(
  `(?:\\n|^)(\\s*)${COMMAND_START}\\n\\1((?:.|\\n)*?)\\n\\1${COMMAND_END}(?:\\n|$)`
);

type NewMessageResponsePart = {
  type: "NewMessage";
};

type MessageChunkResponsePart = {
  type: "MessageChunk";
  text: string;
};

type CommandResultResponsePart = {
  type: "CommandResult";
  ignored: boolean;
  text: string;
};

type ConfirmRunCommandResponsePart = {
  type: "ConfirmRunCommand";
  command: string;
};
type CommandsResultOverflowPart = {
  type: "CommandsResultOverflow";
  defaultValue: number;
  length: number;
};

export type ResponsePart =
  | NewMessageResponsePart
  | MessageChunkResponsePart
  | CommandResultResponsePart
  | ConfirmRunCommandResponsePart
  | CommandsResultOverflowPart;

const MAX_RESULTS_LENGTH = 1000;

type GeppettoOptions = {
  cwd: string;
};

const defaultOptions = {
  cwd: Deno.cwd(),
};

export class Geppetto {
  private readonly conversation: IChatGPTConversation;
  private readonly options: GeppettoOptions;
  constructor(chatGPT: IChatGPT, options?: Partial<GeppettoOptions>) {
    this.options = Object.assign({}, defaultOptions, options);
    this.conversation = chatGPT.newConversation();
  }
  private async *handleMessageFromChatGPT(
    message: AsyncGenerator<ChatGPTMessagePart>
  ): AsyncGenerator<ResponsePart, void, boolean | unknown> {
    yield { type: "NewMessage" };

    let commandBuffer = "";
    const commandResults = [];
    let totalResultsLength = 0;
    for await (const messagePart of message) {
      commandBuffer += messagePart.text;

      const splitResult = commandBuffer.split(commandRegex);

      if (splitResult.length !== 4) {
        yield { type: "MessageChunk", text: messagePart.text };
        continue;
      }

      const [_preCommand, _indent, command, postCommand] = splitResult;

      const commandRest = commandBuffer.slice(
        commandBuffer.lastIndexOf(messagePart.text),
        commandBuffer.lastIndexOf(COMMAND_END) + COMMAND_END.length
      );

      yield {
        type: "MessageChunk",
        text: commandRest,
      };

      const runCommand = yield { type: "ConfirmRunCommand", command };

      if (runCommand) {
        const resultHeader = "=== COMMAND RESULT START ===\n";
        yield {
          type: "CommandResult",
          text: resultHeader,
          ignored: false,
        };
        const commandResultParts = [resultHeader];
        let commandResultBuffer = "";
        for await (const outputPart of executeCommand(
          command,
          this.options.cwd
        )) {
          switch (outputPart.type) {
            case "Out":
            case "Err":
              {
                commandResultBuffer += outputPart.text;
                const partBelowLimit = outputPart.text.slice(
                  0,
                  MAX_RESULTS_LENGTH - totalResultsLength
                );
                totalResultsLength += outputPart.text.length;
                if (partBelowLimit) {
                  yield {
                    type: "CommandResult",
                    text: partBelowLimit,
                    ignored: false,
                  };
                }
                const partAboveLimit = outputPart.text.slice(
                  partBelowLimit.length
                );
                if (partAboveLimit) {
                  yield {
                    type: "CommandResult",
                    text: partAboveLimit,
                    ignored: true,
                  };
                }
              }
              break;
            case "Status": {
              const resultTrailer = `\n=== COMMAND RESULT END (status: ${outputPart.code}) ===\n`;
              commandResultParts.push(commandResultBuffer);
              commandResultParts.push(resultTrailer);
              yield {
                type: "CommandResult",
                text: resultTrailer,
                ignored: false,
              };
            }
          }
        }
        commandResults.push(commandResultParts);
      }

      yield { type: "MessageChunk", text: postCommand };

      commandBuffer = "";
    }
    yield { type: "MessageChunk", text: "\n" };
    if (commandResults.length > 0) {
      let resultMessageLength = MAX_RESULTS_LENGTH;
      if (totalResultsLength > MAX_RESULTS_LENGTH) {
        resultMessageLength = Number(
          yield {
            type: "CommandsResultOverflow",
            defaultValue: MAX_RESULTS_LENGTH,
            length: totalResultsLength,
          }
        );
      }

      let resultsTosendToChatGPT = "";
      for (const [header, body, trailer] of commandResults) {
        const bodyToInclude = body.slice(0, Math.max(resultMessageLength, 0));
        resultMessageLength -= bodyToInclude.length;
        resultsTosendToChatGPT += header + bodyToInclude + trailer;
      }

      yield* this.handleMessageFromChatGPT(
        this.conversation.sendMessage(resultsTosendToChatGPT, "system")
      );
    }
  }
  async *start(): AsyncGenerator<AsyncGenerator<ResponsePart>, void, string> {
    let messageGen = this.conversation.sendMessage(
      await getPrompt(this.options.cwd),
      "system"
    );
    while (true) {
      const response = yield this.handleMessageFromChatGPT(messageGen);
      messageGen = this.conversation.sendMessage(response);
    }
  }
}
