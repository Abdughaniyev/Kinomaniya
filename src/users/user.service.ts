// src/users/user.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(User)
        private repo: Repository<User>,
    ) { }

    async saveIfNotExists(telegramId: string, username?: string) {
        let user = await this.repo.findOne({ where: { telegramId } });
        if (!user) {
            user = this.repo.create({
                telegramId,
                username,
            });
        }
        return this.repo.save(user);
    }

    async remove(telegramId: string) {
        return this.repo.delete({ telegramId });
    }


    async countUsers(): Promise<number> {
        return this.repo.count();
    }

    async findAll(): Promise<User[]> {
        return this.repo.find({ order: { createdAt: 'DESC' } });
    }

    async getUsersPaginated(page = 1, limit = 10) {
        const [users, total] = await this.repo.findAndCount({
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        const totalPages = Math.ceil(total / limit);
        return { users, totalPages };
    }
}
