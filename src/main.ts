import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveDirWithTs } from "https://deno.land/x/ts_serve@v1.4.4/mod.ts";
import { ChatGPT } from "./chat_gtp.ts";

const fileContents = await Deno.readFile(".chat_gpt_cookie.txt");
const cookie = new TextDecoder().decode(fileContents);

const chatGPT = new ChatGPT(cookie);

const conversation = chatGPT.newConversation();

serve((req: Request) => {
  return serveDirWithTs(req, {
    fsRoot: "public",
  });
});
