import json
import logging
import os
from typing import Callable
from google.cloud import pubsub_v1
from google.api_core import exceptions
from google.auth import exceptions as auth_exceptions

logger = logging.getLogger("pubsub")
logging.basicConfig(level=logging.INFO)

def get_project_id() -> str:
    """Helper to retrieve GCP Project ID from env or fallback."""
    project_id = os.getenv("GCP_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project_id:
        # Try importing from googleauth if credentials exist
        try:
            import google.auth
            _, project_id = google.auth.default()
        except Exception:
            project_id = "marketing-genai-local-project"
    return project_id or "marketing-genai-local-project"

class PubSubBroker:
    def __init__(self):
        self.project_id = get_project_id()
        try:
            self.publisher = pubsub_v1.PublisherClient()
            self.subscriber = pubsub_v1.SubscriberClient()
            self.use_mock = False
            logger.info(f"Initialized GCP Pub/Sub client for project {self.project_id}")
        except Exception as e:
            logger.warning(f"GCP credentials not fully resolved. Falling back to local mock Pub/Sub broker. Error: {e}")
            self.use_mock = True
            self.mock_subscriptions = {}
            self.mock_jobs = {}

    def ensure_topic(self, topic_id: str):
        if self.use_mock:
            logger.info(f"[Mock] Ensured topic: {topic_id}")
            return
        
        topic_path = self.publisher.topic_path(self.project_id, topic_id)
        try:
            self.publisher.create_topic(request={"name": topic_path})
            logger.info(f"Created Pub/Sub topic: {topic_id}")
        except exceptions.AlreadyExists:
            logger.info(f"Pub/Sub topic already exists: {topic_id}")
        except Exception as e:
            logger.error(f"Failed to create topic {topic_id}: {e}")

    def ensure_subscription(self, topic_id: str, subscription_id: str):
        if self.use_mock:
            logger.info(f"[Mock] Ensured subscription: {subscription_id} on topic {topic_id}")
            return
        
        topic_path = self.publisher.topic_path(self.project_id, topic_id)
        sub_path = self.subscriber.subscription_path(self.project_id, subscription_id)
        try:
            self.subscriber.create_subscription(
                request={"name": sub_path, "topic": topic_path}
            )
            logger.info(f"Created Pub/Sub subscription: {subscription_id}")
        except exceptions.AlreadyExists:
            logger.info(f"Pub/Sub subscription already exists: {subscription_id}")
        except Exception as e:
            logger.error(f"Failed to create subscription {subscription_id}: {e}")

    def publish(self, topic_id: str, data: dict) -> str:
        payload = json.dumps(data).encode("utf-8")
        if self.use_mock:
            logger.info(f"[Mock Publish] Topic: {topic_id}, Payload: {data}")
            # If mock, trigger any mock subscriptions immediately in a simple way
            if topic_id in self.mock_subscriptions:
                for callback in self.mock_subscriptions[topic_id]:
                    try:
                        # Create a mock message object
                        class MockMessage:
                            def __init__(self, data):
                                self.data = data
                            def ack(self):
                                pass
                        callback(MockMessage(payload))
                    except Exception as err:
                        logger.error(f"Error in mock callback: {err}")
            return "mock-msg-id"
        
        topic_path = self.publisher.topic_path(self.project_id, topic_id)
        try:
            self.ensure_topic(topic_id)
            future = self.publisher.publish(topic_path, payload)
            msg_id = future.result()
            logger.info(f"Published message to {topic_id}, msg_id: {msg_id}")
            return msg_id
        except Exception as e:
            logger.error(f"Failed to publish to topic {topic_id}: {e}")
            raise e

    def subscribe(self, topic_id: str, subscription_id: str, callback: Callable) -> pubsub_v1.subscriber.futures.StreamingPullFuture:
        if self.use_mock:
            logger.info(f"[Mock Subscribe] Registered subscription {subscription_id} on topic {topic_id}")
            if topic_id not in self.mock_subscriptions:
                self.mock_subscriptions[topic_id] = []
            self.mock_subscriptions[topic_id].append(callback)
            return None
        
        self.ensure_topic(topic_id)
        self.ensure_subscription(topic_id, subscription_id)
        sub_path = self.subscriber.subscription_path(self.project_id, subscription_id)
        
        try:
            streaming_pull_future = self.subscriber.subscribe(sub_path, callback=callback)
            logger.info(f"Subscribed to subscription: {subscription_id}")
            return streaming_pull_future
        except Exception as e:
            logger.error(f"Failed to subscribe to subscription {subscription_id}: {e}")
            raise e
