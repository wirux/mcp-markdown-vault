import type { ISamplingProvider } from "../domain/interfaces/sampling-provider.js";

export class SamplingProviderRegistry {
  private readonly providers: ISamplingProvider[] = [];

  register(provider: ISamplingProvider): void {
    this.providers.push(provider);
  }

  unregister(provider: ISamplingProvider): void {
    const idx = this.providers.indexOf(provider);
    if (idx !== -1) {
      this.providers.splice(idx, 1);
    }
  }

  getProvider(): ISamplingProvider | null {
    for (const provider of this.providers) {
      if (provider.isAvailable()) {
        return provider;
      }
    }
    return null;
  }

  get size(): number {
    return this.providers.length;
  }
}
