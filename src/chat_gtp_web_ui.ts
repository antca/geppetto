import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";

import {
  ChatGPTMessagePart,
  IChatGPT,
  IChatGPTConversation,
  Role,
  roles,
} from "./chat_gpt.ts";

export class Conversation implements IChatGPTConversation {
  private lastResponseMessageId?: string;
  private conversationId?: string;
  constructor(private readonly chatGPT: ChatGPTWebUI) {}
  async *sendMessage(
    text: string,
    role: Role = "user",
  ): AsyncGenerator<MessagePart> {
    const gen = this.chatGPT.sendMessage(
      text,
      role,
      this.conversationId,
      this.lastResponseMessageId,
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

export const AuthHeadersSchema = z.object({
  Authorization: z.string(),
  Cookie: z.string(),
  "User-Agent": z.string(),
});

export type AuthHeaders = z.infer<typeof AuthHeadersSchema>;

export interface ChatGPTWebUIAuthHeadersProvider {
  getAuthHeaders: (
    refresh?: boolean,
  ) => Promise<AuthHeaders>;
}

export class ChatGPTWebUI implements IChatGPT {
  constructor(
    private readonly authHeadersProvider: ChatGPTWebUIAuthHeadersProvider,
  ) {}
  newConversation() {
    return new Conversation(this);
  }
  async *sendMessage(
    text: string,
    role: Role,
    conversationId?: string,
    parentMessageId?: string,
    retries = 0,
  ): AsyncGenerator<MessagePart> {
    const roleHeader = `=== MESSAGE AUTHOR ROLE: ${role} ===\n`;
    const data = {
      action: "next",
      messages: [
        {
          id: crypto.randomUUID(),
          author: { role: "user" },
          content: {
            content_type: "text",
            parts: [roleHeader + text],
          },
        },
      ],
      conversation_id: conversationId,
      parent_message_id: parentMessageId ?? crypto.randomUUID(),
      model: "text-davinci-002-render-sha",
    };

    const authHeaders = await this.authHeadersProvider.getAuthHeaders(
      retries > 0,
    );

    const response = await fetch(
      "https://chat.openai.com/backend-api/conversation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      if (retries > 0) {
        console.error(await response.text());
        throw new Error(
          `Request to send message failed: ${response.statusText} (${response.status})`,
        );
      }

      return yield* this.sendMessage(
        text,
        role,
        conversationId,
        parentMessageId,
        retries + 1,
      );
    }

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

        const parsedData = MessageResponse.parse(data);

        const { message, error, conversation_id } = parsedData;

        if (error) {
          throw new Error("Something went wrong when sending message!");
        }

        if (message.author.role !== "assistant") {
          continue;
        }

        const { content } = message;

        const messagePart = content.content_type === "code"
          ? content.text
          : content.parts[0];

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
        "Response chunk processing ended with an unresolved parsing error!",
      );
      error.cause = parsingError;
      throw error;
    }
  }
}

type MessagePart = ChatGPTMessagePart & {
  id: string;
  conversationId: string;
};

const TextContent = z.object({
  content_type: z.literal("text"),
  parts: z.array(z.string()),
});

const CodeContent = z.object({
  content_type: z.literal("code"),
  text: z.string(),
});

const Role = z.enum(roles);

const MessageResponse = z.object({
  message: z.object({
    id: z.string(),
    author: z.object({
      role: Role,
    }),
    content: z.union([TextContent, CodeContent]),
  }),
  conversation_id: z.string(),
  error: z.unknown(),
});
