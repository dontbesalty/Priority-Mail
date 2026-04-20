#!/bin/bash

# --- Priority Mail Dev Script ---
# This script handles docker-compose build and up for the full stack.
# Usage: ./dev.sh [--connectors]

# Default services
CORE_SERVICES="postgres redis backend frontend"
CONNECTORS="gmail-connector o365-connector"

# Parse flags
WITH_CONNECTORS=false
REBUILD=false

for arg in "$@"; do
  case $arg in
    --connectors|-c)
      WITH_CONNECTORS=true
      shift
      ;;
    --rebuild|-r)
      REBUILD=true
      shift
      ;;
    --help|-h)
      echo "Usage: ./dev.sh [options]"
      echo "Options:"
      echo "  -c, --connectors  Build and run connectors (one-shot jobs)"
      echo "  -r, --rebuild     Force rebuild of images"
      echo "  -h, --help        Show this help message"
      exit 0
      ;;
  esac
done

SERVICES=$CORE_SERVICES
if [ "$WITH_CONNECTORS" = true ]; then
  SERVICES="$CORE_SERVICES $CONNECTORS"
fi

echo "🚀 Starting Priority Mail development environment..."

if [ "$REBUILD" = true ]; then
  echo "🏗️  Building services: $SERVICES"
  docker compose build $SERVICES
fi

echo "🆙 Spinning up: $CORE_SERVICES"
docker compose up -d $CORE_SERVICES

if [ "$WITH_CONNECTORS" = true ]; then
  echo "📧 Running connectors..."
  
  # --- Gmail Connector ---
  echo "👉 Running Gmail connector..."
  if [ ! -f "connectors/gmail/.env" ]; then
    echo "⚠️  gmail-connector: .env not found. Skipping. (Copy connectors/gmail/.env.example)"
  else
    # Check if polling is enabled
    if grep -q "POLL_INTERVAL_SECONDS=" "connectors/gmail/.env" && [ "$(grep "POLL_INTERVAL_SECONDS=" "connectors/gmail/.env" | cut -d'=' -f2)" != "" ]; then
      echo "⏱️  Polling mode detected. Starting as daemon..."
      docker compose up -d gmail-connector
    else
      echo "⚡  One-shot mode detected."
      docker compose run --rm gmail-connector
    fi
  fi

  # --- O365 Connector ---
  echo "👉 Running O365 connector..."
  if [ ! -f "connectors/o365/.env" ]; then
    echo "⚠️  o365-connector: .env not found. Skipping. (Copy connectors/o365/.env.example)"
  else
    # Check if polling is enabled
    if grep -q "POLL_INTERVAL_SECONDS=" "connectors/o365/.env" && [ "$(grep "POLL_INTERVAL_SECONDS=" "connectors/o365/.env" | cut -d'=' -f2)" != "" ]; then
      echo "⏱️  Polling mode detected. Starting as daemon..."
      docker compose up -d o365-connector
    else
      echo "⚡  One-shot mode detected."
      docker compose run --rm o365-connector
    fi
  fi
fi

echo "✅ Environment is up!"
echo "📍 Dashboard: http://localhost:3000"
echo "📍 API:       http://localhost:4000"
