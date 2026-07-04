import os
import json
import logging
from typing import TypedDict, List, Optional
from langgraph.graph import StateGraph, END
from app.database import SessionLocalSync
from app.models import Asset, BrandGovernanceConstraint

# New google-genai SDK (replaces deprecated vertexai.preview.vision_models)
from google import genai
from google.genai import types as genai_types

logger = logging.getLogger("agent")
logging.basicConfig(level=logging.INFO)


def get_genai_client() -> genai.Client:
    """
    Get a genai.Client initialized for Vertex AI.
    Tries the modern default constructor (which works on GCP Cloud Run using local metadata),
    and falls back to explicit project/location environment variables for local Docker setups.
    """
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

# Define State
class AgentState(TypedDict):
    campaign_id: str
    prompt: str
    brand_voice_profile: str
    system_directive: str
    blacklist: List[str]
    subsector: str
    persona: str
    stage: str
    selected_asset_tags: List[str]
    system_prompt_override: Optional[str]
    logo_gcs_url: Optional[str]
    sanitized_prompt: str
    marketing_captions: Optional[List[str]]
    
    # Outputs
    blog_post_content: Optional[str]
    press_release_content: Optional[str]
    longform_content: Optional[str]
    
    blog_hero_bytes: Optional[bytes]
    editorial_bytes: Optional[bytes]
    slide_background_bytes: Optional[bytes]
    content_card_bytes: Optional[bytes]
    
    error: Optional[str]

# Node 1: Programmatic Sanitization Check
def sanitize_input_node(state: AgentState) -> dict:
    logger.info("Executing sanitize_input_node...")
    prompt = state.get("prompt", "")
    blacklist = state.get("blacklist", [])
    
    sanitized_prompt = prompt
    violations = []
    
    for word in blacklist:
        if not word.strip():
            continue
        word_lower = word.lower()
        if word_lower in sanitized_prompt.lower():
            violations.append(word)
            import re
            insensitive_word = re.compile(re.escape(word), re.IGNORECASE)
            sanitized_prompt = insensitive_word.sub("[REDACTED]", sanitized_prompt)
            
    logger.info(f"Sanitization complete. Violations detected: {violations}")
    return {"sanitized_prompt": sanitized_prompt}


# ----------------- TEXT GENERATION NODES -----------------

def _generate_text(state: AgentState, format_instructions: str) -> str:
    subsector = state.get("subsector", "Trucking & Local")
    persona = state.get("persona", "Fleet Safety Manager")
    stage = state.get("stage", "Awareness")
    selected_asset_tags = state.get("selected_asset_tags", [])
    # Fallback: if sanitized_prompt is empty, use raw prompt (can happen on state init edge cases)
    sanitized_prompt = state.get("sanitized_prompt") or state.get("prompt", "fleet management video telematics campaign")
    blacklist = state.get("blacklist", [])
    system_prompt_override = state.get("system_prompt_override") or ""
    
    # Query brand governance company name
    company_name = "FleetVid"
    try:
        with SessionLocalSync() as session:
            gov = session.query(BrandGovernanceConstraint).filter(BrandGovernanceConstraint.id == 1).first()
            if gov:
                company_name = getattr(gov, "company_name", "FleetVid")
    except Exception as e:
        logger.error(f"Failed to query governance for company name in agent copy generator: {e}")

    # Format the template with the dynamic company name
    try:
        format_instructions = format_instructions.format(company_name=company_name)
    except Exception as format_err:
        logger.error(f"Failed to format instructions template with company name: {format_err}")
        
    brand_assets_clause = f"Selected Brand Asset Tags: {', '.join(selected_asset_tags)}\n" if selected_asset_tags else ""
    override_clause = f"{system_prompt_override}\n\n" if system_prompt_override else ""
    
    system_instruction_template = _load_prompt("text_generation_system.txt")
    system_instruction = system_instruction_template.format(
        subsector=subsector,
        persona=persona,
        stage=stage,
        brand_assets_clause=brand_assets_clause,
        override_clause=override_clause,
        blacklist=', '.join(blacklist),
        company_name=company_name,
        format_instructions=format_instructions
    )
    
    try:
        client = get_genai_client()
        generation_prompt_template = _load_prompt("text_generation_prompt.txt")
        generation_prompt = generation_prompt_template.format(sanitized_prompt=sanitized_prompt)
        
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=generation_prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
                thinking_config=genai_types.ThinkingConfig(
                    thinking_level="MEDIUM"
                )
            )
        )
        return response.text
    except Exception as e:
        logger.warning(f"Failed to use Gemini model gateway via GenAI SDK: {e}. Falling back to mock.")
        mock_fallback = _load_prompt("mock_text_fallback.txt")
        return mock_fallback

