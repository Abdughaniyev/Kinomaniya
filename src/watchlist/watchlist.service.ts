import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Watchlist } from './watchlist.entity';
import { MoviesService } from '../movies/movies.service';

@Injectable()
export class WatchlistService {
    constructor(
        @InjectRepository(Watchlist)
        private readonly watchlistRepo: Repository<Watchlist>,
        private readonly moviesService: MoviesService,
    ) { }

    async addToWatchlist(userId: string, movieCode: string): Promise<string> {
        const movie = await this.moviesService.findByCode(movieCode);
        if (!movie) throw new Error(`❌ Kino ${movieCode} topilmadi`);

        const exists = await this.watchlistRepo.findOne({ where: { userId, movieCode } });
        if (exists) return '✅ Kino sizning ro‘yxatingizda allaqachon mavjud';

        await this.watchlistRepo.save(this.watchlistRepo.create({ userId, movieCode }));
        return `🎬 ${movie.title} sizning ro‘yxatingizga qo‘shildi`;
    }

    async getWatchlist(userId: string): Promise<string> {
        const items = await this.watchlistRepo.find({ where: { userId } });
        if (!items.length) return '📭 Sizning ro‘yxatingiz bo‘sh';

        // Har bir kod uchun kino maʼlumotlarini yuklash
        const movies = await Promise.all(items.map(i => this.moviesService.findByCode(i.movieCode)));
        const list = movies
            .filter((m): m is NonNullable<typeof m> => !!m)
            .map(m => `- ${m.code} ${m.title}${m.category ? ` (${m.category})` : ''}`)
            .join('\n');

        return `🎬 Sizning ro‘yxatingiz:\n${list}`;
    }

    async removeFromWatchlist(userId: string, movieCode: string): Promise<string> {
        const row = await this.watchlistRepo.findOne({ where: { userId, movieCode } });
        if (!row) return `⚠️ Kino ${movieCode} sizning ro‘yxatingizda mavjud emas`;

        await this.watchlistRepo.remove(row);
        return `❌ Kino ${movieCode} sizning ro‘yxatingizdan olib tashlandi`;
    }
}
