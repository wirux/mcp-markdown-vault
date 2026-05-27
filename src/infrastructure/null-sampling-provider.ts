import type { ISamplingProvider, SamplingRequest, SamplingResponse } from "../domain/interfaces/index.js";

export class NullSamplingProvider implements ISamplingProvider {
  isAvailable(): boolean {
    return false;
  }

  createMessage(_request: SamplingRequest): Promise<SamplingResponse> {
    return Promise.reject(new Error("Sampling not available: no provider connected"));
  }
}
