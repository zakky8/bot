#!/bin/bash

# Google Cloud VM Setup Script for Telegram Bot
# This script installs Docker, Docker Compose, Node.js, and PM2.

echo "🚀 Starting VM Setup..."

# 1. Update and install basic tools
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common git

# 2. Install Docker
echo "🐳 Installing Docker..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# 3. Install Docker Compose
echo "📦 Installing Docker Compose..."
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 4. Install Node.js 20
echo "🟢 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 5. Install PM2 globally
echo "✨ Installing PM2..."
sudo npm install -g pm2

# 6. Add user to docker group
sudo usermod -aG docker $USER

echo "✅ Setup Complete! Please log out and log back in for docker group changes to take effect."
echo "Next steps:"
echo "1. git clone https://github.com/zakky8/bot"
echo "2. cd bot"
echo "3. nano .env  # Add your secrets"
echo "4. docker-compose up -d"
