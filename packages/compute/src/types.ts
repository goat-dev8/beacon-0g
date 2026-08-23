export type TrustMode = "verified" | "private";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ChatCompletionResult = {
  id: string;
  model: string;
  content: string;
  usage: ChatUsage;
  chatId: string;
  zgResKey: string | null;
  providerAddress: string | null;
  trustMode: TrustMode;
  raw: unknown;
};

export type ChatCompletionsInput = {
  model: string;
  messages: ChatMessage[];
  trustMode: TrustMode;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" } | { type: "json_schema"; json_schema: unknown };
  providerAddress?: string;
};

export type LedgerBalances = {
  availableNeurons: bigint;
  totalNeurons: bigint;
};

export type ComputeBroker = {
  ledger: {
    getLedger: () => Promise<{ availableBalance?: bigint; totalBalance?: bigint }>;
    depositFund: (amountOg: number) => Promise<unknown>;
  };
  inference?: {
    processResponse: (
      provider: string,
      chatID?: string,
      content?: string,
    ) => Promise<boolean | null>;
  };
};
