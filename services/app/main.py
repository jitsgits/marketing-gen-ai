import os
import uuid
import json
import logging
import asyncio
import time
import io
from typing import List
from pydantic import BaseModel
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, status, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, delete, text
from PIL import Image, ImageDraw, ImageFont

from app.schemas import (
    GenerateRequest, 
    CampaignStatus,
    CampaignResponse,
    AssetCreate, 
    AssetUpdate, 
    AssetResponse,
    BrandGovernanceUpdate, 
    BrandGovernanceResponse, 
    BlacklistUpdate,
    AssetRegenerateRequest,
    TextArtifactUpdate,
    TextRegenerateRequest
)
from app.pubsub import PubSubBroker
from app.storage import StorageBroker
from app.telemetry import init_telemetry
from app.database import Base, sync_engine, SessionLocalAsync
from app.models import Campaign, BrandGovernanceConstraint, Blacklist, Asset

logger = logging.getLogger("api")
logging.basicConfig(level=logging.INFO)

# Initialize OpenTelemetry Tracer
tracer = init_telemetry("marketing-genai-api")

def get_genai_client():
    from google import genai
    try:
        return genai.Client(vertexai=True)
    except Exception as e:
        logger.info(f"Default client init failed ({e}). Falling back to explicit env values.")
        project_id = os.getenv("GCP_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT")
        location = os.getenv("GCP_LOCATION", "us-central1")
        return genai.Client(
            vertexai=True,
            project=project_id,
            location=location
        )


pubsub_broker = PubSubBroker()

def build_system_prompt_override(
    primary_colors: list,
    secondary_colors: list,
    allowed_heading_fonts: list,
    allowed_body_fonts: list,
    contrast_enforcement_enabled: bool,
    logo_gcs_url: str | None,
    company_vertical: str,
    global_tone: str,
    master_pillars: list,
    guardrails: dict,
    cta_library: dict,
    company_name: str = "FleetVid"
) -> str:
    primary = ", ".join(primary_colors)
    secondary = ", ".join(secondary_colors)
    headings = ", ".join(allowed_heading_fonts)
    body = ", ".join(allowed_body_fonts)
    contrast = (
        "Contrast compliance (WCAG 2.1 AA) must be strictly enforced between backgrounds and text overlays."
        if contrast_enforcement_enabled else
        "Contrast compliance enforcement is disabled."
    )
    logo_clause = ""
    if logo_gcs_url:
        logo_clause = f"\n* **Corporate Logo Asset**: Use the following logo image URL in any HTML/CSS templates or branding visual layout specifications: {logo_gcs_url}"

    company_clause = f"\n* **Corporate Company Name**: The organization name is '{company_name}'. Always refer to the company as '{company_name}' in all generated copy."

    # Pillars
    pillars_str = "\n".join([f"   * **{p['name']}** (ID: {p['id']})" for p in master_pillars])
    
    # Guardrails
    dos_str = "\n".join([f"   * DO: {d}" for d in guardrails.get("dos", [])])
    donts_str = "\n".join([f"   * DONT: {d}" for d in guardrails.get("donts", [])])
    
    # CTAs
    low_cta = ", ".join(cta_library.get("low_friction", []))
    med_cta = ", ".join(cta_library.get("medium_friction", []))
    high_cta = ", ".join(cta_library.get("high_friction", []))

    return f"""### Brand Governance Constraints
You must strictly adhere to the following corporate brand identity guidelines in all generated marketing copy, HTML/CSS layouts, and asset templates:

1. **Company Name**: {company_name}
2. **Company Vertical**: {company_vertical}
3. **Global Voice & Tone**: {global_tone}

4. **Core Messaging Pillars**:
{pillars_str}

5. **Style Guardrails**:
{dos_str}
{donts_str}

6. **Call-To-Action (CTA) Preferences**:
   * Low Friction: [ {low_cta} ]
   * Medium Friction: [ {med_cta} ]
   * High Friction: [ {high_cta} ]

7. **Design & Color Palette Constraints**:
   * **Primary Palette**: Only use these primary colors: [ {primary} ]
   * **Secondary Palette**: Only use these secondary colors: [ {secondary} ]{logo_clause}{company_clause}

8. **Typography Constraints**:
   * **Headings**: Only use the following approved font families: [ {headings} ]
   * **Body Text**: Only use the following approved font families: [ {body} ]

9. **Accessibility**:
   * {contrast}"""

