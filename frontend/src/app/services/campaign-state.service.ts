import { Injectable, signal } from '@angular/core';
import { CampaignResponse } from './generation.service';

@Injectable({
  providedIn: 'root'
})
export class CampaignStateService {
  readonly selectedCampaign = signal<CampaignResponse | null>(null);

  selectCampaign(campaign: CampaignResponse | null): void {
    this.selectedCampaign.set(campaign);
  }
}
