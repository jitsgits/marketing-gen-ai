import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';
import { ConfigService } from '../../services/config.service';
import { GenerationService } from '../../services/generation.service';

@Component({
  selector: 'app-core-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  template: `
    <div class="min-h-screen flex bg-slate-950 text-slate-100 antialiased font-sans">
      
      <!-- Collapsible Sidebar Menu -->
      <aside
        [class.w-64]="isSidebarExpanded"
        [class.w-20]="!isSidebarExpanded"
        class="glass-panel border-r border-slate-800/80 flex flex-col justify-between transition-all duration-300 z-30 shrink-0"
      >
        <!-- Top Section -->
        <div class="space-y-6 py-5">
          <!-- Logo & Collapser -->
          <div class="flex items-center justify-between px-4 gap-2">
            <div class="flex items-center gap-2.5 overflow-hidden" *ngIf="isSidebarExpanded">
              <!-- Brand Logo from Governance -->
              <div *ngIf="configService.logoUrl()" class="w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                <img [src]="configService.logoUrl()" class="max-w-full max-h-full object-contain" alt="Brand Logo" />
              </div>
              <div *ngIf="!configService.logoUrl()" class="w-7 h-7 rounded-lg bg-gradient-to-tr from-brand-650 to-indigo-650 flex items-center justify-center text-white text-xs font-bold shrink-0">
                🚀
              </div>
              <span class="text-sm font-bold bg-gradient-to-r from-brand-400 to-indigo-400 bg-clip-text text-transparent leading-none truncate whitespace-nowrap">
                Campaign Launch Agent
              </span>
            </div>
            
            <div *ngIf="!isSidebarExpanded" class="mx-auto flex flex-col items-center gap-1.5">
              <div *ngIf="configService.logoUrl()" class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                <img [src]="configService.logoUrl()" class="max-w-full max-h-full object-contain" alt="Brand Logo" />
              </div>
              <div *ngIf="!configService.logoUrl()" class="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                🚀
              </div>
            </div>

            <button
              type="button"
              (click)="toggleSidebar()"
              class="p-1.5 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-slate-200 transition focus:outline-none shrink-0"
            >
              <span class="text-xs font-semibold">
                {{ isSidebarExpanded ? '◀' : '▶' }}
              </span>
            </button>
          </div>

          <!-- Navigation Links -->
          <nav class="space-y-1.5 px-3">
            <!-- Campaign Wizard -->
            <a
              routerLink="/wizard"
              routerLinkActive="bg-brand-600 text-white"
              [routerLinkActiveOptions]="{ exact: true }"
              class="w-full flex items-center gap-3.5 py-3 px-3.5 rounded-xl transition duration-200 text-sm font-medium text-slate-450 hover:bg-slate-900 focus:outline-none"
            >
              <span class="text-lg">🧙‍♂️</span>
              <span *ngIf="isSidebarExpanded" class="truncate font-medium">Campaign Wizard</span>
            </a>

            <!-- Campaigns -->
            <a
              routerLink="/campaigns"
              routerLinkActive="bg-brand-600 text-white"
              class="w-full flex items-center gap-3.5 py-3 px-3.5 rounded-xl transition duration-200 text-sm font-medium text-slate-450 hover:bg-slate-900 focus:outline-none"
            >
              <span class="text-lg">📣</span>
              <span *ngIf="isSidebarExpanded" class="truncate font-medium">Campaigns</span>
            </a>
            
            <!-- Asset Library -->
            <a
              routerLink="/assets"
              routerLinkActive="bg-brand-600 text-white"
              class="w-full flex items-center gap-3.5 py-3 px-3.5 rounded-xl transition duration-200 text-sm font-medium text-slate-450 hover:bg-slate-900 focus:outline-none"
            >
              <span class="text-lg">🖼️</span>
              <span *ngIf="isSidebarExpanded" class="truncate font-medium">Asset Library</span>
            </a>
            
            <!-- Brand Governance Settings -->
            <a
              routerLink="/settings"
              routerLinkActive="bg-brand-600 text-white"
              class="w-full flex items-center gap-3.5 py-3 px-3.5 rounded-xl transition duration-200 text-sm font-medium text-slate-450 hover:bg-slate-900 focus:outline-none"
            >
              <span class="text-lg">🛡️</span>
              <span *ngIf="isSidebarExpanded" class="truncate font-medium">Brand Governance</span>
            </a>
          </nav>
        </div>

        <!-- Sidebar Footer -->
        <div class="p-4 border-t border-slate-900">
          <div class="flex items-center gap-3 overflow-hidden">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-white font-bold shrink-0">
              ME
            </div>
            <div class="overflow-hidden" *ngIf="isSidebarExpanded">
              <div class="text-xs font-semibold text-slate-200 truncate">Enterprise User</div>
              <div class="text-[10px] text-slate-500 font-mono truncate">admin&#64;enterprise.com</div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main Canvas Panel -->
      <div class="flex-1 flex flex-col min-w-0">
        <!-- Top Nav Panel -->
        <header class="glass-panel border-b border-slate-800/80 px-6 py-4 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-4">
            <h1 class="text-xl font-bold tracking-tight text-slate-200">
              Campaign Launch Agent
            </h1>
          </div>
        </header>

        <!-- View Canvas Workspace -->
        <main class="flex-1 p-6 overflow-y-auto">
          <router-outlet></router-outlet>
        </main>
      </div>

    </div>
  `
})
export class CoreShellComponent implements OnInit {
  configService = inject(ConfigService);
  private genService = inject(GenerationService);

  isSidebarExpanded = true;

  ngOnInit(): void {
    this.fetchLogo();
  }

  fetchLogo(): void {
    this.genService.getBrandGovernance().subscribe({
      next: (gov) => {
        this.configService.logoUrl.set(gov.logo_gcs_url || null);
      },
      error: (err) => console.error('Failed to load logo in shell', err)
    });
  }

  toggleSidebar(): void {
    this.isSidebarExpanded = !this.isSidebarExpanded;
  }
}
