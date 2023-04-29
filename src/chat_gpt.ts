export interface IChatGPTConversation {
  sendMessage: (
    text: string,
    role?: Role,
  ) => AsyncGenerator<ChatGPTMessagePart>;
}

export interface IChatGPT {
  newConversation(): IChatGPTConversation;
}

export type ChatGPTMessagePart = {
  text: string;
};

export type Role = typeof roles[number];

export const roles = ["system", "user", "assistant"] as const;
