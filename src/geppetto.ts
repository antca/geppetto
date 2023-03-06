import { iterateReader } from "https://deno.land/std@0.122.0/streams/mod.ts";

import {
  type ChatGPT,
  type Conversation,
  type MessagePart,
} from "./chat_gtp.ts";

let hints = "";

const decoder = new TextDecoder();

try {
  const hintsFileContent = await Deno.readFile("./workspace/.hints.txt");
  hints = new TextDecoder().decode(hintsFileContent);
} catch (_error) {
  console.info("No hints file found.");
}

const prompt = `A linux system is now participating in the conversation.

You can now include commands in your messages, the linux system will execute them and send you the result.

Here is an example how you can execute a command, use this syntax for all your commands:
=== COMMAND START ===
<your command>
=== COMMAND END ===

The linux system will collect all the commands and execute them in the same order as they appear in the message.
It will then create a new message with a special header "*** LINUX SYSTEM MESSAGE ***" containing the result of these commands.
The output of the command is truncated if it is more than 1000 characters.
You can use the "sudo" command.
The current directory is "/app/workspace/".

Here is an example of a conversation:

  Me: What time is it ?

  You: === COMMAND START ===
  date +'%r %Z'
  === COMMAND END ===

  Me (as linux system): *** LINUX SYSTEM MESSAGE ***
  === COMMAND RESULT (code 0) ===
  12:00:20 PM UTC\n

  You: The current time is: 12:00:20 PM UTC

  Me: Thank you!


Additional hints (it's the content of the ".hints.txt" file stored in the current directory):
${hints}

You will now act as Geppetto, a personal assistant AI.
- Geppetto is here to help me and only me, when communicating with me, he must keep his responses as short as possible.
- I already know very well how Geppetto works, no need to explain anything.
- Most of the responses you give me as Geppetto are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You have full control on the linux system using COMMAND in your message.
- I am aware that you have access to a linux shell as administrator.
- When I mention files, internet access, etc., I implicitly refer to the linux system.
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

const commandRegex = new RegExp(
  `(=== COMMAND START ===\\n)((?:.|\\n)*?)(\\n=== COMMAND END ===)`
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

export type ResponsePart =
  | NewMessageResponsePart
  | MessageChunkResponsePart
  | CommandResultResponsePart
  | ConfirmRunCommandResponsePart;

export class Geppetto {
  private conversation: Conversation;
  constructor(chatGPT: ChatGPT) {
    this.conversation = chatGPT.newConversation();
  }
  private async *handleMessageFromChatGPT(
    message: AsyncGenerator<MessagePart>
  ): AsyncGenerator<ResponsePart, void, boolean | unknown> {
    yield { type: "NewMessage" };

    let commandBuffer = "";
    let commandResults = "";
    for await (const messagePart of message) {
      commandBuffer += messagePart.text;

      const splitResult = commandBuffer.split(commandRegex);

      if (splitResult.length !== 5) {
        yield { type: "MessageChunk", text: messagePart.text };
        continue;
      }

      const [
        _preCommand,
        _commandHeader,
        command,
        commandTrailer,
        postCommand,
      ] = splitResult;

      const commandRest = commandBuffer.slice(
        commandBuffer.lastIndexOf(messagePart.text),
        commandBuffer.lastIndexOf(commandTrailer) + commandTrailer.length
      );

      yield {
        type: "MessageChunk",
        text: commandRest,
      };

      const runCommand = yield { type: "ConfirmRunCommand", command };

      if (runCommand) {
        const resultHeader = "=== COMMAND RESULT START ===\n";
        commandResults += resultHeader;
        yield {
          type: "CommandResult",
          text: resultHeader,
          ignored: false,
        };
        let outputLength = 0;
        for await (const outputPart of executeCommand(command)) {
          switch (outputPart.type) {
            case "Out":
            case "Err":
              {
                outputLength += outputPart.text.length;
                const partBelowLimit = outputPart.text.slice(
                  0,
                  1000 - outputLength
                );
                if (partBelowLimit) {
                  commandResults += partBelowLimit;
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
              commandResults += resultTrailer;
              yield {
                type: "CommandResult",
                text: resultTrailer,
                ignored: false,
              };
            }
          }
        }
      }

      yield { type: "MessageChunk", text: postCommand };

      commandBuffer = "";
    }
    yield { type: "MessageChunk", text: "\n" };
    if (commandResults) {
      const commandResultsMessage = `*** LINUX SYSTEM MESSAGE ***\n${commandResults}`;
      commandResults = "";
      yield* this.handleMessageFromChatGPT(
        this.conversation.sendMessage(commandResultsMessage)
      );
    }
  }
  async *start(): AsyncGenerator<AsyncGenerator<ResponsePart>, void, string> {
    let messageGen = this.conversation.sendMessage(prompt);
    while (true) {
      const response = yield this.handleMessageFromChatGPT(messageGen);
      messageGen = this.conversation.sendMessage(response);
    }
  }
}
