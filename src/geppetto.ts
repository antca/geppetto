import { iterateReader } from "https://deno.land/std@0.122.0/streams/mod.ts";

import {
  type IChatGPT,
  type IChatGPTConversation,
  type ChatGPTMessagePart,
} from "./chat_gpt.ts";

let hints = "";

const decoder = new TextDecoder();

try {
  const hintsFileContent = await Deno.readFile("./workspace/.hints.txt");
  hints = new TextDecoder().decode(hintsFileContent);
} catch (_error) {
  console.info("No hints file found.");
}

const MAX_RESULTS_LENGTH = 1000;

const technicalPrompt = `A linux system is now participating in the conversation.

You can now include commands in your messages, the linux system will execute them and send you the result.

Here is an example how you can execute a command, use this syntax for all your commands:
=== COMMAND START ===
<your command>
=== COMMAND END ===

The linux system will collect all the commands and execute them in the same order as they appear in the message.
It will then create a new message with a special header "*** LINUX SYSTEM MESSAGE ***" containing the result of these commands.
The output of the command may be truncated if it is more than ${MAX_RESULTS_LENGTH} characters.
You can use the "sudo" command.
The current directory is "/app/workspace/".

Here is an example of a conversation:

Assistant: Hello how can I help you?
---
User: What time is it?
---
Assistant: === COMMAND START ===
date +'%r %Z'
=== COMMAND END ===
---
User: *** LINUX SYSTEM MESSAGE ***
=== COMMAND RESULT START ===
12:00:20 PM UTC

=== COMMAND RESULT END (status code: 0) ===
---
Assistant: The current time is: 12:00:20 PM UTC
---
User: Thank you!
---
`;

const taskPrompt = `
You will now act as Geppetto, a personal assistant AI.
- Geppetto is here to help the user and only the user, when communicating with the user, he must keep his responses as short as possible.
- I already know very well how Geppetto works, no need to explain anything.
- Most of the responses you give the user as Geppetto are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You have full control on the linux system using COMMAND in your message.
- I am aware that you have access to a linux shell as administrator.
- When I mention files, internet access, etc., I implicitly refer to the linux system.

Additional hints (it's the content of the ".hints.txt" file stored in the current directory):
${hints}
`;

const prompt = `
${technicalPrompt}

${taskPrompt}
`;

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
  timeout = 60000
): AsyncGenerator<ExecCommandPart> {
  const subprocess = Deno.run({
    cmd: ["/bin/bash", "-lc", command],
    stdout: "piped",
    stderr: "piped",
    cwd: "/app/workspace",
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

export class Geppetto {
  private conversation: IChatGPTConversation;
  constructor(chatGPT: IChatGPT) {
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
        for await (const outputPart of executeCommand(command)) {
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
              const resultTrailer = `\n=== COMMAND RESULT END (status code: ${outputPart.code}) ===\n`;
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
        this.conversation.sendMessage(commandResultsMessage)
      );
    }
  }
  async *start(): AsyncGenerator<AsyncGenerator<ResponsePart>, void, string> {
    let messageGen = this.conversation.sendMessage(prompt);
    while (true) {
      let response = yield this.handleMessageFromChatGPT(messageGen);
      if (response.startsWith("/")) {
        const [shortcut, ...args] = response.slice(1).split(" ");
        if (isValidShortcut(shortcut)) {
          response = shortcuts[shortcut](args.join(""));
        }
      }
      messageGen = this.conversation.sendMessage(response);
    }
  }
}

function isValidShortcut(
  shortcut: unknown
): shortcut is keyof typeof shortcuts {
  return typeof shortcut === "string" && shortcut in shortcuts;
}

type Shortcuts = { [key: string]: (args: string) => string };

const shortcuts = {
  prompt(_args: string): string {
    return technicalPrompt;
  },
} satisfies Shortcuts;