def draw_campaign_banner(campaign_title: str, primary_colors: list, secondary_colors: list) -> bytes:
    """Programmatically draw a modern landscape banner representing the campaign."""
    width, height = 1024, 512
    bg_color = primary_colors[0] if primary_colors else "#0F172A"
    accent_color = secondary_colors[0] if secondary_colors else "#4F46E5"
    border_color = secondary_colors[1] if len(secondary_colors) > 1 else "#0EA5E9"
    text_color = primary_colors[1] if len(primary_colors) > 1 else "#F8FAFC"
    
    # Create image canvas
    img = Image.new("RGB", (width, height), color=bg_color)
    draw = ImageDraw.Draw(img)
    
    # Draw geometric background decorations
    draw.ellipse([-80, -80, 400, 400], fill=accent_color)
    draw.ellipse([850, 280, 1150, 580], fill=border_color)
    draw.rectangle([20, 20, width-20, height-20], outline=border_color, width=4)
    
    # Text Formatting
    title_text = campaign_title[:65] + "..." if len(campaign_title) > 65 else campaign_title
    
    font = None
    font_paths = [
        "arial.ttf",
        "Helvetica.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    ]
    for path in font_paths:
        try:
            font = ImageFont.truetype(path, size=28)
            break
        except Exception:
            continue
            
    if font is None:
        font = ImageFont.load_default()
        
    draw.text((width // 2, height // 2 - 30), "CAMPAIGN LAUNCH AGENT", fill=border_color, font=font, anchor="mm")
    draw.text((width // 2, height // 2 + 30), title_text, fill=text_color, font=font, anchor="mm")
    
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database schema...")
    try:
        # Bypassed dropping tables to enable full data persistence across container rebuilds.
        pass
            
        Base.metadata.create_all(bind=sync_engine)
        logger.info("Database schema initialized successfully.")

        # DDL Alteration to add company_name column if missing (SQLite/PostgreSQL compatible)
        with sync_engine.connect() as conn:
            try:
                conn.execute(text("ALTER TABLE brand_governance_constraints ADD COLUMN company_name VARCHAR DEFAULT 'FleetVid'"))
                conn.commit()
                logger.info("Database schema migration: added company_name to brand_governance_constraints.")
            except Exception as ddl_err:
                logger.info(f"Database schema migration check finished (column may already exist): {ddl_err}")

        # DDL migrations for campaign document artifact columns
        with sync_engine.connect() as conn:
            for col_def in [
                "docx_gcs_url VARCHAR",
                "pptx_gcs_url VARCHAR",
                "docx_status VARCHAR DEFAULT 'idle'",
                "pptx_status VARCHAR DEFAULT 'idle'",
            ]:
                col_name = col_def.split()[0]
                try:
                    conn.execute(text(f"ALTER TABLE campaigns ADD COLUMN {col_def}"))
                    conn.commit()
                    logger.info(f"DB migration: added campaigns.{col_name}")
                except Exception:
                    pass  # column already exists

        # Seed default brand governance settings if none exist
        from app.database import SessionLocalSync
        with SessionLocalSync() as session:
            constraints = session.query(BrandGovernanceConstraint).first()
            if not constraints:
                default_primary = ["#0F172A", "#F8FAFC", "#4F46E5", "#0EA5E9", "#1E40AF"]
                default_secondary = ["#10B981", "#8B5CF6", "#F43F5E", "#64748B"]
                default_headings = ["Outfit", "Inter", "Cabinet Grotesk"]
                default_body = ["Inter", "Plus Jakarta Sans", "Roboto"]
                
                default_vertical = "Video Telematics & Fleet Management"
                default_tone = "Authoritative, data-driven, pragmatic, and respectful of fleet operators. Avoid startup hype."
                default_pillars = [
                    {"id": "pillar_safety_exoneration", "name": "Driver Exoneration & Insurance Reduction"},
                    {"id": "pillar_ai_coaching", "name": "Proactive In-Cab AI Driver Coaching"},
                    {"id": "pillar_operational_efficiency", "name": "Asset Optimization & Fuel Savings"}
                ]
                default_guardrails = {
                    "dos": [
                        "Position drivers as professional partners needing protection",
                        "Lead with operational metrics and hard fleet data",
                        "Use industry terms: ELD compliance, harsh event, exoneration"
                    ],
                    "donts": [
                        "Never use surveillance words: spying, monitoring drivers, catching employees",
                        "Never guarantee 100% accident elimination or absolute zero liability",
                        "Avoid abstract tech jargon like 'digital transformation of trucking'"
                    ]
                }
                default_cta_library = {
                    "low_friction": ["Calculate Your Fleet ROI", "Watch 2-Min Platform Walkthrough"],
                    "medium_friction": ["Download Fleet Safety Blueprint", "Talk to a Fleet Expert"],
                    "high_friction": ["Request a Free Hardware Pilot", "Book a Live Demo"]
                }
                
                default_override = build_system_prompt_override(
                    default_primary,
                    default_secondary,
                    default_headings,
                    default_body,
                    True,
                    None,
                    default_vertical,
                    default_tone,
                    default_pillars,
                    default_guardrails,
                    default_cta_library,
                    "FleetVid"
                )
                
                new_constraints = BrandGovernanceConstraint(
                    id=1,
                    company_name="FleetVid",
                    primary_colors=default_primary,
                    secondary_colors=default_secondary,
                    allowed_heading_fonts=default_headings,
                    allowed_body_fonts=default_body,
                    contrast_enforcement_enabled=True,
                    logo_gcs_url=None,
                    system_prompt_override=default_override,
                    company_vertical=default_vertical,
                    global_tone=default_tone,
                    master_pillars=default_pillars,
                    guardrails=default_guardrails,
                    cta_library=default_cta_library
                )
                session.add(new_constraints)
                session.commit()
                logger.info("Seeded Brand Governance Constraints.")
                
            # Seed default blacklist if none exist
            words_count = session.query(Blacklist).count()
            if words_count == 0:
                default_words = ["spam", "cheap", "clickbait", "guarantee"]
                for word in default_words:
                    new_word = Blacklist(forbidden_word=word)
                    session.add(new_word)
                session.commit()
                logger.info("Seeded default Blacklist forbidden words.")

            # Seed default brand assets if none exist
            asset_count = session.query(Asset).count()
            if asset_count == 0:
                logger.info("Seeding default brand assets...")
                static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "static_assets"))
                default_assets = [
                    {"name": "FleetVid Dual-Lens Dashcam", "filename": "dashcam_product.png", "category": "product", "tags": ["dashcam", "telematics", "hardware", "safety"]},
                    {"name": "FleetVid Transit Cargo Van", "filename": "transit_van.png", "category": "vehicle", "tags": ["transit", "van", "fleet", "telematics"]},
                    {"name": "FleetVid Electric Semi-Truck", "filename": "electric_semi.png", "category": "vehicle", "tags": ["semi-truck", "ev", "electric", "logistics"]}
                ]
                storage_broker = StorageBroker()
                for def_asset in default_assets:
                    filepath = os.path.join(static_dir, def_asset["filename"])
                    if os.path.exists(filepath):
                        with open(filepath, "rb") as f:
                            file_data = f.read()
                        
                        gcs_path = f"assets/seeded_{def_asset['filename']}"
                        gcs_url = storage_broker.upload_binary_artifact(gcs_path, file_data, "image/png")
                        
                        db_asset = Asset(
                            asset_id=str(uuid.uuid4()),
                            name=def_asset["name"],
                            category=def_asset["category"],
                            tags=def_asset["tags"],
                            gcs_url=gcs_url
                        )
                        session.add(db_asset)
                session.commit()
                logger.info("Default brand assets seeded successfully.")

    except Exception as db_err:
        logger.error(f"Failed to initialize/seed database schema: {db_err}")

    logger.info("Initializing API Pub/Sub connections...")
    try:
        pubsub_broker.ensure_topic("marketing-genai-requests")
    except Exception as pubsub_err:
        logger.error(f"Failed to verify Pub/Sub topic: {pubsub_err}")

    yield

    logger.info("Shutdown completed.")

app = FastAPI(
    title="Campaign Launch Agent API",
    description="Enterprise Content Engine API Gateway",
    version="1.0.0",
    lifespan=lifespan
)

origins = [
    "http://localhost",
    "http://localhost:4200",
    "http://127.0.0.1",
    "http://127.0.0.1:4200",
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/v1/generate", response_model=CampaignStatus, status_code=status.HTTP_202_ACCEPTED)
async def generate_content(request: GenerateRequest):
    with tracer.start_as_current_span("api_generate_request") as span:
        campaign_id = request.campaign_id if request.campaign_id else str(uuid.uuid4())
        span.set_attribute("campaign_id", campaign_id)
        span.set_attribute("personalization.persona", request.personalization_matrix.persona)
        
        logger.info(f"Initiating campaign generation request. campaign_id: {campaign_id}")
        
        # Write initial queued state or update existing row in PostgreSQL
        try:
            async with SessionLocalAsync() as session:
                if request.campaign_id:
                    result = await session.execute(select(Campaign).where(Campaign.campaign_id == campaign_id))
                    db_campaign = result.scalars().first()
                    if db_campaign:
                        # Delete existing campaign files from GCS (does not affect asset library)
                        storage_broker = StorageBroker()
                        urls_to_delete = [
                            db_campaign.blog_post_gcs_url,
                            db_campaign.press_release_gcs_url,
                            db_campaign.longform_gcs_url,
                            db_campaign.blog_hero_gcs_url,
                            db_campaign.editorial_gcs_url,
                            db_campaign.slide_background_gcs_url,
                            db_campaign.content_card_gcs_url,
                            db_campaign.gcs_url,
                            db_campaign.banner_gcs_url,
                            getattr(db_campaign, 'docx_gcs_url', None),
                            getattr(db_campaign, 'pptx_gcs_url', None),
                        ]
                        for url in urls_to_delete:
                            if url:
                                try:
                                    storage_broker.delete_artifact(url)
                                except Exception as del_err:
                                    logger.error(f"Failed to delete campaign artifact {url}: {del_err}")

                        # Reset campaign metadata, URLs, and statuses to default/idle
                        db_campaign.name = request.name
                        db_campaign.stage_status = request.stage_status or "Draft"
                        db_campaign.status = "queued"
                        db_campaign.prompt = request.prompt
                        db_campaign.subsector = request.personalization_matrix.subsector
                        db_campaign.persona = request.personalization_matrix.persona
                        db_campaign.stage = request.personalization_matrix.stage
                        db_campaign.selected_asset_tags = request.selected_asset_tags
                        db_campaign.error = None
                        
                        db_campaign.blog_post_gcs_url = None
                        db_campaign.press_release_gcs_url = None
                        db_campaign.longform_gcs_url = None
                        db_campaign.blog_hero_gcs_url = None
                        db_campaign.editorial_gcs_url = None
                        db_campaign.slide_background_gcs_url = None
                        db_campaign.content_card_gcs_url = None
                        db_campaign.gcs_url = None
                        db_campaign.banner_gcs_url = None

                        db_campaign.blog_post_status = "idle"
                        db_campaign.press_release_status = "idle"
                        db_campaign.longform_status = "idle"
                        db_campaign.blog_hero_status = "idle"
                        db_campaign.editorial_status = "idle"
                        db_campaign.slide_background_status = "idle"
                        db_campaign.content_card_status = "idle"
                        db_campaign.docx_gcs_url = None
                        db_campaign.pptx_gcs_url = None
                        db_campaign.docx_status = "idle"
                        db_campaign.pptx_status = "idle"
                    else:
                        raise HTTPException(status_code=404, detail="Campaign not found to update.")
                else:
                    db_campaign = Campaign(
                        campaign_id=campaign_id,
                        name=request.name,
                        stage_status=request.stage_status or "Draft",
                        status="queued",
                        prompt=request.prompt,
                        subsector=request.personalization_matrix.subsector,
                        persona=request.personalization_matrix.persona,
                        stage=request.personalization_matrix.stage,
                        selected_asset_tags=request.selected_asset_tags
                    )
                    session.add(db_campaign)
                await session.commit()
            logger.info(f"Campaign {campaign_id} successfully persisted/updated in PostgreSQL.")
        except HTTPException:
            raise
        except Exception as db_err:
            logger.error(f"Failed to write campaign {campaign_id} to database: {db_err}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database storage unavailable. Generation request failed to save."
            )

        # Formulate Pub/Sub request message payload
        message_payload = {
            "campaign_id": campaign_id,
            "name": request.name,
            "stage_status": request.stage_status or "Draft",
            "prompt": request.prompt,
            "selected_asset_tags": request.selected_asset_tags,
            "personalization_matrix": {
                "subsector": request.personalization_matrix.subsector,
                "persona": request.personalization_matrix.persona,
                "stage": request.personalization_matrix.stage
            }
        }
        
        # Publish request message to Pub/Sub Requests queue
        try:
            pubsub_broker.publish("marketing-genai-requests", message_payload)
            logger.info(f"Campaign {campaign_id} published to Pub/Sub topic 'marketing-genai-requests'.")
        except Exception as e:
            logger.error(f"Failed to submit campaign to Pub/Sub requests queue: {e}")
            # Update database status to failed
            try:
                async with SessionLocalAsync() as session:
                    result = await session.execute(select(Campaign).where(Campaign.campaign_id == campaign_id))
                    db_campaign = result.scalars().first()
                    if db_campaign:
                        db_campaign.status = "failed"
                        db_campaign.error = "Failed to queue campaign in Pub/Sub requests broker."
                        await session.commit()
            except Exception as update_err:
                logger.error(f"Failed to update failed campaign status in DB: {update_err}")

            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Message broker unavailable. Generation request failed to queue."
            )
            
        return CampaignStatus(
            campaign_id=campaign_id,
            status="queued",
            content=None,
            gcs_url=None,
            error=None
        )

@app.get("/api/v1/campaigns", response_model=List[CampaignResponse])
async def list_campaigns():
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).order_by(Campaign.created_at.desc())
            )
            return result.scalars().all()
    except Exception as e:
        logger.error(f"Error fetching campaigns: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error querying campaigns database."
        )

@app.get("/api/v1/campaigns/{campaign_id}", response_model=CampaignStatus)
async def get_campaign_status(campaign_id: str):
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Campaign ID {campaign_id} not found."
                )
            return CampaignStatus(
                campaign_id=db_campaign.campaign_id,
                name=db_campaign.name,
                stage_status=db_campaign.stage_status,
                status=db_campaign.status,
                content=db_campaign.content,
                gcs_url=db_campaign.gcs_url,
                banner_gcs_url=db_campaign.banner_gcs_url,
                blog_hero_gcs_url=db_campaign.blog_hero_gcs_url,
                editorial_gcs_url=db_campaign.editorial_gcs_url,
                slide_background_gcs_url=db_campaign.slide_background_gcs_url,
                content_card_gcs_url=db_campaign.content_card_gcs_url,
                blog_post_gcs_url=db_campaign.blog_post_gcs_url,
                press_release_gcs_url=db_campaign.press_release_gcs_url,
                longform_gcs_url=db_campaign.longform_gcs_url,
                blog_hero_status=db_campaign.blog_hero_status,
                editorial_status=db_campaign.editorial_status,
                slide_background_status=db_campaign.slide_background_status,
                content_card_status=db_campaign.content_card_status,
                blog_post_status=db_campaign.blog_post_status,
                press_release_status=db_campaign.press_release_status,
                longform_status=db_campaign.longform_status,
                docx_gcs_url=getattr(db_campaign, 'docx_gcs_url', None),
                pptx_gcs_url=getattr(db_campaign, 'pptx_gcs_url', None),
                docx_status=getattr(db_campaign, 'docx_status', 'idle'),
                pptx_status=getattr(db_campaign, 'pptx_status', 'idle'),
                error=db_campaign.error,
                prompt=db_campaign.prompt,
                subsector=db_campaign.subsector,
                persona=db_campaign.persona,
                stage=db_campaign.stage,
                selected_asset_tags=db_campaign.selected_asset_tags
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching campaign {campaign_id} status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error querying database."
        )

