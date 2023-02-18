type ChatEntry = { user: string; message: string };
import { $, $new } from "./dom.ts";

const chatLog = $(HTMLDivElement, "#chatLog");

const chatLogList = $(HTMLUListElement, ".ChatLogList", chatLog);
const chatLogForm = $(HTMLFormElement, ".ChatLogForm", chatLog);

function appendChatEntry(message: ChatEntry) {
  const chatLogEntryEl = $new("#ChatLogEntry");

  const chatLogEntryNameEl = $(
    HTMLSpanElement,
    ".ChatLogEntryName",
    chatLogEntryEl
  );
  chatLogEntryNameEl.textContent = message.user;

  const chatLogEntryMessageEl = $(
    HTMLSpanElement,
    ".ChatLogEntryMessage",
    chatLogEntryEl
  );
  chatLogEntryMessageEl.textContent = message.message;

  chatLogList.appendChild(chatLogEntryEl);
}

const chatLogFormInput = $(HTMLInputElement, ".ChatLogFormInput");

chatLogForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = chatLogFormInput.value;
  console.log(value);
});

const conversation: ChatEntry[] = [
  { user: "Test", message: "Hello" },
  { user: "Test2", message: "Hello2" },
];

for (const chatEntry of conversation) {
  appendChatEntry(chatEntry);
}
