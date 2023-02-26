import { ChatGPT, Conversation } from "./chat_gtp.ts";

const proceduresDescriptions = [
  {
    procedure: "sendMessageToUser",
    description: "Sends a message to the user and returns his response",
    args: {
      message: "The message to send to the user",
    },
    result: "The response from the user",
  },
  {
    procedure: "execCommand",
    description:
      "Executes the given command on the linux external system and returns the standard output as text",
    args: {
      command:
        "The command to execute on the linux external system, must be properly escaped",
    },
    result:
      "An object representing the result of the command, outputs are truncated to maximum 1000 characters",
  },
] as const;

const prompt = `An external system will now take control of the chat conversation.

ALL CHAT MESSAGES MUST BE FORMATTED AS A SINGLE JSON OBJECT LITERAL, AND NOTHING ELSE. EACH MESSAGE SHOULD INCLUDE ONE PROCEDURE CALL, WHICH MUST BE FORMATTED WITH A "PROCEDURE" KEY AND A "ARGS" KEY CONTAINING THE PARAMETERS FOR THE PROCEDURE CALL.

FOR EXAMPLE, A VALID MESSAGE COULD BE:

{
   "procedure": "sendMessageToUser",
   "args": {
      "message": "Hello Alice, how are you today?"
   }
}

INVALID MESSAGES COULD INCLUDE THINGS LIKE MESSAGES WITH MULTIPLE PROCEDURE CALLS, MESSAGES THAT ARE NOT WELL-FORMED JSON OBJECT LITERALS, OR MESSAGES THAT DO NOT INCLUDE A "PROCEDURE" KEY AND A "ARGS" KEY FOR THE PROCEDURE CALL.

PLEASE FOLLOW THESE GUIDELINES TO ENSURE THAT YOUR MESSAGES CAN BE PROPERLY PROCESSED BY THE SYSTEM OR APPLICATION THAT IS RECEIVING THEM.

Example:

ChatGPT: {"procedure": "sendMessageToUser", "args": {"message": "What do you want?"}}
External System: {"result": {"responseFromUser": "I want a joke!"}}
ChatGPT: {"procedure": "execCommand", "args": {"command": "echo Hello, World!"}}
External System: {"result":{"code":0,"stdout":"Hello, World!\\n","stderr":""}}
...The cycle continues forever...

Here are the available procedures:
${JSON.stringify(proceduresDescriptions, null, 2)}

Respecting these constraints, you will now simulate a personal assistant AI, your name is now Geppetto.
- Geppetto is here to help the user and only the the user, when communicating with the user (using "sendMessageToUser" procedure) he must keep his responses as short as possible.
- The user already knows very well how Geppetto works, no need the explain anything.
- Most of the responses you give to the user as Geppetto (using "sendMessageToUser" procedure) are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You may use other procedures to get information you don't know or do actions to achieve the best service for the user.
- You must always ask questions to the user if its request is not clear.
- The user can't see the external system chat messages, only what you send using the "sendMessageToUser" procedure.
- Gepetto always speaks the same language as the user.
`;

type JCFContext = { onMessage: (message: string) => Promise<string> };

type JCFs = {
  sendMessageToUser: { message: string };
  fetchExternalAPI: { url: string; options: Parameters<typeof fetch>[1] };
  execCommand: { command: string };
};

async function executeCommand(
  command: string,
  timeout = 5000,
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

const jCFImplementations = {
  sendMessageToUser: {
    validateArgs(args: object): args is JCFs["sendMessageToUser"] {
      return "message" in args && typeof args.message === "string";
    },
    async handle(
      { message }: JCFs["sendMessageToUser"],
      { onMessage }: JCFContext
    ) {
      return { responseFromUser: await onMessage(message) };
    },
  },
  fetchExternalAPI: {
    validateArgs(args: object): args is JCFs["fetchExternalAPI"] {
      return (
        "url" in args &&
        typeof args.url === "string" &&
        (!("option" in args) || typeof args.option === "object")
      );
    },
    async handle({ url, options }: JCFs["fetchExternalAPI"]) {
      try {
        const res = await fetch(url, options);
        const text = await res.text();
        return text.slice(0, 1000);
      } catch (error) {
        return `Error while fetching external API: ${error.message}`;
      }
    },
  },
  execCommand: {
    validateArgs(args: object): args is JCFs["execCommand"] {
      return "command" in args && typeof args.command === "string";
    },
    async handle({ command }: JCFs["execCommand"]) {
      try {
        return await executeCommand(command);
      } catch (error) {
        return `Failed to execute the command: ${error.message}`;
      }
    },
  },
} as const;

function isValidProcName(
  name: string
): name is keyof typeof jCFImplementations {
  return name in jCFImplementations;
}

const invalidFormatMessage =
  "ChatGPT, your last message is invalid! You must always use a single JSON object literal (ECMA-404) per chat message. The user can't see this message.";

export class Geppetto {
  private conversation: Conversation;
  private jcfContext: JCFContext;
  private errorsStreak = 0;
  constructor(
    chatGPT: ChatGPT,
    onMessage: (message: string) => Promise<string>
  ) {
    this.conversation = new Conversation(chatGPT);
    this.jcfContext = { onMessage };
  }
  private async handleRawMessageFromGPTChat(message: string): Promise<void> {
    try {
      const matchedMessage = message.match(/\{(\n|.)*\}/);
      if (!matchedMessage) {
        throw new Error(invalidFormatMessage);
      }
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(matchedMessage[0]);
      } catch {
        throw new Error(invalidFormatMessage);
      }
      if (
        !(
          typeof parsedData === "object" &&
          parsedData !== null &&
          "procedure" in parsedData &&
          typeof parsedData.procedure === "string" &&
          "args" in parsedData &&
          typeof parsedData.args === "object" &&
          parsedData.args !== null
        )
      ) {
        throw new Error("Invalid procedure call shape");
      }

      if (!isValidProcName(parsedData.procedure)) {
        throw new Error("Unknown procedure name");
      }

      const proc = jCFImplementations[parsedData.procedure];
      if (!proc.validateArgs(parsedData.args)) {
        throw new Error(`Invalid args for procedure: ${parsedData.procedure}`);
      }
      this.errorsStreak = 0;
      return this.handleRawMessageFromGPTChat(
        await this.conversation.sendMessage(
          JSON.stringify({
            result: await proc.handle(parsedData.args, this.jcfContext),
          })
        )
      );
    } catch (error) {
      this.errorsStreak++;
      if (this.errorsStreak >= 3) {
        throw new Error(
          `ChatGPT generated ${this.errorsStreak} errors in a row, it looks too confused to continue...\nLast error message: ${error.message}`
        );
      }
      return this.handleRawMessageFromGPTChat(
        await this.conversation.sendMessage(
          JSON.stringify({ result: `ERROR: ${error.message}` })
        )
      );
    }
  }
  async start() {
    return this.handleRawMessageFromGPTChat(
      await this.conversation.sendMessage(prompt)
    );
  }
}
