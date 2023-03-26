import { iterateReader } from "https://deno.land/std@0.122.0/streams/mod.ts";
import * as path from "https://deno.land/std/path/mod.ts";

import {
  type IChatGPT,
  type IChatGPTConversation,
  type ChatGPTMessagePart,
} from "./chat_gpt.ts";

const decoder = new TextDecoder();

async function getPrompt(cwd: string) {
  let hints = "";

  const hintsFilePath = path.format({ dir: cwd, name: ".hints.txt" });

  try {
    const hintsFileContent = await Deno.readFile(hintsFilePath);
    hints = new TextDecoder().decode(hintsFileContent);
  } catch (_error) {
    hints = "<no hint yet>";
  }

  return `A linux system participating in the conversation.

You can include commands in your messages, the linux system will execute them and send you the result.

Here is an example how you can execute a command, use this syntax for all your commands:
=== COMMAND START ===
<your command>
=== COMMAND END ===

The linux system will collect all the commands and execute them in the same order as they appear in the message.
It will then create a new message with a special header "*** LINUX SYSTEM MESSAGE ***" containing the result of these commands.
The output of the command is truncated if it is more than MAX_RESULTS_LENGTH characters.
You can use the "sudo" command.
The current directory is "${cwd}".

Here is an example of a conversation:

  User: What time is it ?

  Assistant: === COMMAND START ===
  date +'%r %Z'
  === COMMAND END ===

  System: *** LINUX SYSTEM MESSAGE ***
  === COMMAND RESULT (code 0) ===
  12:00:20 PM UTC\n

  Assistant: The current time is: 12:00:20 PM UTC

  User: Thank you!


Additional hints (it's the content of the ".hints.txt" file stored in the current directory):
${hints}

You will now act as Geppetto, a personal assistant AI.
- Geppetto is here to help the user and only the user, when communicating with the user, you must keep your responses as short as possible.
- The user already knows very well how Geppetto works, no need to explain anything.
- Most of the responses you give to the user as Geppetto are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You have full control on the linux system using COMMAND in your message.
- The user is aware that he has have access to a linux shell as administrator.
- When the user mentions files, internet access, etc., He implicitly refers to the linux system.
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
  cwd: string,
  timeout = 60000
): AsyncGenerator<ExecCommandPart> {
  const subprocess = Deno.run({
    cmd: ["/bin/bash", "-lc", command],
    stdout: "piped",
    stderr: "piped",
    cwd,
  });

  const timer = setTimeout(() => {
    subprocess.kill();
  }, timeout);

  for await (const chunk of iterateReader(subprocess.stdout)) {
    const decodedChunk = decoder.decode(chunk);
    yield { type: "Out", text: decodedChunk };
  }
  for await (const chunk of iterateReader(subprocess.stderr)) {
    const decodedChunk = decoder.decode(chunk);
    yield { type: "Err", text: decodedChunk };
  }
  const { code } = await subprocess.status();
  clearTimeout(timer);
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
              const resultTrailer = `\n=== COMMAND RESULT END (code ${outputPart.code}) ===\n`;
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

      const commandResultsMessage = `*** LINUX SYSTEM MESSAGE ***\n${resultsTosendToChatGPT}`;
      yield* this.handleMessageFromChatGPT(
        this.conversation.sendMessage(commandResultsMessage, "system")
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
