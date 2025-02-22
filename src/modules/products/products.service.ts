import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PrismaService } from '../prisma/prisma.service';
import { FilterProductDto } from './dto/filters-product.dto';
import { ExcelService } from '../excel/excel.service';
import { AwsService } from 'src/aws/aws.service';
import { I18nService } from 'nestjs-i18n';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excel: ExcelService,
    private readonly aws: AwsService,
    private readonly i18n: I18nService,
  ) {}

  async findAll(filters: FilterProductDto) {
    try {
      const where: any = { isDeleted: false };

      const { name, minPrice, maxPrice, categoryId, minStock, maxStock } =
        filters;

      //filtro por nombre
      if (name) where.name = { contains: name, mode: 'insensitive' };
      //filtro por precio
      if (minPrice || maxPrice) {
        where.price = {};
        if (minPrice) where.price.gte = minPrice;
        if (maxPrice) where.price.lte = maxPrice;
      }
      // Filtro por stock
      if (minStock || maxStock) {
        where.stock = {};
        if (minStock) where.stock.gte = minStock;
        if (maxStock) where.stock.lte = maxStock;
      }
      //filtro por categoria
      if (categoryId) {
        where.categories = {
          some: {
            categoryId: categoryId,
          },
        };
      }
      const products = await this.prisma.product.findMany({
        where,
        include: {
          images: {
            select: { url: true },
          },
          categories: {
            select: {
              category: {
                select: { name: true },
              },
            },
          },
        },
      });
      const formattedProducts = products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        stock: product.stock,
        images: product.images,
        categories: product.categories.map((pc) => pc.category.name),
      }));
      return formattedProducts;
    } catch (error) {
      console.log(error);
      throw new BadRequestException(this.i18n.t('products.error.PRODUCT_NOT_FOUND'), error);
    }
  }

  async findOne(id: string) {
    try {
      const product = await this.prisma.product.findFirst({
        where: { id, isDeleted: false },
        include: {
          images: {
            select: {
              id: true,
              url: true,
              altText: true,
            },
          },
          categories: {
            select: {
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!product) {
        throw new NotFoundException(this.i18n.t('products.error.PRODUCT_ID_NOT_FOUND'));
      }
      return product;
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        this.i18n.t('products.error.PRODUCT_NOT_FOUND'),
        error.response.message,
      );
    }
  }

  async createProduct(
    product: CreateProductDto,
    images: Express.Multer.File[],
  ) {
    try {
      const newProduct = await this.prisma.$transaction(async (tx) => {
        const { name, description, price, stock, categories } = product;

        // Verificar si el nombre de producto ya existe.
        const productExists = await tx.product.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        });
        if (productExists) {
          throw new BadRequestException(this.i18n.t('products.error.PRODUCT_EXISTS'));
        }
        //verifica que todas las categorías existan, retorna true si todas las categorías existen
        await this.validateCategories(categories);

        const createdProduct = await tx.product.create({
          data: {
            name,
            description: description || null,
            price,
            stock,
            // Crear las relaciones con las categorías directamente
            categories: {
              create: categories.map((categoryId) => ({
                categoryId: categoryId,
              })),
            },
          },
          include: {
            categories: true,
          },
        });

        //subir imagenes a s3
        if (images && images.length > 0) {
          const imagePromises = images.map(async (image) => {
            const imageUrl = await this.aws.uploadImage(
              image,
              createdProduct.id,
            );
            return tx.image.create({
              data: {
                url: imageUrl,
                productId: createdProduct.id,
              },
            });
          });
          await Promise.all(imagePromises);
        }
      });
      return { message: this.i18n.t('products.success.CREATED_PRODUCT'), newProduct };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        this.i18n.t('products.success.PRODUCT_CREATION_FAILED'),
        error.response?.message,
      );
    }
  }

  async uploadProduct(file: Express.Multer.File) {
    try {
      const columnasRequeridas = [
        'Nombre',
        'Precio',
        'Stock',
        'Descripcion',
        'Categoria',
      ];

      // Se lee el contenido del Excel utilizando el servicio ExcelService
      const datos = await this.excel.readExcel(file.buffer, columnasRequeridas);

      //se parsean los datos
      const products = datos
        .map((row: any) => {
          const name = row['Nombre'];
          const price = parseFloat(row['Precio']);
          const stock = parseInt(row['Stock'], 10);
          const description = row['Descripcion'];
          const categories = row['Categoria'];
          //se valida que los datos sean correctos
          if (!name || isNaN(price) || !categories || isNaN(stock)) {
            return null;
          }

          return { name, price, stock, description, categories };
        })
        .filter((product) => product !== null); //se filtra los productos que no son correctos

      if (!products.length) {
        throw new BadRequestException(this.i18n.t('products.error.NO_VALID_PRODUCT'));
      }
      //se eliminan los productos importados duplicados
      const productosSinDuplicar = products.filter(
        (producto, index, self) =>
          index ===
          self.findIndex(
            (p) => p.name.toLowerCase() === producto.name.toLowerCase(),
          ),
      );

      const result = await this.prisma.$transaction(async (tx) => {
        // verificar que los nombres de los productos no sean duplicados en la base de datos
        const existingNames = await tx.product.findMany({
          where: {
            name: {
              in: productosSinDuplicar.map((p) => p.name),
              mode: 'insensitive',
            },
          },
          select: { name: true }, //solo obtiene el nombre de los productos
        });

        if (existingNames.length > 0) {
          throw new BadRequestException(
            this.i18n.t('products.error.PRODUCT_EXISTS', { args: { names: existingNames.map((p) => p.name).join(', ') } }),
          );
        }

        // Parsea todas las categorías a un arreglo
        const allCategories = [
          ...new Set(
            productosSinDuplicar.flatMap((p) =>
              p.categories.split(',').map((c) => c.trim()),
            ),
          ),
        ];
        //valida que todas las categorías existan
        await this.validateCategories(allCategories);

        const createdProducts = [];
        for (const producto of productosSinDuplicar) {
          //crear el producto
          const createdProduct = await tx.product.create({
            data: {
              name: producto.name,
              price: producto.price,
              stock: producto.stock,
              description: producto.description,
            },
          });
          const categoryIds = await this.validateCategories(
            producto.categories.split(',').map((c) => c.trim()),
          );
          //asignar categorías al producto
          await tx.productCategory.createMany({
            data: categoryIds.map((categoryId) => ({
              productId: createdProduct.id,
              categoryId,
            })),
          });

          createdProducts.push(createdProduct);
        }

        return createdProducts;
      });

      return {
        message: this.i18n.t('products.error.PRODUCTS_IMPORTED'),
        cantidad: result.length,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        this.i18n.t('products.error.PRODUCTS_IMPORT_FAILED') + error.message,
      );
    }
  }

  async updateProduct(id: string, updateProductDto: UpdateProductDto) {
    try {
      const updatedProduct = await this.prisma.$transaction(async (tx) => {
        const { name, description, price, stock, categories } =
          updateProductDto;

        // Buscar el producto a actualizar que no esté eliminado.
        const productExists = await tx.product.findUnique({
          where: { id, isDeleted: false },
        });

        if (!productExists) {
          throw new NotFoundException(this.i18n.t('products.error.PRODUCT_ID_NOT_FOUND', { args: { id } }));
        }

        // Preparar los datos de actualización
        const updateData: any = {
          name: name ?? productExists.name,
          description: description ?? productExists.description,
          price: price ?? productExists.price,
          stock: stock ?? productExists.stock,
        };

        // Si hay categorías, validarlas y reemplazarlas correctamente
        if (categories?.length) {
          const categoryIds = await this.validateCategories(categories);

          // Eliminar las categorías actuales
          await tx.productCategory.deleteMany({
            where: { productId: id },
          });

          // Asociar nuevas categorías usando `createMany()`
          await tx.productCategory.createMany({
            data: categoryIds.map((categoryId) => ({
              productId: id,
              categoryId: categoryId,
            })),
          });
        }

        // Actualizar el producto
        return tx.product.update({
          where: { id },
          data: updateData,
          include: {
            categories: {
              select: {
                category: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        });
      });

      return {
        message: this.i18n.t('products.success.UPDATED_PRODUCT'),
        updatedProduct,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        this.i18n.t('products.success.PRODUCT_UPDATE_FAILED'),
        error.response.message,
      );
    }
  }

  async removeProduct(id: string) {
    try {
      const productExists = await this.prisma.product.findUnique({
        where: { id, isDeleted: false },
      });
      if (!productExists) {
        throw new NotFoundException(
          this.i18n.t('products.error.PRODUCT_NOT_FOUND'),
        );
      }
      const productDeleted = await this.prisma.product.update({
        where: { id },
        data: { isDeleted: true },
      });
      return {
        message: this.i18n.t('products.error.DELETED_PRODUCT'),
        productDeleted,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        this.i18n.t('products.error.PRODUCT_DELETION_FAILED'),
        error.response.message,
      );
    }
  }

  async restoreProduct(id: string) {
    try {
      const productExists = await this.prisma.product.findUnique({
        where: { id },
      });
      if (!productExists) {
        throw new NotFoundException(this.i18n.t('products.error.PRODUCT_NOT_FOUND'));
      }
      if (!productExists.isDeleted) {
        throw new BadRequestException(this.i18n.t('products.error.ACTIVE_PRODUCT'));
      }
      const restoredProduct = await this.prisma.product.update({
        where: { id },
        data: { isDeleted: false },
      });
      return {
        message: this.i18n.t('products.error.PRODUCT_RESTORED'),
        restoredProduct,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        this.i18n.t('products.error.PRODUCT_RESTORED_FAILED'),
        error.response.message,
      );
    }
  }

  //verifica que todas las categorías existan
  async validateCategories(categoryId: string[]) {
    const existingCategories = await this.prisma.category.findMany({
      where: { id: { in: categoryId }, isDeleted: false },
      select: { id: true },
    });

    const foundCategoryNames = existingCategories.map((c) => c.id);
    const missingCategories = categoryId.filter(
      (id) => !foundCategoryNames.includes(id),
    );

    if (missingCategories.length > 0) {
      throw new BadRequestException(
        this.i18n.t('products.error.MISSING_CATEGORIES', { args: { missingCategories: missingCategories.join(', ') } }),
      );
    }

    return existingCategories.map((c) => c.id);
  }

  //asociar categorías a un producto
  async associateCategories(productId: string, categoryIds: string[]) {
    console.log(productId, categoryIds);
    try {
      //genera nuevas relaciones
      await this.prisma.productCategory.createMany({
        data: categoryIds.map((categoryId) => ({
          productId,
          categoryId,
        })),
      });
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        this.i18n.t('products.error.CATEGORY_ASSOCIATION_FAILED'),
        error.response,
      );
    }
  }
}
