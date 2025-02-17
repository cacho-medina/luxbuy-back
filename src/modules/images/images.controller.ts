import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ImagesService } from './images.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@Controller('images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Post('/upload-image/:id')
  @UseInterceptors(
    FileInterceptor('image', {
      //Configuro como manejar la carga de archivos
      storage: memoryStorage(), //almaceno en la memoria
      limits: { fileSize: 5 * 1024 * 1024 }, // Tamaño limite de 5MB
      fileFilter: (req, file, callback) => {
        if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg') {
          callback(null, true);
        } else {
          callback(
            new BadRequestException('Only JPEG and PNG files are allowed'),
            false,
          );
        }
      },
    }),
  )
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() image: Express.Multer.File,
    @Body('altText') altText: string,
  ) {
    return this.imagesService.uploadImage(id, image, altText);
  }

  @Get('/all')
  findAll() {
    return this.imagesService.findAll();
  }

  @Get('/:id')
  findOne(@Param('id') id: string) {
    return this.imagesService.findOne(id);
  }

  /* @Patch('/update/:id')
  update(@Param('id') id: string, @Body() updateImageDto: UpdateImageDto) {
    return this.imagesService.update(id, updateImageDto);
  } */

  @Delete('/delete/:id')
  remove(@Param('id') id: string) {
    return this.imagesService.deleteImage(id);
  }
}
