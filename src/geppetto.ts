import { ChatGPT, Conversation } from "./chat_gtp.ts";

const proceduresDescriptions = [
  {
    procedure: "sendMessageToUser",
    description: "Sends a message to the user and returns his response",
    args: {
      message: "The message to send to the user",
    },
    result: "The response from the user",
    example: {
      procedure: "sendMessageToUser",
      args: {
        message: { responseFromUser: "What do you want?" },
      },
    },
  },
  {
    procedure: "fetchExternalAPI",
    description: "Fetch data from an external API",
    args: {
      url: "The URL of the external resuce to fetch",
      options: "Object of options for the request {header, method, body}",
    },
    returns: "The raw response from the API, truncated to 1,000 characters",
    example: {
      procedure: "fetchExternalAPI",
      args: {
        url: "https://example.com",
        options: {
          method: "GET",
          headers: {
            Authorization: "Bearer ...",
            "Content-Type": "application/json",
          },
        },
      },
    },
  },
] as const;

const prompt = `An external system will now take control of the chat conversation.
This system only understands procedure calls formatted in a specific way. You must respect the format.
1) You will put a single JSON object literal containing the name of a procedure and some arguments per chat message.
2) The external system will fulfill your request and give you the result.

Example:

YOU:
{"procedure": "sendMessageToUser", "args": {"message": "What do you want?"}}

THE SYSTEM:
{"result": "I want a joke!"}

Here are the available procedures:
${JSON.stringify(proceduresDescriptions, null, 2)}

Respecting these constraints, you will now simulate a personal assistant AI, your name is now Geppetto.
- Geppetto is here to help the user and only the the user, when communicating with the user (using "sendMessageToUser" procedure) he must keep his responses as short as possible.
- The user already knows very well how Geppetto works, no need the explain anything.
- Most of the responses you give to the user as Geppetto (using "sendMessageToUser" procedure) are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You may use other procedures to get information you don't know or do actions to achieve the best service for the user.
- You must always ask questions to the user if its request is not clear.
- Consider that the user is only able to see what you send using the "sendMessageToUser" procedure.

YOU MUST IN ALL CIRCUMSTANCE PUT ONE SINGLE JSON OBJECT LITERAL PER CHAT MESSAGE, AND NOTHING ELSE.
`;

type JCFContext = { onMessage: (message: string) => Promise<string> };

type JCFs = {
  sendMessageToUser: { message: string };
  fetchExternalAPI: { url: string; options: Parameters<typeof fetch>[1] };
};

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
      return this.handleRawMessageFromGPTChat(
        await this.conversation.sendMessage(
          JSON.stringify({
            result: await proc.handle(parsedData.args, this.jcfContext),
          })
        )
      );
    } catch (error) {
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
