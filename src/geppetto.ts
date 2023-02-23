import { ChatGPT, Conversation } from "./chat_gtp.ts";

const proceduresDescriptions = [
  {
    procedure: "tellToUser",
    description: "Send a message to the user and returns his next response",
    args: {
      message: {
        type: "string",
        description: "The message to send to the user",
      },
    },
    returns: {
      type: "string",
      description: "The response from the user to the last message",
    },
    example: JSON.stringify({
      procedure: "tellToUser",
      args: {
        message: "What do you want?",
      },
    }),
  },
  {
    procedure: "fetchExternalAPI",
    description:
      "Fetch data from an external API, the data returned is not visible by the user",
    args: {
      url: {
        type: "string",
        description: "The URL of the external API to fetch data from",
      },
      options: {
        method: "string",
        headers: "object",
        body: "string",
      },
    },
    returns: {
      type: "string",
      description:
        "The raw response from the API, truncated to 1,000 characters",
    },
    example: JSON.stringify({
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
    }),
  },
];

const prompt = `An external system will now take control of the chat conversation.
This system only understands procedure calls formatted in a specific way. You must respect the format.
You will call procedures, the system will do the operation and give you the result.

Example:

YOU:
{"procedure": "tellToUser", "args": {"message": "What do you want?"}

THE SYSTEM:
{"result": "I want a joke!"}

Here are the available procedures:
${JSON.stringify(proceduresDescriptions, null, 2)}

Respecting these constraints, you will now simulate a personal assistant AI, your name is now Geppetto.
- Geppetto is here to help the user and only the the user, when communicating with the user (using "tellToUser" procedure) he must keep his responses as short as possible.
- The user already knows very well how Geppetto works, no need the explain anything.
- Most of the responses you give to the user as Geppetto (using "tellToUser" procedure) are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You may use other procedures to get information you don't know or do actions to achieve the best service for the user.
- Consider that the user is only able to see what you send using the "tellToUser" procedure.

THE COMMUNICATION WILL NOW CONTINUE USING LITERAL JSON OBJECTS AND NOTHING ELSE.
`;

type AFCResponse = {
  result: string;
};

type AFCRequest = {
  procedure: keyof typeof proceduresDescriptions;
  args: Record<string, JSONValue>;
};

type JSONValue =
  | Record<string, JSONValue>
  | Array<JSONValue>
  | null
  | number
  | boolean
  | string;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function assertIsAFCRequest(
  afcRequest: unknown
): asserts afcRequest is AFCRequest {
  if (
    isObject(afcRequest) &&
    "procedure" in afcRequest &&
    typeof afcRequest.procedure === "string" &&
    ["tellToUser", "fetchExternalAPI"].includes(afcRequest.procedure) &&
    "args" in afcRequest &&
    isObject(afcRequest.args)
  ) {
    return;
  }

  throw new Error("Invalid Assistant Procedure Call.");
}

class AFCImplementations {
  constructor(
    private readonly context: { onMessage: (message: string) => Promise<void> }
  ) {}
  async tellToUser({ message }: { message: string }) {
    return { responseFromUser: await this.context.onMessage(message) };
  }
  async fetchExternalAPI({ url, options }: { url: string; options: object }) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      return text.slice(0, 1000);
    } catch (error) {
      return `Error while fetching external API: ${error.message}`;
    }
  }
}

export class Geppetto {
  private conversation: Conversation;
  private afcImplementations: AFCImplementations;
  constructor(
    chatGPT: ChatGPT,
    private readonly onMessage: (message: string) => Promise<string>
  ) {
    this.conversation = new Conversation(chatGPT);
    this.afcImplementations = new AFCImplementations({ onMessage });
  }
  private async handleRawMessageFromGPTChat(message: string) {
    try {
      const matchedMessage = message.match(/\{(\n|.)*\}/);
      if (!matchedMessage) {
        throw new Error(
          "The message format is invalid! You (ChatGPT) must use a single JSON object (ECMA-404) per message."
        );
      }
      const parsedData = JSON.parse(matchedMessage[0]);

      assertIsAFCRequest(parsedData);
      const { procedure: funcName, args } = parsedData;
      if (!(funcName in this.afcImplementations)) {
        throw new Error("AFC not found!");
      }
      return this.handleRawMessageFromGPTChat(
        await this.conversation.sendMessage(
          JSON.stringify({
            result: await this.afcImplementations[funcName](args),
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
