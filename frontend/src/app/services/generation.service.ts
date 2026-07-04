import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface BrandVoice {
  profile: string;
  system_directive: string;
  blacklist: string[];
}

export interface PersonalizationMatrix {
  subsector: string;
  persona: string;
  stage: string;
}

export interface GenerateRequest {
  name: string;
  stage_status?: string;
  prompt: string;
  personalization_matrix: PersonalizationMatrix;
  selected_asset_tags: string[];
  campaign_id?: string;
}

export interface CampaignStatus {
  campaign_id: string;
  name?: string;
  stage_status?: string;
  status: string;
  prompt?: string;
  subsector?: string;
  persona?: string;
  stage?: string;
  selected_asset_tags?: string[];
  gcs_url?: string;
  banner_gcs_url?: string;
  blog_hero_gcs_url?: string;
  editorial_gcs_url?: string;
  slide_background_gcs_url?: string;
  content_card_gcs_url?: string;
  content?: string;
  error?: string;
}

export interface CampaignResponse {
  campaign_id: string;
  name: string;
  stage_status: string;
  status: string;
  prompt: string;
  subsector: string;
  persona: string;
  stage: string;
  selected_asset_tags: string[];
  gcs_url?: string;
  banner_gcs_url?: string;
  blog_hero_gcs_url?: string;
  editorial_gcs_url?: string;
  slide_background_gcs_url?: string;
  content_card_gcs_url?: string;
  content?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface AssetResponse {
  asset_id: string;
  name: string;
  gcs_url: string;
  category: string;
  tags: string[];
  created_at: string;
}

export interface BrandGovernance {
  company_name: string;
  primary_colors: string[];
  secondary_colors: string[];
  allowed_heading_fonts: string[];
  allowed_body_fonts: string[];
  contrast_enforcement_enabled: boolean;
  logo_gcs_url?: string;
  system_prompt_override: string;
}

export interface BlacklistData {
  blacklist: string[];
}

@Injectable({
  providedIn: 'root'
})
export class GenerationService {
  private apiUrl: string;
  private wsUrl: string;

