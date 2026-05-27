export interface SamplingRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface SamplingResponse {
  text: string;
  model?: string;
  stopReason?: string;
}

export interface ISamplingProvider {
  isAvailable(): boolean;
  createMessage(request: SamplingRequest): Promise<SamplingResponse>;
}
