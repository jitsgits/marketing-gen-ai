import { Injectable, signal } from '@angular/core';
import { BrandVoice } from './generation.service';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  // Setup reactive signals for central state management
  readonly brandVoice = signal<BrandVoice>({
    profile: 'Enterprise Compliance',
    system_directive: 'You are a professional marketing strategist. Enforce enterprise compliance standards, write clearly, and do not use forbidden terms.',
    blacklist: ['surveillance', 'spying']
  });

  readonly logoUrl = signal<string | null>(null);

  /**
   * Update active brand voice profile and parameters
   */
  updateBrandVoice(voice: Partial<BrandVoice>): void {
    this.brandVoice.update(current => ({
      ...current,
      ...voice
    }));
  }
}