  constructor(private http: HttpClient) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      this.apiUrl = 'http://localhost:8000/api/v1';
      this.wsUrl = 'ws://localhost:8000/api/v1/ws';
    } else {
      // Cloud environment: Dynamically map marketing-genai-frontend -> marketing-genai-api
      const apiHostname = hostname.replace('marketing-genai-frontend', 'marketing-genai-api');
      const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
      
      this.apiUrl = `${protocol}//${apiHostname}/api/v1`;
      this.wsUrl = `${wsProtocol}//${apiHostname}/api/v1/ws`;
    }
  }

  /**
   * Submit a content generation campaign
   */
  generate(request: GenerateRequest): Observable<CampaignStatus> {
    return this.http.post<CampaignStatus>(`${this.apiUrl}/generate`, request);
  }

  /**
   * Fetch current list of campaigns (historic logs)
   */
  getCampaigns(): Observable<CampaignResponse[]> {
    return this.http.get<CampaignResponse[]>(`${this.apiUrl}/campaigns`);
  }

  /**
   * Fetch current status of a campaign (fallback/direct fetch)
   */
  getCampaignStatus(campaignId: string): Observable<CampaignStatus> {
    return this.http.get<CampaignStatus>(`${this.apiUrl}/campaigns/${campaignId}`);
  }

  /**
   * Connect to the WebSocket status updates channel for a specific campaign.
   */
  connectWebSocket(campaignId: string): WebSocket {
    return new WebSocket(`${this.wsUrl}/${campaignId}`);
  }

  /**
   * Request generation of graphical/visual banner assets for a campaign.
   */
  generateCampaignAssets(campaignId: string): Observable<{
    blog_hero_gcs_url: string;
    editorial_gcs_url: string;
    slide_background_gcs_url: string;
    content_card_gcs_url: string;
  }> {
    return this.http.post<{
      blog_hero_gcs_url: string;
      editorial_gcs_url: string;
      slide_background_gcs_url: string;
      content_card_gcs_url: string;
    }>(`${this.apiUrl}/campaigns/${campaignId}/generate-assets`, {});
  }

  /**
   * Fetch organization brand governance constraints
   */
  getBrandGovernance(): Observable<BrandGovernance> {
    return this.http.get<BrandGovernance>(`${this.apiUrl}/settings/brand-governance`);
  }

  /**
   * Update organization brand governance constraints
   */
  updateBrandGovernance(data: {
    primary_colors: string[];
    secondary_colors: string[];
    allowed_heading_fonts: string[];
    allowed_body_fonts: string[];
    contrast_enforcement_enabled: boolean;
  }): Observable<BrandGovernance> {
    return this.http.put<BrandGovernance>(`${this.apiUrl}/settings/brand-governance`, data);
  }

  /**
   * Upload brand logo to GCS
   */
  uploadBrandLogo(file: File): Observable<{ logo_url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ logo_url: string }>(`${this.apiUrl}/settings/brand-governance/logo`, formData);
  }

  /**
   * Fetch global forbidden words blacklist
   */
  getBlacklist(): Observable<BlacklistData> {
    return this.http.get<BlacklistData>(`${this.apiUrl}/settings/blacklist`);
  }

  /**
   * Save global forbidden words blacklist
   */
  updateBlacklist(data: BlacklistData): Observable<BlacklistData> {
    return this.http.put<BlacklistData>(`${this.apiUrl}/settings/blacklist`, data);
  }

  /**
   * Get all library assets
   */
  getAssets(): Observable<AssetResponse[]> {
    return this.http.get<AssetResponse[]>(`${this.apiUrl}/assets`);
  }

  /**
   * Upload new vehicle or product asset
   */
  uploadAsset(name: string, category: string, tags: string[], file: File): Observable<AssetResponse> {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('category', category);
    formData.append('tags_json', JSON.stringify(tags));
    formData.append('file', file);
    return this.http.post<AssetResponse>(`${this.apiUrl}/assets`, formData);
  }

  /**
   * Delete asset from database and GCS
   */
  deleteAsset(assetId: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/assets/${assetId}`);
  }

  /**
   * Update existing asset metadata (name, category, tags)
   */
  updateAsset(assetId: string, name: string, category: string, tags: string[]): Observable<AssetResponse> {
    return this.http.put<AssetResponse>(`${this.apiUrl}/assets/${assetId}`, { name, category, tags });
  }

  /**
   * Regenerate a single campaign image template
   */
  regenerateCampaignAsset(campaignId: string, imageType: string, refinementPrompt?: string): Observable<{ image_url: string }> {
    return this.http.post<{ image_url: string }>(
      `${this.apiUrl}/campaigns/${campaignId}/regenerate-asset`,
      { image_type: imageType, refinement_prompt: refinementPrompt }
    );
  }

  /**
   * Delete campaign
   */
  deleteCampaign(campaignId: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/campaigns/${campaignId}`);
  }

  /**
   * Regenerate a single campaign text artifact
   */
  regenerateCampaignText(campaignId: string, textType: string, refinementPrompt?: string): Observable<{ content: string, url: string }> {
    return this.http.post<{ content: string, url: string }>(
      `${this.apiUrl}/campaigns/${campaignId}/regenerate-text`,
      { text_type: textType, refinement_prompt: refinementPrompt }
    );
  }

  /**
   * Finalize templates (mark campaign stage as Generated)
   */
  finalizeCampaign(campaignId: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/campaigns/${campaignId}/finalize`, {});
  }

  /**
   * Generate DOCX and PPTX documents for a campaign, upload to GCS, and mark as Generated
   */
  generateDocuments(campaignId: string): Observable<{ docx_url: string; pptx_url: string; stage_status: string }> {
    return this.http.post<{ docx_url: string; pptx_url: string; stage_status: string }>(
      `${this.apiUrl}/campaigns/${campaignId}/generate-documents`, {}
    );
  }

  /**
   * Fetch text content directly from GCS
   */
  getTextArtifact(gcsUrl: string): Observable<string> {
    return this.http.get(gcsUrl, { responseType: 'text' });
  }

  /**
   * Save updated text content back to backend DB and GCS
   */
  updateTextArtifact(campaignId: string, artifactType: string, content: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/campaigns/${campaignId}/artifacts/${artifactType}`, { content });
  }

  /**
   * Overlay logo on campaign image at a specific corner
   */
  overlayLogo(campaignId: string, imageType: string, position: string): Observable<{ image_url: string }> {
    return this.http.post<{ image_url: string }>(
      `${this.apiUrl}/campaigns/${campaignId}/overlay-logo`,
      { image_type: imageType, position: position }
    );
  }
}
