import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfigService } from '../../services/config.service';

@Component({
  selector: 'app-brand-voice',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Header -->
      <div>
        <h1 class="text-3xl font-bold bg-gradient-to-r from-brand-400 to-indigo-400 bg-clip-text text-transparent">
          Brand Voice Settings
        </h1>
        <p class="text-slate-400 mt-1">
          Configure corporate compliance standards, system directives, and prompt filtering rules.
        </p>
      </div>

      <!-- Settings Card -->
      <div class="glass-card rounded-2xl p-6 space-y-6">
        <!-- Profile Switcher Toggle -->
        <div>
          <h2 class="text-lg font-semibold text-slate-200 mb-3">Brand Voice Profile</h2>
          <div class="flex items-center space-x-4">
            <button
              type="button"
              (click)="setProfile('Enterprise Compliance')"
              [class.bg-brand-600]="activeVoice().profile === 'Enterprise Compliance'"
              [class.text-white]="activeVoice().profile === 'Enterprise Compliance'"
              [class.bg-slate-900]="activeVoice().profile !== 'Enterprise Compliance'"
              [class.text-slate-400]="activeVoice().profile !== 'Enterprise Compliance'"
              [class.border-slate-800]="activeVoice().profile !== 'Enterprise Compliance'"
              class="flex-1 py-3 px-4 rounded-xl border text-sm font-medium transition duration-200 hover:border-brand-500/50"
            >
              🛡️ Enterprise Compliance
            </button>
            <button
              type="button"
              (click)="setProfile('Bold & Innovative')"
              [class.bg-brand-600]="activeVoice().profile === 'Bold & Innovative'"
              [class.text-white]="activeVoice().profile === 'Bold & Innovative'"
              [class.bg-slate-900]="activeVoice().profile !== 'Bold & Innovative'"
              [class.text-slate-400]="activeVoice().profile !== 'Bold & Innovative'"
              [class.border-slate-800]="activeVoice().profile !== 'Bold & Innovative'"
              class="flex-1 py-3 px-4 rounded-xl border text-sm font-medium transition duration-200 hover:border-brand-500/50"
            >
              🚀 Bold & Innovative
            </button>
          </div>
        </div>

        <!-- Systemic Directive -->
        <div>
          <div class="flex justify-between items-center mb-2">
            <label for="directive" class="text-lg font-semibold text-slate-200">Systemic Directive</label>
            <span class="text-xs text-slate-500 uppercase tracking-widest font-mono">Immutable base system prompt</span>
          </div>
          <textarea
            id="directive"
            [(ngModel)]="directiveText"
            (blur)="saveDirective()"
            rows="3"
            class="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl px-4 py-3 text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition duration-200 font-mono text-sm leading-relaxed"
          ></textarea>
        </div>

        <!-- Blacklisted Words Chips Input -->
        <div>
          <h2 class="text-lg font-semibold text-slate-200 mb-2">Forbidden Words Blacklist</h2>
          <p class="text-sm text-slate-400 mb-3">
            Prompt contexts containing these keywords will be programmatically sanitized before submission.
          </p>
          
          <div class="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 min-h-[100px] flex flex-wrap gap-2 items-start focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent transition duration-200">
            <!-- Chip Item -->
            <span
              *ngFor="let word of activeVoice().blacklist"
              class="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-brand-950/80 border border-brand-800/85 text-brand-300"
            >
              {{ word }}
              <button
                type="button"
                (click)="removeChip(word)"
                class="ml-2 hover:text-brand-100 transition focus:outline-none"
              >
                &times;
              </button>
            </span>
            
            <!-- Input to add word -->
            <input
              type="text"
              [(ngModel)]="newWord"
              (keydown.enter)="addChip()"
              placeholder="Type word & press Enter"
              class="flex-1 bg-transparent border-none outline-none text-sm text-slate-200 py-1 min-w-[150px] focus:ring-0"
            />
            
            <button
              type="button"
              (click)="addChip()"
              class="px-3 py-1 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-brand-600 hover:text-white transition duration-200"
            >
              + Add
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class BrandVoiceComponent {
  configService = inject(ConfigService);
  
  activeVoice = this.configService.brandVoice;
  directiveText = this.activeVoice().system_directive;
  newWord = '';

  setProfile(profile: string): void {
    this.configService.updateBrandVoice({ profile });
  }

  saveDirective(): void {
    this.configService.updateBrandVoice({ system_directive: this.directiveText });
  }

  addChip(): void {
    const word = this.newWord.trim().toLowerCase();
    if (word && !this.activeVoice().blacklist.includes(word)) {
      const blacklist = [...this.activeVoice().blacklist, word];
      this.configService.updateBrandVoice({ blacklist });
    }
    this.newWord = '';
  }

  removeChip(word: string): void {
    const blacklist = this.activeVoice().blacklist.filter(w => w !== word);
    this.configService.updateBrandVoice({ blacklist });
  }
}