def _load_prompt(filename: str) -> str:
    prompt_path = os.path.join(os.path.dirname(__file__), "prompts", filename)
    try:
        with open(prompt_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        logger.error(f"Failed to load prompt {filename}: {e}")
        return ""

def generate_blog_post_node(state: AgentState) -> dict:
    logger.info("Executing generate_blog_post_node...")
    format_instructions = _load_prompt("blog_post.txt")
    content = _generate_text(state, format_instructions)
    return {"blog_post_content": content}

def generate_press_release_node(state: AgentState) -> dict:
    logger.info("Executing generate_press_release_node...")
    format_instructions = _load_prompt("press_release.txt")
    content = _generate_text(state, format_instructions)
    return {"press_release_content": content}

def generate_longform_node(state: AgentState) -> dict:
    logger.info("Executing generate_longform_node...")
    format_instructions = _load_prompt("longform.txt")
    content = _generate_text(state, format_instructions)
    return {"longform_content": content}

# Node 1.5: Generate Pre-Approved Slogans/Captions
def generate_captions_node(state: AgentState) -> dict:
    logger.info("Executing generate_captions_node...")
    subsector = state.get("subsector", "Trucking & Local")
    persona = state.get("persona", "Fleet Safety Manager")
    stage = state.get("stage", "Awareness")
    sanitized_prompt = state.get("sanitized_prompt", "")
    
    try:
        system_instruction_template = _load_prompt("generate_captions.txt")
        system_instruction = system_instruction_template.format(
            subsector=subsector,
            persona=persona,
            stage=stage,
            sanitized_prompt=sanitized_prompt
        )
        
        client = get_genai_client()
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents="Generate the captions JSON array.",
            config=genai_types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
                response_mime_type="application/json",
                thinking_config=genai_types.ThinkingConfig(
                    thinking_level="MEDIUM"
                )
            )
        )
        captions = json.loads(response.text)
        if isinstance(captions, dict) and "captions" in captions:
            captions = captions["captions"]
        elif not isinstance(captions, list):
            captions = []
            
        logger.info(f"Generated pre-approved captions: {captions}")
        return {"marketing_captions": captions}
    except Exception as e:
        logger.warning(f"Failed to generate captions: {e}. Falling back to default list.")
        default_captions = [
            "Empower Your Fleet",
            "Safety in Motion",
            "Smart Video Telematics",
            "Drive Efficiency, Protect Drivers",
            "Proactive Driver Coaching",
            "Real-Time Insights, True Protection"
        ]
        return {"marketing_captions": default_captions}

# ----------------- IMAGE GENERATION NODES -----------------

def _generate_image(state: AgentState, aspect_ratio: str, width: int, height: int, mock_label: str, image_type: str = "blog_hero") -> bytes | None:
    subsector = state.get("subsector", "Trucking & Local")
    persona = state.get("persona", "Fleet Safety Manager")
    prompt_topic = state.get("sanitized_prompt", "")
    campaign_tags = state.get("selected_asset_tags", [])
    captions = state.get("marketing_captions") or []
    
    matched_assets = []
    brand_colors_str = "corporate brand colors"
    try:
        with SessionLocalSync() as session:
            gov = session.query(BrandGovernanceConstraint).filter(BrandGovernanceConstraint.id == 1).first()
            if gov:
                # Omit raw hex codes in the prompt to prevent Imagen from writing them as text
                colors = [c for c in (gov.primary_colors or []) + (gov.secondary_colors or []) if not c.startswith("#")]
                if colors:
                    brand_colors_str = f"brand colors: {', '.join(colors)}"
                else:
                    brand_colors_str = "brand colors"
                brand_fonts_str = f"Heading fonts: {', '.join(gov.allowed_heading_fonts or [])}. Body fonts: {', '.join(gov.allowed_body_fonts or [])}."
                logo_gcs_url = gov.logo_gcs_url or ""
                company_name = getattr(gov, "company_name", "FleetVid")
            
            if campaign_tags:
                all_assets = session.query(Asset).all()
                for asset in all_assets:
                    asset_tags = asset.tags or []
                    if any(tag in campaign_tags for tag in asset_tags):
                        matched_assets.append(asset)
    except Exception as db_err:
        logger.error(f"Failed to query brand assets or guidelines in agent: {db_err}")
        
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
    
    # Assign unique slogans to each image type from the generated list
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
    
    # Load scene description from separate template file
    filename = f"image_{image_type}.txt"
    scene_template = _load_prompt(filename)
    scene = scene_template.format(
        prompt_topic=prompt_topic,
        persona=persona,
        subsector=subsector
    )
    
    caption_clause = ""
    if caption_text:
        caption_clause = (
            f" The image must display the text '{caption_text}' clearly visible on a signboard, screen, or vehicle."
        )

    # Instruct Imagen to avoid generating any brand logos or symbols to prevent mismatching and messy random logo generations.
    logo_clause = " CRITICAL REQUIREMENT: Do NOT generate or paint any brand logos, corporate symbols, or emblem graphics on the vehicles, screens, or layout overlays. Keep all surfaces clean and free of branding graphics."
    company_clause = f" It is acceptable to display the company name '{company_name}' in simple black typographic lettering on signboards, vehicles, or screens in the scene."

    base_rules_template = _load_prompt("image_base_rules.txt")
    base_rules = base_rules_template.format(brand_colors_str=brand_colors_str)

    base_prompt = f"{scene}{caption_clause}{logo_clause}{company_clause}\n{base_rules}"
    if composition_details:
        base_prompt += f"\nReference assets to incorporate: {composition_details}"

        
    logger.info(f"Generating image [{image_type}] with prompt: {base_prompt[:300]}...")
    
    try:
        client = get_genai_client()
        
        import time
        max_retries = 3
        response = None
        
        for attempt in range(max_retries):
            try:
                response = client.models.generate_images(
                    model="imagen-4.0-generate-001",
                    prompt=base_prompt,
                    config=genai_types.GenerateImagesConfig(
                        number_of_images=1,
                        aspect_ratio=aspect_ratio,
                        guidance_scale=15.0,
                        output_mime_type="image/png",
                        person_generation="DONT_ALLOW",
                        safety_filter_level="block_medium_and_above"
                    )
                )
                break
            except Exception as retry_e:
                if "429" in str(retry_e) and attempt < max_retries - 1:
                    logger.warning(f"Quota exceeded for Imagen. Retrying in {2 ** attempt} seconds...")
                    time.sleep(2 ** attempt)
                else:
                    raise retry_e

        # Extract PNG bytes from the response
        img_data = response.generated_images[0]
        image_bytes = img_data.image.image_bytes
        if not image_bytes:
            logger.warning(f"No image bytes returned for {mock_label} (possibly filtered by safety filters).")
            return None
        logger.info(f"Successfully generated Imagen image for {mock_label}, size={len(image_bytes)} bytes")
        return image_bytes
    except Exception as e:
        logger.exception(f"Vertex AI Imagen call failed for {mock_label}: {e}. Returning None to signal failure.")
        return None


