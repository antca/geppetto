// import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// import { serveDirWithTs } from "https://deno.land/x/ts_serve@v1.4.4/mod.ts";
import { ChatGPT } from "./chat_gtp.ts";
import { Geppetto } from "./geppetto.ts";

const fileContents = await Deno.readFile(".chat_gpt_cookie.txt");
const cookie = new TextDecoder().decode(fileContents);

const chatGPT = new ChatGPT(cookie);

const geppetto = new Geppetto(chatGPT, async (message: string) => {
  return await prompt(message);
});
geppetto.start();

// serve((req: Request) => {
//   return serveDirWithTs(req, {
//     fsRoot: "public",
//   });
// });
