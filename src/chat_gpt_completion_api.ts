import {
  ChatGPTMessagePart,
  IChatGPT,
  IChatGPTConversation,
} from "./chat_gpt.ts";

type Message = {
  role: typeof roles[number];
  content: string;
};

export class Conversation implements IChatGPTConversation {
  private messages: Message[] = [];
  constructor(private readonly chatGPT: ChatGPTCompletionAPI) {}
  async *sendMessage(text: string): AsyncGenerator<ChatGPTMessagePart> {
    this.messages.push({
      role: "user",
      content: text,
    });

    const responseGen = this.chatGPT.sendConversation(this.messages);

    let responseContent = "";
    for await (const chatGPTMessagePart of responseGen) {
      responseContent += chatGPTMessagePart.text;
      yield chatGPTMessagePart;
    }

    this.messages.push({
      role: "assistant",
      content: responseContent,
    });
  }
}

export class ChatGPTCompletionAPI implements IChatGPT {
  constructor(private readonly openAIAPIKey: string) {}
  newConversation() {
    return new Conversation(this);
  }
  async *sendConversation(
    messages: Message[]
  ): AsyncGenerator<ChatGPTMessagePart> {
    const data = {
      model: "gpt-3.5-turbo",
      stream: true,
      messages,
    };
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openAIAPIKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!response.body) {
      throw new Error("No data received after sending message");
    }

    const decoder = new TextDecoder("utf-8");

    let bodyBuffer = new Uint8Array();
    let parsingError: Error | undefined;
    let successFullyProcessedChunkParts = 0;
    for await (const chunk of response.body) {
      const newBuffer = new Uint8Array(bodyBuffer.length + chunk.length);
      newBuffer.set(bodyBuffer);
      newBuffer.set(chunk, bodyBuffer.length);
      bodyBuffer = newBuffer;

      const decodedChunk = decoder.decode(bodyBuffer);
      const chunkParts = decodedChunk
        .trim()
        .split("\n\n")
        .slice(successFullyProcessedChunkParts);

      let buffer = "";
      for (const chunkPart of chunkParts) {
        buffer += chunkPart;
        if (!buffer.startsWith("data: ")) {
          continue;
        }
        const chunkData = buffer.trim().replace("data: ", "");

        if (chunkData.trim() === "[DONE]") {
          return;
        }

        let data: unknown;
        try {
          data = JSON.parse(chunkData);
          buffer = "";
          parsingError = undefined;
          successFullyProcessedChunkParts++;
        } catch (error) {
          parsingError = error;
          continue;
        }

        assertMessageResponse(data);

        const {
          choices: [choice],
        } = data;

        if (isFinishChoice(choice)) {
          continue;
        }

        if (!isDeltaChoice(choice)) {
          throw new Error(`Unknown choice type: ${choice}`);
        }

        const { delta } = choice;

        if (isRoleDelta(delta)) {
          continue;
        }

        if (!isContentDelta(delta)) {
          throw new Error(`Unknown delta type: ${delta}`);
        }

        yield {
          text: delta.content,
        };
      }
      if (parsingError) {
        continue;
      }

      bodyBuffer = new Uint8Array();
      successFullyProcessedChunkParts = 0;
    }

    if (parsingError) {
      const error = new Error(
        "Response chunk processing ended with an unresolved parsing error!"
      );
      error.cause = parsingError;
      throw error;
    }
  }
}

const roles = ["system", "user", "assistant"] as const;
const rolesLax: readonly string[] = roles;

function isRoleDelta(value: unknown): value is RoleDelta {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    typeof value.role === "string" &&
    rolesLax.includes(value.role)
  );
}

function isContentDelta(value: unknown): value is ContentDelta {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    typeof value.content === "string"
  );
}

function isDeltaChoice(value: unknown): value is DeltaChoice {
  return (
    typeof value === "object" &&
    value !== null &&
    "delta" in value &&
    typeof value.delta === "object" &&
    value.delta !== null &&
    (isRoleDelta(value.delta) || isContentDelta(value.delta))
  );
}

function isFinishChoice(value: unknown): value is FinishChoice {
  return (
    typeof value === "object" &&
    value !== null &&
    "finish_reason" in value &&
    value.finish_reason === "stop"
  );
}

function assertMessageResponse(data: unknown): asserts data is ResponsePart {
  if (!(typeof data === "object" && data !== null)) {
    throw new Error("Message is invalid!");
  }
  if (
    !(
      "choices" in data &&
      Array.isArray(data.choices) &&
      data.choices.length === 1 &&
      (isDeltaChoice(data.choices[0]) || isFinishChoice(data.choices[0]))
    )
  ) {
    throw new Error("Message.choice is invalid!");
  }
}

type RoleDelta = {
  role: typeof roles[number];
};

type ContentDelta = {
  content: string;
};

type DeltaChoice = { delta: RoleDelta | ContentDelta; finish_reason: null };

type FinishChoice = { finish_reason: "stop" };

type ResponsePart = {
  choices: [DeltaChoice | FinishChoice];
};
