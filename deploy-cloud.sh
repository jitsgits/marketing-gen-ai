#!/bin/bash
set -e

echo "====================================================================="
echo "             Marketing GenAI Cloud Deployment Orchestrator           "
echo "====================================================================="

# Navigate to script directory (project root)
cd "$(dirname "$0")"

# 1. Resolve GCP Project ID
GCP_PROJECT_RESOLVED=""
if [ -n "$1" ]; then
    GCP_PROJECT_RESOLVED="$1"
elif [ -n "$GOOGLE_PROJECT" ]; then
    GCP_PROJECT_RESOLVED="$GOOGLE_PROJECT"
elif [ -n "$GCP_PROJECT" ]; then
    GCP_PROJECT_RESOLVED="$GCP_PROJECT"
else
    # Attempt to read active gcloud project
    if command -v gcloud &> /dev/null; then
        GCP_PROJECT_RESOLVED=$(gcloud config get-value project 2>/dev/null || echo "")
    fi
fi

GCP_PROJECT="$GCP_PROJECT_RESOLVED"

if [ -z "$GCP_PROJECT" ]; then
    echo "❌ ERROR: GCP Project ID could not be determined."
    echo "Usage: ./deploy-cloud.sh [YOUR_GCP_PROJECT_ID] [REGION]"
    exit 1
fi

REGION="${2:-${GOOGLE_REGION:-us-central1}}"
echo "✓ Target Project: $GCP_PROJECT"
echo "✓ Target Region:  $REGION"

# Validate tools
for tool in gcloud docker terraform; do
    if ! command -v $tool &> /dev/null; then
        echo "❌ ERROR: $tool is not installed on this system. Please install it to proceed."
        exit 1
    fi
done

# 2. Enable GCP Service APIs
echo "Enabling required Google Cloud APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  pubsub.googleapis.com \
  storage-api.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  sqladmin.googleapis.com \
  --project="$GCP_PROJECT"

# Configure local docker helper authentication
echo "Configuring Docker credential helper..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# Create the Terraform state bucket if it doesn't exist
TF_STATE_BUCKET="marketing-genai-tfstate-${GCP_PROJECT}"
echo "Ensuring private GCS bucket for Terraform state: $TF_STATE_BUCKET..."
if ! gcloud storage buckets describe "gs://${TF_STATE_BUCKET}" &>/dev/null; then
    gcloud storage buckets create "gs://${TF_STATE_BUCKET}" \
      --project="$GCP_PROJECT" \
      --location="$REGION" \
      --uniform-bucket-level-access
    # Prevent public access to this bucket
    gcloud storage buckets update "gs://${TF_STATE_BUCKET}" \
      --project="$GCP_PROJECT" \
      --public-access-prevention
fi

echo "Initializing Terraform with GCS remote backend..."
cd infrastructure
terraform init \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="prefix=terraform/state" \
  -reconfigure


# 3.1 Idempotency Check: Reconcile existing Cloud SQL instances and users
echo "Checking for existing Cloud SQL Database Instances in GCP project..."
EXISTING_DB=$(gcloud sql instances list --project="$GCP_PROJECT" --format="value(name)" --quiet 2>/dev/null | grep "marketing-genai-db-" | head -n 1 || echo "")

if [ -n "$EXISTING_DB" ]; then
    echo "✓ Found existing Cloud SQL instance in project: $EXISTING_DB"
    
    # Import Database Instance if not in state
    if ! terraform state list 2>/dev/null | grep -q "google_sql_database_instance.postgres_instance"; then
        echo "⚠️ Instance is not tracked in Terraform state. Importing..."
        terraform import \
          -var="project_id=$GCP_PROJECT" \
          -var="region=$REGION" \
          -var="frontend_image_uri=placeholder" \
          -var="api_image_uri=placeholder" \
          google_sql_database_instance.postgres_instance "$GCP_PROJECT/$EXISTING_DB" || true
    fi

    # Import Database Schema if not in state
    if ! terraform state list 2>/dev/null | grep -q "google_sql_database.postgres_db"; then
        echo "⚠️ Database schema is not tracked in state. Importing..."
        terraform import \
          -var="project_id=$GCP_PROJECT" \
          -var="region=$REGION" \
          -var="frontend_image_uri=placeholder" \
          -var="api_image_uri=placeholder" \
          google_sql_database.postgres_db "$GCP_PROJECT/$EXISTING_DB/marketing_genai" || true
    fi

    # Import Database Admin User if not in state
    if ! terraform state list 2>/dev/null | grep -q "google_sql_user.db_user"; then
        echo "⚠️ Database user 'postgres' is not tracked in state. Importing..."
        terraform import \
          -var="project_id=$GCP_PROJECT" \
          -var="region=$REGION" \
          -var="frontend_image_uri=placeholder" \
          -var="api_image_uri=placeholder" \
          google_sql_user.db_user "$GCP_PROJECT/$EXISTING_DB/postgres" || true
    fi
else
    echo "✓ No existing Cloud SQL database instances found. Proceeding with fresh creation."
fi

echo "Bootstrapping Artifact Registry Repository..."
terraform apply \
  -target=google_artifact_registry_repository.marketing_genai_repo \
  -var="project_id=$GCP_PROJECT" \
  -var="region=$REGION" \
  -var="frontend_image_uri=placeholder" \
  -var="api_image_uri=placeholder" \
  -auto-approve

cd ..

# 4. Build and Push Container Images
TAG="v-$(date +%Y%m%d-%H%M%S)"
REGISTRY="${REGION}-docker.pkg.dev/${GCP_PROJECT}/marketing-genai-repo"
FRONTEND_IMAGE="${REGISTRY}/frontend:${TAG}"
API_IMAGE="${REGISTRY}/api:${TAG}"

echo "Building containers (tag: $TAG)..."
echo "Building Frontend..."
docker build -t "$FRONTEND_IMAGE" ./frontend

echo "Building API Backend..."
docker build -t "$API_IMAGE" ./services

echo "Pushing images to GCP Artifact Registry..."
docker push "$FRONTEND_IMAGE"
docker push "$API_IMAGE"

# 5. Full Cloud Deployment
echo "Executing complete deployment pipeline..."
cd infrastructure
terraform apply \
  -var="project_id=$GCP_PROJECT" \
  -var="region=$REGION" \
  -var="frontend_image_uri=$FRONTEND_IMAGE" \
  -var="api_image_uri=$API_IMAGE" \
  -auto-approve

# Grab the service URL outputs
FRONTEND_URL=$(terraform output -raw frontend_service_url || echo "")
API_URL=$(terraform output -raw api_service_url || echo "")

cd ..

echo "====================================================================="
echo "🎉 Deployment Complete!"
echo "---------------------------------------------------------------------"
echo "Frontend Dashboard URL: $FRONTEND_URL"
echo "Backend API Gateway:    $API_URL"
echo "====================================================================="
