export class Conversation {
  private lastResponseMessageId?: string;
  private conversationId?: string;
  constructor(private readonly chatGPT: ChatGPT) {}
  async sendMessage(text: string) {
    const lastResponse = await this.chatGPT.sendMessage(
      text,
      this.conversationId,
      this.lastResponseMessageId
    );
    this.lastResponseMessageId = lastResponse.id;
    this.conversationId = lastResponse.conversationId;
    return lastResponse.text;
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

export class ChatGPT {
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
  async sendMessage(
    text: string,
    conversationId?: string,
    parentMessageId?: string
  ) {
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
    const textResponse = await response.text();
    const {
      message,
      error,
      conversation_id: responseConversationId,
    } = getEndData(textResponse);
    if (error) {
      throw new Error("Something went wrong when sending message!");
    }

    return {
      id: message.id,
      text: message.content.parts[0],
      conversationId: responseConversationId,
    };
  }
}

function getEndData(raw: string): MessageResponse {
  const messages = raw.trim().split("\n\n");
  const finalDataRaw = messages[messages.length - 2].replace("data: ", "");
  return JSON.parse(finalDataRaw);
}

type MessageResponse = {
  message: {
    id: string;
    content: {
      parts: [string];
    };
  };
  conversation_id: string;
  error: unknown;
};
