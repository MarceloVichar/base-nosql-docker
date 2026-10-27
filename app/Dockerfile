FROM node:20-alpine

WORKDIR /app

# Instala dependências
COPY package*.json ./
RUN npm ci

# Copia o código fonte
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 3400

# Prepara a cópia de busca antes de atender; executa o JavaScript compilado.
CMD ["sh", "-c", "npm run seed:elastic && exec npm start"]
