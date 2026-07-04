import logging
import os
from google.cloud import storage
from google.cloud.storage import Bucket, Blob

logger = logging.getLogger("storage")
logging.basicConfig(level=logging.INFO)

class StorageBroker:
    def __init__(self):
        # The exact bucket name is passed in via environment variables from Docker / Terraform
        self.bucket_name = os.getenv("GCS_BUCKET_NAME", "marketing-genai-gcs-default")
        try:
            self.storage_client = storage.Client()
            self.use_mock = False
            logger.info(f"Initialized GCP Storage client for bucket: {self.bucket_name}")
        except Exception as e:
            logger.warning(f"GCP credentials not resolved for GCS. Falling back to local file mock storage. Error: {e}")
            self.use_mock = True
            self.mock_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "mock_gcs"))
            os.makedirs(self.mock_dir, exist_ok=True)
            logger.info(f"Local mock storage initialized at {self.mock_dir}")

    def _get_blob(self, file_path: str) -> Blob:
        """Returns a Blob object directly, bypassing storage.buckets.get preflight check.
        Uses Bucket(client, name) constructor which does NOT make a network call."""
        bucket = Bucket(self.storage_client, self.bucket_name)
        return bucket.blob(file_path)

    def upload_text_artifact(self, file_path: str, text_content: str) -> str:
        """
        Uploads text content as an artifact to Google Cloud Storage.
        Returns the GCS URI (gs://bucket/file_path) or local mock path.
        """
        if self.use_mock:
            target_path = os.path.join(self.mock_dir, file_path)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(text_content)
            mock_url = f"file://{target_path.replace(os.sep, '/')}"
            logger.info(f"[Mock Storage] Saved artifact to {mock_url}")
            return mock_url

        try:
            blob = self._get_blob(file_path)
            blob.cache_control = "no-store, no-cache, must-revalidate"
            blob.upload_from_string(text_content, content_type="text/plain")
            gcs_url = f"https://storage.googleapis.com/{self.bucket_name}/{file_path}"
            logger.info(f"Uploaded artifact to GCP Storage: {gcs_url}")
            return gcs_url
        except Exception as e:
            logger.error(f"Failed to upload to GCS bucket {self.bucket_name}: {e}")
            # Fallback to saving locally if GCP call failed
            fallback_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "failed_gcs_uploads"))
            os.makedirs(fallback_dir, exist_ok=True)
            target_path = os.path.join(fallback_dir, os.path.basename(file_path))
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(text_content)
            return f"file://{target_path.replace(os.sep, '/')}"

    def upload_binary_artifact(self, file_path: str, data: bytes, content_type: str) -> str:
        """
        Uploads binary content (e.g. image) as an artifact to Google Cloud Storage.
        Returns the GCS HTTPS URL or local mock path.
        """
        if self.use_mock:
            target_path = os.path.join(self.mock_dir, file_path)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(target_path, "wb") as f:
                f.write(data)
            mock_url = f"file://{target_path.replace(os.sep, '/')}"
            logger.info(f"[Mock Storage] Saved binary artifact to {mock_url}")
            return mock_url

        try:
            blob = self._get_blob(file_path)
            blob.cache_control = "no-store, no-cache, must-revalidate"
            blob.upload_from_string(data, content_type=content_type)
            gcs_url = f"https://storage.googleapis.com/{self.bucket_name}/{file_path}"
            logger.info(f"Uploaded binary artifact to GCP Storage: {gcs_url}")
            return gcs_url
        except Exception as e:
            logger.error(f"Failed to upload binary to GCS bucket {self.bucket_name}: {e}")
            # Fallback to saving locally if GCP call failed
            fallback_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "failed_gcs_uploads"))
            os.makedirs(fallback_dir, exist_ok=True)
            target_path = os.path.join(fallback_dir, os.path.basename(file_path))
            with open(target_path, "wb") as f:
                f.write(data)
            return f"file://{target_path.replace(os.sep, '/')}"

    def delete_artifact(self, gcs_url_or_path: str) -> None:
        """
        Deletes the GCS file from the GCS bucket or local mock path.
        """
        if not gcs_url_or_path:
            return
        if self.use_mock or gcs_url_or_path.startswith("file://"):
            try:
                local_path = gcs_url_or_path.replace("file://", "")
                if os.path.exists(local_path):
                    os.remove(local_path)
                    logger.info(f"[Mock Storage] Deleted local file: {local_path}")
            except Exception as e:
                logger.error(f"Failed to delete mock file {gcs_url_or_path}: {e}")
            return

        try:
            prefix = f"https://storage.googleapis.com/{self.bucket_name}/"
            if gcs_url_or_path.startswith(prefix):
                file_path = gcs_url_or_path.replace(prefix, "")
                blob = self._get_blob(file_path)
                if blob.exists():
                    blob.delete()
                    logger.info(f"Deleted GCP Storage file: {gcs_url_or_path}")
        except Exception as e:
            logger.error(f"Failed to delete GCS file {gcs_url_or_path}: {e}")
            
    def download_text_artifact(self, gcs_url_or_path: str) -> str:
        """
        Downloads text content from the given GCS URL or local mock path.
        """
        if not gcs_url_or_path:
            return ""
        if self.use_mock or gcs_url_or_path.startswith("file://"):
            try:
                local_path = gcs_url_or_path.replace("file://", "")
                if os.path.exists(local_path):
                    with open(local_path, "r", encoding="utf-8") as f:
                        return f.read()
            except Exception as e:
                logger.error(f"Failed to read mock file {gcs_url_or_path}: {e}")
            return ""

        try:
            prefix = f"https://storage.googleapis.com/{self.bucket_name}/"
            if gcs_url_or_path.startswith(prefix):
                file_path = gcs_url_or_path.replace(prefix, "")
                blob = self._get_blob(file_path)
                if blob.exists():
                    return blob.download_as_string().decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to read GCS file {gcs_url_or_path}: {e}")
        return ""
