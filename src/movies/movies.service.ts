import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Movie } from './movie.entity';

@Injectable()
export class MoviesService {
    constructor(
        @InjectRepository(Movie)
        private readonly moviesRepo: Repository<Movie>,
    ) { }

    // Strict create: agar kod mavjud bo‘lsa xatolik beradi
    async createStrict(data: Partial<Movie>): Promise<Movie> {
        const exists = await this.moviesRepo.findOne({ where: { code: data.code! } });
        if (exists) throw new ConflictException(`⚠️ Kod ${data.code} allaqachon mavjud`);
        const movie = this.moviesRepo.create(data);
        return this.moviesRepo.save(movie);
    }

    async findByCodeIncludeDeleted(code: string) {
        return this.moviesRepo.findOne({ where: { code } });
    }

    async findByCode(code: string): Promise<Movie | null> {
        return this.moviesRepo.findOne({ where: { code, isDeleted: false } });
    }

    async setDeleted(code: string, deleted: boolean) {
        const movie = await this.moviesRepo.findOne({ where: { code } });
        if (!movie) throw new Error(`Movie ${code} not found`);
        movie.isDeleted = deleted;
        return this.moviesRepo.save(movie);
    }


    async update(movie: Movie): Promise<Movie> {
        return this.moviesRepo.save(movie);
    }
}
