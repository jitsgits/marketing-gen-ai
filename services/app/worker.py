import json
import logging
import os
import time
import base64
from typing import Optional
from fastapi import FastAPI, Request, Response, status as http_status, BackgroundTasks
from opentelemetry import trace

from app.pubsub import PubSubBroker
from app.storage import StorageBroker
from app.telemetry import init_telemetry
from app.database import SessionLocalSync
from app.models import Campaign, BrandGovernanceConstraint

logger = logging.getLogger("worker")
logging.basicConfig(level=logging.INFO)

# Initialize OpenTelemetry Tracer
tracer = init_telemetry("marketing-genai-worker")

# Instantiated FastAPI app for push mode
app = FastAPI(title="Campaign Launch Agent Worker")

def update_campaign_status(
    campaign_id: str,
    status_str: str,
    content: Optional[str] = None,
    gcs_url: Optional[str] = None,
    error_str: Optional[str] = None
):
    """Utility to synchronously update Campaign status in PostgreSQL database."""
    try:
        with SessionLocalSync() as session:
            db_campaign = session.query(Campaign).filter(Campaign.campaign_id == campaign_id).first()
            if db_campaign:
                db_campaign.status = status_str
                if content is not None:
                    db_campaign.content = content
                if gcs_url is not None:
                    db_campaign.gcs_url = gcs_url
                if error_str is not None:
                    db_campaign.error = error_str
                session.commit()
                logger.info(f"Successfully updated database for campaign {campaign_id} to status '{status_str}'.")
            else:
                logger.warning(f"Campaign {campaign_id} not found in database to update status to '{status_str}'.")
    except Exception as db_err:
        logger.error(f"Database update failed for campaign {campaign_id}: {db_err}")

