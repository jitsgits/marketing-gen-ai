import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GenerationService, AssetResponse } from '../../services/generation.service';

@Component({
  selector: 'app-asset-library',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-120px)]">
      
      <!-- Left Column: Add Asset Form (Grid span 4) -->
      <div class="lg:col-span-4 glass-card rounded-2xl p-6 flex flex-col justify-between overflow-y-auto max-h-full">
        <div class="space-y-6">
          <div>
            <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>🖼️</span> Asset Library Manager
            </h2>
            <p class="text-slate-400 text-xs mt-0.5">
              Upload and tag vehicle and product images to compose custom Imagen campaigns.
            </p>
          </div>

          <div class="space-y-4">
            <!-- Asset Name -->
            <div class="space-y-1.5">
              <label for="assetName" class="text-xs font-semibold text-slate-400 uppercase tracking-wider block font-mono">Asset Name</label>
              <input
                id="assetName"
                type="text"
                [(ngModel)]="newAssetName"
                placeholder="E.g., Gen2 EV Flatbed Truck"
                class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 text-xs"
              />
            </div>

            <!-- Category -->
            <div class="space-y-1.5">
              <label for="assetCategory" class="text-xs font-semibold text-slate-400 uppercase tracking-wider block font-mono">Category</label>
              <select
                id="assetCategory"
                [(ngModel)]="newAssetCategory"
                class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 transition duration-200"
              >
                <option value="vehicle">🚚 Vehicle</option>
                <option value="product">📦 Product</option>
              </select>
            </div>

            <!-- File Selector -->
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider block font-mono">Asset Image File</label>
              <div class="flex items-center justify-center w-full">
                <label class="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-800 hover:border-brand-550/40 rounded-xl cursor-pointer bg-slate-950/20 transition duration-200">
                  <div class="flex flex-col items-center justify-center pt-5 pb-6">
                    <span class="text-2xl mb-2">📁</span>
                    <p class="text-[10px] text-slate-400 font-medium">
                      {{ selectedFile ? selectedFile.name : 'Select JPG, PNG or WEBP' }}
                    </p>
                  </div>
                  <input type="file" (change)="onFileSelected($event)" class="hidden" accept="image/*" />
                </label>
              </div>
            </div>

            <!-- Tags Chip Input -->
            <div class="space-y-1.5">
              <label for="tagInput" class="text-xs font-semibold text-slate-400 uppercase tracking-wider block font-mono">Associate Tags</label>
              <div class="flex gap-2">
                <input
                  id="tagInput"
                  type="text"
                  [(ngModel)]="currentTag"
                  (keyup.enter)="addTag()"
                  placeholder="E.g., electric"
                  class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 text-xs"
                />
                <button
                  type="button"
                  (click)="addTag()"
                  class="px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-750"
                >
                  Add
                </button>
              </div>
              
              <!-- Chips List -->
              <div class="flex flex-wrap gap-1.5 mt-2">
                <span
                  *ngFor="let tag of tags"
                  class="flex items-center gap-1 px-2 py-0.5 rounded bg-brand-950/40 border border-brand-900/60 text-[9px] font-mono text-brand-300 uppercase font-semibold"
                >
                  {{ tag }}
                  <button type="button" (click)="removeTag(tag)" class="text-red-400 hover:text-red-300 font-bold ml-1">×</button>
                </span>
                <span *ngIf="tags.length === 0" class="text-[10px] text-slate-500 font-mono italic">No tags associated yet.</span>
              </div>
            </div>

            <!-- Status Alerts -->
            <div *ngIf="alertMessage"
                 [class.bg-emerald-950]="alertType === 'success'"
                 [class.text-emerald-400]="alertType === 'success'"
                 [class.border-emerald-900]="alertType === 'success'"
                 [class.bg-red-950]="alertType === 'error'"
                 [class.text-red-400]="alertType === 'error'"
                 [class.border-red-900]="alertType === 'error'"
                 class="border rounded-xl p-3 text-xs bg-slate-900">
              {{ alertMessage }}
            </div>
          </div>
        </div>

        <!-- Submit Button -->
        <div class="pt-4 border-t border-slate-800/60 mt-4">
          <button
            type="button"
            (click)="uploadAsset()"
            [disabled]="isUploading || !newAssetName.trim() || !selectedFile"
            class="w-full bg-gradient-to-r from-brand-600 to-indigo-650 text-white font-medium py-2.5 px-4 rounded-xl hover:from-brand-500 hover:to-indigo-550 disabled:from-slate-850 disabled:to-slate-850 disabled:text-slate-500 transition duration-300 shadow-md flex items-center justify-center gap-2 text-xs"
          >
            <span *ngIf="isUploading" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            <span>{{ isUploading ? 'Uploading...' : '📤 Add to Library' }}</span>
          </button>
        </div>
      </div>

      <!-- Right Column: Gallery Grid (Grid span 8) -->
      <div class="lg:col-span-8 glass-card rounded-2xl p-6 flex flex-col justify-between overflow-hidden relative max-h-full">
        <!-- Gallery Header -->
        <div class="border-b border-slate-800/60 pb-4 mb-4 flex justify-between items-center shrink-0">
          <h3 class="text-lg font-bold text-slate-100 flex items-center gap-2">
            <span>🖼️</span> Corporate Assets Grid
          </h3>
          <span class="text-xs text-slate-400 font-mono">
            {{ assets.length }} Asset(s)
          </span>
        </div>

        <!-- Gallery Body -->
        <div class="flex-1 overflow-y-auto pr-1">
          <!-- EMPTY STATE -->
          <div *ngIf="assets.length === 0" class="h-64 flex flex-col items-center justify-center text-center p-6 space-y-3">
            <span class="text-3xl">📭</span>
            <div class="max-w-sm space-y-1">
              <h4 class="text-sm font-semibold text-slate-350">Asset Library Empty</h4>
              <p class="text-slate-500 text-xs">
                Upload image assets in the left panel to populate the media library database.
              </p>
            </div>
          </div>

          <!-- GRID -->
          <div *ngIf="assets.length > 0" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div
              *ngFor="let asset of assets"
              class="bg-slate-950/40 border border-slate-900 rounded-xl overflow-hidden flex flex-col justify-between"
            >
              <!-- Thumbnail -->
              <div class="relative bg-slate-900 h-32 flex items-center justify-center border-b border-slate-900 overflow-hidden">
                <img [src]="asset.gcs_url" alt="{{ asset.name }}" class="w-full h-full object-cover" />
                <span class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-slate-950/80 border border-slate-800 text-[8px] font-mono text-slate-300 uppercase font-semibold">
                  {{ asset.category === 'vehicle' ? '🚚 Vehicle' : '📦 Product' }}
                </span>
              </div>

              <!-- Content details -->
              <div class="p-3 space-y-2 flex-1 flex flex-col justify-between">
                <div class="space-y-1">
                  <h4 class="text-xs font-bold text-slate-200 truncate" [title]="asset.name">
                    {{ asset.name }}
                  </h4>
                  <div class="flex flex-wrap gap-1">
                    <span
                      *ngFor="let t of asset.tags"
                      class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[8px] font-mono text-slate-400 font-medium"
                    >
                      #{{ t }}
                    </span>
                  </div>
                </div>

                <div class="pt-3 border-t border-slate-900 flex justify-between items-center mt-2">
                  <button
                    type="button"
                    (click)="startEditing(asset)"
                    class="text-[9px] text-brand-400 hover:text-brand-300 font-semibold uppercase tracking-wider"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    (click)="deleteAsset(asset.asset_id)"
                    class="text-[9px] text-red-500 hover:text-red-400 font-semibold uppercase tracking-wider"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Asset Modal Overlay -->
    <div *ngIf="editingAssetId" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="glass-card rounded-2xl p-6 max-w-md w-full space-y-6 border border-slate-800/80 animate-fade-in shadow-2xl">
        <div>
          <h3 class="text-lg font-bold text-slate-100 flex items-center gap-2">
            <span>✏️</span> Edit Asset Metadata
          </h3>
          <p class="text-slate-400 text-xs mt-0.5">Modify the catalog properties for this asset.</p>
        </div>

        <div class="space-y-4">
          <!-- Asset Name -->
          <div class="space-y-1.5">
            <label for="editName" class="text-[10px] text-slate-405 font-semibold uppercase tracking-wider block font-mono">Asset Name</label>
            <input
              id="editName"
              type="text"
              [(ngModel)]="editAssetName"
              class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 text-xs"
            />
          </div>

          <!-- Category -->
          <div class="space-y-1.5">
            <label for="editCategory" class="text-[10px] text-slate-405 font-semibold uppercase tracking-wider block font-mono">Category</label>
            <select
              id="editCategory"
              [(ngModel)]="editAssetCategory"
              class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 transition duration-200"
            >
              <option value="vehicle">🚚 Vehicle</option>
              <option value="product">📦 Product</option>
            </select>
          </div>

          <!-- Tags -->
          <div class="space-y-1.5">
            <label for="editTagInput" class="text-[10px] text-slate-405 font-semibold uppercase tracking-wider block font-mono">Associate Tags</label>
            <div class="flex gap-2">
              <input
                id="editTagInput"
                type="text"
                [(ngModel)]="currentEditTag"
                (keyup.enter)="addEditTag()"
                placeholder="E.g., electric"
                class="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 text-xs"
              />
              <button
                type="button"
                (click)="addEditTag()"
                class="px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-750"
              >
                Add
              </button>
            </div>
            
            <div class="flex flex-wrap gap-1.5 mt-2">
              <span
                *ngFor="let tag of editAssetTags"
                class="flex items-center gap-1 px-2 py-0.5 rounded bg-brand-950/40 border border-brand-900/60 text-[9px] font-mono text-brand-300 uppercase font-semibold"
              >
                {{ tag }}
                <button type="button" (click)="removeEditTag(tag)" class="text-red-400 hover:text-red-300 font-bold ml-1">×</button>
              </span>
            </div>
          </div>
        </div>

        <div class="flex gap-3 pt-4 border-t border-slate-800">
          <button
            type="button"
            (click)="cancelEditing()"
            class="flex-1 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            (click)="saveAssetChanges()"
            [disabled]="!editAssetName.trim()"
            class="flex-1 bg-gradient-to-r from-brand-600 to-indigo-650 text-white font-semibold py-2 rounded-xl hover:from-brand-500 hover:to-indigo-550 transition disabled:from-slate-850 disabled:to-slate-850 disabled:text-slate-500 text-xs shadow-md"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  `
})
export class AssetLibraryComponent implements OnInit {
  private genService = inject(GenerationService);

  assets: AssetResponse[] = [];
  isUploading = false;

  newAssetName = '';
  newAssetCategory = 'vehicle';
  tags: string[] = [];
  currentTag = '';
  selectedFile: File | null = null;

  alertMessage = '';
  alertType: 'success' | 'error' = 'success';

  // Edit Mode variables
  editingAssetId: string | null = null;
  editAssetName = '';
  editAssetCategory = 'vehicle';
  editAssetTags: string[] = [];
  currentEditTag = '';

  ngOnInit(): void {
    this.fetchAssets();
  }

  fetchAssets(): void {
    this.genService.getAssets().subscribe({
      next: (res) => this.assets = res,
      error: (err) => console.error('Failed to fetch assets', err)
    });
  }

  onFileSelected(event: any): void {
    const file = event.target.files?.[0];
    if (file) {
      this.selectedFile = file;
    }
  }

  addTag(): void {
    const t = this.currentTag.trim().toLowerCase();
    if (t && !this.tags.includes(t)) {
      this.tags.push(t);
    }
    this.currentTag = '';
  }

  removeTag(tag: string): void {
    this.tags = this.tags.filter(t => t !== tag);
  }

  uploadAsset(): void {
    if (!this.newAssetName.trim() || !this.selectedFile) return;

    this.isUploading = true;
    this.alertMessage = '';

    this.genService.uploadAsset(
      this.newAssetName,
      this.newAssetCategory,
      this.tags,
      this.selectedFile
    ).subscribe({
      next: (res) => {
        this.isUploading = false;
        this.newAssetName = '';
        this.newAssetCategory = 'vehicle';
        this.tags = [];
        this.selectedFile = null;
        this.alertMessage = 'Asset successfully uploaded to GCS and saved!';
        this.alertType = 'success';
        this.fetchAssets();
      },
      error: (err) => {
        this.isUploading = false;
        this.alertMessage = err.error?.detail || 'Upload failed.';
        this.alertType = 'error';
      }
    });
  }

  deleteAsset(assetId: string): void {
    this.genService.deleteAsset(assetId).subscribe({
      next: () => {
        this.fetchAssets();
      },
      error: (err) => console.error('Failed to delete asset', err)
    });
  }

  // Edit Handlers
  startEditing(asset: AssetResponse): void {
    this.editingAssetId = asset.asset_id;
    this.editAssetName = asset.name;
    this.editAssetCategory = asset.category;
    this.editAssetTags = [...(asset.tags || [])];
    this.currentEditTag = '';
  }

  cancelEditing(): void {
    this.editingAssetId = null;
  }

  addEditTag(): void {
    const t = this.currentEditTag.trim().toLowerCase();
    if (t && !this.editAssetTags.includes(t)) {
      this.editAssetTags.push(t);
    }
    this.currentEditTag = '';
  }

  removeEditTag(tag: string): void {
    this.editAssetTags = this.editAssetTags.filter(t => t !== tag);
  }

  saveAssetChanges(): void {
    if (!this.editingAssetId || !this.editAssetName.trim()) return;

    this.genService.updateAsset(
      this.editingAssetId,
      this.editAssetName,
      this.editAssetCategory,
      this.editAssetTags
    ).subscribe({
      next: () => {
        this.editingAssetId = null;
        this.fetchAssets();
      },
      error: (err) => console.error('Failed to update asset', err)
    });
  }
}
