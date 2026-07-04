import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PersonalizationFormComponent } from '../personalization-form/personalization-form.component';
import { ConfigService } from '../../services/config.service';
import { GenerationService, PersonalizationMatrix, CampaignStatus, CampaignResponse } from '../../services/generation.service';
import { CampaignStateService } from '../../services/campaign-state.service';
import { ActivatedRoute, Router } from '@angular/router';

type GenerationState = 'idle' | 'loading' | 'completed' | 'error';

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, PersonalizationFormComponent],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-120px)]">
      
      <!-- Left Panel: Prompt Configuration & Campaign Wizard (Grid span 5) -->
      <div class="lg:col-span-4 glass-card rounded-2xl p-6 flex flex-col justify-between overflow-y-auto max-h-full">
        <div class="space-y-6">
          <div class="flex justify-between items-center gap-2">
            <div>
              <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2">
                <span>🧙‍♂️</span> Campaign Wizard
              </h2>
              <p class="text-slate-400 text-xs mt-0.5">
                Select your personalization matrix parameters.
              </p>
            </div>
            
            <!-- Staging Badge -->
            <span
              [class.bg-slate-900]="campaignStage === 'Draft'"
              [class.text-slate-400]="campaignStage === 'Draft'"
              [class.border-slate-800]="campaignStage === 'Draft'"
              [class.bg-brand-950]="campaignStage === 'Generated'"
              [class.text-brand-300]="campaignStage === 'Generated'"
              [class.border-brand-800]="campaignStage === 'Generated'"
              class="px-2.5 py-0.5 rounded border text-[10px] font-mono font-semibold uppercase tracking-wider animate-fade-in shrink-0"
            >
              {{ campaignStage }}
            </span>
          </div>

          <!-- Section 1: Campaign Metadata -->
          <div class="space-y-3 bg-slate-950/40 border border-slate-800/80 rounded-xl p-4">
            <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-widest font-mono">
              1. Campaign Info
            </h3>
            
            <div class="space-y-1">
              <label for="campaignName" class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">Campaign Name</label>
              <input
                id="campaignName"
                type="text"
                [(ngModel)]="campaignName"
                (ngModelChange)="onCampaignFieldEdit()"
                [disabled]="campaignStage === 'Generated'"
                placeholder="E.g., Summer Q3 Safety Drive"
                class="w-full bg-slate-900/90 border border-slate-700/80 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-transparent transition duration-200 text-xs disabled:opacity-50"
              />
            </div>
          </div>

          <!-- Section 2: Audience Persona Matrix -->
          <div class="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4">
            <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-widest font-mono mb-3">
              2. Audience Persona Matrix
            </h3>
            <app-personalization-form
              [initialMatrix]="activeMatrix"
              [disabled]="campaignStage === 'Generated'"
              (matrixChange)="onMatrixChange($event)"
            ></app-personalization-form>
          </div>

          <!-- Section 3: Brand Asset tags selection -->
          <div class="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4">
            <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-widest font-mono mb-2">
              3. Associate Asset Tags
            </h3>
            <p class="text-[10px] text-slate-500 mb-3 leading-relaxed">
              Select vehicle or product tags from your Asset Library to include in composition prompts.
            </p>
            
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                *ngFor="let tag of availableTags"
                (click)="toggleAssetTag(tag)"
                [disabled]="campaignStage === 'Generated'"
                [class.bg-brand-950]="selectedAssetTags.includes(tag)"
                [class.text-brand-300]="selectedAssetTags.includes(tag)"
                [class.border-brand-805]="selectedAssetTags.includes(tag)"
                [class.bg-slate-900]="!selectedAssetTags.includes(tag)"
                [class.text-slate-400]="!selectedAssetTags.includes(tag)"
                [class.border-slate-800]="!selectedAssetTags.includes(tag)"
                class="px-2.5 py-1 rounded border text-[10px] font-mono font-semibold uppercase tracking-wider transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                #{{ tag }}
              </button>
              <span *ngIf="availableTags.length === 0" class="text-[10px] text-slate-500 font-mono italic">
                No tags found in Asset Library. Add items in Asset Library first.
              </span>
            </div>
          </div>

          <!-- Section 4: Campaign Direction & Context -->
          <div class="space-y-2">
            <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-widest font-mono">
              4. Campaign Direction & Context
            </h3>
            <textarea
              id="promptInput"
              [(ngModel)]="prompt"
              (ngModelChange)="onCampaignFieldEdit()"
              [disabled]="campaignStage === 'Generated'"
              rows="4"
              placeholder="E.g., Write a promotional launch article introducing our new electric commercial fleet solutions, focusing on telematics, preventive maintenance alerts, and compliance tracking."
              class="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition duration-200 resize-none text-sm leading-relaxed disabled:opacity-50"
            ></textarea>
          </div>
        </div>
      </div>

      <!-- Sandwiched Middle Column: Asset Pipeline Trigger (Grid span 1) -->
      <div class="lg:col-span-1 flex flex-col justify-center items-center relative py-6 border-l border-r border-slate-800/40 bg-slate-950/20 rounded-2xl overflow-hidden shrink-0">
        <!-- Visual pipeline wire -->
        <div class="w-0.5 h-full bg-slate-800/60 absolute z-0"></div>

        <!-- Floating Control Panel -->
        <div class="flex flex-col items-center justify-center space-y-4 z-10">
          <button
            type="button"
            (click)="generateCreativeArtifacts()"
            [disabled]="state() === 'loading' || !prompt.trim() || !campaignName.trim() || campaignStage === 'Generated'"
            class="w-16 h-16 rounded-full bg-gradient-to-tr from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white shadow-xl shadow-brand-900/30 flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 disabled:from-slate-900 disabled:to-slate-900 disabled:text-slate-600 disabled:border-slate-800/80 disabled:border disabled:scale-100 disabled:shadow-none group relative focus:outline-none"
          >
            <span *ngIf="state() === 'loading'" class="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            <span *ngIf="state() !== 'loading'" class="text-xl font-bold">➔</span>
            
            <!-- Tooltip -->
            <span class="absolute bottom-full mb-3 hidden group-hover:block bg-slate-900 border border-slate-800 text-[10px] text-slate-350 font-mono py-1.5 px-2.5 rounded-lg whitespace-nowrap tracking-wider shadow-2xl">
              {{ (!prompt.trim() || !campaignName.trim()) ? 'Campaign Info & Context Required' : 'Generate Creative Artifacts (Draft)' }}
            </span>
          </button>
          <div class="text-center">
            <span class="text-[10px] text-slate-500 font-mono uppercase tracking-widest font-semibold block">Creative Assets</span>
            <span class="text-[9px] text-slate-600 font-mono block mt-0.5">Pipeline (Draft)</span>
          </div>
        </div>
      </div>

      <!-- Right Panel: Generation Canvas & Workspace Output (Grid span 7) -->
      <div class="lg:col-span-7 glass-card rounded-2xl p-6 flex flex-col justify-between overflow-hidden relative max-h-full"
           [class.glow-pulse]="state() === 'loading'">
        
        <!-- Canvas Header -->
        <div class="border-b border-slate-800/60 pb-4 mb-4 flex justify-between items-center shrink-0">
          <div>
            <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>🎨</span> Generation Canvas
            </h2>
          </div>
          <div class="flex items-center gap-3">
            <!-- Generate / Download Document & PPT -->
            <ng-container *ngIf="hasAllArtifactsCompleted()">
              <!-- If documents already generated: show Download buttons -->
              <ng-container *ngIf="campaignData?.docx_status === 'completed' && campaignData?.pptx_status === 'completed'">
                <a
                  id="download-docx-btn"
                  [href]="campaignData.docx_gcs_url"
                  target="_blank"
                  download
                  class="px-3 py-1.5 bg-emerald-900/70 hover:bg-emerald-800 text-emerald-300 text-xs font-semibold rounded-lg border border-emerald-800/60 transition flex items-center gap-1.5"
                >📄 Download DOCX</a>
                <a
                  id="download-pptx-btn"
                  [href]="campaignData.pptx_gcs_url"
                  target="_blank"
                  download
                  class="px-3 py-1.5 bg-blue-900/70 hover:bg-blue-800 text-blue-300 text-xs font-semibold rounded-lg border border-blue-800/60 transition flex items-center gap-1.5"
                >📊 Download PPTX</a>
              </ng-container>
              <!-- Otherwise: Generate button -->
              <button
                *ngIf="campaignData?.docx_status !== 'completed' || campaignData?.pptx_status !== 'completed'"
                id="generate-documents-btn"
                type="button"
                (click)="finalizeTemplates()"
                [disabled]="isGeneratingDocuments || state() === 'loading'"
                class="px-4 py-1.5 bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-lg shadow-md transition duration-200 focus:outline-none disabled:opacity-50 flex items-center gap-2"
              >
                <span *ngIf="isGeneratingDocuments" class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                {{ isGeneratingDocuments ? 'Generating...' : '🚀 Generate Document & PPT' }}
              </button>
            </ng-container>
            
            <span *ngIf="state() !== 'idle'"
                  [class.bg-yellow-950]="state() === 'loading'"
                  [class.text-yellow-400]="state() === 'loading'"
                  [class.border-yellow-800]="state() === 'loading'"
                  [class.bg-emerald-950]="state() === 'completed'"
                  [class.text-emerald-400]="state() === 'completed'"
                  [class.border-emerald-800]="state() === 'completed'"
                  [class.bg-red-950]="state() === 'error'"
                  [class.text-red-400]="state() === 'error'"
                  [class.border-red-800]="state() === 'error'"
                  class="px-2.5 py-1 rounded-full text-xs font-mono border uppercase tracking-wider font-semibold animate-fade-in">
              {{ state() }}
            </span>
          </div>
        </div>

        <!-- Canvas Body (Scrollable Output area) -->
        <div class="flex-1 overflow-y-auto pr-1 flex flex-col h-full">
          
          <!-- IDLE STATE -->
          <div *ngIf="state() === 'idle'" class="my-auto flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div class="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-3xl shadow-inner">
              ⚙️
            </div>
            <div class="max-w-sm space-y-2">
              <h3 class="text-lg font-semibold text-slate-300">Canvas Ready</h3>
              <p class="text-slate-400 text-sm leading-relaxed">
                Configure your target parameters in the wizard, enter context directives, and trigger generation using the middle ➔ button to generate draft artifacts.
              </p>
            </div>
          </div>

          <!-- ERROR STATE -->
          <div *ngIf="state() === 'error'" class="my-auto flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div class="w-16 h-16 rounded-full bg-red-950/40 border border-red-900/60 flex items-center justify-center text-3xl text-red-500 shadow-inner">
              ⚠️
            </div>
            <div class="max-w-sm space-y-2">
              <h3 class="text-lg font-semibold text-red-400">Generation Failed</h3>
              <p class="text-slate-400 text-sm leading-relaxed">
                {{ errorMessage }}
              </p>
            </div>
            <button
              type="button"
              (click)="state.set('idle')"
              class="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-lg text-sm border border-slate-700/80 transition"
            >
              Return to Wizard
            </button>
          </div>

          <!-- COMPLETED / LOADING CANVAS (Tabbed Interface) -->
          <div *ngIf="state() === 'completed' || state() === 'loading'" class="flex flex-col h-full animate-fade-in">
            
            <div class="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2 mb-4 flex flex-wrap gap-1 sticky top-0 z-10 shadow-lg">
              <!-- Visual Tabs -->
              <button *ngFor="let tab of visualTabs" 
                      (click)="activeTab = tab.id"
                      [class.bg-brand-900]="activeTab === tab.id"
                      [class.text-white]="activeTab === tab.id"
                      [class.bg-transparent]="activeTab !== tab.id"
                      [class.text-slate-400]="activeTab !== tab.id"
                      class="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold tracking-wider transition-all focus:outline-none flex items-center gap-2">
                <span *ngIf="getStatus(tab.statusKey) === 'generating'" class="w-3 h-3 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin"></span>
                <span *ngIf="getStatus(tab.statusKey) === 'completed'" class="text-emerald-400">✓</span>
                {{ tab.label }}
              </button>
              <div class="w-px h-6 bg-slate-800 mx-2 my-auto"></div>
              <!-- Text Tabs -->
              <button *ngFor="let tab of textTabs" 
                      (click)="activeTab = tab.id; loadTextContent(tab.id)"
                      [class.bg-indigo-900]="activeTab === tab.id"
                      [class.text-white]="activeTab === tab.id"
                      [class.bg-transparent]="activeTab !== tab.id"
                      [class.text-slate-400]="activeTab !== tab.id"
                      class="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold tracking-wider transition-all focus:outline-none flex items-center gap-2">
                <span *ngIf="getStatus(tab.statusKey) === 'generating'" class="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></span>
                <span *ngIf="getStatus(tab.statusKey) === 'completed'" class="text-emerald-400">✓</span>
                {{ tab.label }}
              </button>
            </div>
            
            <!-- Tab Viewport -->
            <div class="flex-1 bg-slate-950/50 border border-slate-800/80 rounded-xl p-4 flex flex-col relative h-[580px] min-h-[580px]">
              
              <!-- IMAGE VIEWER -->
              <div *ngIf="isVisualTabActive()" class="flex-1 flex flex-col relative">
                <div class="flex justify-between items-center mb-3">
                  <h4 class="text-xs text-indigo-400 font-bold uppercase tracking-widest font-mono">
                    {{ campaignStage === 'Generated' ? 'Image View' : 'Image Refinement' }}
                  </h4>
                  <div class="flex gap-2 w-full max-w-md items-center justify-end">
                     <ng-container *ngIf="campaignStage !== 'Generated'">
                       <input type="text" [(ngModel)]="refinementPrompt" placeholder="Refinement prompt..." class="flex-1 bg-slate-900/90 border border-slate-700/80 rounded-lg px-2 py-1 text-slate-200 focus:outline-none focus:border-brand-500 text-xs">
                       <button type="button" (click)="regenerateActiveImage()" [disabled]="isRegeneratingSingle || getStatus(activeTabObj.statusKey) === 'generating'" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-mono rounded-lg border border-slate-700 whitespace-nowrap">🔄 Regenerate</button>
                       <div class="w-px h-6 bg-slate-800 mx-1"></div>
                     </ng-container>
                     <button type="button" (click)="downloadImageArtifact(activeTabObj.label, activeGcsUrl)" [disabled]="!activeGcsUrl" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-mono rounded-lg border border-slate-700 text-slate-300 flex items-center gap-1.5 focus:outline-none whitespace-nowrap">
                       📥 Download
                     </button>
                  </div>
                </div>
                
                <!-- LOGO OVERLAY CONTROL PANEL -->
                <div *ngIf="campaignStage !== 'Generated' && activeGcsUrl" class="mb-3 p-3 bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between text-xs text-slate-300 gap-4">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-indigo-400">🛡️ Logo Overlay:</span>
                    <span class="text-slate-400">Select corner to stamp corporate logo:</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="logo_pos" [(ngModel)]="logoPosition" value="top_left" class="accent-indigo-500"> TL
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="logo_pos" [(ngModel)]="logoPosition" value="top_right" class="accent-indigo-500"> TR
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="logo_pos" [(ngModel)]="logoPosition" value="bottom_left" class="accent-indigo-500"> BL
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="logo_pos" [(ngModel)]="logoPosition" value="bottom_right" class="accent-indigo-500"> BR
                    </label>
                    <button type="button" (click)="applyLogoOverlay()" [disabled]="isApplyingLogo || getStatus(activeTabObj.statusKey) === 'generating'" class="ml-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition active:scale-95 flex items-center gap-1.5 focus:outline-none">
                      <span *ngIf="isApplyingLogo" class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      {{ isApplyingLogo ? 'Applying...' : 'Apply Logo' }}
                    </button>
                  </div>
                </div>

                <div class="flex-1 bg-slate-900 overflow-hidden relative flex items-center justify-center rounded-xl border border-slate-800 group">
                   <img *ngIf="activeGcsUrl" [src]="activeGcsUrl" class="w-full h-full object-contain" alt="Preview" />
                   <div *ngIf="!activeGcsUrl && getStatus(activeTabObj.statusKey) === 'generating'" class="flex flex-col items-center text-slate-500 font-mono text-[10px]">
                      <div class="w-6 h-6 border-2 border-brand-500/20 border-t-brand-500 rounded-full animate-spin mb-2"></div>
                      Generating Image...
                   </div>
                   <div *ngIf="!activeGcsUrl && getStatus(activeTabObj.statusKey) === 'idle'" class="text-slate-600 font-mono text-xs">Waiting in queue...</div>
                   
                   <div *ngIf="!activeGcsUrl && (getStatus(activeTabObj.statusKey) === 'failed' || getStatus(activeTabObj.statusKey) === 'completed')" class="absolute inset-0 flex flex-col items-center justify-center text-red-405 font-mono text-xs bg-slate-900/95 rounded-xl border border-red-900/40 p-6 space-y-3 text-center z-10">
                      <span class="font-bold text-sm text-red-400">⚠️ Image Not Loaded</span>
                      <span class="text-[11px] text-slate-400 max-w-sm">The image is still propagating to GCS or generation encountered a limit.</span>
                      <button type="button" (click)="retryLoadVisual(activeTab)" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono rounded-lg border border-slate-700 transition active:scale-95 focus:outline-none">🔄 Retry Loading from GCS</button>
                   </div>
                   
                   <div *ngIf="isRegeneratingSingle" class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center space-y-2 z-20">
                     <div class="w-8 h-8 border-2 border-brand-500/20 border-t-brand-500 rounded-full animate-spin"></div>
                     <span class="text-xs text-slate-300 font-mono">Regenerating...</span>
                   </div>
                </div>
              </div>

              <!-- TEXT VIEWER -->
              <div *ngIf="!isVisualTabActive()" class="flex-1 flex flex-col relative h-full min-h-0">
                <div class="flex justify-between items-center mb-3">
                  <h4 class="text-xs text-brand-400 font-bold uppercase tracking-widest font-mono">
                    {{ campaignStage === 'Generated' ? 'Text View (Markdown)' : 'Text Refinement (Markdown)' }}
                  </h4>
                  <div class="flex gap-2 w-full max-w-xl items-center justify-end">
                     <ng-container *ngIf="campaignStage !== 'Generated'">
                       <input type="text" [(ngModel)]="textRefinementPrompt" placeholder="Refinement prompt..." class="bg-slate-900/90 border border-slate-700/80 rounded-lg px-2 py-1 text-slate-200 focus:outline-none focus:border-brand-500 text-xs w-40">
                       <button type="button" (click)="regenerateActiveText()" [disabled]="isRegeneratingSingleText || getStatus(activeTabObj.statusKey) === 'generating'" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-mono rounded-lg border border-slate-700 whitespace-nowrap">🔄 Regenerate</button>
                       <div class="w-px h-6 bg-slate-800 mx-1"></div>
                     </ng-container>
                     <button type="button" (click)="downloadTextArtifact(activeTabObj.label, activeTextContent)" [disabled]="!activeTextContent" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-mono rounded-lg border border-slate-700 text-slate-300 flex items-center gap-1.5 focus:outline-none whitespace-nowrap">
                       📥 Download
                     </button>
                     <button *ngIf="campaignStage !== 'Generated'" type="button" (click)="saveTextContent()" [disabled]="isSavingText || getStatus(activeTabObj.statusKey) === 'generating' || !activeTextContent" class="px-3 py-1.5 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-300 text-xs font-mono font-bold rounded-lg border border-emerald-800 transition-colors flex items-center gap-2 whitespace-nowrap">
                        <span *ngIf="isSavingText" class="w-3 h-3 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></span>
                        {{ isSavingText ? 'Saving...' : '💾 Save Text' }}
                     </button>
                  </div>
                </div>
                
                <div class="flex-1 flex flex-col space-y-4 relative min-h-0">
                   <!-- Show editor and preview only when completed AND content is populated -->
                   <div *ngIf="getStatus(activeTabObj.statusKey) === 'completed' && activeTextContent" class="flex-1 flex flex-col space-y-4 min-h-0">
                      <textarea *ngIf="campaignStage !== 'Generated'" [(ngModel)]="activeTextContent" class="w-full h-1/3 min-h-[120px] bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-300 font-mono text-xs leading-relaxed focus:outline-none focus:border-brand-500 resize-none shrink-0"></textarea>
                      
                      <!-- Live Markdown Preview -->
                      <div class="flex-1 flex flex-col min-h-0 border-t border-slate-800/80 pt-3">
                         <div class="text-[10px] text-slate-400 font-bold uppercase tracking-widest font-mono mb-2">Live Markdown Preview</div>
                         <div [innerHTML]="renderMarkdown(activeTextContent)" class="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs overflow-y-auto text-slate-300 leading-relaxed font-sans prose prose-invert max-w-none"></div>
                      </div>
                   </div>
                   
                   <div *ngIf="getStatus(activeTabObj.statusKey) === 'generating'" class="absolute inset-0 flex flex-col items-center justify-center text-slate-500 font-mono text-[10px] bg-slate-900/50 rounded-xl border border-slate-800">
                      <div class="w-6 h-6 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-2"></div>
                      Generating Text Content...
                   </div>
                   <div *ngIf="getStatus(activeTabObj.statusKey) === 'idle'" class="absolute inset-0 flex items-center justify-center text-slate-600 font-mono text-xs bg-slate-900/50 rounded-xl border border-slate-800">Waiting in queue...</div>
                   
                   <!-- Show failure or missing text state -->
                   <div *ngIf="!activeTextContent && getStatus(activeTabObj.statusKey) === 'failed'" class="absolute inset-0 flex flex-col items-center justify-center text-red-405 font-mono text-xs bg-slate-900/95 rounded-xl border border-red-900/40 p-6 space-y-3 text-center z-10">
                      <span class="font-bold text-sm text-red-400">⚠️ Text Not Loaded</span>
                      <span class="text-[11px] text-slate-400 max-w-sm">The text generation failed or encountered a limit. Use the Regenerate button above to try again.</span>
                      <button type="button" (click)="regenerateActiveText()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono rounded-lg border border-slate-700 transition active:scale-95 focus:outline-none">🔄 Regenerate Text</button>
                   </div>
                   
                   <div *ngIf="!activeTextContent && getStatus(activeTabObj.statusKey) === 'completed'" class="absolute inset-0 flex flex-col items-center justify-center text-slate-400 font-mono text-xs bg-slate-900/95 rounded-xl border border-slate-800 p-6 space-y-3 text-center z-10">
                      <span class="font-bold text-sm text-indigo-400">⏱️ Loading Artifact from GCS</span>
                      <span class="text-[11px] text-slate-500 max-w-sm">Please wait while the text content is being loaded from GCS.</span>
                      <div class="w-6 h-6 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mt-2"></div>
                   </div>
                </div>
              </div>



            </div>
          </div>

        </div>

      </div>
    </div>
  `
})
export class WorkspaceComponent implements OnInit {
  configService = inject(ConfigService);
  generationService = inject(GenerationService);
  campaignState = inject(CampaignStateService);
  route = inject(ActivatedRoute);
  router = inject(Router);

  campaignName = '';
  campaignStage = 'Draft';
  prompt = '';
  
  state = signal<GenerationState>('idle');
  errorMessage = '';
  currentCampaignId = '';
  
  refinementPrompt = '';
  textRefinementPrompt = '';
  isRegeneratingSingle = false;
  isRegeneratingSingleText = false;
  isSavingText = false;
  isGeneratingDocuments = false;
  isLoadingCampaign = false;
   
  // Logo Overlay Settings
  logoPosition: string = 'bottom_right';
  isApplyingLogo: boolean = false;
  
  // Tab Management
  visualTabs = [
    { id: 'blog_hero', label: 'Blog Hero', statusKey: 'blog_hero_status', urlKey: 'blog_hero_gcs_url' },
    { id: 'editorial', label: 'Editorial', statusKey: 'editorial_status', urlKey: 'editorial_gcs_url' },
    { id: 'slide_background', label: 'Slide Bg', statusKey: 'slide_background_status', urlKey: 'slide_background_gcs_url' },
    { id: 'content_card', label: 'Card', statusKey: 'content_card_status', urlKey: 'content_card_gcs_url' }
  ];
  textTabs = [
    { id: 'blog_post', label: 'Blog Post', statusKey: 'blog_post_status', urlKey: 'blog_post_gcs_url' },
    { id: 'press_release', label: 'Press Release', statusKey: 'press_release_status', urlKey: 'press_release_gcs_url' },
    { id: 'longform', label: 'Long-form', statusKey: 'longform_status', urlKey: 'longform_gcs_url' }
  ];

  
  activeTab: string = 'blog_hero';
  activeTextContent: string = '';
  loadedTextArtifacts: Record<string, string> = {};

  activeMatrix: PersonalizationMatrix = {
    subsector: 'Trucking & Local',
    persona: 'Fleet Safety Manager',
    stage: 'Awareness'
  };

  availableTags: string[] = [];
  selectedAssetTags: string[] = [];

  // Local state cache for the campaign artifact statuses
  campaignData: any = {};

  ngOnInit(): void {
    this.fetchAssetTags();

    // Check if campaign_id is in route params
    this.route.paramMap.subscribe(params => {
      const campaignId = params.get('campaign_id');
      if (campaignId) {
        this.loadCampaignById(campaignId);
      } else {
        // Fallback to state service
        const selected = this.campaignState.selectedCampaign();
        if (selected) {
          this.router.navigate(['/wizard', selected.campaign_id], { replaceUrl: true });
          this.campaignState.selectCampaign(null);
        }
      }
    });
  }

  loadCampaignById(campaignId: string): void {
    this.isLoadingCampaign = true;
    this.state.set('loading');
    this.currentCampaignId = campaignId;
    this.generationService.getCampaignStatus(campaignId).subscribe({
      next: (campaign: CampaignStatus) => {
        this.campaignData = campaign;
        this.campaignName = campaign.name || '';
        this.campaignStage = campaign.stage_status || 'Draft';
        this.prompt = campaign.prompt || '';
        
        // Note: selected_asset_tags and matrix might not be in basic status object, but let's map what we can
        // We will fetch full campaign details if needed, but CampaignStatus schema contains subsector/persona/stage
        this.activeMatrix = {
          subsector: campaign.subsector || 'Trucking & Local',
          persona: campaign.persona || 'Fleet Safety Manager',
          stage: campaign.stage || 'Awareness'
        };
        this.selectedAssetTags = campaign.selected_asset_tags || [];

        if (campaign.status === 'completed' || campaign.status === 'failed') {
          this.state.set('completed');
          this.loadTextContent(this.activeTab);
        } else if (campaign.status === 'processing' || campaign.status === 'queued') {
          this.state.set('loading');
          this.connectWS(campaign.campaign_id);
        } else {
          this.state.set('idle');
        }
        
        setTimeout(() => {
          this.isLoadingCampaign = false;
        }, 150);
      },
      error: (err) => {
        this.isLoadingCampaign = false;
        this.errorMessage = 'Failed to load campaign from route.';
        this.state.set('error');
      }
    });
  }

  fetchAssetTags(): void {
    this.generationService.getAssets().subscribe({
      next: (assets) => {
        const tagSet = new Set<string>();
        assets.forEach(a => {
          if (a.tags) {
            a.tags.forEach(tag => tagSet.add(tag));
          }
        });
        this.availableTags = Array.from(tagSet);
      },
      error: (err) => console.error('Failed to load asset tags', err)
    });
  }

  toggleAssetTag(tag: string): void {
    if (this.campaignStage === 'Generated') return;
    if (this.selectedAssetTags.includes(tag)) {
      this.selectedAssetTags = this.selectedAssetTags.filter(t => t !== tag);
    } else {
      this.selectedAssetTags.push(tag);
    }
  }

  onMatrixChange(matrix: PersonalizationMatrix): void {
    if (this.isLoadingCampaign || this.campaignStage === 'Generated') return;
    this.activeMatrix = matrix;
  }

  onCampaignFieldEdit(): void {
    // All editable inputs are disabled via [disabled] bindings for Generated campaigns.
    // This method is kept as a hook for future use but no longer resets campaign state.
  }

  getFormattedTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + pad(now.getHours()) + pad(now.getMinutes());
  }
  
  get activeTabObj(): any {
    return [...this.visualTabs, ...this.textTabs].find(t => t.id === this.activeTab);
  }
  
  isVisualTabActive(): boolean {
    return this.visualTabs.some(t => t.id === this.activeTab);
  }
  
  getStatus(statusKey: string): string {
    return this.campaignData[statusKey] || 'idle';
  }
  
  wsBuster = new Date().getTime();

  get activeGcsUrl(): string {
    const tab = this.visualTabs.find(t => t.id === this.activeTab);
    if (!tab) return '';
    const url = this.campaignData[tab.urlKey];
    if (!url) return '';
    if (url.startsWith('http')) {
      return url.split('?')[0] + '?t=' + this.wsBuster;
    }
    return url;
  }
  
  hasAllArtifactsCompleted(): boolean {
    const statuses = [
      this.campaignData.blog_post_status, this.campaignData.press_release_status, this.campaignData.longform_status,
      this.campaignData.blog_hero_status, this.campaignData.editorial_status, this.campaignData.slide_background_status, this.campaignData.content_card_status
    ];
    return statuses.length > 0 && statuses.every(s => s === 'completed');
  }

  generateCreativeArtifacts(): void {
    if (!this.prompt.trim() || !this.campaignName.trim()) return;

    this.state.set('loading');
    this.errorMessage = '';
    this.campaignStage = 'Draft';
    this.campaignData = {};
    this.loadedTextArtifacts = {};

    const requestPayload: any = {
      name: this.campaignName,
      stage_status: 'Draft',
      prompt: this.prompt,
      personalization_matrix: this.activeMatrix,
      selected_asset_tags: this.selectedAssetTags
    };
    if (this.currentCampaignId) {
      requestPayload.campaign_id = this.currentCampaignId;
    }

    this.generationService.generate(requestPayload).subscribe({
      next: (campaign: CampaignStatus) => {
        this.currentCampaignId = campaign.campaign_id;
        // Update route with campaign_id
        this.router.navigate(['/wizard', campaign.campaign_id], { replaceUrl: true });
        this.connectWS(campaign.campaign_id);
      },
      error: (err) => {
        this.state.set('error');
        this.errorMessage = err.error?.detail || 'Failed to submit generation request.';
      }
    });
  }
  
  finalizeTemplates(): void {
    if (!this.currentCampaignId || this.isGeneratingDocuments) return;
    this.isGeneratingDocuments = true;

    this.generationService.generateDocuments(this.currentCampaignId).subscribe({
      next: (res) => {
        // Update local campaignData so buttons switch to Download state
        this.campaignData = {
          ...this.campaignData,
          docx_gcs_url: res.docx_url,
          pptx_gcs_url: res.pptx_url,
          docx_status: 'completed',
          pptx_status: 'completed',
          stage_status: 'Generated',
        };
        this.campaignStage = 'Generated';
        this.isGeneratingDocuments = false;

        // Trigger browser downloads
        if (res.docx_url) {
          const docxLink = document.createElement('a');
          docxLink.href = res.docx_url;
          docxLink.download = `${this.campaignName || 'campaign'}_package.docx`;
          docxLink.target = '_blank';
          docxLink.click();
        }
        if (res.pptx_url) {
          setTimeout(() => {
            const pptxLink = document.createElement('a');
            pptxLink.href = res.pptx_url;
            pptxLink.download = `${this.campaignName || 'campaign'}_deck.pptx`;
            pptxLink.target = '_blank';
            pptxLink.click();
          }, 500);
        }
      },
      error: (err) => {
        console.error('Failed to generate documents', err);
        this.isGeneratingDocuments = false;
        alert('Document generation failed: ' + (err.error?.detail || err.message));
      }
    });
  }

  regenerateActiveImage(): void {
    if (!this.currentCampaignId || this.isRegeneratingSingle || !this.isVisualTabActive()) return;
    
    const tab = this.visualTabs.find(t => t.id === this.activeTab);
    if (tab) {
      this.campaignData[tab.statusKey] = 'generating';
    }
    
    this.isRegeneratingSingle = true;
    this.generationService.regenerateCampaignAsset(this.currentCampaignId, this.activeTab, this.refinementPrompt).subscribe({
      next: (res) => {
        this.wsBuster = new Date().getTime();
        if (tab) {
          this.campaignData[tab.urlKey] = res.image_url;
          this.campaignData[tab.statusKey] = 'completed';
        }
        this.isRegeneratingSingle = false;
        this.refinementPrompt = '';
      },
      error: (err) => {
        console.error('Failed to regenerate single image template', err);
        if (tab) {
          this.campaignData[tab.statusKey] = 'failed';
        }
        this.isRegeneratingSingle = false;
      }
    });
  }

  applyLogoOverlay(): void {
    if (!this.currentCampaignId || this.isApplyingLogo || !this.isVisualTabActive() || !this.activeGcsUrl) return;
    
    const tab = this.visualTabs.find(t => t.id === this.activeTab);
    if (tab) {
      this.campaignData[tab.statusKey] = 'generating';
    }
    
    this.isApplyingLogo = true;
    this.generationService.overlayLogo(this.currentCampaignId, this.activeTab, this.logoPosition).subscribe({
      next: (res) => {
        this.wsBuster = new Date().getTime();
        if (tab) {
          this.campaignData[tab.urlKey] = res.image_url;
          this.campaignData[tab.statusKey] = 'completed';
        }
        this.isApplyingLogo = false;
      },
      error: (err) => {
        console.error('Failed to overlay logo', err);
        alert('Failed to overlay logo: ' + (err.error?.detail || err.message));
        if (tab) {
          this.campaignData[tab.statusKey] = 'completed';
        }
        this.isApplyingLogo = false;
      }
    });
  }

  regenerateActiveText(): void {
    if (!this.currentCampaignId || this.isRegeneratingSingleText || this.isVisualTabActive()) return;
    
    const tab = this.textTabs.find(t => t.id === this.activeTab);
    if (tab) {
      this.campaignData[tab.statusKey] = 'generating';
    }
    
    this.isRegeneratingSingleText = true;
    this.generationService.regenerateCampaignText(this.currentCampaignId, this.activeTab, this.textRefinementPrompt).subscribe({
      next: (res) => {
        if (tab) {
          this.campaignData[tab.urlKey] = res.url;
          this.campaignData[tab.statusKey] = 'completed';
        }
        this.loadedTextArtifacts[this.activeTab] = res.content;
        this.activeTextContent = res.content;
        this.isRegeneratingSingleText = false;
        this.textRefinementPrompt = '';
      },
      error: (err) => {
        console.error('Failed to regenerate single text artifact', err);
        if (tab) {
          this.campaignData[tab.statusKey] = 'failed';
        }
        this.isRegeneratingSingleText = false;
      }
    });
  }

  downloadTextArtifact(label: string, content: string): void {
    if (!content) return;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label.replace(/\s+/g, '_').toLowerCase()}.md`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  downloadImageArtifact(label: string, gcsUrl: string): void {
    if (!gcsUrl) return;
    // Open image URL directly to trigger/allow download
    const a = document.createElement('a');
    a.href = gcsUrl;
    a.target = '_blank';
    a.download = `${label.replace(/\s+/g, '_').toLowerCase()}.png`;
    a.click();
  }

  loadTextContent(tabId: string, force: boolean = false): void {
    if (!this.currentCampaignId) return;
    
    const tabObj = this.textTabs.find(t => t.id === tabId);
    if (!tabObj) return;
    if (this.getStatus(tabObj.statusKey) !== 'completed' && !force) return;
    
    if (this.loadedTextArtifacts[tabId] && !force) {
      if (this.activeTab === tabId) {
        this.activeTextContent = this.loadedTextArtifacts[tabId];
      }
      return;
    }
    
    const gcsUrl = this.campaignData[tabObj.urlKey];
    if (!gcsUrl) {
      if (this.activeTab === tabId) {
        this.activeTextContent = '';
      }
      return;
    }
    
    const cacheBust = new Date().getTime();
    const finalGcsUrl = gcsUrl.split('?')[0] + '?t=' + cacheBust;
    
    this.generationService.getTextArtifact(finalGcsUrl).subscribe({
      next: (content) => {
        if (content && content.trim().length > 0) {
          this.loadedTextArtifacts[tabId] = content;
          if (this.activeTab === tabId) {
            this.activeTextContent = content;
          }
        }
      },
      error: (err) => {
        console.error("Failed to load text artifact directly from GCS", err);
      }
    });
  }

  retryLoadVisual(tabId: string): void {
    if (!this.currentCampaignId) return;
    
    this.wsBuster = new Date().getTime();
    this.generationService.getCampaignStatus(this.currentCampaignId).subscribe({
      next: (campaign: CampaignStatus) => {
        this.campaignData = { ...this.campaignData, ...campaign };
      },
      error: (err) => console.error("Failed to reload campaign status", err)
    });
  }

  saveTextContent(): void {
    if (!this.currentCampaignId || !this.activeTextContent || this.isVisualTabActive()) return;
    
    this.isSavingText = true;
    this.generationService.updateTextArtifact(this.currentCampaignId, this.activeTab, this.activeTextContent).subscribe({
      next: (res) => {
        this.isSavingText = false;
        const tab = this.textTabs.find(t => t.id === this.activeTab);
        if (tab) {
          this.campaignData[tab.urlKey] = res.url;
        }
        this.loadedTextArtifacts[this.activeTab] = this.activeTextContent;
      },
      error: (err) => {
        console.error("Failed to save text artifact via API gateway", err);
        this.isSavingText = false;
      }
    });
  }


  connectWS(campaignId: string): void {
    const ws = this.generationService.connectWebSocket(campaignId);

    ws.onmessage = (event) => {
      try {
        const campaignUpdate: CampaignStatus = JSON.parse(event.data);
        this.campaignData = { ...this.campaignData, ...campaignUpdate };
        this.wsBuster = new Date().getTime();
        
        // Auto-load text content for whichever text tab is active and just completed
        if (!this.isVisualTabActive() && this.getStatus(this.activeTabObj.statusKey) === 'completed' && !this.loadedTextArtifacts[this.activeTab]) {
          this.loadTextContent(this.activeTab);
        }
        
        if (campaignUpdate.status === 'completed' || campaignUpdate.status === 'failed') {
          this.state.set('completed');
          // Pre-load all completed text tabs so they are ready when user switches
          this.textTabs.forEach(tab => {
            if (this.getStatus(tab.statusKey) === 'completed' && !this.loadedTextArtifacts[tab.id]) {
              this.loadTextContent(tab.id);
            }
          });
        }
      } catch (err) {
        console.error('Failed to parse websocket message', err);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket connection error', err);
    };

    ws.onclose = () => {
      console.log('WebSocket closed.');
    };
  }


  renderMarkdown(md: string): string {
    if (!md) return '';
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3 class="text-xs font-bold text-slate-200 mt-3 mb-1 font-sans">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="text-sm font-bold text-slate-100 mt-4 mb-2 border-b border-slate-800 pb-1 font-sans">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="text-base font-bold text-white mt-5 mb-3 font-sans">$1</h1>');
    
    // Bold & Italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em class="italic text-slate-300">$1</em>');
    
    // Bullet lists
    html = html.replace(/^\s*-\s+(.*$)/gim, '<li class="list-disc ml-5 text-slate-350 text-xs my-0.5">$1</li>');
    html = html.replace(/^\s*\*\s+(.*$)/gim, '<li class="list-disc ml-5 text-slate-350 text-xs my-0.5">$1</li>');
    
    // Paragraphs (lines not matching list items or headers)
    html = html.replace(/^\s*(?!<h|<li|<strong|<em)(.+)/gim, '<p class="text-xs text-slate-400 my-2 leading-relaxed">$1</p>');
    
    return html;
  }
}
