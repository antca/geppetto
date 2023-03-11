export interface IChatGPTConversation {
  sendMessage: (text: string) => AsyncGenerator<ChatGPTMessagePart>;
}

export interface IChatGPT {
  newConversation(): IChatGPTConversation;
}

export type ChatGPTMessagePart = {
  text: string;
};