def process_message_callback(message):
    logger.info("Received message from requests subscription.")
    with tracer.start_as_current_span("worker_process_message") as span:
        storage_broker = StorageBroker()
        
        try:
            # Decode and parse payload
            payload = json.loads(message.data.decode("utf-8"))
            logger.info(f"Request payload parsed: {payload}")
            
            campaign_id = payload.get("campaign_id")
            prompt = payload.get("prompt")
            personalization = payload.get("personalization_matrix", {})
            selected_asset_tags = payload.get("selected_asset_tags", [])
            
            span.set_attribute("campaign_id", str(campaign_id) if campaign_id else "None")
            span.set_attribute("personalization.subsector", personalization.get("subsector", "None"))
            span.set_attribute("personalization.persona", personalization.get("persona", "None"))
            
            if not campaign_id:
                logger.error("Message missing 'campaign_id'. Acknowledging and skipping.")
                message.ack()
                return
            
            # Update database status to processing
            update_campaign_status(campaign_id, "processing")
            
            # Query Brand Governance and Blacklist constraints from DB
            system_prompt_override = ""
            logo_gcs_url = None
            blacklist = []
            try:
                with SessionLocalSync() as session:
                    gov = session.query(BrandGovernanceConstraint).filter(BrandGovernanceConstraint.id == 1).first()
                    if gov:
                        system_prompt_override = gov.system_prompt_override or ""
                        logo_gcs_url = gov.logo_gcs_url
                    
                    from app.models import Blacklist as DBBlacklist
                    words = session.query(DBBlacklist).all()
                    blacklist = [w.forbidden_word for w in words]
            except Exception as db_err:
                logger.error(f"Failed to query brand constraints or blacklist for campaign {campaign_id}: {db_err}")

            # Run LangGraph pipeline in stream mode
            logger.info(f"Running LangGraph agent pipeline for campaign {campaign_id} in parallel...")
            from app.agent import get_agent_workflow
            agent_workflow = get_agent_workflow()
            
            inputs = {
                "campaign_id": campaign_id,
                "prompt": prompt,
                "brand_voice_profile": "",
                "system_directive": "",
                "blacklist": blacklist,
                "subsector": personalization.get("subsector", "Trucking & Local"),
                "persona": personalization.get("persona", "Fleet Safety Manager"),
                "stage": personalization.get("stage", "Awareness"),
                "selected_asset_tags": selected_asset_tags,
                "system_prompt_override": system_prompt_override,
                "logo_gcs_url": logo_gcs_url
            }
            
            # Helper to update a specific artifact's status and optionally its URL in the database
            def update_artifact_in_db(status_col: str, status_val: str, url_col: str = None, url_val: str = None):
                try:
                    with SessionLocalSync() as session:
                        db_campaign = session.query(Campaign).filter(Campaign.campaign_id == campaign_id).first()
                        if db_campaign:
                            setattr(db_campaign, status_col, status_val)
                            if url_col and url_val:
                                setattr(db_campaign, url_col, url_val)
                                
                            # Check if all 7 artifacts are completed
                            statuses = [
                                db_campaign.blog_post_status, db_campaign.press_release_status, db_campaign.longform_status,
                                db_campaign.blog_hero_status, db_campaign.editorial_status, db_campaign.slide_background_status, db_campaign.content_card_status
                            ]
                            
                            # Publish websocket update (this implicitly notifies UI)
                            session.commit()
                except Exception as e:
                    logger.error(f"Failed to update artifact status {status_col} in DB: {e}")

            # Set all to generating
            for col in ["blog_post_status", "press_release_status", "longform_status", "blog_hero_status", "editorial_status", "slide_background_status", "content_card_status"]:
                update_artifact_in_db(col, "generating")

            for output in agent_workflow.stream(inputs):
                for node_name, state_update in output.items():
                    logger.info(f"Node '{node_name}' finished.")
                    
                    if "marketing_captions" in state_update:
                        try:
                            with SessionLocalSync() as session:
                                db_campaign = session.query(Campaign).filter(Campaign.campaign_id == campaign_id).first()
                                if db_campaign:
                                    db_campaign.content = json.dumps(state_update["marketing_captions"])
                                    session.commit()
                        except Exception as e:
                            logger.error(f"Failed to save marketing captions to DB: {e}")

                    if "blog_post_content" in state_update:
                        url = storage_broker.upload_text_artifact(f"campaigns/{campaign_id}/blog_post.txt", state_update["blog_post_content"])
                        update_artifact_in_db("blog_post_status", "completed", "blog_post_gcs_url", url)
                        
                    if "press_release_content" in state_update:
                        url = storage_broker.upload_text_artifact(f"campaigns/{campaign_id}/press_release.txt", state_update["press_release_content"])
                        update_artifact_in_db("press_release_status", "completed", "press_release_gcs_url", url)
                        
                    if "longform_content" in state_update:
                        url = storage_broker.upload_text_artifact(f"campaigns/{campaign_id}/longform.txt", state_update["longform_content"])
                        update_artifact_in_db("longform_status", "completed", "longform_gcs_url", url)
                        
                    if "blog_hero_bytes" in state_update:
                        img_bytes = state_update["blog_hero_bytes"]
                        if img_bytes:
                            url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/blog_hero.png", img_bytes, "image/png")
                            update_artifact_in_db("blog_hero_status", "completed", "blog_hero_gcs_url", url)
                        else:
                            update_artifact_in_db("blog_hero_status", "failed")
                        
                    if "editorial_bytes" in state_update:
                        img_bytes = state_update["editorial_bytes"]
                        if img_bytes:
                            url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/editorial.png", img_bytes, "image/png")
                            update_artifact_in_db("editorial_status", "completed", "editorial_gcs_url", url)
                        else:
                            update_artifact_in_db("editorial_status", "failed")
                        
                    if "slide_background_bytes" in state_update:
                        img_bytes = state_update["slide_background_bytes"]
                        if img_bytes:
                            url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/slide_background.png", img_bytes, "image/png")
                            update_artifact_in_db("slide_background_status", "completed", "slide_background_gcs_url", url)
                        else:
                            update_artifact_in_db("slide_background_status", "failed")
                        
                    if "content_card_bytes" in state_update:
                        img_bytes = state_update["content_card_bytes"]
                        if img_bytes:
                            url = storage_broker.upload_binary_artifact(f"campaigns/{campaign_id}/content_card.png", img_bytes, "image/png")
                            update_artifact_in_db("content_card_status", "completed", "content_card_gcs_url", url)
                        else:
                            update_artifact_in_db("content_card_status", "failed")

            
            # Check if all completed and set master status to completed
            with SessionLocalSync() as session:
                db_campaign = session.query(Campaign).filter(Campaign.campaign_id == campaign_id).first()
                if db_campaign:
                    statuses = [
                        db_campaign.blog_post_status, db_campaign.press_release_status, db_campaign.longform_status,
                        db_campaign.blog_hero_status, db_campaign.editorial_status, db_campaign.slide_background_status, db_campaign.content_card_status
                    ]
                    # Set master campaign status to completed so that the user can access the canvas and regenerate failed assets.
                    db_campaign.status = "completed"
                    session.commit()
            
            logger.info(f"Campaign {campaign_id} successfully completed graph streaming.")
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            span.record_exception(e)
            if 'campaign_id' in locals() and campaign_id:
                update_campaign_status(campaign_id, "failed", error_str=str(e))
                
        finally:
            # Always acknowledge the message
            message.ack()
            logger.info("Acknowledged requests message.")

