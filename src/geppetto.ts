import { ChatGPT, Conversation } from "./chat_gtp.ts";

const functionsDescriptions = {
  tellToUser: {
    description: "Send a message to the user and returns his next response",
    parameters: {
      message: {
        type: "string",
        description: "The message to send to the user",
      },
    },
    returns: {
      type: "string",
      description: "The response from the user to the last message",
    },
  },
  fetchExternalAPI: {
    description: "Fetch data from an external API",
    parameters: {
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
        "The raw response from the API, truncated to 10,000 characters",
    },
  },
};

const prompt = `
After this message, I will put you in communication with a proxy computer.
The computer is setup to understand a limited function calls in a specific format.
The language that the computer understand is called "Assistant Function Call" (AFC for short), every of your messages must respect the format and only that. It is a basic language using JSON formatted messages.

Here is an example of use of an AFC exchange:

Your first call:
\`\`\`
{
  "function": "tellToUser",
  "parameters": {
    "message": "What do you want?"
  }
}
\`\`\`


The proxy computer returning the response from your last function call (me responding to your question):
\`\`\`
{
  "result": "I want a joke!"
}
\`\`\`

You calling a function to get a joke from the internet:
\`\`\`
{
  "function": "fetchExternalAPI",
  "parameters": {
    "url": "https://official-joke-api.appspot.com/random_joke",
    "options": {
      "method": "GET"
    }
  }
}
\`\`\`


The proxy server returning the result of your function call:
\`\`\`
{
  "result": "Why the chicken crosses the road?...."
}
\`\`\`

You telling me the joke using a function call:

\`\`\`
{
  "function": "tellToUser",
  "parameters": {
    "message": "Why the chicken crosses the road?...."
  }
}
\`\`\`

Basically, every call is shaped has following:
  - \`function\`: The function you want to call.
  - \`parameters\`: An object containing the parameters to pass to the function.

And every response is shaped has the following:
  - \`result\`: The result of you last call.

The \`result\` is always the result of your previous function call!

Here are the available functions you can call:
${JSON.stringify(functionsDescriptions, null, 2)}

If you want to tell something to me, use a specific AFC, "tellToUser" which is described above.
I am not able see your communication with the proxy computer, only what you send as \`message\` when using \`tellToUser\` function.

YOU MUST NOT TRY TO CALL ANY FUNCTION BESIDE THE FOLLOWING ONES: ${Object.keys(
  functionsDescriptions
).join(", ")}


You will have to simulate a personal assistant AI, your name is now Geppetto.
- Geppetto is here to help me and only the me, when communicating with me (using "tellToUser" AFC) he must keep his responses as short as possible.
- I already knows very well how Geppetto works, no need the explain anything.
- Most of the responses you give to me as Geppetto (using "tellToUser" AFC) are generated like you usually do as "ChatGPT, a conversational AI language model developed by OpenAI".
- You may use other AFCs to get information you don't know or do actions to achieve the best service for me.

== YOU ARE NOW IN COMMUNICATION WITH THE PROXY COMPUTER, YOU MUST USE AFC FROM NOW ON ==
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
  async tellToUser({ message }: { message: string }) {
    return this.context.onMessage(message);
  }
  async getTime() {
    return new Date().toISOString();
  }
  async generateUUID() {
    return crypto.randomUUID();
  }
  async fetchExternalAPI({ url, options }: { url: string; options: object }) {
    const res = await fetch(url, options);
    const text = await res.text();
    return text.slice(0, 10000);
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
    const data = message.match(/\{(\n|.)*\}/);
    const parsedData =
      data === null
        ? {
            function: "tellToUser",
            parameters: { message },
          }
        : JSON.parse(data[0]);

    assertIsAFCRequest(parsedData);

    const { function: funcName, parameters } = parsedData;
    if (!(funcName in this.afcImplementations)) {
      throw new Error("AFC not found!");
    }
    let result = await this.afcImplementations[funcName](parameters);
    return this.handleRawMessageFromGPTChat(
      await this.conversation.sendMessage(
        "Proxy server sent:\n" + JSON.stringify({ result })
      )
    );
  }
  async start() {
    return this.handleRawMessageFromGPTChat(
      await this.conversation.sendMessage(prompt)
    );
  }
}
