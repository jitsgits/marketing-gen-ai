terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
  backend "gcs" {}
}

# --- Variables ---
variable "project_id" {
  type        = string
  description = "The GCP Project ID where resources will be provisioned."
}

variable "region" {
  type        = string
  default     = "us-central1"
  description = "The target GCP region for regional resources."
}

variable "environment" {
  type        = string
  default     = "production"
  description = "Application deployment tier environment (e.g. dev, staging, production)."
}

variable "frontend_image_uri" {
  type        = string
  description = "The container image URI for the frontend Nginx application."
}

variable "api_image_uri" {
  type        = string
  description = "The container image URI for the backend FastAPI application."
}

# --- Random Suffix Generator ---
resource "random_uuid" "bucket_suffix" {}

resource "random_id" "db_suffix" {
  byte_length = 4
}

# --- Google Cloud Storage ---
resource "google_storage_bucket" "artifacts_bucket" {
  name                        = "marketing-genai-gcs-${random_uuid.bucket_suffix.result}"
  location                    = var.region
  project                     = var.project_id
  force_destroy               = true
  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

# --- GCS Public Read Access ---
resource "google_storage_bucket_iam_member" "public_bucket_read" {
  bucket = google_storage_bucket.artifacts_bucket.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# --- Google Cloud Pub/Sub ---
resource "google_pubsub_topic" "requests_topic" {
  name    = "marketing-genai-requests"
  project = var.project_id
}

resource "google_pubsub_subscription" "requests_sub" {
  name    = "marketing-genai-requests-sub"
  topic   = google_pubsub_topic.requests_topic.name
  project = var.project_id

  # Message retention and ack configurations
  message_retention_duration = "604800s" # 7 days
  ack_deadline_seconds       = 60

  # Push delivery configuration pointing to the background worker service
  push_config {
    push_endpoint = google_cloud_run_v2_service.worker_service.uri
    oidc_token {
      service_account_email = google_service_account.cloud_run_sa.email
    }
  }
}

# --- Artifact Registry ---
resource "google_artifact_registry_repository" "marketing_genai_repo" {
  location      = var.region
  repository_id = "marketing-genai-repo"
  description   = "Docker repository for Marketing GenAI container images"
  format        = "DOCKER"
  project       = var.project_id
}

# --- Secret Manager ---
resource "google_secret_manager_secret" "api_secret" {
  secret_id = "marketing-genai-secret"
  project   = var.project_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "api_secret_version" {
  secret      = google_secret_manager_secret.api_secret.id
  secret_data = "dummy-api-secret-value-for-initial-provisioning"
}

# --- Cloud SQL (PostgreSQL) ---
resource "google_sql_database_instance" "postgres_instance" {
  name                = "marketing-genai-db-${random_id.db_suffix.hex}"
  database_version    = "POSTGRES_15"
  region              = var.region
  project             = var.project_id
  deletion_protection = false

  settings {
    tier = "db-f1-micro"
    ip_configuration {
      ipv4_enabled = true
    }
  }
}

resource "google_sql_database" "postgres_db" {
  name     = "marketing_genai"
  instance = google_sql_database_instance.postgres_instance.name
  project  = var.project_id
}

resource "random_password" "db_password" {
  length  = 16
  special = false
}

resource "google_sql_user" "db_user" {
  name     = "postgres"
  instance = google_sql_database_instance.postgres_instance.name
  password = random_password.db_password.result
  project  = var.project_id
}


# Data resource to resolve GCP Project Details (like Project Number)
data "google_project" "project" {
  project_id = var.project_id
}

# --- IAM Service Account ---
resource "google_service_account" "cloud_run_sa" {
  account_id   = "marketing-genai-run-sa"
  display_name = "Cloud Run Service Account for Marketing GenAI"
  project      = var.project_id
}

# Grant Pub/Sub Service Agent the Service Account Token Creator role on the Run Service Account
# This is required so Pub/Sub can generate OIDC identity tokens to authenticate push requests.
resource "google_service_account_iam_member" "pubsub_token_creator" {
  service_account_id = google_service_account.cloud_run_sa.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# Assign required roles to Service Account
resource "google_project_iam_member" "vertex_ai_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_project_iam_member" "pubsub_editor" {
  project = var.project_id
  role    = "roles/pubsub.editor"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_project_iam_member" "storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_project_iam_member" "secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_project_iam_member" "artifact_registry_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_project_iam_member" "cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# --- Google Cloud Run: API Service ---
resource "google_cloud_run_v2_service" "api_service" {
  name     = "marketing-genai-api"
  location = var.region
  project  = var.project_id
  client   = "terraform"

  template {
    service_account = google_service_account.cloud_run_sa.email

    containers {
      image = var.api_image_uri

      ports {
        container_port = 8000
      }

      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GCP_LOCATION"
        value = var.region
      }
      env {
        name  = "GCS_BUCKET_NAME"
        value = google_storage_bucket.artifacts_bucket.name
      }

      env {
        name  = "CLOUD_SQL_CONNECTION_NAME"
        value = google_sql_database_instance.postgres_instance.connection_name
      }
      env {
        name  = "DB_USER"
        value = google_sql_user.db_user.name
      }
      env {
        name  = "DB_PASS"
        value = google_sql_user.db_user.password
      }
      env {
        name  = "DB_NAME"
        value = google_sql_database.postgres_db.name
      }

      # Mount sensitive values from Secret Manager
      env {
        name = "API_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.api_secret.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres_instance.connection_name]
      }
    }

    scaling {
      max_instance_count = 3
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# --- Google Cloud Run: Frontend Proxy Service ---
resource "google_cloud_run_v2_service" "frontend_service" {
  name     = "marketing-genai-frontend"
  location = var.region
  project  = var.project_id
  client   = "terraform"

  template {
    containers {
      image = var.frontend_image_uri

      ports {
        container_port = 80
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# --- Cloud Run Public Access Invoker Bindings ---
resource "google_cloud_run_v2_service_iam_member" "api_public_access" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api_service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public_access" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.frontend_service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- Google Cloud Run: Worker Service ---
resource "google_cloud_run_v2_service" "worker_service" {
  name     = "marketing-genai-worker"
  location = var.region
  project  = var.project_id
  client   = "terraform"

  template {
    service_account = google_service_account.cloud_run_sa.email

    containers {
      image = var.api_image_uri # Uses the same compiled Python container
      command = ["uvicorn", "app.worker:app", "--host", "0.0.0.0", "--port", "8000"]

      ports {
        container_port = 8000
      }

      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GCP_LOCATION"
        value = var.region
      }
      env {
        name  = "GCS_BUCKET_NAME"
        value = google_storage_bucket.artifacts_bucket.name
      }
      env {
        name  = "WORKER_MODE"
        value = "push"
      }

      env {
        name  = "CLOUD_SQL_CONNECTION_NAME"
        value = google_sql_database_instance.postgres_instance.connection_name
      }
      env {
        name  = "DB_USER"
        value = google_sql_user.db_user.name
      }
      env {
        name  = "DB_PASS"
        value = google_sql_user.db_user.password
      }
      env {
        name  = "DB_NAME"
        value = google_sql_database.postgres_db.name
      }

      # Mount sensitive values from Secret Manager
      env {
        name = "API_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.api_secret.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres_instance.connection_name]
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# Only allow the IAM Service Account used by Pub/Sub push token to invoke the worker
resource "google_cloud_run_v2_service_iam_member" "worker_invoker_permission" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# --- Outputs ---
output "gcs_bucket_name" {
  value       = google_storage_bucket.artifacts_bucket.name
  description = "The name of the provisioned Google Cloud Storage bucket."
}

output "api_service_url" {
  value       = google_cloud_run_v2_service.api_service.uri
  description = "The URI of the FastAPI backend service."
}

output "frontend_service_url" {
  value       = google_cloud_run_v2_service.frontend_service.uri
  description = "The URI of the Angular proxy frontend service."
}

output "worker_service_url" {
  value       = google_cloud_run_v2_service.worker_service.uri
  description = "The URI of the Cloud Run background worker service."
}