@app.get("/api/v1/campaigns/{campaign_id}/artifacts/{artifact_type}")
async def get_text_artifact(campaign_id: str, artifact_type: str):
    if artifact_type not in ["blog_post", "press_release", "longform"]:
        raise HTTPException(status_code=400, detail="Invalid artifact type.")
        
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
                
            gcs_url = None
            if artifact_type == "blog_post":
                gcs_url = db_campaign.blog_post_gcs_url
            elif artifact_type == "press_release":
                gcs_url = db_campaign.press_release_gcs_url
            elif artifact_type == "longform":
                gcs_url = db_campaign.longform_gcs_url
                
            if not gcs_url:
                raise HTTPException(status_code=404, detail="Artifact not generated yet.")
                
            storage_broker = StorageBroker()
            text_content = storage_broker.download_text_artifact(gcs_url)
            return {"content": text_content}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching text artifact {artifact_type} for campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail="Error fetching text artifact.")

@app.put("/api/v1/campaigns/{campaign_id}/artifacts/{artifact_type}")
async def update_text_artifact(campaign_id: str, artifact_type: str, request_data: TextArtifactUpdate):
    if artifact_type not in ["blog_post", "press_release", "longform"]:
        raise HTTPException(status_code=400, detail="Invalid artifact type.")
        
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
                
            file_path = f"campaigns/{campaign_id}/{artifact_type}.txt"
            storage_broker = StorageBroker()
            gcs_url = storage_broker.upload_text_artifact(file_path, request_data.content)
            
            if artifact_type == "blog_post":
                db_campaign.blog_post_gcs_url = gcs_url
            elif artifact_type == "press_release":
                db_campaign.press_release_gcs_url = gcs_url
            elif artifact_type == "longform":
                db_campaign.longform_gcs_url = gcs_url
                
            await session.commit()
            return {"message": "Artifact updated successfully", "gcs_url": gcs_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating text artifact {artifact_type} for campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail="Error updating text artifact.")

