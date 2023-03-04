import {
  type ChatGPT,
  type Conversation,
  type MessagePart,
} from "./chat_gtp.ts";

const commandKey = crypto.randomUUID();

let hints = "";

try {
  const hintsFileContent = await Deno.readFile("./workspace/.hints.txt");
  hints = new TextDecoder().decode(hintsFileContent);
} catch (_error) {
  console.info("No hints file found.");
}

const prompt = `A linux system is now participating the conversation.

You must include commands in your messages, the linux system will execute them, and provide you the result.

Here is an example how you can execute a command, this syntax is required for all you commands:
=== COMMAND START ${commandKey} ===
<your command>
=== COMMAND END ${commandKey} ===

The linux system will collect all your commands and execute them in the same order as they appear in message.
It will then create a new message with a special header "*** LINUX SYSTEM MESSAGE ***" containing the result of these commands.
The output will be truncated if it is more than 1000 characters.
You can use the "sudo" command.
The current directory is "/app/workspace/".
You commands must include this session command key: ${commandKey}

Here is an example of a conversation:

> Me:
> What time is it ?
>
> ChatGPT:
> === COMMAND START ${commandKey} ===
> date +'%r %Z'
> === COMMAND END ${commandKey} ===
>
> Me (as linux system):
> *** LINUX SYSTEM MESSAGE ***
> === COMMAND RESULT (code 0) ===
> 12:00:20 PM UTC\n
>
> ChatGPT:
> The current time is: 12:00:20 PM UTC
>
> Me:
> Thank you!


Additional hints (it's the content of the ".hints.txt" file stored in the current directory):
${hints}

You will now act as Geppetto, a personal assistant AI.
- Geppetto is here to help me and only me, when communicating with me he must keep his responses as short as possible.
- I already knows very well how Geppetto works, no need the explain anything.
- Most of the responses you give me as Geppetto are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You have full control on the linux system using COMMAND in your message.
- I am aware that you have access to a linux shell as administrator.
- When I mention files, internet access, etc., I implicitly refer to the linux system.
`;

async function executeCommand(
  command: string,
  timeout = 60000,
  maxOutputLength = 1000
): Promise<{ code: number; stdout: string; stderr: string }> {
  const decoder = new TextDecoder();

  const subprocess = Deno.run({
    cmd: ["/bin/bash", "-lc", command],
    stdout: "piped",
    stderr: "piped",
    cwd: "/app/workspace",
  });

  const timer = setTimeout(() => {
    subprocess.kill();
  }, timeout);

  const [stdout, stderr] = await Promise.all([
    subprocess.output(),
    subprocess.stderrOutput(),
  ]);

  clearTimeout(timer);
  const { code } = await subprocess.status();
  subprocess.close();

  let stdoutText = decoder.decode(stdout);
  let stderrText = decoder.decode(stderr);

  stdoutText = stdoutText.slice(0, maxOutputLength);
  stderrText = stderrText.slice(0, maxOutputLength);

  return {
    code,
    stdout: stdoutText,
    stderr: stderrText,
  };
}

const commandRegex = new RegExp(
  `=== COMMAND START ${commandKey} ===\\n((?:.|\\n)*?)\\n=== COMMAND END ${commandKey} ===`
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
  text: string;
};

type ResponsePart =
  | NewMessageResponsePart
  | MessageChunkResponsePart
  | CommandResultResponsePart;

export class Geppetto {
  private conversation: Conversation;
  constructor(chatGPT: ChatGPT) {
    this.conversation = chatGPT.newConversation();
  }
  private async *handleMessageFromChatGPT(
    message: AsyncGenerator<MessagePart>
  ): AsyncGenerator<ResponsePart> {
    yield { type: "NewMessage" };

    let commandBuffer = "";
    let commandResults = "";
    for await (const messagePart of message) {
      commandBuffer += messagePart.text;
      const match = commandBuffer.match(commandRegex);
      if (!match) {
        yield { type: "MessageChunk", text: messagePart.text };
        continue;
      }
      const [, , postCommandChunk] = commandBuffer.split(commandRegex);

      commandBuffer = "";

      const commandRest = messagePart.text.slice(
        0,
        messagePart.text.lastIndexOf(postCommandChunk)
      );

      yield {
        type: "MessageChunk",
        text: commandRest,
      };

      const [, command] = match;
      const { code, stdout, stderr } = await executeCommand(command);
      const commandResult = `\n=== COMMAND RESULT (code ${code}) ===\n${stdout}\n${stderr}`;
      commandResults += commandResult;
      yield { type: "CommandResult", text: commandResult };
      yield { type: "MessageChunk", text: postCommandChunk };
    }
    yield { type: "MessageChunk", text: "\n" };
    if (commandResults) {
      const commandResultsMessage = `*** LINUX SYSTEM MESSAGE ***\n${commandResults} `;
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
