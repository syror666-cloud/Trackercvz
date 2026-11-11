FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
