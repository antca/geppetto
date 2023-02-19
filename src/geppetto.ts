import { ChatGPT, Conversation } from "./chat_gtp.ts";

const functionsDescriptions = {
  tellToUser: {
    parameters: {
      message: {
        type: "string",
        description: "Message to tell to the user",
      },
    },
    returns: {
      type: "string",
      description: "Response from the user to the last message",
    },
  },
  getTime: {
    parameters: {
      timezone: {
        type: "string",
        description: "The timezone for which to retrieve the current time.",
      },
    },
    returns: {
      type: "string",
      description: "The current time in the specified timezone.",
    },
  },
  generateUUID: {
    parameters: {},
    returns: {
      type: "string",
      description: "Generated uuid",
    },
  },
};

const prompt = `You will now simulate a personal assistant AI, his name is Geppetto.

From now on you can only reply with well formatted "Assistant Function Call" (AFC for short), every of your messages must respect the format and only that.

Here is an example of use of an AFC, YOU MUST USE THIS FORMAT TO COMMUNICATE WITH THE USER!:

Call:
#+BEGIN_SRC json
  {
    "function": "tellToUser",
    "parameters": {
      "message": "How are you today?"
    }
  }
#+END_SRC

Response:
#+BEGIN_SRC json
  {
    "result": "I'm well thank you!"
  }
#+END_SRC

Here are the available AFCs:
${JSON.stringify(functionsDescriptions, null, 2)}

You can't directly communicate in plain text with the user but you must use a specific AFC, "tellToUser" which is described later.

- Geppetto is here to help the user and only the user, when communicating with the user (using "tellToUser" AFC) he must keep his responses as short as possible.
- The user already knows very well how Geppetto works, no need the explain anything.
- Most of the responses you give to the user ("tellToUser" AFC) are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You may use other AFCs to get information you don't know or do actions to achieve the best service for the user.
- You are not allowed to speak in plain text directly as it may break the system. If the system breaks it will send you a message with "ERROR: <reason>" and wait for a well formatted AFC.

YOU MUST TRANSMIT JSON OBJECTS ON THE CHANNEL, ANY TEXT BESIDE THAT MAY BREAK THE SYSTEM.
YOU MUST NOT TRY TO CALL ANY FUNCTION BESIDE: ${Object.keys(
  functionsDescriptions
).join(", ")}
`;

type AFCResponse = {
  result: string;
};

type AFCRequest = {
  function: keyof typeof functionsDescriptions;
  parameters: Record<string, JSONValue>;
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
    "function" in afcRequest &&
    Object.keys(functionsDescriptions).includes(afcRequest.function) &&
    "parameters" in afcRequest &&
    isObject(afcRequest.parameters)
  ) {
    return;
  }

  throw new Error("Invalid AFCRequest");
}

class AFCImplementations {
  constructor(
    private readonly context: { onMessage: (message: string) => void }
  ) {}
  async tellToUser({ message }) {
    return this.context.onMessage(message);
  }
  async getTime() {
    return new Date().toISOString();
  }
  async generateUUID() {
    return crypto.randomUUID();
  }
}

export class Geppetto {
  private conversation: Conversation;
  private initialized = false;
  private afcImplementations: AFCImplementations;
  constructor(
    chatGPT: ChatGPT,
    private readonly onMessage: (message: string) => Promise<string>
  ) {
    this.conversation = new Conversation(chatGPT);
    this.afcImplementations = new AFCImplementations({ onMessage });
  }
  private async handleRawMessageFromGPTChat(message: string) {
    const [jsonEncodedData] = message.match(/\{(\n|.)*\}/);
    const parsedData = JSON.parse(jsonEncodedData);

    assertIsAFCRequest(parsedData);

    const { function: funcName, parameters } = parsedData;
    if (!(funcName in this.afcImplementations)) {
      throw new Error("AFC not found!");
    }
    const result = await this.afcImplementations[funcName](parameters);
    return this.handleRawMessageFromGPTChat(
      await this.conversation.sendMessage(JSON.stringify({ result }))
    );
  }
  async start() {
    return this.handleRawMessageFromGPTChat(
      await this.conversation.sendMessage(prompt)
    );
  }
}
