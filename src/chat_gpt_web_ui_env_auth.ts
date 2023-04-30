import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";

import { ChatGPTWebUIAuthHeadersProvider } from "./chat_gtp_web_ui.ts";

const FetchAccessTokenResponseSchema = z.object({
  accessToken: z.string(),
});

export class ChatGPTWebUIEnvAuth implements ChatGPTWebUIAuthHeadersProvider {
  private accessToken?: string;
  constructor(
    private readonly cookie: string,
    private readonly userAgent: string,
  ) {}

  private async getAccessToken() {
    if (this.accessToken) {
      return this.accessToken;
    }

    const response = await fetch("https://chat.openai.com/api/auth/session", {
      method: "GET",
      headers: {
        "User-Agent": this.userAgent,
        Cookie: this.cookie,
      },
    });

    if (!response.ok) {
      console.error(await response.text());
      throw new Error("Something went wrong when fetching access token!");
    }

    const responseData = FetchAccessTokenResponseSchema.parse(
      await response.json(),
    );

    this.accessToken = responseData.accessToken;

    return this.accessToken;
  }

  async getAuthHeaders(refresh = false) {
    if (refresh) {
      this.accessToken = undefined;
    }

    return {
      Authorization: `Bearer ${await this.getAccessToken()}`,
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
    };
  }
}