def generate_blog_hero_node(state: AgentState) -> dict:
    logger.info("Executing generate_blog_hero_node...")
    img_bytes = _generate_image(state, "16:9", 1408, 768, "Blog/PR Hero Image", image_type="blog_hero")
    return {"blog_hero_bytes": img_bytes}

def generate_editorial_node(state: AgentState) -> dict:
    logger.info("Executing generate_editorial_node...")
    import time
    time.sleep(4)  # Stagger to avoid Imagen quota exhaustion
    img_bytes = _generate_image(state, "4:3", 1280, 896, "Inline Editorial Image", image_type="editorial")
    return {"editorial_bytes": img_bytes}

def generate_slide_background_node(state: AgentState) -> dict:
    logger.info("Executing generate_slide_background_node...")
    import time
    time.sleep(4)  # Stagger to avoid Imagen quota exhaustion
    img_bytes = _generate_image(state, "16:9", 1408, 768, "PowerPoint Widescreen Background", image_type="slide_background")
    return {"slide_background_bytes": img_bytes}

def generate_content_card_node(state: AgentState) -> dict:
    logger.info("Executing generate_content_card_node...")
    import time
    time.sleep(4)  # Stagger to avoid Imagen quota exhaustion
    img_bytes = _generate_image(state, "1:1", 1024, 1024, "Grid/Column Content Card", image_type="content_card")
    return {"content_card_bytes": img_bytes}

# Assemble LangGraph Workflow
def build_agent_graph():
    workflow = StateGraph(AgentState)
    
    # Add Nodes
    workflow.add_node("sanitize_input", sanitize_input_node)
    workflow.add_node("generate_captions", generate_captions_node)
    workflow.add_node("generate_blog_post", generate_blog_post_node)
    workflow.add_node("generate_press_release", generate_press_release_node)
    workflow.add_node("generate_longform", generate_longform_node)
    
    workflow.add_node("generate_blog_hero", generate_blog_hero_node)
    workflow.add_node("generate_editorial", generate_editorial_node)
    workflow.add_node("generate_slide_background", generate_slide_background_node)
    workflow.add_node("generate_content_card", generate_content_card_node)
    
    # Add Edges
    workflow.set_entry_point("sanitize_input")
    workflow.add_edge("sanitize_input", "generate_captions")
    
    # Fan out from captions to all TEXT generators in parallel
    workflow.add_edge("generate_captions", "generate_blog_post")
    workflow.add_edge("generate_captions", "generate_press_release")
    workflow.add_edge("generate_captions", "generate_longform")
    
    # Image generators run SEQUENTIALLY to avoid Imagen quota exhaustion
    # captions -> blog_hero -> editorial -> slide_background -> content_card -> END
    workflow.add_edge("generate_captions", "generate_blog_hero")
    workflow.add_edge("generate_blog_hero", "generate_editorial")
    workflow.add_edge("generate_editorial", "generate_slide_background")
    workflow.add_edge("generate_slide_background", "generate_content_card")
    
    # Fan in to END
    workflow.add_edge("generate_blog_post", END)
    workflow.add_edge("generate_press_release", END)
    workflow.add_edge("generate_longform", END)
    workflow.add_edge("generate_content_card", END)
    
    return workflow.compile()

# Instantiated workflow runner
agent_workflow = build_agent_graph()

def get_agent_workflow():
    return agent_workflow
