FROM node:22-slim

# Install dependencies for native compilation
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install python dependencies
COPY python_monitor/requirements.txt ./python_monitor/
RUN python3 -m pip install --break-system-packages -r python_monitor/requirements.txt
RUN python3 -m pip list

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Build the app
RUN npm run build

# Start the app
CMD ["node", "server.ts"]
