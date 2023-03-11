import {
  ChatGPTMessagePart,
  IChatGPT,
  IChatGPTConversation,
} from "./chat_gpt.ts";

export class Conversation implements IChatGPTConversation {
  private lastResponseMessageId?: string;
  private conversationId?: string;
  constructor(private readonly chatGPT: ChatGPTWebUI) {}
  async *sendMessage(text: string): AsyncGenerator<MessagePart> {
    const gen = this.chatGPT.sendMessage(
      text,
      this.conversationId,
      this.lastResponseMessageId
    );

    const { value: firstMessage, done } = await gen.next();

    if (done || !firstMessage) {
      return;
    }

    this.lastResponseMessageId = firstMessage.id;
    this.conversationId = firstMessage.conversationId;
    yield firstMessage;

    yield* gen;
  }
}

function assertValidAccessTokenFetchResponseData(
  value: unknown
): asserts value is { accessToken: string } {
  if (
    typeof value === "object" &&
    value !== null &&
    "accessToken" in value &&
    typeof value.accessToken === "string"
  ) {
    return;
  }
  throw new Error("Unexpected value for ChatGPT session");
}

export class ChatGPTWebUI implements IChatGPT {
  private accessToken?: string;
  constructor(private readonly cookie: string) {}
  private async getAccessToken() {
    if (this.accessToken) {
      return this.accessToken;
    }

    const response = await fetch("https://chat.openai.com/api/auth/session", {
      method: "GET",
      headers: {
        Cookie: this.cookie,
      },
    });

    if (!response.ok) {
      console.error(await response.text());
      throw new Error("Something went wrong when fetching access token!");
    }

    const responseData = await response.json();
    assertValidAccessTokenFetchResponseData(responseData);

    this.accessToken = responseData.accessToken;

    return this.accessToken;
  }
  newConversation() {
    return new Conversation(this);
  }
  async *sendMessage(
    text: string,
    conversationId?: string,
    parentMessageId?: string
  ): AsyncGenerator<MessagePart> {
    const accessToken = await this.getAccessToken();
    const data = {
      action: "next",
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          content: {
            content_type: "text",
            parts: [text],
          },
        },
      ],
      conversation_id: conversationId,
      parent_message_id: parentMessageId ?? crypto.randomUUID(),
      model: "text-davinci-002-render-sha",
    };
    const response = await fetch(
      "https://chat.openai.com/backend-api/conversation",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Cookie: this.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }
    );
    if (!response.body) {
      throw new Error("No data received after sending message");
    }

    let lastMessage = "";
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

        const { message, error, conversation_id } = data;

        if (error) {
          throw new Error("Something went wrong when sending message!");
        }

        if (message.author.role !== "assistant") {
          continue;
        }

        const messagePart = message.content.parts[0];

        yield {
          id: message.id,
          text: messagePart.replace(lastMessage, ""),
          conversationId: conversation_id,
        };

        lastMessage = messagePart;
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

function assertMessageResponse(data: unknown): asserts data is MessageResponse {
  if (!(typeof data === "object" && data !== null)) {
    throw new Error("MessageResponse is invalid!");
  }
  if (
    !("conversation_id" in data && typeof data.conversation_id === "string")
  ) {
    throw new Error("MessageResponse.conversation_id is invalid!");
  }
  if (
    !(
      "message" in data &&
      typeof data.message === "object" &&
      data.message !== null
    )
  ) {
    throw new Error("MessageResponse.message is invalid!");
  }
  if (!("id" in data.message && typeof data.message.id === "string")) {
    throw new Error("MessageResponse.message.id is invalid!");
  }
  if (
    !(
      "content" in data.message &&
      typeof data.message.content === "object" &&
      data.message.content !== null
    )
  ) {
    throw new Error("MessageResponse.message.content is invalid!");
  }
  if (
    !(
      "content" in data.message &&
      typeof data.message.content === "object" &&
      data.message.content !== null
    )
  ) {
    throw new Error("MessageResponse.message.content is invalid!");
  }
  if (
    !(
      "parts" in data.message.content &&
      Array.isArray(data.message.content.parts) &&
      data.message.content.parts.length === 1 &&
      typeof data.message.content.parts[0] === "string"
    )
  ) {
    throw new Error("MessageResponse.message.content.parts is invalid!");
  }
  if (
    !(
      "parts" in data.message.content &&
      Array.isArray(data.message.content.parts) &&
      data.message.content.parts.length === 1 &&
      typeof data.message.content.parts[0] === "string"
    )
  ) {
    throw new Error("MessageResponse.message.content.parts is invalid!");
  }
  if (
    !(
      "author" in data.message &&
      typeof data.message.author === "object" &&
      data.message.author !== null
    )
  ) {
    throw new Error("MessageResponse.message.author is invalid!");
  }
  if (
    !(
      "role" in data.message.author &&
      typeof data.message.author.role === "string" &&
      rolesLax.includes(data.message.author.role)
    )
  ) {
    throw new Error("MessageResponse.message.author.role is invalid!");
  }
}

type MessagePart = ChatGPTMessagePart & {
  id: string;
  conversationId: string;
};

type MessageResponse = {
  message: {
    id: string;
    author: { role: typeof roles[number] };
    content: {
      parts: [string];
    };
  };
  conversation_id: string;
  error: unknown;
};
