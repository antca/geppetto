type ChatEntry = { user: string; message: string };

const chatLog = document.querySelector("#chatLog");

const chatLogEntryTemplate = document.querySelector("#chatLogEntryTemplate");

function appendChatEntry(message: ChatEntry) {
  if (!(chatLogEntryTemplate instanceof HTMLTemplateElement)) {
    throw new Error("Invalid chat log entry template");
  }

  const ChatLogEntryEl = chatLogEntryTemplate.content.cloneNode(true);

  if (!(ChatLogEntryEl instanceof DocumentFragment)) {
    throw new Error("Invalid chat log entry fragment");
  }

  const chatLogEntryNameEl = ChatLogEntryEl.querySelector(".ChatLogEntryName");
  if (!(chatLogEntryNameEl instanceof HTMLElement)) {
    throw new Error("Invalid chat log entry name element");
  }
  chatLogEntryNameEl.textContent = message.user;

  const chatLogEntryMessageEl = ChatLogEntryEl.querySelector(
    ".ChatLogEntryMessage"
  );
  if (!(chatLogEntryMessageEl instanceof HTMLElement)) {
    throw new Error("Invalid chat log entry message element");
  }
  chatLogEntryMessageEl.textContent = message.message;

  if (!chatLog) {
    throw new Error("Can't find chat log element");
  }

  chatLog.appendChild(ChatLogEntryEl);
}

const conversation: ChatEntry[] = [
  { user: "Test", message: "Hello" },
  { user: "Test2", message: "Hello2" },
];

for (const chatEntry of conversation) {
  appendChatEntry(chatEntry);
}
