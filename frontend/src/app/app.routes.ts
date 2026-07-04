import { Routes } from '@angular/router';
import { CoreShellComponent } from './components/core-shell/core-shell.component';
import { WorkspaceComponent } from './components/workspace/workspace.component';
import { CampaignsListComponent } from './components/campaigns-list/campaigns-list.component';
import { AssetLibraryComponent } from './components/asset-library/asset-library.component';
import { BrandConstraintsComponent } from './components/brand-constraints/brand-constraints.component';

export const routes: Routes = [
  {
    path: '',
    component: CoreShellComponent,
    children: [
      { path: '', redirectTo: 'wizard', pathMatch: 'full' },
      { path: 'wizard', component: WorkspaceComponent },
      { path: 'wizard/:campaign_id', component: WorkspaceComponent },
      { path: 'campaigns', component: CampaignsListComponent },
      { path: 'assets', component: AssetLibraryComponent },
      { path: 'settings', component: BrandConstraintsComponent }
    ]
  }
];
