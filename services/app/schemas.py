from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

class PersonalizationMatrix(BaseModel):
    subsector: str = Field(..., description="E.g., Construction, Transit, etc.")
    persona: str = Field(..., description="E.g., Fleet Safety Manager, VP Operations, C-Suite")
    stage: str = Field(..., description="E.g., Awareness, Consideration, Decision")

class GenerateRequest(BaseModel):
    name: str = Field(..., description="Name of the campaign")
    stage_status: Optional[str] = Field("Draft", description="E.g., 'Draft' or 'Generated'")
    prompt: str = Field(..., description="Input context/topic for generation")
    personalization_matrix: PersonalizationMatrix
    selected_asset_tags: List[str] = Field(default=[], description="Selected assets tags for context")
    campaign_id: Optional[str] = Field(None, description="Optional existing campaign ID to regenerate/update")

class CampaignStatus(BaseModel):
    campaign_id: str
    name: Optional[str] = None
    stage_status: Optional[str] = None
    status: str  # "queued" | "processing" | "completed" | "failed"
    gcs_url: Optional[str] = None
    banner_gcs_url: Optional[str] = None
    blog_hero_gcs_url: Optional[str] = None
    editorial_gcs_url: Optional[str] = None
    slide_background_gcs_url: Optional[str] = None
    content_card_gcs_url: Optional[str] = None
    
    blog_post_gcs_url: Optional[str] = None
    press_release_gcs_url: Optional[str] = None
    longform_gcs_url: Optional[str] = None
    
    blog_hero_status: Optional[str] = "idle"
    editorial_status: Optional[str] = "idle"
    slide_background_status: Optional[str] = "idle"
    content_card_status: Optional[str] = "idle"
    blog_post_status: Optional[str] = "idle"
    press_release_status: Optional[str] = "idle"
    longform_status: Optional[str] = "idle"
    docx_gcs_url: Optional[str] = None
    pptx_gcs_url: Optional[str] = None
    docx_status: Optional[str] = "idle"
    pptx_status: Optional[str] = "idle"
    content: Optional[str] = None
    error: Optional[str] = None
    
    # Personalization and wizard configuration metadata
    prompt: Optional[str] = None
    subsector: Optional[str] = None
    persona: Optional[str] = None
    stage: Optional[str] = None
    selected_asset_tags: Optional[List[str]] = []

class CampaignResponse(BaseModel):
    campaign_id: str
    name: str
    stage_status: str
    status: str
    prompt: str
    subsector: str
    persona: str
    stage: str
    selected_asset_tags: Optional[List[str]] = []
    gcs_url: Optional[str] = None
    banner_gcs_url: Optional[str] = None
    blog_hero_gcs_url: Optional[str] = None
    editorial_gcs_url: Optional[str] = None
    slide_background_gcs_url: Optional[str] = None
    content_card_gcs_url: Optional[str] = None
    
    blog_post_gcs_url: Optional[str] = None
    press_release_gcs_url: Optional[str] = None
    longform_gcs_url: Optional[str] = None
    
    blog_hero_status: Optional[str] = "idle"
    editorial_status: Optional[str] = "idle"
    slide_background_status: Optional[str] = "idle"
    content_card_status: Optional[str] = "idle"
    blog_post_status: Optional[str] = "idle"
    press_release_status: Optional[str] = "idle"
    longform_status: Optional[str] = "idle"
    docx_gcs_url: Optional[str] = None
    pptx_gcs_url: Optional[str] = None
    docx_status: Optional[str] = "idle"
    pptx_status: Optional[str] = "idle"
    content: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class AssetCreate(BaseModel):
    name: str
    category: str  # "vehicle" | "product"
    tags: List[str]

class AssetUpdate(BaseModel):
    name: str
    category: str
    tags: List[str]

class AssetResponse(BaseModel):
    asset_id: str
    name: str
    gcs_url: str
    category: str
    tags: List[str]
    created_at: datetime

    class Config:
        from_attributes = True

class BrandGovernanceUpdate(BaseModel):
    company_name: str
    primary_colors: List[str]
    secondary_colors: List[str]
    allowed_heading_fonts: List[str]
    allowed_body_fonts: List[str]
    contrast_enforcement_enabled: bool
    company_vertical: str
    global_tone: str
    master_pillars: List[Dict[str, Any]]
    guardrails: Dict[str, List[str]]
    cta_library: Dict[str, List[str]]

class BrandGovernanceResponse(BaseModel):
    company_name: str
    primary_colors: List[str]
    secondary_colors: List[str]
    allowed_heading_fonts: List[str]
    allowed_body_fonts: List[str]
    contrast_enforcement_enabled: bool
    logo_gcs_url: Optional[str] = None
    system_prompt_override: str
    company_vertical: str
    global_tone: str
    master_pillars: List[Dict[str, Any]]
    guardrails: Dict[str, List[str]]
    cta_library: Dict[str, List[str]]

class BlacklistUpdate(BaseModel):
    blacklist: List[str]

class AssetRegenerateRequest(BaseModel):
    image_type: str  # "blog_hero" | "editorial" | "slide_background" | "content_card"
    refinement_prompt: Optional[str] = None
    
class TextArtifactUpdate(BaseModel):
    content: str

class TextRegenerateRequest(BaseModel):
    text_type: str  # "blog_post" | "press_release" | "longform"
    refinement_prompt: Optional[str] = None