@app.post("/api/v1/campaigns/{campaign_id}/generate-assets")
async def generate_campaign_assets(campaign_id: str):
    """Draws custom image templates based on brand configurations and uploads to GCS."""
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
                
            gov_res = await session.execute(
                select(BrandGovernanceConstraint).where(BrandGovernanceConstraint.id == 1)
            )
            gov = gov_res.scalars().first()
            if not gov:
                raise HTTPException(status_code=404, detail="Brand governance constraints not found.")
                
            # Find assets matching selected campaign tags
            campaign_tags = db_campaign.selected_asset_tags or []
            logger.info(f"Campaign selected tags to compose: {campaign_tags}")
            
            assets_res = await session.execute(select(Asset))
            all_assets = assets_res.scalars().all()
            
            # Filter assets by tags
            matched_assets = []
            for asset in all_assets:
                asset_tags = asset.tags or []
                if any(tag in campaign_tags for tag in asset_tags):
                    matched_assets.append(asset)
            
            logger.info(f"Found {len(matched_assets)} matched library assets for composition.")
            
            # Compose Prompt incorporating governor parameters and campaign details
            composition_details = " \n".join([f"- Use reference {a.category} asset named '{a.name}' (URL: {a.gcs_url}, tags: {a.tags})" for a in matched_assets])
            base_prompt = (
                f"Topic: {db_campaign.prompt}\n"
                f"Target Persona: {db_campaign.persona} in {db_campaign.subsector}\n"
                f"Corporate Brand Guidelines compliance enforced.\n"
            )
            if composition_details:
                base_prompt += f"Incorporate the following image assets directly into the composition:\n{composition_details}\n"
            
            # Helper to run Vertex AI Imagen or fallback mock
            def run_imagen(aspect_ratio: str, width: int, height: int, mock_label: str) -> bytes:
                try:
                    from google.genai import types as genai_types
                    client = get_genai_client()
                    response = client.models.generate_images(
                        model="imagen-4.0-generate-001",
                        prompt=f"{mock_label} marketing banner. {base_prompt}",
                        config=genai_types.GenerateImagesConfig(
                            number_of_images=1,
                            aspect_ratio=aspect_ratio,
                            guidance_scale=15.0,
                            output_mime_type="image/png",
                            person_generation="DONT_ALLOW",
                            safety_filter_level="block_medium_and_above"
                        )
                    )
                    image_bytes = response.generated_images[0].image.image_bytes
                    if not image_bytes:
                        raise Exception("No image bytes returned (possibly filtered by safety filters)")
                    return image_bytes
                except Exception as e:
                    logger.warning(f"Vertex AI Imagen call failed: {e}. Falling back to standard fidelity Pillow drawing.")
                    from PIL import Image, ImageDraw, ImageFont
                    import io
                    img = Image.new("RGB", (width, height), color="#0F172A")
                    draw = ImageDraw.Draw(img)
                    
                    # Fill background with primary/secondary branding if available
                    draw.rectangle([10, 10, width-10, height-10], outline="#4F46E5", width=2)
                    draw.text((width // 2, 40), f"Imagen composition: {mock_label}", fill="#ffffff", anchor="mm")
                    draw.text((width // 2, height // 2 - 20), f"Size: {width}x{height} | Aspect Ratio: {aspect_ratio}", fill="#cbd5e1", anchor="mm")
                    draw.text((width // 2, height // 2 + 20), f"Topic: {db_campaign.prompt[:40]}...", fill="#cbd5e1", anchor="mm")
                    if matched_assets:
                        draw.text((width // 2, height - 40), f"Composed with: {matched_assets[0].name}", fill="#F43F5E", anchor="mm")
                        
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    return buf.getvalue()
            
            storage_broker = StorageBroker()
            
            # Generate 4 images
            logger.info("Generating Blog Hero (16:9)...")
            blog_hero_bytes = run_imagen("16:9", 1408, 768, "Blog/PR Hero Image")
            blog_hero_url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/blog_hero.png", blog_hero_bytes, "image/png")
            
            logger.info("Generating Editorial (4:3)...")
            editorial_bytes = run_imagen("4:3", 1280, 896, "Inline Editorial Image")
            editorial_url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/editorial.png", editorial_bytes, "image/png")
            
            logger.info("Generating Slide Background (16:9)...")
            slide_bytes = run_imagen("16:9", 1408, 768, "PowerPoint Widescreen Background")
            slide_url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/slide_background.png", slide_bytes, "image/png")
            
            logger.info("Generating Content Card (1:1)...")
            card_bytes = run_imagen("1:1", 1024, 1024, "Grid/Column Content Card")
            card_url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/content_card.png", card_bytes, "image/png")
            
            # Save all 4 URLs to Campaign record
            db_campaign.blog_hero_gcs_url = blog_hero_url
            db_campaign.editorial_gcs_url = editorial_url
            db_campaign.slide_background_gcs_url = slide_url
            db_campaign.content_card_gcs_url = card_url
            db_campaign.banner_gcs_url = blog_hero_url  # Set legacy banner_gcs_url to blog hero for backward compatibility
            
            await session.commit()
            
            logger.info("4 programmatic standard fidelity image templates generated successfully!")
            return {
                "blog_hero_gcs_url": blog_hero_url,
                "editorial_gcs_url": editorial_url,
                "slide_background_gcs_url": slide_url,
                "content_card_gcs_url": card_url
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed programmatically drawing assets for campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

from app.schemas import AssetRegenerateRequest

@app.post("/api/v1/campaigns/{campaign_id}/regenerate-asset")
async def regenerate_campaign_asset(campaign_id: str, request_data: AssetRegenerateRequest):
    image_type = request_data.image_type
    if image_type not in ["blog_hero", "editorial", "slide_background", "content_card"]:
        raise HTTPException(status_code=400, detail="Invalid image_type.")
        
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
                
            gov_res = await session.execute(
                select(BrandGovernanceConstraint).where(BrandGovernanceConstraint.id == 1)
            )
            gov = gov_res.scalars().first()
            if not gov:
                raise HTTPException(status_code=404, detail="Brand governance constraints not found.")
                
            campaign_tags = db_campaign.selected_asset_tags or []
            assets_res = await session.execute(select(Asset))
            all_assets = assets_res.scalars().all()
            
            matched_assets = []
            for asset in all_assets:
                asset_tags = asset.tags or []
                if any(tag in campaign_tags for tag in asset_tags):
                    matched_assets.append(asset)
                    
            # Describe matched assets in natural language, omitting raw instructions or DB metadata
            descriptions = []
            for a in matched_assets:
                clean_tags = [t for t in (a.tags or []) if len(t) < 30 and not any(k in t.lower() for k in ["overlay", "placement", "http", "gcs"])]
                clean_name = a.name
                if clean_name:
                    if clean_tags:
                        descriptions.append(f"a {a.category} representing '{clean_name}' (associated with: {', '.join(clean_tags)})")
                    else:
                        descriptions.append(f"a {a.category} representing '{clean_name}'")
            composition_details = " \n".join([f"- {desc}" for desc in descriptions])
            
            # Load slogans from the database
            captions = []
            if db_campaign.content:
                try:
                    captions = json.loads(db_campaign.content)
                except Exception:
                    pass
                    
            caption_index = 0
            if image_type == "blog_hero":
                caption_index = 0
            elif image_type == "editorial":
                caption_index = 1
            elif image_type == "slide_background":
                caption_index = 2
            elif image_type == "content_card":
                caption_index = 3
                
            caption_text = captions[caption_index] if len(captions) > caption_index else (captions[0] if captions else None)
            
            def _load_prompt(filename: str) -> str:
                prompt_path = os.path.join(os.path.dirname(__file__), "prompts", filename)
                try:
                    with open(prompt_path, "r", encoding="utf-8") as f:
                        return f.read()
                except Exception as e:
                    logger.error(f"Failed to load prompt {filename}: {e}")
                    return ""
                    
            scene_template = _load_prompt(f"image_{image_type}.txt")
            subsector = db_campaign.subsector or "Trucking & Local"
            persona = db_campaign.persona or "Fleet Safety Manager"
            
            scene = scene_template.format(
                prompt_topic=db_campaign.prompt,
                persona=persona,
                subsector=subsector
            )
            
            caption_clause = ""
            if caption_text:
                caption_clause = (
                    f" The image must display the text '{caption_text}' clearly visible on a signboard, screen, or vehicle."
                )
                
            logo_gcs_url = gov.logo_gcs_url
            company_name = getattr(gov, "company_name", "FleetVid")
            
            # Instruct Imagen to avoid generating any brand logos or symbols to prevent mismatching and messy random logo generations.
            logo_clause = " CRITICAL REQUIREMENT: Do NOT generate or paint any brand logos, corporate symbols, or emblem graphics on the vehicles, screens, or layout overlays. Keep all surfaces clean and free of branding graphics."
            company_clause = f" It is acceptable to display the company name '{company_name}' in simple black typographic lettering on signboards, vehicles, or screens in the scene."
            
            # Omit raw hex codes in the prompt to prevent Imagen from writing them as text
            colors = [c for c in (gov.primary_colors or []) + (gov.secondary_colors or []) if not c.startswith("#")]
            if colors:
                brand_colors_str = f"brand colors: {', '.join(colors)}"
            else:
                brand_colors_str = "brand colors"
            base_rules_template = _load_prompt("image_base_rules.txt")
            base_rules = base_rules_template.format(brand_colors_str=brand_colors_str)
            
            original_prompt = f"{scene}{caption_clause}{logo_clause}{company_clause}\n{base_rules}"
            if composition_details:
                original_prompt += f"\nReference assets to incorporate: {composition_details}"
                
            final_prompt = original_prompt
            if request_data.refinement_prompt:
                try:
                    from google import genai
                    from google.genai import types as genai_types
                    client = get_genai_client()
                    refine_instruction = (
                        "You are an expert prompt engineer for Imagen 3.0. "
                        "You refine existing image generation prompts based on user feedback. "
                        "CRITICAL DIRECTIVE: You must ONLY refine the existing visual prompt to incorporate the user's refinement feedback. "
                        "Do NOT replace the prompt with a completely different scene, layout, or subject. "
                        "Keep the overall composition, vehicles, telematics settings, camera angles, and style constraints exactly the same, "
                        "and apply the refinement changes incrementally (e.g. changing lighting, adding/removing a minor element, or updating color). "
                        "Return only the refined visual prompt text in a single paragraph, visual description only. "
                        "Do not include any preambles, explanations, or code formatting blocks."
                    )
                    refine_response = client.models.generate_content(
                        model="gemini-2.5-flash",
                        contents=(
                            f"Original Image Scene Prompt:\n{original_prompt}\n\n"
                            f"User's Refinement Request: {request_data.refinement_prompt}\n\n"
                            f"Generate the updated visual prompt for Imagen:"
                        ),
                        config=genai_types.GenerateContentConfig(
                            system_instruction=refine_instruction,
                            temperature=0.7
                        )
                    )
                    refined_text = refine_response.text.strip()
                    if refined_text:
                        final_prompt = f"{refined_text}\n{base_rules}"
                        if composition_details:
                            final_prompt += f"\nReference assets to incorporate: {composition_details}"
                        logger.info(f"Successfully refined prompt using Gemini: {final_prompt[:300]}")
                except Exception as e:
                    logger.warning(f"Failed to refine prompt using Gemini: {e}. Using raw concatenation.")
                    final_prompt += f"\nSpecific Refinement Request: {request_data.refinement_prompt}"
                    
            def run_imagen(aspect_ratio: str, width: int, height: int, mock_label: str) -> bytes:
                try:
                    from google import genai
                    from google.genai import types as genai_types
                    client = get_genai_client()
                    response = client.models.generate_images(
                        model="imagen-4.0-generate-001",
                        prompt=final_prompt,
                        config=genai_types.GenerateImagesConfig(
                            number_of_images=1,
                            aspect_ratio=aspect_ratio,
                            guidance_scale=15.0,
                            output_mime_type="image/png",
                            person_generation="DONT_ALLOW",
                            safety_filter_level="block_medium_and_above"
                        )
                    )
                    image_bytes = response.generated_images[0].image.image_bytes
                    if not image_bytes:
                        logger.warning(f"No image bytes returned for {mock_label} (possibly filtered by safety filters).")
                        raise Exception("No image bytes returned (possibly filtered by safety filters)")
                    logger.info(f"Successfully regenerated Imagen image for {mock_label}, size={len(image_bytes)} bytes")
                    return image_bytes
                except Exception as e:
                    logger.warning(f"Imagen call failed: {e}. Falling back to Pillow drawing.")
                    from PIL import Image, ImageDraw
                    import io
                    img = Image.new("RGB", (width, height), color="#0F172A")
                    draw = ImageDraw.Draw(img)
                    draw.rectangle([10, 10, width-10, height-10], outline="#4F46E5", width=2)
                    draw.text((width // 2, 40), f"Imagen composition: {mock_label}", fill="#ffffff", anchor="mm")
                    draw.text((width // 2, height // 2 - 20), f"Size: {width}x{height} | Aspect Ratio: {aspect_ratio}", fill="#cbd5e1", anchor="mm")
                    draw.text((width // 2, height // 2 + 20), f"Refinement: {request_data.refinement_prompt or 'None'}", fill="#cbd5e1", anchor="mm")
                    if matched_assets:
                        draw.text((width // 2, height - 40), f"Composed with: {matched_assets[0].name}", fill="#F43F5E", anchor="mm")
                        
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    return buf.getvalue()
            
            storage_broker = StorageBroker()
            
            old_url = None
            if image_type == "blog_hero":
                old_url = db_campaign.blog_hero_gcs_url
            elif image_type == "editorial":
                old_url = db_campaign.editorial_gcs_url
            elif image_type == "slide_background":
                old_url = db_campaign.slide_background_gcs_url
            elif image_type == "content_card":
                old_url = db_campaign.content_card_gcs_url
                
            if old_url:
                logger.info(f"Deleting old GCS image for type '{image_type}': {old_url}")
                storage_broker.delete_artifact(old_url)
                if old_url.endswith(".png"):
                    storage_broker.delete_artifact(old_url.replace(".png", "_raw.png"))
                
            if image_type == "blog_hero":
                new_bytes = run_imagen("16:9", 1408, 768, "Blog/PR Hero Image")
                storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/blog_hero_raw.png", new_bytes, "image/png")
                new_url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/blog_hero.png", new_bytes, "image/png")
                db_campaign.blog_hero_gcs_url = new_url
                db_campaign.banner_gcs_url = new_url
                db_campaign.blog_hero_status = "completed"
            elif image_type == "editorial":
                new_bytes = run_imagen("4:3", 1280, 896, "Inline Editorial Image")
                storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/editorial_raw.png", new_bytes, "image/png")
                new_url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/editorial.png", new_bytes, "image/png")
                db_campaign.editorial_gcs_url = new_url
                db_campaign.editorial_status = "completed"
            elif image_type == "slide_background":
                new_bytes = run_imagen("16:9", 1408, 768, "PowerPoint Widescreen Background")
                storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/slide_background_raw.png", new_bytes, "image/png")
                new_url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/slide_background.png", new_bytes, "image/png")
                db_campaign.slide_background_gcs_url = new_url
                db_campaign.slide_background_status = "completed"
            elif image_type == "content_card":
                new_bytes = run_imagen("1:1", 1024, 1024, "Grid/Column Content Card")
                storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/content_card_raw.png", new_bytes, "image/png")
                new_url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/content_card.png", new_bytes, "image/png")
                db_campaign.content_card_gcs_url = new_url
                db_campaign.content_card_status = "completed"
                
            await session.commit()
            return {"image_url": new_url}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed regenerating asset of type {image_type} for campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str):
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
                
            # Delete files from GCS
            storage_broker = StorageBroker()
            for url in [
                db_campaign.blog_hero_gcs_url, db_campaign.editorial_gcs_url,
                db_campaign.slide_background_gcs_url, db_campaign.content_card_gcs_url,
                db_campaign.blog_post_gcs_url, db_campaign.press_release_gcs_url,
                db_campaign.longform_gcs_url, db_campaign.banner_gcs_url, db_campaign.gcs_url
            ]:
                if url:
                    try:
                        storage_broker.delete_artifact(url)
                        if url.endswith(".png"):
                            storage_broker.delete_artifact(url.replace(".png", "_raw.png"))
                    except Exception as e:
                        logger.error(f"Failed deleting GCS artifact {url} during campaign deletion: {e}")
                        
            # Delete from DB
            await session.delete(db_campaign)
            await session.commit()
            return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed deleting campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class LogoOverlayRequest(BaseModel):
    image_type: str
    position: str

@app.post("/api/v1/campaigns/{campaign_id}/overlay-logo")
async def overlay_campaign_logo(campaign_id: str, request_data: LogoOverlayRequest):
    image_type = request_data.image_type
    position = request_data.position
    
    if image_type not in ["blog_hero", "editorial", "slide_background", "content_card"]:
        raise HTTPException(status_code=400, detail="Invalid image_type.")
        
    if position not in ["top_left", "top_right", "bottom_left", "bottom_right"]:
        raise HTTPException(status_code=400, detail="Invalid position. Must be top_left, top_right, bottom_left, or bottom_right.")
        
    try:
        async with SessionLocalAsync() as session:
            # 1. Fetch Campaign
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
                
            # 2. Fetch Brand Governance Logo URL
            gov_res = await session.execute(
                select(BrandGovernanceConstraint).where(BrandGovernanceConstraint.id == 1)
            )
            gov = gov_res.scalars().first()
            if not gov or not gov.logo_gcs_url:
                raise HTTPException(status_code=400, detail="Brand logo is not configured in Settings.")
            logo_url = gov.logo_gcs_url
            company_name = getattr(gov, "company_name", "FleetVid")
            
            # 3. Resolve Image GCS URL
            image_url = None
            if image_type == "blog_hero":
                image_url = db_campaign.blog_hero_gcs_url
            elif image_type == "editorial":
                image_url = db_campaign.editorial_gcs_url
            elif image_type == "slide_background":
                image_url = db_campaign.slide_background_gcs_url
            elif image_type == "content_card":
                image_url = db_campaign.content_card_gcs_url
                
            if not image_url:
                raise HTTPException(status_code=400, detail=f"Image of type '{image_type}' has not been generated yet.")
                
            # 4. Download main image and logo
            storage_broker = StorageBroker()
            # Try to fetch the true raw copy first to avoid accumulating multiple logos
            raw_url = image_url.replace(".png", "_raw.png") if image_url.endswith(".png") else image_url
            main_image_bytes = storage_broker.download_binary_artifact(raw_url)
            if not main_image_bytes:
                logger.warning(f"Raw image {raw_url} not found. Falling back to active display image {image_url}")
                main_image_bytes = storage_broker.download_binary_artifact(image_url)
                
            logo_bytes = storage_broker.download_binary_artifact(logo_url)
            
            if not main_image_bytes:
                raise HTTPException(status_code=400, detail="Could not read the main image from storage.")
            if not logo_bytes:
                raise HTTPException(status_code=400, detail="Could not read the brand logo image from storage.")
                
            # 5. Perform PIL overlay
            from PIL import Image
            import io
            
            # Open images
            main_img = Image.open(io.BytesIO(main_image_bytes)).convert("RGBA")
            logo_img = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")
            
            main_w, main_h = main_img.size
            
            # Scale logo: Let's make the logo width equal to 12% of the main image width
            target_width = int(main_w * 0.12)
            # Maintain aspect ratio
            logo_w, logo_h = logo_img.size
            target_height = int((target_width / logo_w) * logo_h)
            
            # Prevent logo from being too tiny or too huge
            target_width = max(60, min(target_width, 300))
            target_height = int((target_width / logo_w) * logo_h)
            
            logo_img_resized = logo_img.resize((target_width, target_height), Image.Resampling.LANCZOS)
            
            # Calculate coordinates with 3% margin
            margin_x = int(main_w * 0.03)
            margin_y = int(main_h * 0.03)
            
            if position == "top_left":
                x = margin_x
                y = margin_y
            elif position == "top_right":
                x = main_w - target_width - margin_x
                y = margin_y
            elif position == "bottom_left":
                x = margin_x
                y = main_h - target_height - margin_y
            else: # bottom_right
                x = main_w - target_width - margin_x
                y = main_h - target_height - margin_y
                
            # Paste the logo with its alpha channel as a mask for perfect transparency support
            canvas = Image.new("RGBA", main_img.size)
            canvas.paste(main_img, (0, 0))
            canvas.paste(logo_img_resized, (x, y), mask=logo_img_resized)
            
            # Save back to PNG bytes
            out_buf = io.BytesIO()
            canvas.save(out_buf, format="PNG")
            new_image_bytes = out_buf.getvalue()
            
            # 6. Upload back to GCS (overwriting)
            prefix = f"https://storage.googleapis.com/{storage_broker.bucket_name}/"
            file_path = image_url.replace(prefix, "") if image_url.startswith(prefix) else f"campaigns/{campaign_id}/{image_type}.png"
            
            if image_url.startswith("file://"):
                file_path = image_url.replace("file://", "")
                
            new_url = storage_broker.upload_binary_artifact(file_path, new_image_bytes, "image/png")
            
            # Update DB GCS URLs (force png extension in database)
            if image_type == "blog_hero":
                db_campaign.blog_hero_gcs_url = new_url
                db_campaign.banner_gcs_url = new_url
            elif image_type == "editorial":
                db_campaign.editorial_gcs_url = new_url
            elif image_type == "slide_background":
                db_campaign.slide_background_gcs_url = new_url
            elif image_type == "content_card":
                db_campaign.content_card_gcs_url = new_url
                
            await session.commit()
            return {"image_url": new_url}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to overlay logo on campaign {campaign_id} image {image_type}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to overlay logo: {str(e)}")

@app.post("/api/v1/campaigns/{campaign_id}/regenerate-text")
async def regenerate_campaign_text(campaign_id: str, request_data: TextRegenerateRequest):
    text_type = request_data.text_type
    if text_type not in ["blog_post", "press_release", "longform"]:
        raise HTTPException(status_code=400, detail="Invalid text_type.")
        
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
                
            gov_res = await session.execute(
                select(BrandGovernanceConstraint).where(BrandGovernanceConstraint.id == 1)
            )
            gov = gov_res.scalars().first()
            
            system_prompt_override = gov.system_prompt_override if gov else ""
            blacklist = []
            try:
                from app.models import Blacklist as DBBlacklist
                words_res = await session.execute(select(DBBlacklist))
                blacklist = [w.forbidden_word for w in words_res.scalars().all()]
            except Exception as db_err:
                logger.error(f"Failed to query blacklist: {db_err}")
                
            def _load_prompt(filename: str) -> str:
                prompt_path = os.path.join(os.path.dirname(__file__), "prompts", filename)
                try:
                    with open(prompt_path, "r", encoding="utf-8") as f:
                        return f.read()
                except Exception as e:
                    logger.error(f"Failed to load prompt {filename}: {e}")
                    return ""
                    
            format_instructions = ""
            if text_type == "blog_post":
                format_instructions = _load_prompt("blog_post.txt")
            elif text_type == "press_release":
                format_instructions = _load_prompt("press_release.txt")
            elif text_type == "longform":
                format_instructions = _load_prompt("longform.txt")
                
            # Query brand governance company name
            company_name = getattr(gov, "company_name", "FleetVid") if gov else "FleetVid"

            # Format the template with the dynamic company name
            try:
                format_instructions = format_instructions.format(company_name=company_name)
            except Exception as format_err:
                logger.error(f"Failed to format instructions template with company name in main: {format_err}")
                
            subsector = db_campaign.subsector or "Trucking & Local"
            persona = db_campaign.persona or "Fleet Safety Manager"
            stage = db_campaign.stage or "Awareness"
            selected_asset_tags = db_campaign.selected_asset_tags or []
            sanitized_prompt = db_campaign.prompt or ""
            
            # Blacklist redaction
            for word in blacklist:
                if not word:
                    continue
                word_lower = word.lower()
                if word_lower in sanitized_prompt.lower():
                    import re
                    insensitive_word = re.compile(re.escape(word), re.IGNORECASE)
                    sanitized_prompt = insensitive_word.sub("[REDACTED]", sanitized_prompt)
 
            system_instruction = (
                f"Target Subsector/Industry: {subsector}\n"
                f"Target Persona: {persona}\n"
                f"Buyer Journey Stage: {stage}\n"
            )
            if selected_asset_tags:
                system_instruction += f"Selected Brand Asset Tags: {', '.join(selected_asset_tags)}\n"
            system_instruction += "\n"
            
            if system_prompt_override:
                system_instruction += f"{system_prompt_override}\n\n"
                
            system_instruction += (
                f"Generate professional marketing copy aligned with this context. "
                f"Ensure you address the needs of a {persona} working in the {subsector} industry subsector at the {stage} journey stage. "
                f"Do NOT use any of these blacklisted words: {', '.join(blacklist)}.\n\n"
                f"CRITICAL REQUIREMENT: The official company name is '{company_name}'. You MUST use the official company name '{company_name}' in all generated copy. Do NOT invent other company names (such as 'VisionFleet Technologies', 'FleetLogix', etc.).\n\n"
                f"CRITICAL REQUIREMENT: Do NOT generate placeholder text, template indicators, or mock Latin copy like 'lorem ipsum'. "
                f"All generated copy must be complete, realistic, production-ready marketing copy and captions tailored to a fleet management and video telematics company.\n\n"
                f"FORMAT INSTRUCTIONS:\n{format_instructions}\n"
                f"Output format MUST be raw, clean Markdown. Do NOT wrap the output in ```markdown or ``` code block wrappers. Do NOT include any HTML, CSS, or JavaScript code. Begin the content directly."
            )
            
            if request_data.refinement_prompt:
                system_instruction += f"\n\nSpecific Refinement Request from User: {request_data.refinement_prompt}\n"

            storage_broker = StorageBroker()
            
            old_url = None
            if text_type == "blog_post":
                old_url = db_campaign.blog_post_gcs_url
            elif text_type == "press_release":
                old_url = db_campaign.press_release_gcs_url
            elif text_type == "longform":
                old_url = db_campaign.longform_gcs_url

            existing_content = ""
            if old_url:
                try:
                    existing_content = storage_broker.download_text_artifact(old_url)
                except Exception as read_err:
                    logger.error(f"Failed to download previous artifact content: {read_err}")

            contents = f"Write the complete marketing piece (e.g. Blog Post, Press Release, or Long-form Editorial Copy) for the topic/theme: '{sanitized_prompt}'. Do NOT output slogans unless explicitly requested. Follow the format instructions."
            if existing_content and request_data.refinement_prompt:
                contents = (
                    f"Here is the current version of the content:\n"
                    f"=========================================\n"
                    f"{existing_content}\n"
                    f"=========================================\n\n"
                    f"The user has requested the following refinement:\n"
                    f"Refinement Request: {request_data.refinement_prompt}\n\n"
                    f"CRITICAL DIRECTIVE: You must ONLY refine the current version to satisfy the refinement request. "
                    f"Do NOT replace the content with a completely new structure or topic. "
                    f"Retain the formatting, structural constraints, and all existing information, making only local edits "
                    f"necessary to fulfill the refinement request. Output the complete refined marketing copy in raw Markdown (no code blocks)."
                )

            try:
                from google import genai
                from google.genai import types as genai_types
                client = get_genai_client()
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=contents,
                    config=genai_types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.7
                    )
                )
                content = response.text
            except Exception as e:
                logger.warning(f"Failed to use Gemini model gateway via GenAI SDK: {e}. Falling back to mock.")
                content = f"## [Mock Content]\n\n{format_instructions}\n\nTopic: {sanitized_prompt}"
                if request_data.refinement_prompt:
                    content += f"\n\nRefined with: {request_data.refinement_prompt}"

            if old_url:
                storage_broker.delete_artifact(old_url)
                
            filename = f"campaigns/{campaign_id}/{text_type}.txt"
            new_url = storage_broker.upload_text_artifact(filename, content)
            
            if text_type == "blog_post":
                db_campaign.blog_post_gcs_url = new_url
                db_campaign.blog_post_status = "completed"
            elif text_type == "press_release":
                db_campaign.press_release_gcs_url = new_url
                db_campaign.press_release_status = "completed"
            elif text_type == "longform":
                db_campaign.longform_gcs_url = new_url
                db_campaign.longform_status = "completed"
                
            await session.commit()
            return {"content": content, "url": new_url}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed regenerating text for campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/campaigns/{campaign_id}/finalize")
async def finalize_campaign(campaign_id: str):
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
                
            db_campaign.stage_status = "Generated"
            await session.commit()
            return {"status": "success", "stage_status": "Generated"}
    except Exception as e:
        logger.error(f"Failed to finalize campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/campaigns/{campaign_id}/generate-documents")
async def generate_campaign_documents(campaign_id: str):
    """
    Generates a Word DOCX and a PowerPoint PPTX for the campaign.
    Both files are uploaded to GCS and the campaign is marked as Generated.
    Returns the GCS URLs for both files.
    """
    import asyncio
    from fastapi.responses import JSONResponse
    from app.document_generator import generate_docx, generate_pptx

    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")

            gov_res = await session.execute(
                select(BrandGovernanceConstraint).where(BrandGovernanceConstraint.id == 1)
            )
            gov = gov_res.scalars().first()

            company_name = getattr(gov, 'company_name', 'FleetVid') if gov else 'FleetVid'
            logo_url = getattr(gov, 'logo_gcs_url', None) if gov else None
            master_pillars = getattr(gov, 'master_pillars', []) if gov else []

            # Mark documents as generating
            db_campaign.docx_status = "generating"
            db_campaign.pptx_status = "generating"
            await session.commit()

        # Download all text artifacts from GCS
        storage_broker = StorageBroker()
        blog_post_md   = storage_broker.download_text_artifact(db_campaign.blog_post_gcs_url or "") or ""
        press_release_md = storage_broker.download_text_artifact(db_campaign.press_release_gcs_url or "") or ""
        longform_md    = storage_broker.download_text_artifact(db_campaign.longform_gcs_url or "") or ""

        # Generate DOCX
        logger.info(f"Generating DOCX for campaign {campaign_id}...")
        docx_bytes = await asyncio.get_event_loop().run_in_executor(None, lambda: generate_docx(
            campaign_name=db_campaign.name,
            company_name=company_name,
            logo_url=logo_url,
            blog_post_md=blog_post_md,
            press_release_md=press_release_md,
            longform_md=longform_md,
            blog_hero_url=db_campaign.blog_hero_gcs_url,
            editorial_url=db_campaign.editorial_gcs_url,
            slide_background_url=db_campaign.slide_background_gcs_url,
            content_card_url=db_campaign.content_card_gcs_url,
        ))
        docx_gcs_path = f"campaigns/{campaign_id}/campaign_package.docx"
        docx_url = storage_broker.upload_binary_artifact(
            docx_gcs_path, docx_bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        logger.info(f"DOCX uploaded to {docx_url}")

        # Generate PPTX
        logger.info(f"Generating PPTX for campaign {campaign_id}...")
        pptx_bytes = await asyncio.get_event_loop().run_in_executor(None, lambda: generate_pptx(
            campaign_name=db_campaign.name,
            company_name=company_name,
            logo_url=logo_url,
            slide_bg_url=db_campaign.slide_background_gcs_url,
            blog_hero_url=db_campaign.blog_hero_gcs_url,
            editorial_url=db_campaign.editorial_gcs_url,
            content_card_url=db_campaign.content_card_gcs_url,
            blog_post_md=blog_post_md,
            press_release_md=press_release_md,
            master_pillars=master_pillars,
        ))
        pptx_gcs_path = f"campaigns/{campaign_id}/campaign_deck.pptx"
        pptx_url = storage_broker.upload_binary_artifact(
            pptx_gcs_path, pptx_bytes,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        )
        logger.info(f"PPTX uploaded to {pptx_url}")

        # Update DB with URLs, statuses, and mark as Generated
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if db_campaign:
                db_campaign.docx_gcs_url = docx_url
                db_campaign.pptx_gcs_url = pptx_url
                db_campaign.docx_status  = "completed"
                db_campaign.pptx_status  = "completed"
                db_campaign.stage_status = "Generated"
                await session.commit()

        return {
            "docx_url": docx_url,
            "pptx_url": pptx_url,
            "stage_status": "Generated",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate documents for campaign {campaign_id}: {e}")
        # Mark as failed
        try:
            async with SessionLocalAsync() as session:
                result = await session.execute(
                    select(Campaign).where(Campaign.campaign_id == campaign_id)
                )
                db_c = result.scalars().first()
                if db_c:
                    db_c.docx_status = "failed"
                    db_c.pptx_status = "failed"
                    await session.commit()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Document generation failed: {str(e)}")

@app.websocket("/api/v1/ws/{campaign_id}")
async def websocket_endpoint(websocket: WebSocket, campaign_id: str):
    await websocket.accept()
    logger.info(f"WebSocket client connected for campaign: {campaign_id}")
    
    last_payload = {}
    try:
        while True:
            async with SessionLocalAsync() as session:
                result = await session.execute(
                    select(Campaign).where(Campaign.campaign_id == campaign_id)
                )
                db_campaign = result.scalars().first()
                
                if not db_campaign:
                    await asyncio.sleep(0.5)
                    continue
                
                current_payload = {
                    "campaign_id": db_campaign.campaign_id,
                    "name": db_campaign.name,
                    "stage_status": db_campaign.stage_status,
                    "status": db_campaign.status,
                    "content": db_campaign.content,
                    "gcs_url": db_campaign.gcs_url,
                    "banner_gcs_url": db_campaign.banner_gcs_url,
                    "blog_hero_gcs_url": db_campaign.blog_hero_gcs_url,
                    "editorial_gcs_url": db_campaign.editorial_gcs_url,
                    "slide_background_gcs_url": db_campaign.slide_background_gcs_url,
                    "content_card_gcs_url": db_campaign.content_card_gcs_url,
                    "blog_post_gcs_url": db_campaign.blog_post_gcs_url,
                    "press_release_gcs_url": db_campaign.press_release_gcs_url,
                    "longform_gcs_url": db_campaign.longform_gcs_url,
                    "blog_hero_status": db_campaign.blog_hero_status,
                    "editorial_status": db_campaign.editorial_status,
                    "slide_background_status": db_campaign.slide_background_status,
                    "content_card_status": db_campaign.content_card_status,
                    "blog_post_status": db_campaign.blog_post_status,
                    "press_release_status": db_campaign.press_release_status,
                    "longform_status": db_campaign.longform_status,
                    "error": db_campaign.error,
                    "prompt": db_campaign.prompt,
                    "subsector": db_campaign.subsector,
                    "persona": db_campaign.persona,
                    "stage": db_campaign.stage,
                    "selected_asset_tags": db_campaign.selected_asset_tags
                }
                
                if current_payload != last_payload:
                    await websocket.send_json(current_payload)
                    last_payload = current_payload
                    logger.info(f"Pushed state update via WS for campaign {campaign_id}")
                
                if db_campaign.status in ["completed", "failed"]:
                    break
            
            await asyncio.sleep(1)
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for campaign: {campaign_id}")
    except Exception as ws_err:
        logger.error(f"Error in WebSocket status stream for campaign {campaign_id}: {ws_err}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

# --- Settings & Governance Endpoints ---

@app.get("/api/v1/settings/brand-governance", response_model=BrandGovernanceResponse)
async def get_brand_governance():
    async with SessionLocalAsync() as session:
        result = await session.execute(
            select(BrandGovernanceConstraint).where(BrandGovernanceConstraint.id == 1)
        )
        governance = result.scalars().first()
        if not governance:
            raise HTTPException(status_code=404, detail="Brand governance constraints not found.")
        return governance

@app.put("/api/v1/settings/brand-governance", response_model=BrandGovernanceResponse)
async def update_brand_governance(update_data: BrandGovernanceUpdate):
    async with SessionLocalAsync() as session:
        result = await session.execute(
            select(BrandGovernanceConstraint).where(BrandGovernanceConstraint.id == 1)
        )
        governance = result.scalars().first()
        if not governance:
            raise HTTPException(status_code=404, detail="Brand governance constraints not found.")
        
        # Build prompt override
        override_text = build_system_prompt_override(
            update_data.primary_colors,
            update_data.secondary_colors,
            update_data.allowed_heading_fonts,
            update_data.allowed_body_fonts,
            update_data.contrast_enforcement_enabled,
            governance.logo_gcs_url,
            update_data.company_vertical,
            update_data.global_tone,
            update_data.master_pillars,
            update_data.guardrails,
            update_data.cta_library,
            update_data.company_name
        )
        
        governance.company_name = update_data.company_name
        governance.primary_colors = update_data.primary_colors
        governance.secondary_colors = update_data.secondary_colors
        governance.allowed_heading_fonts = update_data.allowed_heading_fonts
        governance.allowed_body_fonts = update_data.allowed_body_fonts
        governance.contrast_enforcement_enabled = update_data.contrast_enforcement_enabled
        governance.system_prompt_override = override_text
        
        # Brand Voice attributes
        governance.company_vertical = update_data.company_vertical
        governance.global_tone = update_data.global_tone
        governance.master_pillars = update_data.master_pillars
        governance.guardrails = update_data.guardrails
        governance.cta_library = update_data.cta_library
        
        await session.commit()
        await session.refresh(governance)
        return governance
 
@app.post("/api/v1/settings/brand-governance/logo")
async def upload_brand_logo(file: UploadFile = File(...)):
    logo_data = await file.read()
    
    timestamp = int(time.time())
    file_ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    file_path = f"brand_governance/logo_{timestamp}.{file_ext}"
    
    storage_broker = StorageBroker()
    logo_url = storage_broker.upload_binary_artifact(file_path, logo_data, file.content_type or "image/png")
    
    async with SessionLocalAsync() as session:
        result = await session.execute(
            select(BrandGovernanceConstraint).where(BrandGovernanceConstraint.id == 1)
        )
        governance = result.scalars().first()
        if not governance:
            raise HTTPException(status_code=404, detail="Brand governance constraints not found.")
            
        governance.logo_gcs_url = logo_url
        company_name = getattr(governance, "company_name", "FleetVid")
        
        override_text = build_system_prompt_override(
            governance.primary_colors,
            governance.secondary_colors,
            governance.allowed_heading_fonts,
            governance.allowed_body_fonts,
            governance.contrast_enforcement_enabled,
            logo_url,
            governance.company_vertical,
            governance.global_tone,
            governance.master_pillars,
            governance.guardrails,
            governance.cta_library,
            company_name
        )
        governance.system_prompt_override = override_text
        
        await session.commit()
        await session.refresh(governance)
        return {"status": "success", "logo_url": logo_url}

@app.get("/api/v1/campaigns/{campaign_id}/artifacts/{artifact_type}")
async def get_text_artifact(campaign_id: str, artifact_type: str):
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found")
                
            url = None
            if artifact_type == "blog_post":
                url = db_campaign.blog_post_gcs_url
            elif artifact_type == "press_release":
                url = db_campaign.press_release_gcs_url
            elif artifact_type == "longform":
                url = db_campaign.longform_gcs_url
                
            if not url:
                return {"content": ""}
                
            storage_broker = StorageBroker()
            content = storage_broker.download_text_artifact(url)
            return {"content": content}
    except Exception as e:
        logger.error(f"Failed to fetch artifact {artifact_type} for campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/v1/campaigns/{campaign_id}/artifacts/{artifact_type}")
async def update_text_artifact(campaign_id: str, artifact_type: str, update_data: TextArtifactUpdate):
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(
                select(Campaign).where(Campaign.campaign_id == campaign_id)
            )
            db_campaign = result.scalars().first()
            if not db_campaign:
                raise HTTPException(status_code=404, detail="Campaign not found")
                
            storage_broker = StorageBroker()
            
            old_url = None
            if artifact_type == "blog_post":
                old_url = db_campaign.blog_post_gcs_url
            elif artifact_type == "press_release":
                old_url = db_campaign.press_release_gcs_url
            elif artifact_type == "longform":
                old_url = db_campaign.longform_gcs_url
                
            if old_url:
                storage_broker.delete_artifact(old_url)
                
            filename = f"campaigns/{campaign_id}/{artifact_type}.txt"
            new_url = storage_broker.upload_text_artifact(filename, update_data.content)
            
            if artifact_type == "blog_post":
                db_campaign.blog_post_gcs_url = new_url
            elif artifact_type == "press_release":
                db_campaign.press_release_gcs_url = new_url
            elif artifact_type == "longform":
                db_campaign.longform_gcs_url = new_url
                
            await session.commit()
            return {"content": update_data.content, "url": new_url}
    except Exception as e:
        logger.error(f"Failed to update artifact {artifact_type} for campaign {campaign_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/settings/blacklist")
async def get_blacklist():
    async with SessionLocalAsync() as session:
        result = await session.execute(select(Blacklist))
        words = result.scalars().all()
        return {"blacklist": [w.forbidden_word for w in words]}

@app.put("/api/v1/settings/blacklist")
async def update_blacklist(update_data: BlacklistUpdate):
    async with SessionLocalAsync() as session:
        await session.execute(delete(Blacklist))
        for word in update_data.blacklist:
            clean_word = word.strip().lower()
            if clean_word:
                session.add(Blacklist(forbidden_word=clean_word))
        await session.commit()
        
        result = await session.execute(select(Blacklist))
        words = result.scalars().all()
        return {"blacklist": [w.forbidden_word for w in words]}

from fastapi import Form
from app.models import Asset
from app.schemas import AssetResponse

@app.get("/api/v1/assets", response_model=List[AssetResponse])
async def list_assets():
    try:
        async with SessionLocalAsync() as session:
            result = await session.execute(select(Asset).order_by(Asset.created_at.desc()))
            return result.scalars().all()
    except Exception as e:
        logger.error(f"Error listing assets: {e}")
        raise HTTPException(status_code=500, detail="Failed to list assets.")

@app.post("/api/v1/assets", response_model=AssetResponse, status_code=201)
async def create_asset(
    name: str = Form(...),
    category: str = Form(...),
    tags_json: str = Form(...),
    file: UploadFile = File(...)
):
    try:
        tags = json.loads(tags_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid tags JSON format.")
        
    try:
        file_data = await file.read()
        timestamp = int(time.time())
        file_path = f"assets/{timestamp}_{file.filename}"
        
        storage_broker = StorageBroker()
        gcs_url = storage_broker.upload_binary_artifact(file_path, file_data, file.content_type or "image/png")
        
        asset_id = str(uuid.uuid4())
        db_asset = Asset(
            asset_id=asset_id,
            name=name,
            category=category,
            tags=tags,
            gcs_url=gcs_url
        )
        
        async with SessionLocalAsync() as session:
            session.add(db_asset)
            await session.commit()
            
            res = await session.execute(select(Asset).where(Asset.asset_id == asset_id))
            fresh_asset = res.scalars().first()
            return fresh_asset
    except Exception as e:
        logger.error(f"Error creating asset: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/assets/{asset_id}")
async def delete_asset(asset_id: str):
    try:
        async with SessionLocalAsync() as session:
            res = await session.execute(select(Asset).where(Asset.asset_id == asset_id))
            asset = res.scalars().first()
            if not asset:
                raise HTTPException(status_code=404, detail="Asset not found.")
                
            await session.delete(asset)
            await session.commit()
            return {"status": "success", "message": f"Asset {asset_id} deleted."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting asset {asset_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete asset.")

from app.schemas import AssetUpdate

@app.put("/api/v1/assets/{asset_id}", response_model=AssetResponse)
async def update_asset(asset_id: str, update_data: AssetUpdate):
    try:
        async with SessionLocalAsync() as session:
            res = await session.execute(select(Asset).where(Asset.asset_id == asset_id))
            asset = res.scalars().first()
            if not asset:
                raise HTTPException(status_code=404, detail="Asset not found.")
                
            asset.name = update_data.name
            asset.category = update_data.category
            asset.tags = update_data.tags
            
            await session.commit()
            await session.refresh(asset)
            return asset
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating asset {asset_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update asset.")
