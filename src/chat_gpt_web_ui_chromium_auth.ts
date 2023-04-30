import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { join } from "https://deno.land/std@0.122.0/path/mod.ts";

const defaultStorageBasePath = "/tmp/geppetto";

import {
  AuthHeadersSchema,
  ChatGPTWebUIAuthHeadersProvider,
} from "./chat_gtp_web_ui.ts";

export class ChatGPTWebUIChromiumAuth
  implements ChatGPTWebUIAuthHeadersProvider {
  private readonly storedHeadersFilepath: string;
  constructor(private readonly baseStoragePath = defaultStorageBasePath) {
    this.storedHeadersFilepath = join(this.baseStoragePath, "headers.json");
  }
  private async getStoredHeaders() {
    let storedHeadersFileContent: string;
    try {
      storedHeadersFileContent = await Deno.readTextFile(
        this.storedHeadersFilepath,
      );
    } catch (_error) {
      return null;
    }

    try {
      return AuthHeadersSchema.parse(
        JSON.parse(storedHeadersFileContent),
      );
    } catch (_error) {
      console.warn("Invalid data found in stored headers file.");
      return null;
    }
  }

  async hasStoredHeaders() {
    return !!await this.getStoredHeaders();
  }

  async getAuthHeaders(refresh = false) {
    const storedAuthHeaders = await this.getStoredHeaders();

    if (storedAuthHeaders && !refresh) {
      return storedAuthHeaders;
    }

    const authHeaders = await getAuthHeadersUsingChromium(
      join(this.baseStoragePath, "auth-chromium-profile"),
    );

    await Deno.mkdir(this.baseStoragePath, { recursive: true });
    await Deno.writeTextFile(
      this.storedHeadersFilepath,
      JSON.stringify(authHeaders),
    );
    return authHeaders;
  }
}

function findRandomFreePort(): number {
  const tempListener = Deno.listen({
    transport: "tcp",
    hostname: "127.0.0.1",
    port: 0,
  });
  if (tempListener.addr.transport !== "tcp") {
    throw new Error("Unexpected listener transport!");
  }
  const port = tempListener.addr.port;
  tempListener.close();
  return port;
}

async function startChromiumWithRemoteDebug(
  port: number,
  profileStoragePath: string,
): Promise<Deno.ChildProcess> {
  const chromiumCommand = new Deno.Command("chromium", {
    args: [
      `--remote-debugging-port=${port}`,
      `--app=data:text/plain,`,
      `--user-data-dir=${profileStoragePath}`,
    ],
    stdout: "null",
    stdin: "null",
    stderr: "piped",
  });

  const chromiumProcess = chromiumCommand.spawn();

  const textDecoder = new TextDecoder();

  for await (const chunkData of chromiumProcess.stderr) {
    const chunkText = textDecoder.decode(chunkData);
    if (chunkText.includes("DevTools listening")) {
      return chromiumProcess;
    }
  }

  throw new Error("Failed to start Chromium with remote debug");
}

const CDPResponseErrorSchema = z.object({
  error: z.string(),
});

const CDPResponseFetchRequestPausedSchema = z.object({
  method: z.literal("Fetch.requestPaused"),
  params: z.object({
    requestId: z.string(),
    request: z.object({
      headers: AuthHeadersSchema,
    }),
  }),
});

const CDPResponseInspectorDetached = z.object({
  method: z.literal("Inspector.detached"),
});

async function connectRemoteDebug(port: number): Promise<WebSocket> {
  const response = await fetch(`http://localhost:${port}/json`);
  const targets = await response.json();
  const target = targets.find((t: { type: string }) => t.type === "page");
  return new WebSocket(target.webSocketDebuggerUrl);
}

async function getAuthHeadersUsingChromium(profileStoragePath: string) {
  const port = findRandomFreePort();
  const chromiumProcess = await startChromiumWithRemoteDebug(
    port,
    profileStoragePath,
  );
  const socket = await connectRemoteDebug(port);

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Fetch.enable",
        params: {
          patterns: [
            {
              urlPattern: "https://chat.openai.com/backend-api/accounts/check",
              resourceType: "XHR",
              requestStage: "Response",
            },
          ],
        },
      }),
    );

    socket.send(
      JSON.stringify({
        id: 2,
        method: "Page.navigate",
        params: {
          url: "https://chat.openai.com",
        },
      }),
    );
  };

  try {
    return await new Promise<
      { Authorization: string; Cookie: string; "User-Agent": string }
    >((resolve, reject) => {
      socket.onmessage = (event) => {
        const parsedJSONData = JSON.parse(event.data);

        const errorMessage = CDPResponseErrorSchema.safeParse(parsedJSONData);

        if (errorMessage.success) {
          reject(errorMessage.data.error);
          return;
        }

        const inspectorDetachedMessage = CDPResponseInspectorDetached
          .safeParse(parsedJSONData);

        if (inspectorDetachedMessage.success) {
          socket.close();
          reject(
            new Error(
              "Authentication Failed: The Chromium browser closed unexpectedly before authentication could be completed.",
            ),
          );
          return;
        }

        const fetchRequestPausedMessage = CDPResponseFetchRequestPausedSchema
          .safeParse(parsedJSONData);

        if (fetchRequestPausedMessage.success) {
          const { requestId, request } = fetchRequestPausedMessage.data.params;

          socket.send(
            JSON.stringify({
              id: 3,
              method: "Fetch.continueRequest",
              params: { requestId },
            }),
          );

          resolve(request.headers);
        }
      };
    });
  } finally {
    socket.close();
    chromiumProcess.kill();
  }
}
