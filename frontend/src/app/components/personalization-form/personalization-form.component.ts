import { Component, EventEmitter, Output, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PersonalizationMatrix } from '../../services/generation.service';

@Component({
  selector: 'app-personalization-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-4">
      <!-- Industry Subsector -->
      <div>
        <label for="subsector" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
          Industry Subsector
        </label>
        <select
          id="subsector"
          [(ngModel)]="matrix.subsector"
          (change)="onSelectionChange()"
          [disabled]="disabled"
          class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 transition duration-205 disabled:opacity-50"
        >
          <option *ngFor="let s of subsectors" [value]="s">{{ s }}</option>
        </select>
      </div>

      <!-- Target Persona -->
      <div>
        <label for="persona" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
          Target Persona
        </label>
        <select
          id="persona"
          [(ngModel)]="matrix.persona"
          (change)="onSelectionChange()"
          [disabled]="disabled"
          class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 transition duration-205 disabled:opacity-50"
        >
          <option *ngFor="let p of personas" [value]="p">{{ p }}</option>
        </select>
      </div>

      <!-- Journey Stage -->
      <div>
        <label for="stage" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
          Journey Stage
        </label>
        <select
          id="stage"
          [(ngModel)]="matrix.stage"
          (change)="onSelectionChange()"
          [disabled]="disabled"
          class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 transition duration-205 disabled:opacity-50"
        >
          <option *ngFor="let st of stages" [value]="st">{{ st }}</option>
        </select>
      </div>
    </div>
  `
})
export class PersonalizationFormComponent implements OnInit {
  @Output() matrixChange = new EventEmitter<PersonalizationMatrix>();
  @Input() disabled = false;
  
  @Input() set initialMatrix(val: PersonalizationMatrix | null) {
    if (val) {
      this.matrix = { ...val };
      this.onSelectionChange();
    }
  }

  subsectors: string[] = [
    'Construction',
    'Transit',
    'Distribution',
    'Utilities',
    'Field Services',
    'Trucking & Local',
    'Retail'
  ];

  personas: string[] = [
    'Fleet Safety Manager',
    'VP Operations',
    'C-Suite'
  ];

  stages: string[] = [
    'Awareness',
    'Consideration',
    'Decision'
  ];

  matrix: PersonalizationMatrix = {
    subsector: 'Trucking & Local',
    persona: 'Fleet Safety Manager',
    stage: 'Awareness'
  };

  ngOnInit(): void {
    this.onSelectionChange();
  }

  onSelectionChange(): void {
    this.matrixChange.emit({ ...this.matrix });
  }
}
