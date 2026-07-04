import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, FormControl, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { GenerationService, BrandGovernance } from '../../services/generation.service';
import { ConfigService } from '../../services/config.service';

function exactFiveUniqueHexValidator(control: AbstractControl): ValidationErrors | null {
  const colors = control.value || [];
  if (colors.length !== 5) {
    return { notFiveColors: true };
  }
  const hexRegex = /^#[0-9A-Fa-f]{6}$/;
  const validColors = colors.filter((c: string) => hexRegex.test(c));
  if (validColors.length !== 5) {
    return { invalidHex: true };
  }
  const uniqueColors = new Set(colors.map((c: string) => c.toLowerCase()));
  if (uniqueColors.size !== 5) {
    return { duplicateHex: true };
  }
  return null;
}

@Component({
  selector: 'app-brand-constraints',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-120px)]">
      
      <!-- Left Panel: Brand Policy Config (Grid span 7) -->
      <div class="lg:col-span-7 glass-card rounded-2xl p-6 flex flex-col justify-between overflow-y-auto max-h-full">
        <div class="space-y-6">
          <div>
            <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>🛡️</span> Organization Brand Governance
            </h2>
            <p class="text-slate-400 text-sm mt-1">
              Lock in corporate asset compliance constraints and brand voice parameters company-wide.
            </p>
          </div>

          <form [formGroup]="brandForm" class="space-y-6">
            <!-- Section 1: Logo & Typography -->
            <div class="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 space-y-4">
              <h3 class="text-xs font-semibold text-slate-350 uppercase tracking-widest font-mono">
                1. Identity & Corporate assets
              </h3>
              
              <!-- Logo Uploader -->
              <div class="flex items-center gap-4">
                <div *ngIf="logoUrl" class="w-16 h-16 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                  <img [src]="logoUrl" class="max-w-full max-h-full object-contain" alt="Brand Logo" />
                </div>
                <div *ngIf="!logoUrl" class="w-16 h-16 rounded-xl bg-slate-900 border border-dashed border-slate-800 flex items-center justify-center text-2xl text-slate-600 shrink-0">
                  🖼️
                </div>
                <div class="space-y-1">
                  <label class="text-xs font-semibold text-slate-200 block">Organization Corporate Logo</label>
                  <div class="flex items-center gap-3">
                    <input
                      type="file"
                      #logoInput
                      (change)="onLogoFileSelected($event)"
                      accept="image/*"
                      class="hidden"
                    />
                    <button
                      type="button"
                      (click)="logoInput.click()"
                      class="px-3.5 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition duration-200 focus:outline-none"
                    >
                      Upload Image
                    </button>
                    <span *ngIf="isUploadingLogo" class="text-xs text-brand-400 animate-pulse">Uploading to GCS...</span>
                  </div>
                  <p class="text-[10px] text-slate-500">Supports PNG, JPG, SVG. Stored in GCP Bucket.</p>
                </div>
              </div>

              <!-- Company Name Input -->
              <div class="space-y-1.5 mt-2">
                <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">Company Name</label>
                <input
                  type="text"
                  formControlName="companyName"
                  placeholder="e.g. FleetVid"
                  class="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition duration-200"
                />
              </div>

              <hr class="border-slate-900" />

              <!-- Headings & Body Fonts Selectors -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- Heading Fonts -->
                <div class="space-y-1.5">
                  <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">Approved Heading Fonts</label>
                  <div class="bg-slate-900 border border-slate-800/80 rounded-lg p-2 min-h-[46px] flex flex-wrap gap-1.5 items-start">
                    <span
                      *ngFor="let font of headingFonts"
                      class="inline-flex items-center px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/80 text-[10px] font-semibold text-indigo-300"
                    >
                      {{ font }}
                      <button type="button" (click)="removeHeadingFont(font)" class="ml-1 hover:text-indigo-100 font-bold focus:outline-none">&times;</button>
                    </span>
                    <input
                      type="text"
                      [(ngModel)]="newHeadingFont"
                      [ngModelOptions]="{standalone: true}"
                      (keydown.enter)="$event.preventDefault(); addHeadingFont()"
                      placeholder="Add & Enter"
                      class="flex-1 bg-transparent border-none outline-none text-xs text-slate-200 py-0.5 min-w-[70px] focus:ring-0"
                    />
                  </div>
                </div>

                <!-- Body Fonts -->
                <div class="space-y-1.5">
                  <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">Approved Body Fonts</label>
                  <div class="bg-slate-900 border border-slate-800/80 rounded-lg p-2 min-h-[46px] flex flex-wrap gap-1.5 items-start">
                    <span
                      *ngFor="let font of bodyFonts"
                      class="inline-flex items-center px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/80 text-[10px] font-semibold text-indigo-300"
                    >
                      {{ font }}
                      <button type="button" (click)="removeBodyFont(font)" class="ml-1 hover:text-indigo-100 font-bold focus:outline-none">&times;</button>
                    </span>
                    <input
                      type="text"
                      [(ngModel)]="newBodyFont"
                      [ngModelOptions]="{standalone: true}"
                      (keydown.enter)="$event.preventDefault(); addBodyFont()"
                      placeholder="Add & Enter"
                      class="flex-1 bg-transparent border-none outline-none text-xs text-slate-200 py-0.5 min-w-[70px] focus:ring-0"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Section 2: Colors & Accessibility -->
            <div class="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 space-y-4">
              <h3 class="text-xs font-semibold text-slate-350 uppercase tracking-widest font-mono">
                2. Color Palettes & Contrast
              </h3>

              <!-- Primary Color Palette -->
              <div>
                <div class="flex justify-between items-center mb-1">
                  <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">Primary Palette (Exactly 5 Colors Required)</label>
                  <span
                    *ngIf="brandForm.get('primaryColors')?.errors?.['duplicateHex']"
                    class="text-[9px] text-red-400 font-mono"
                  >
                    ⚠️ Duplicate colors not allowed
                  </span>
                </div>
                <div class="grid grid-cols-5 gap-3" formArrayName="primaryColors">
                  <div
                    *ngFor="let control of primaryColorsArray.controls; let i = index"
                    class="flex flex-col items-center bg-slate-900 border border-slate-800/60 rounded-xl p-2.5 space-y-1.5"
                  >
                    <input
                      type="color"
                      [formControlName]="i"
                      class="w-8 h-8 rounded border border-slate-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      [formControlName]="i"
                      placeholder="#000000"
                      class="w-full text-center bg-slate-950 border border-slate-800 rounded py-0.5 text-[9px] font-mono text-slate-300 focus:outline-none focus:border-brand-500"
                    />
                  </div>
                </div>
              </div>

              <!-- Secondary Color Palette -->
              <div>
                <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block mb-2.5">Secondary Palette (Up to 10 Colors)</label>
                <div class="flex flex-wrap gap-2.5" formArrayName="secondaryColors">
                  <div
                    *ngFor="let control of secondaryColorsArray.controls; let i = index"
                    class="flex items-center bg-slate-900 border border-slate-800/60 rounded-lg px-2.5 py-1.5 gap-2"
                  >
                    <input
                      type="color"
                      [formControl]="getSecondaryColorControl(i)"
                      class="w-5 h-5 rounded border border-slate-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      [formControl]="getSecondaryColorControl(i)"
                      placeholder="#000000"
                      class="w-14 text-center bg-slate-950 border border-slate-800 rounded py-0.5 text-[9px] font-mono text-slate-300 focus:outline-none focus:border-brand-500"
                    />
                    <button
                      type="button"
                      (click)="removeSecondaryColor(i)"
                      class="text-xs text-slate-500 hover:text-red-400 font-bold focus:outline-none"
                    >
                      &times;
                    </button>
                  </div>

                  <!-- Add Secondary Color Button -->
                  <button
                    type="button"
                    *ngIf="secondaryColorsArray.length < 10"
                    (click)="addSecondaryColor()"
                    class="h-[38px] w-[38px] rounded-lg bg-slate-900 border border-dashed border-slate-800 hover:border-brand-500/50 flex items-center justify-center text-slate-400 hover:text-brand-300 font-bold text-lg transition duration-200 focus:outline-none"
                  >
                    +
                  </button>
                </div>
              </div>

              <!-- WCAG Contrast Enforcement Toggle -->
              <div class="flex justify-between items-center bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 mt-2">
                <div class="space-y-0.5">
                  <label class="text-xs font-semibold text-slate-200 block">Contrast Enforcement (WCAG 2.1 AA)</label>
                  <span class="text-[10px] text-slate-500">Inject constraints warning LLM against low-contrast overlays.</span>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    formControlName="contrastEnforcementEnabled"
                    class="sr-only peer"
                  />
                  <div class="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-600 peer-checked:after:bg-white"></div>
                </label>
              </div>
            </div>

            <!-- Section 3: Brand Voice Profile -->
            <div class="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 space-y-4">
              <h3 class="text-xs font-semibold text-slate-350 uppercase tracking-widest font-mono">
                3. Brand Voice Profile
              </h3>

              <!-- Company Vertical & Global Tone -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-1">
                  <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">Company Vertical</label>
                  <input
                    type="text"
                    formControlName="companyVertical"
                    class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 text-xs"
                    placeholder="E.g., Logistics / SaaS Platform"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">Global Voice & Tone</label>
                  <textarea
                    formControlName="globalTone"
                    rows="2"
                    class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 text-xs resize-none"
                    placeholder="E.g., Professional, authoritative, pragmatic..."
                  ></textarea>
                </div>
              </div>

              <hr class="border-slate-900" />

              <!-- Messaging Pillars -->
              <div class="space-y-2">
                <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">Core Messaging Pillars</label>
                <div class="space-y-2">
                  <div
                    *ngFor="let pillar of masterPillars"
                    class="flex justify-between items-center bg-slate-900 border border-slate-800/60 rounded-lg px-3 py-2 text-xs"
                  >
                    <span class="text-slate-200">
                      <strong>{{ pillar.name }}</strong> <span class="text-slate-500 font-mono">({{ pillar.id }})</span>
                    </span>
                    <button
                      type="button"
                      (click)="removePillar(pillar.id)"
                      class="text-xs text-slate-500 hover:text-red-400 font-bold focus:outline-none"
                    >
                      &times;
                    </button>
                  </div>
                  
                  <div class="flex gap-2">
                    <input
                      type="text"
                      [(ngModel)]="newPillarName"
                      [ngModelOptions]="{standalone: true}"
                      placeholder="New Messaging Pillar Name"
                      class="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none text-xs"
                    />
                    <button
                      type="button"
                      (click)="addPillar()"
                      class="px-4 py-2 bg-brand-900/40 border border-brand-800 rounded-lg text-brand-200 text-xs font-semibold hover:bg-brand-900 transition focus:outline-none"
                    >
                      Add Pillar
                    </button>
                  </div>
                </div>
              </div>

              <hr class="border-slate-900" />

              <!-- Guardrails (DOs & DONTs) -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- DOs -->
                <div class="space-y-2">
                  <label class="text-[10px] text-emerald-450 font-semibold uppercase tracking-wider block">Style Guardrails: DOs</label>
                  <div class="space-y-1.5">
                    <div
                      *ngFor="let doVal of guardrailsDos; let idx = index"
                      class="flex justify-between items-center bg-slate-900 border border-slate-800/60 rounded-lg px-2.5 py-1.5 text-[11px]"
                    >
                      <span class="text-slate-350 line-clamp-1">{{ doVal }}</span>
                      <button type="button" (click)="removeDo(idx)" class="text-slate-500 hover:text-red-450 font-bold focus:outline-none">&times;</button>
                    </div>
                    
                    <div class="flex gap-1.5">
                      <input
                        type="text"
                        [(ngModel)]="newDo"
                        [ngModelOptions]="{standalone: true}"
                        (keydown.enter)="$event.preventDefault(); addDo()"
                        placeholder="Add DO rule"
                        class="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                      />
                      <button
                        type="button"
                        (click)="addDo()"
                        class="px-2.5 py-1.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-300 text-xs focus:outline-none"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <!-- DONTs -->
                <div class="space-y-2">
                  <label class="text-[10px] text-red-450 font-semibold uppercase tracking-wider block">Style Guardrails: DONTs</label>
                  <div class="space-y-1.5">
                    <div
                      *ngFor="let dontVal of guardrailsDonts; let idx = index"
                      class="flex justify-between items-center bg-slate-900 border border-slate-800/60 rounded-lg px-2.5 py-1.5 text-[11px]"
                    >
                      <span class="text-slate-350 line-clamp-1">{{ dontVal }}</span>
                      <button type="button" (click)="removeDont(idx)" class="text-slate-500 hover:text-red-450 font-bold focus:outline-none">&times;</button>
                    </div>
                    
                    <div class="flex gap-1.5">
                      <input
                        type="text"
                        [(ngModel)]="newDont"
                        [ngModelOptions]="{standalone: true}"
                        (keydown.enter)="$event.preventDefault(); addDont()"
                        placeholder="Add DONT rule"
                        class="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                      />
                      <button
                        type="button"
                        (click)="addDont()"
                        class="px-2.5 py-1.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-300 text-xs focus:outline-none"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <hr class="border-slate-900" />

              <!-- CTA Library (Frictions) -->
              <div class="space-y-3">
                <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block">CTA Library Preferences</label>
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <!-- Low Friction -->
                  <div class="space-y-1.5 bg-slate-900/30 p-2.5 border border-slate-900 rounded-lg">
                    <span class="text-[9px] text-slate-400 font-mono uppercase font-bold tracking-wider">Low Friction</span>
                    <div class="space-y-1 min-h-[30px]">
                      <div *ngFor="let item of ctasLow; let idx = index" class="flex justify-between items-center text-[10px] bg-slate-900 p-1 rounded">
                        <span class="truncate pr-1 text-slate-300">{{ item }}</span>
                        <button type="button" (click)="removeCta('low', idx)" class="text-slate-500 hover:text-red-400 font-bold focus:outline-none">&times;</button>
                      </div>
                    </div>
                    <div class="flex gap-1">
                      <input type="text" [(ngModel)]="newLowCta" [ngModelOptions]="{standalone: true}" (keydown.enter)="$event.preventDefault(); addCta('low')" placeholder="Add low" class="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-[10px] focus:outline-none" />
                      <button type="button" (click)="addCta('low')" class="p-1 bg-slate-850 border border-slate-850 text-slate-300 text-[10px] rounded focus:outline-none">+</button>
                    </div>
                  </div>

                  <!-- Medium Friction -->
                  <div class="space-y-1.5 bg-slate-900/30 p-2.5 border border-slate-900 rounded-lg">
                    <span class="text-[9px] text-slate-400 font-mono uppercase font-bold tracking-wider">Medium Friction</span>
                    <div class="space-y-1 min-h-[30px]">
                      <div *ngFor="let item of ctasMedium; let idx = index" class="flex justify-between items-center text-[10px] bg-slate-900 p-1 rounded">
                        <span class="truncate pr-1 text-slate-300">{{ item }}</span>
                        <button type="button" (click)="removeCta('medium', idx)" class="text-slate-500 hover:text-red-400 font-bold focus:outline-none">&times;</button>
                      </div>
                    </div>
                    <div class="flex gap-1">
                      <input type="text" [(ngModel)]="newMediumCta" [ngModelOptions]="{standalone: true}" (keydown.enter)="$event.preventDefault(); addCta('medium')" placeholder="Add med" class="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-[10px] focus:outline-none" />
                      <button type="button" (click)="addCta('medium')" class="p-1 bg-slate-850 border border-slate-850 text-slate-300 text-[10px] rounded focus:outline-none">+</button>
                    </div>
                  </div>

                  <!-- High Friction -->
                  <div class="space-y-1.5 bg-slate-900/30 p-2.5 border border-slate-900 rounded-lg">
                    <span class="text-[9px] text-slate-400 font-mono uppercase font-bold tracking-wider">High Friction</span>
                    <div class="space-y-1 min-h-[30px]">
                      <div *ngFor="let item of ctasHigh; let idx = index" class="flex justify-between items-center text-[10px] bg-slate-900 p-1 rounded">
                        <span class="truncate pr-1 text-slate-300">{{ item }}</span>
                        <button type="button" (click)="removeCta('high', idx)" class="text-slate-500 hover:text-red-400 font-bold focus:outline-none">&times;</button>
                      </div>
                    </div>
                    <div class="flex gap-1">
                      <input type="text" [(ngModel)]="newHighCta" [ngModelOptions]="{standalone: true}" (keydown.enter)="$event.preventDefault(); addCta('high')" placeholder="Add high" class="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-[10px] focus:outline-none" />
                      <button type="button" (click)="addCta('high')" class="p-1 bg-slate-850 border border-slate-850 text-slate-300 text-[10px] rounded focus:outline-none">+</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Section 4: Blacklist Guardrails -->
            <div class="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 space-y-4">
              <h3 class="text-xs font-semibold text-slate-355 uppercase tracking-widest font-mono">
                4. Forbidden Words Blacklist
              </h3>
              
              <div>
                <label class="text-[10px] text-slate-450 font-semibold uppercase tracking-wider block mb-1.5">Forbidden Word Chips</label>
                <div class="bg-slate-900 border border-slate-800/80 rounded-lg p-2 min-h-[50px] flex flex-wrap gap-1.5 items-start focus-within:ring-1 focus-within:ring-brand-500 transition duration-200">
                  <span
                    *ngFor="let word of blacklist"
                    class="inline-flex items-center px-2 py-0.5 rounded bg-brand-950/80 border border-brand-800/85 text-[10px] font-semibold text-brand-300"
                  >
                    {{ word }}
                    <button type="button" (click)="removeBlacklistWord(word)" class="ml-1 hover:text-red-300 font-bold focus:outline-none">&times;</button>
                  </span>
                  <input
                    type="text"
                    [(ngModel)]="newBlacklistWord"
                    [ngModelOptions]="{standalone: true}"
                    (keydown.enter)="$event.preventDefault(); addBlacklistWord()"
                    placeholder="Add forbidden word & Enter"
                    class="flex-1 bg-transparent border-none outline-none text-xs text-slate-200 py-0.5 min-w-[150px] focus:ring-0"
                  />
                </div>
              </div>
            </div>
          </form>
        </div>

        <!-- Action Button -->
        <div class="pt-4 border-t border-slate-800/60 mt-5 flex justify-between items-center">
          <span *ngIf="saveStatus" class="text-xs" [class.text-emerald-400]="saveStatus === 'success'" [class.text-red-400]="saveStatus === 'error'">
            {{ saveStatus === 'success' ? '✓ Settings Saved successfully.' : '❌ Failed to save configurations.' }}
          </span>
          <span *ngIf="!saveStatus" class="text-[10px] text-slate-500 font-mono">
            * Singleton parameters apply company-wide
          </span>
          
          <button
            type="button"
            (click)="saveSettings()"
            [disabled]="brandForm.invalid || isSaving"
            class="bg-gradient-to-r from-brand-600 to-indigo-600 text-white font-medium py-2.5 px-6 rounded-xl hover:from-brand-500 hover:to-indigo-500 disabled:from-slate-850 disabled:to-slate-850 disabled:text-slate-500 transition duration-200 shadow-md focus:outline-none flex items-center gap-2 text-xs"
          >
            <span *ngIf="isSaving" class="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin"></span>
            <span>{{ isSaving ? 'Saving Configurations...' : '💾 Save Governance Rules' }}</span>
          </button>
        </div>
      </div>

      <!-- Right Panel: LLM Rule Preview Pane (Grid span 5) -->
      <div class="lg:col-span-5 glass-card rounded-2xl p-6 flex flex-col justify-between overflow-hidden relative max-h-full">
        <div class="border-b border-slate-800/60 pb-3 mb-3 shrink-0">
          <h2 class="text-lg font-bold text-slate-100 flex items-center gap-2">
            <span>👁️</span> Model Directives Preview
          </h2>
          <p class="text-slate-400 text-[11px] mt-1">Real-time Markdown constraints compiled dynamically for AI.</p>
        </div>

        <!-- Preview Text Body -->
        <div class="flex-1 overflow-y-auto bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 font-mono text-[11px] text-slate-300 leading-normal whitespace-pre-wrap select-all">
          {{ previewText }}
        </div>
      </div>

    </div>
  `
})
export class BrandConstraintsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private genService = inject(GenerationService);
  private configService = inject(ConfigService);

  brandForm!: FormGroup;
  logoUrl: string | null = null;
  isUploadingLogo = false;
  isSaving = false;
  saveStatus: 'success' | 'error' | null = null;

  // Font chips
  headingFonts: string[] = [];
  bodyFonts: string[] = [];
  newHeadingFont = '';
  newBodyFont = '';

  // Brand Voice Arrays
  masterPillars: { id: string; name: string }[] = [];
  newPillarName = '';

  guardrailsDos: string[] = [];
  guardrailsDonts: string[] = [];
  newDo = '';
  newDont = '';

  ctasLow: string[] = [];
  ctasMedium: string[] = [];
  ctasHigh: string[] = [];
  newLowCta = '';
  newMediumCta = '';
  newHighCta = '';

  // Blacklist
  blacklist: string[] = [];
  newBlacklistWord = '';

  // Preview Prompt block
  previewText = '';

  ngOnInit(): void {
    this.brandForm = this.fb.group({
      companyName: ['FleetVid', Validators.required],
      primaryColors: this.fb.array([], [exactFiveUniqueHexValidator]),
      secondaryColors: this.fb.array([]),
      contrastEnforcementEnabled: [true],
      companyVertical: ['Video Telematics & Fleet Management', Validators.required],
      globalTone: ['Authoritative, data-driven, pragmatic, and respectful of fleet operators. Avoid startup hype.', Validators.required]
    });

    // Load initial values
    this.loadSettings();

    // Listen to changes and update LLM prompt preview
    this.brandForm.valueChanges.subscribe(() => {
      this.updatePreviewText();
    });
  }

  get primaryColorsArray(): FormArray {
    return this.brandForm.get('primaryColors') as FormArray;
  }

  get secondaryColorsArray(): FormArray {
    return this.brandForm.get('secondaryColors') as FormArray;
  }

  getSecondaryColorControl(index: number): FormControl {
    return this.secondaryColorsArray.at(index) as FormControl;
  }

  addSecondaryColor(color = '#ffffff'): void {
    if (this.secondaryColorsArray.length < 10) {
      this.secondaryColorsArray.push(new FormControl(color));
      this.updatePreviewText();
    }
  }

  removeSecondaryColor(index: number): void {
    this.secondaryColorsArray.removeAt(index);
    this.updatePreviewText();
  }

  // --- Fonts Handlers ---
  addHeadingFont(): void {
    const font = this.newHeadingFont.trim();
    if (font && !this.headingFonts.includes(font)) {
      this.headingFonts.push(font);
      this.updatePreviewText();
    }
    this.newHeadingFont = '';
  }

  removeHeadingFont(font: string): void {
    this.headingFonts = this.headingFonts.filter(f => f !== font);
    this.updatePreviewText();
  }

  addBodyFont(): void {
    const font = this.newBodyFont.trim();
    if (font && !this.bodyFonts.includes(font)) {
      this.bodyFonts.push(font);
      this.updatePreviewText();
    }
    this.newBodyFont = '';
  }

  removeBodyFont(font: string): void {
    this.bodyFonts = this.bodyFonts.filter(f => f !== font);
    this.updatePreviewText();
  }

  // --- Messaging Pillars Handlers ---
  addPillar(): void {
    const name = this.newPillarName.trim();
    if (name) {
      const id = 'pillar_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!this.masterPillars.some(p => p.id === id)) {
        this.masterPillars.push({ id, name });
        this.updatePreviewText();
      }
    }
    this.newPillarName = '';
  }

  removePillar(id: string): void {
    this.masterPillars = this.masterPillars.filter(p => p.id !== id);
    this.updatePreviewText();
  }

  // --- Guardrails DOs & DONTs Handlers ---
  addDo(): void {
    const rule = this.newDo.trim();
    if (rule && !this.guardrailsDos.includes(rule)) {
      this.guardrailsDos.push(rule);
      this.updatePreviewText();
    }
    this.newDo = '';
  }

  removeDo(index: number): void {
    this.guardrailsDos.splice(index, 1);
    this.updatePreviewText();
  }

  addDont(): void {
    const rule = this.newDont.trim();
    if (rule && !this.guardrailsDonts.includes(rule)) {
      this.guardrailsDonts.push(rule);
      this.updatePreviewText();
    }
    this.newDont = '';
  }

  removeDont(index: number): void {
    this.guardrailsDonts.splice(index, 1);
    this.updatePreviewText();
  }

  // --- CTA Library Handlers ---
  addCta(type: 'low' | 'medium' | 'high'): void {
    let item = '';
    if (type === 'low') {
      item = this.newLowCta.trim();
      if (item && !this.ctasLow.includes(item)) this.ctasLow.push(item);
      this.newLowCta = '';
    } else if (type === 'medium') {
      item = this.newMediumCta.trim();
      if (item && !this.ctasMedium.includes(item)) this.ctasMedium.push(item);
      this.newMediumCta = '';
    } else if (type === 'high') {
      item = this.newHighCta.trim();
      if (item && !this.ctasHigh.includes(item)) this.ctasHigh.push(item);
      this.newHighCta = '';
    }
    this.updatePreviewText();
  }

  removeCta(type: 'low' | 'medium' | 'high', index: number): void {
    if (type === 'low') this.ctasLow.splice(index, 1);
    else if (type === 'medium') this.ctasMedium.splice(index, 1);
    else if (type === 'high') this.ctasHigh.splice(index, 1);
    this.updatePreviewText();
  }

  // --- Blacklist Handlers ---
  addBlacklistWord(): void {
    const word = this.newBlacklistWord.trim().toLowerCase();
    if (word && !this.blacklist.includes(word)) {
      this.blacklist.push(word);
    }
    this.newBlacklistWord = '';
  }

  removeBlacklistWord(word: string): void {
    this.blacklist = this.blacklist.filter(w => w !== word);
  }

  // --- REST Operations ---
  loadSettings(): void {
    // 1. Fetch Governance Policies
    this.genService.getBrandGovernance().subscribe({
      next: (gov: any) => {
        this.logoUrl = gov.logo_gcs_url || null;
        this.configService.logoUrl.set(gov.logo_gcs_url || null);
        this.headingFonts = gov.allowed_heading_fonts || [];
        this.bodyFonts = gov.allowed_body_fonts || [];
        
        // Brand Voice lists
        this.masterPillars = gov.master_pillars || [];
        this.guardrailsDos = gov.guardrails?.dos || [];
        this.guardrailsDonts = gov.guardrails?.donts || [];
        this.ctasLow = gov.cta_library?.low_friction || [];
        this.ctasMedium = gov.cta_library?.medium_friction || [];
        this.ctasHigh = gov.cta_library?.high_friction || [];

        // Populate primary color controllers (exactly 5)
        this.primaryColorsArray.clear();
        const primary = gov.primary_colors || [];
        for (let i = 0; i < 5; i++) {
          this.primaryColorsArray.push(new FormControl(primary[i] || '#ffffff'));
        }

        // Populate secondary color controllers (up to 10)
        this.secondaryColorsArray.clear();
        const secondary = gov.secondary_colors || [];
        secondary.forEach((color: string) => {
          this.addSecondaryColor(color);
        });

        this.brandForm.patchValue({
          companyName: gov.company_name || 'FleetVid',
          contrastEnforcementEnabled: gov.contrast_enforcement_enabled,
          companyVertical: gov.company_vertical || 'Video Telematics & Fleet Management',
          globalTone: gov.global_tone || 'Authoritative, data-driven, pragmatic, and respectful of fleet operators. Avoid startup hype.'
        }, { emitEvent: false });

        this.updatePreviewText();
      },
      error: (err) => console.error('Failed to load brand policies', err)
    });

    // 2. Fetch Blacklist guardrails
    this.genService.getBlacklist().subscribe({
      next: (res) => {
        this.blacklist = res.blacklist || [];
      },
      error: (err) => console.error('Failed to load blacklist words', err)
    });
  }

  onLogoFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.isUploadingLogo = true;
      this.genService.uploadBrandLogo(file).subscribe({
        next: (res) => {
          this.logoUrl = res.logo_url;
          this.configService.logoUrl.set(res.logo_url);
          this.isUploadingLogo = false;
          this.updatePreviewText();
        },
        error: (err) => {
          console.error('Failed to upload logo', err);
          this.isUploadingLogo = false;
        }
      });
    }
  }

  updatePreviewText(): void {
    const formVals = this.brandForm.getRawValue();
    const primary = (formVals.primaryColors || []).join(', ');
    const secondary = (formVals.secondaryColors || []).join(', ');
    const headings = this.headingFonts.join(', ');
    const body = this.bodyFonts.join(', ');
    const contrast = formVals.contrastEnforcementEnabled
      ? 'Contrast compliance (WCAG 2.1 AA) must be strictly enforced between backgrounds and text overlays.'
      : 'Contrast compliance enforcement is disabled.';
    
    let logoClause = '';
    if (this.logoUrl) {
      logoClause = `\n* **Corporate Logo Asset**: Use the following logo image URL: ${this.logoUrl}`;
    }

    const company = formVals.companyName || 'FleetVid';
    const vertical = formVals.companyVertical || 'Video Telematics & Fleet Management';
    const tone = formVals.globalTone || 'Authoritative, data-driven, pragmatic...';
    
    // Pillars
    const pillarsStr = this.masterPillars.map(p => `   * **${p.name}** (ID: ${p.id})`).join('\n');
    
    // Guardrails
    const dosStr = this.guardrailsDos.map(d => `   * DO: ${d}`).join('\n');
    const dontsStr = this.guardrailsDonts.map(d => `   * DONT: ${d}`).join('\n');

    // CTAs
    const lowF = this.ctasLow.join(', ');
    const medF = this.ctasMedium.join(', ');
    const highF = this.ctasHigh.join(', ');

    this.previewText = `### Brand Governance Constraints
