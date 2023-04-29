import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";

import {
  ChatGPTMessagePart,
  IChatGPT,
  IChatGPTConversation,
  Role,
} from "./chat_gpt.ts";

type Message = {
  role: Role;
  content: string;
};

export class Conversation implements IChatGPTConversation {
  private messages: Message[] = [];
  constructor(private readonly chatGPT: ChatGPTCompletionAPI) {}
  async *sendMessage(
    text: string,
    role: Role = "user",
  ): AsyncGenerator<ChatGPTMessagePart> {
    this.messages.push({
      role,
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
    messages: Message[],
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

        const parsedData = ResponsePartSchema.parse(data);

        const {
          choices: [choice],
        } = parsedData;

        if (choice.finish_reason === "stop") {
          continue;
        }

        const { delta } = choice;

        if ("role" in delta) {
          continue;
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
        "Response chunk processing ended with an unresolved parsing error!",
      );
      error.cause = parsingError;
      throw error;
    }
  }
}

const roles = ["system", "user", "assistant"] as const;

const RoleSchema = z.enum(roles);

const RoleDeltaSchema = z.object({
  role: RoleSchema,
});

const ContentDeltaSchema = z.object({
  content: z.string(),
});

const DeltaChoiceSchema = z.object({
  delta: z.union([RoleDeltaSchema, ContentDeltaSchema]),
  finish_reason: z.literal(null),
});

const FinishChoiceSchema = z.object({
  finish_reason: z.literal("stop"),
});

const ResponsePartSchema = z.object({
  choices: z.tuple([z.union([DeltaChoiceSchema, FinishChoiceSchema])]),
});
