from sqlalchemy import Column, String, Text, DateTime, JSON, func, Integer, Boolean
from app.database import Base

class Campaign(Base):
    __tablename__ = "campaigns"

    campaign_id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False, default="Unnamed Campaign")
    stage_status = Column(String, nullable=False, default="Draft")  # "Draft" | "Generated"
    status = Column(String, nullable=False, default="queued")
    prompt = Column(Text, nullable=False)
    subsector = Column(String, nullable=False)
    persona = Column(String, nullable=False)
    stage = Column(String, nullable=False)
    selected_asset_tags = Column(JSON, nullable=True)  # List of selected asset tags
    gcs_url = Column(String, nullable=True)
    banner_gcs_url = Column(String, nullable=True)  # Legacy
    blog_hero_gcs_url = Column(String, nullable=True)
    editorial_gcs_url = Column(String, nullable=True)
    slide_background_gcs_url = Column(String, nullable=True)
    content_card_gcs_url = Column(String, nullable=True)
    
    # Text Artifact GCS URLs
    blog_post_gcs_url = Column(String, nullable=True)
    press_release_gcs_url = Column(String, nullable=True)
    longform_gcs_url = Column(String, nullable=True)
    
    # Artifact Status Tracking (idle | generating | completed | failed)
    blog_hero_status = Column(String, nullable=False, default="idle")
    editorial_status = Column(String, nullable=False, default="idle")
    slide_background_status = Column(String, nullable=False, default="idle")
    content_card_status = Column(String, nullable=False, default="idle")
    blog_post_status = Column(String, nullable=False, default="idle")
    press_release_status = Column(String, nullable=False, default="idle")
    longform_status = Column(String, nullable=False, default="idle")

    # Document and Presentation Artifacts
    docx_gcs_url = Column(String, nullable=True)
    pptx_gcs_url = Column(String, nullable=True)
    docx_status = Column(String, nullable=False, default="idle")
    pptx_status = Column(String, nullable=False, default="idle")

    content = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Asset(Base):
    __tablename__ = "assets"

    asset_id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    gcs_url = Column(String, nullable=False)
    category = Column(String, nullable=False)  # "vehicle" | "product"
    tags = Column(JSON, nullable=False)  # List of strings
    created_at = Column(DateTime, server_default=func.now())

class BrandGovernanceConstraint(Base):
    __tablename__ = "brand_governance_constraints"

    id = Column(Integer, primary_key=True, autoincrement=True)
    primary_colors = Column(JSON, nullable=False)
    secondary_colors = Column(JSON, nullable=False)
    allowed_heading_fonts = Column(JSON, nullable=False)
    allowed_body_fonts = Column(JSON, nullable=False)
    contrast_enforcement_enabled = Column(Boolean, nullable=False, default=True)
    logo_gcs_url = Column(String, nullable=True)
    system_prompt_override = Column(Text, nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Global brand voice profile fields
    company_name = Column(String, nullable=False, default="FleetVid")
    company_vertical = Column(String, nullable=False, default="Video Telematics & Fleet Management")
    global_tone = Column(Text, nullable=False, default="Authoritative, data-driven, pragmatic, and respectful of fleet operators. Avoid startup hype.")
    master_pillars = Column(JSON, nullable=False)
    guardrails = Column(JSON, nullable=False)
    cta_library = Column(JSON, nullable=False)

class Blacklist(Base):
    __tablename__ = "blacklist"

    id = Column(Integer, primary_key=True, autoincrement=True)
    forbidden_word = Column(String, unique=True, index=True, nullable=False)
