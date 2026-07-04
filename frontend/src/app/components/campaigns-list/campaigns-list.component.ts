import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { GenerationService, CampaignResponse } from '../../services/generation.service';
import { CampaignStateService } from '../../services/campaign-state.service';

@Component({
  selector: 'app-campaigns-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6 h-[calc(100vh-120px)] flex flex-col justify-between overflow-hidden">
      <!-- Header -->
      <div class="shrink-0">
        <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2">
          <span>📣</span> Campaigns
        </h2>
        <p class="text-slate-400 text-sm mt-1">
          Review generated marketing deliverables or restore a past campaign back into the wizard canvas.
        </p>
      </div>

      <!-- Main Body -->
      <div class="flex-1 overflow-y-auto pr-1">
        <!-- Loader -->
        <div *ngIf="isLoading" class="flex flex-col items-center justify-center py-12 space-y-3">
          <div class="w-10 h-10 rounded-full border-4 border-brand-500/20 border-t-brand-500 animate-spin"></div>
          <span class="text-xs text-slate-450 font-medium">Fetching campaigns...</span>
        </div>

        <!-- Empty State -->
        <div *ngIf="!isLoading && campaigns.length === 0" class="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div class="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-3xl">
            📭
          </div>
          <div class="max-w-sm">
            <h3 class="text-base font-semibold text-slate-200">No campaigns found</h3>
            <p class="text-xs text-slate-450 mt-1 leading-relaxed">
              You haven't generated any marketing campaigns yet. Head over to the Campaign Wizard to launch your first asset pipeline!
            </p>
          </div>
        </div>

        <!-- Grid of Campaign Cards -->
        <div *ngIf="!isLoading && campaigns.length > 0" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          <div
            *ngFor="let campaign of campaigns"
            class="glass-panel border border-slate-800/80 rounded-2xl p-5 hover:border-brand-500/40 transition duration-300 flex flex-col justify-between min-h-[220px]"
          >
            <!-- Top Metadata -->
            <div class="space-y-3">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] text-slate-500 font-mono">
                  ID: {{ campaign.campaign_id.slice(0, 8) }}...
                </span>
                
                <!-- Status Badge -->
                <span
                  [ngClass]="{
                    'bg-yellow-950 text-yellow-400 border-yellow-900/60': campaign.status === 'queued' || campaign.status === 'processing',
                    'bg-emerald-950 text-emerald-400 border-emerald-900/60': campaign.status === 'completed',
                    'bg-red-950 text-red-400 border-red-900/60': campaign.status === 'failed'
                  }"
                  class="px-2 py-0.5 rounded-full text-[9px] font-mono border uppercase tracking-wider font-semibold"
                >
                  {{ campaign.status }}
                </span>
              </div>

              <!-- Campaign Name & Stage Badge -->
              <div class="flex items-center justify-between gap-2 py-0.5">
                <h4 class="text-xs font-bold text-slate-200 truncate" [title]="campaign.name">
                  💼 {{ campaign.name || 'Unnamed Campaign' }}
                </h4>
                <span 
                  [class.bg-slate-900]="campaign.stage_status === 'Draft'"
                  [class.text-slate-400]="campaign.stage_status === 'Draft'"
                  [class.border-slate-800]="campaign.stage_status === 'Draft'"
                  [class.bg-brand-950]="campaign.stage_status === 'Generated'"
                  [class.text-brand-300]="campaign.stage_status === 'Generated'"
                  [class.border-brand-850]="campaign.stage_status === 'Generated'"
                  class="px-1.5 py-0.5 rounded border text-[8px] font-mono font-semibold uppercase tracking-wider shrink-0 animate-fade-in"
                >
                  {{ campaign.stage_status || 'Draft' }}
                </span>
              </div>

              <!-- Persona Matrix Info -->
              <div class="flex flex-wrap gap-1.5">
                <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[9px] text-slate-300 font-medium">
                  🏢 {{ campaign.subsector }}
                </span>
                <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[9px] text-slate-300 font-medium">
                  👤 {{ campaign.persona }}
                </span>
                <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[9px] text-slate-300 font-medium" [title]="campaign.stage">
                  🎯 {{ campaign.stage }}
                </span>
              </div>

              <!-- Prompt Snippet -->
              <p class="text-xs text-slate-350 leading-relaxed line-clamp-3 select-none" [title]="campaign.prompt">
                "{{ campaign.prompt }}"
              </p>
            </div>

            <!-- Bottom Actions -->
            <div class="pt-4 border-t border-slate-900 mt-4 flex items-center justify-between gap-3">
              <div class="text-[9px] text-slate-500 font-mono">
                {{ formatTimestamp(campaign.created_at) }}
              </div>
              
              <div class="flex gap-2">
                <!-- GCS Download Link -->
                <a
                  *ngIf="campaign.status === 'completed' && campaign.gcs_url"
                  [href]="campaign.gcs_url"
                  target="_blank"
                  class="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-white rounded-lg text-slate-400 text-xs font-semibold transition duration-200 flex items-center justify-center"
                  title="Download GCS Package"
                >
                  📥
                </a>
                
                <!-- Delete Campaign -->
                <button
                  type="button"
                  (click)="deleteCampaign(campaign.campaign_id)"
                  class="p-2 bg-slate-900 border border-slate-800 hover:bg-red-950 hover:border-red-900 hover:text-red-400 rounded-lg text-slate-400 text-xs font-semibold transition duration-200 flex items-center justify-center focus:outline-none"
                  title="Delete Campaign"
                >
                  🗑️
                </button>
                
                <!-- Load in Wizard -->
                <button
                  type="button"
                  (click)="loadCampaign(campaign)"
                  class="px-3 py-2 bg-brand-900/40 hover:bg-brand-900 border border-brand-800/80 hover:border-brand-700 rounded-lg text-brand-200 hover:text-white text-xs font-semibold transition duration-200 flex items-center gap-1.5 focus:outline-none"
                >
                  ⚡ Load Wizard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CampaignsListComponent implements OnInit {
  private genService = inject(GenerationService);
  private campaignState = inject(CampaignStateService);
  private router = inject(Router);

  campaigns: CampaignResponse[] = [];
  isLoading = true;

  ngOnInit(): void {
    this.fetchCampaigns();
  }

  fetchCampaigns(): void {
    this.isLoading = true;
    this.genService.getCampaigns().subscribe({
      next: (data) => {
        this.campaigns = data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Failed to load campaigns list', err);
        this.isLoading = false;
      }
    });
  }

  deleteCampaign(campaignId: string): void {
    if (!confirm('Are you sure you want to delete this campaign and all its generated assets?')) {
      return;
    }
    this.genService.deleteCampaign(campaignId).subscribe({
      next: () => {
        this.campaigns = this.campaigns.filter(c => c.campaign_id !== campaignId);
      },
      error: (err) => {
        console.error('Failed to delete campaign', err);
        alert('Failed to delete campaign: ' + (err.error?.detail || err.message));
      }
    });
  }

  loadCampaign(campaign: CampaignResponse): void {
    this.router.navigate(['/wizard', campaign.campaign_id]);
  }

  formatTimestamp(dateString: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateString;
    }
  }
}
