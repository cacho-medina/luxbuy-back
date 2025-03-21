import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const setupSwagger = (app): void => {
  const config = new DocumentBuilder()
    .setTitle('API NESTJS')
    .setDescription('Vortex Grupo 3')
    .setVersion('1.0')
    .addTag('Proyecto 1')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document);

  //Ruta para acceder a la documentacion de swagger: http://localhost:8000/api-docs

};