@app.post("/")
async def pubsub_push_handler(request: Request, background_tasks: BackgroundTasks):
    """
    Endpoint for Pub/Sub Push Subscription (Production Cloud Run).
    Receives JSON push envelope, decodes data, and executes callback in a background task.
    """
    with tracer.start_as_current_span("pubsub_push_received") as span:
        try:
            envelope = await request.json()
            if not envelope or "message" not in envelope:
                logger.error("Invalid Pub/Sub push envelope format.")
                return Response(status_code=http_status.HTTP_400_BAD_REQUEST, content="Bad Request: Missing message envelope")
                
            pubsub_message = envelope["message"]
            data_b64 = pubsub_message.get("data", "")
            
            if not data_b64:
                logger.error("Pub/Sub message contains no payload data.")
                return Response(status_code=http_status.HTTP_400_BAD_REQUEST, content="Bad Request: Missing data field")
                
            # Decode base64 data
            decoded_data = base64.b64decode(data_b64)
            
            # Create a mock PubSub message class to match the subscriber callback signature
            class PushMessageWrapper:
                def __init__(self, data):
                    self.data = data
                def ack(self):
                    # Auto-acknowledged by returning 200 OK to the push service
                    pass
                    
            # Run worker processing in background to prevent Pub/Sub timeouts and duplicate deliveries
            background_tasks.add_task(process_message_callback, PushMessageWrapper(decoded_data))
            return {"status": "queued"}
            
        except Exception as e:
            logger.error(f"Exception in Pub/Sub push handler: {e}")
            span.record_exception(e)
            return Response(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, content=str(e))

def run_pull_subscriber():
    logger.info("Starting Campaign Launch Agent Worker in PULL mode...")
    pubsub_broker = PubSubBroker()
    
    # Ensure Pub/Sub topics exist before subscribing
    pubsub_broker.ensure_topic("marketing-genai-requests")
    pubsub_broker.ensure_subscription("marketing-genai-requests", "marketing-genai-requests-sub")
    
    # Subscribe to requests queue
    logger.info("Listening for messages on marketing-genai-requests-sub...")
    streaming_future = pubsub_broker.subscribe(
        topic_id="marketing-genai-requests",
        subscription_id="marketing-genai-requests-sub",
        callback=process_message_callback
    )
    
    if streaming_future:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            streaming_future.cancel()
            streaming_future.result()
    else:
        logger.info("[Mock Mode] Active. Waiting for mock requests...")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Stopping worker.")

if __name__ == "__main__":
    mode = os.getenv("WORKER_MODE", "pull").lower()
    if mode == "push":
        import uvicorn
        port = int(os.getenv("PORT", "8000"))
        logger.info(f"Starting Campaign Launch Agent Worker in PUSH mode on port {port}...")
        uvicorn.run("worker:app", host="0.0.0.0", port=port)
    else:
        run_pull_subscriber()
