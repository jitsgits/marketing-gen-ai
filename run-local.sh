#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

# Automatically navigate to the script's directory (project root)
cd "$(dirname "$0")"

echo "====================================================================="
echo "               Marketing GenAI Enterprise MVP Setup                  "
echo "====================================================================="

# 1. System Prerequisite Validation
echo "[1/4] Validating local system prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "❌ ERROR: Docker command not found. Please install Docker Desktop (https://www.docker.com/products/docker-desktop) and try again."
    exit 1
fi

# Check Docker Compose (Docker Compose V2 uses 'docker compose', V1 uses 'docker-compose')
COMPOSE_CMD=""
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
    echo "✓ Docker Compose (V2) detected."
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
    echo "✓ Docker-Compose (V1) detected."
else
    echo "❌ ERROR: Docker Compose is not installed. Please install Docker Compose and try again."
    exit 1
fi

# 2. GCP Credentials and Environments Resolution
echo "[2/4] Resolving Google Cloud Platform credentials..."

GCP_CREDS_PATH=""

# A. Check existing env var
if [ -n "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    if [ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
        GCP_CREDS_PATH="$GOOGLE_APPLICATION_CREDENTIALS"
        echo "✓ Found credentials file via GOOGLE_APPLICATION_CREDENTIALS environment variable."
    fi
fi

# B. Search typical default directories if env var not set/valid
if [ -z "$GCP_CREDS_PATH" ]; then
    echo "Searching in default Google Cloud SDK locations..."
    
    # Paths to search
    WIN_APPDATA_ADC="$APPDATA/gcloud/application_default_credentials.json"
    USER_HOME_ADC="$HOME/.config/gcloud/application_default_credentials.json"
    USER_PROFILE_ADC="$USERPROFILE/.config/gcloud/application_default_credentials.json"
    
    if [ -f "$WIN_APPDATA_ADC" ]; then
        GCP_CREDS_PATH="$WIN_APPDATA_ADC"
    elif [ -f "$USER_HOME_ADC" ]; then
        GCP_CREDS_PATH="$USER_HOME_ADC"
    elif [ -f "$USER_PROFILE_ADC" ]; then
        GCP_CREDS_PATH="$USER_PROFILE_ADC"
    fi
fi

# C. Setup mounts and extract project ID
if [ -n "$GCP_CREDS_PATH" ]; then
    echo "✓ Found Google Cloud Application Default Credentials (ADC) at: $GCP_CREDS_PATH"
    
    # Path conversion for Git Bash / MSYS terminal under Windows to prevent mount failure
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        if command -v cygpath &> /dev/null; then
            export GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH=$(cygpath -w "$GCP_CREDS_PATH")
        else
            export GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH="$GCP_CREDS_PATH"
        fi
    else
        export GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH="$GCP_CREDS_PATH"
    fi
    
    # Extract GCP project ID from credential JSON
    if command -v grep &> /dev/null && command -v sed &> /dev/null; then
        EXTRACTED_PROJECT=$(grep -o '"project_id": *"[^"]*"' "$GCP_CREDS_PATH" | head -n 1 | sed 's/"project_id": *"\([^"]*\)"/\1/' || echo "")
        if [ -n "$EXTRACTED_PROJECT" ]; then
            export GCP_PROJECT="$EXTRACTED_PROJECT"
            echo "✓ Configured GCP_PROJECT from credentials: $GCP_PROJECT"
        fi
    fi
else
    echo "⚠️ WARNING: Google Cloud Application Default Credentials (ADC) not detected."
    echo "  The backend container will initialize in LOCAL MOCK mode."
    echo "  To use real Vertex AI models, run: gcloud auth application-default login"
    
    # Create empty directory to satisfy Docker Compose volumes binding requirement
    mkdir -p ./services/mock_gcs
    # Point host credentials to local mock folder
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        export GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH="$(pwd -W)/services/mock_gcs"
    else
        export GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH="$(pwd)/services/mock_gcs"
    fi
fi

# Set default GCP Project if not resolved
export GCP_PROJECT="${GCP_PROJECT:-marketing-genai-project}"
export GCP_LOCATION="${GCP_LOCATION:-us-central1}"

# Set GCS Bucket Name. Suffix is typically randomized for uniqueness
export GCS_BUCKET_NAME="${GCS_BUCKET_NAME:-marketing-genai-gcs-local-dev}"

echo "Environment: GCP_PROJECT=$GCP_PROJECT, GCP_LOCATION=$GCP_LOCATION, GCS_BUCKET_NAME=$GCS_BUCKET_NAME"

# 3. Clean Docker Build
echo "[3/4] Compiling Docker containers from source (no-cache)..."
$COMPOSE_CMD build --no-cache

# 4. Boot Containers
echo "[4/4] Launching containerized application stack..."
echo "Starting PostgreSQL database container first..."
$COMPOSE_CMD up -d db

echo -n "Waiting for PostgreSQL database to boot"
# Wait until pg_isready returns 0 inside the db container
until docker exec $($COMPOSE_CMD ps -q db) pg_isready -U postgres &>/dev/null; do
    sleep 1
    echo -n "."
done
echo " PostgreSQL is ready!"

echo "Starting frontend, api-service, and ai-worker containers..."
$COMPOSE_CMD up -d

echo "====================================================================="
echo "🎉 Setup Complete!"
echo "Open your browser at: http://localhost"
echo "====================================================================="
