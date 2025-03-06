# Usa una imagen de Node.js optimizada
FROM node:20-alpine

# Instala dependencias necesarias
RUN apk add --no-cache python3 py3-pip make g++ pkgconf pixman-dev cairo-dev pango-dev libjpeg-turbo-dev freetype-dev

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala todas las dependencias (incluye Prisma CLI)
RUN npm install

# Copia el resto de la aplicación
COPY . .

# Generar el Cliente de Prisma antes de compilar
RUN npx prisma generate

# Copiar el archivo .env al contenedor
COPY .env .env

# Compila el proyecto
RUN npm run build

# Expone el puerto de la app
EXPOSE 3000

# Comando de inicio corregido
CMD ["npm", "run", "start"]