You must strictly adhere to the following corporate brand identity guidelines in all generated marketing copy, HTML/CSS layouts, and asset templates:

1. **Company Name**: ${company}
2. **Company Vertical**: ${vertical}
3. **Global Voice & Tone**: ${tone}

4. **Core Messaging Pillars**:
${pillarsStr}

5. **Style Guardrails**:
${dosStr}
${dontsStr}

5. **Call-To-Action (CTA) Preferences**:
   * Low Friction: [ ${lowF} ]
   * Medium Friction: [ ${medF} ]
   * High Friction: [ ${highF} ]

6. **Design & Color Palette Constraints**:
   * **Primary Palette**: Only use these primary colors: [ ${primary} ]
   * **Secondary Palette**: Only use these secondary colors: [ ${secondary} ]${logoClause}

7. **Typography Constraints**:
   * **Headings**: Only use the following approved font families: [ ${headings} ]
   * **Body Text**: Only use the following approved font families: [ ${body} ]

8. **Accessibility**:
   * ${contrast}`;
  }

  saveSettings(): void {
    if (this.brandForm.invalid) return;
    this.isSaving = true;
    this.saveStatus = null;

    const formVals = this.brandForm.getRawValue();
    const govData = {
      company_name: formVals.companyName,
      primary_colors: formVals.primaryColors,
      secondary_colors: formVals.secondaryColors,
      allowed_heading_fonts: this.headingFonts,
      allowed_body_fonts: this.bodyFonts,
      contrast_enforcement_enabled: formVals.contrastEnforcementEnabled,
      company_vertical: formVals.companyVertical,
      global_tone: formVals.globalTone,
      master_pillars: this.masterPillars,
      guardrails: {
        dos: this.guardrailsDos,
        donts: this.guardrailsDonts
      },
      cta_library: {
        low_friction: this.ctasLow,
        medium_friction: this.ctasMedium,
        high_friction: this.ctasHigh
      }
    };

    // Save Brand Governance Policies
    this.genService.updateBrandGovernance(govData).subscribe({
      next: () => {
        // Save Blacklist Words
        this.genService.updateBlacklist({ blacklist: this.blacklist }).subscribe({
          next: () => {
            this.isSaving = false;
            this.saveStatus = 'success';
            setTimeout(() => this.saveStatus = null, 4000);
          },
          error: (err) => {
            console.error('Failed to save blacklist', err);
            this.isSaving = false;
            this.saveStatus = 'error';
          }
        });
      },
      error: (err) => {
        console.error('Failed to save brand policies', err);
        this.isSaving = false;
        this.saveStatus = 'error';
        alert('Failed to save brand governance: ' + (err.error?.detail || err.message));
      }
    });
  }
}
