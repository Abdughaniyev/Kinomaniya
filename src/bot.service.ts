import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { MoviesService } from './movies/movies.service';
import { WatchlistService } from './watchlist/watchlist.service';
import { UserService } from './users/user.service';
import * as dotenv from 'dotenv';

dotenv.config();

type ParsedCaption = {
    code: string;
    title: string;
    category?: string;
    description?: string;
};

const owner = Number(process.env.ADMIN);
const ADMINS: number[] = [owner];

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
    private bot!: Telegraf;
    private knownUsers = new Set<string>();

    private forceJoinActive = false;
    private forceJoinChannels: string[] = [];

    constructor(
        private readonly moviesService: MoviesService,
        private readonly watchlistService: WatchlistService,
        private readonly userService: UserService,
    ) {
        const token = process.env.BOT_TOKEN;
        if (!token) throw new Error('BOT_TOKEN mavjud emas');
        this.bot = new Telegraf(token);
    }

    async onModuleInit() {
        if (!this.bot) return;

        await this.cacheUsers();
        this.registerHandlers();

        const launch = async () => {
            try {
                await this.bot.launch();
                console.log('🤖 Telegram bot ishga tushdi');
            } catch (err) {
                console.error('❌ Bot ishga tushmadi:', (err as Error).message);
                console.log('⏳ 5 soniyadan keyin qayta urinib ko‘riladi...');
                setTimeout(launch, 5000);
            }
        };

        launch();
    }


    async onModuleDestroy() {
        if (this.bot) {
            // don't await .stop() — some Telegraf versions don't return a Promise here
            this.bot.stop();
            console.log('🛑 Telegram bot to‘xtatildi');
        }
    }

    private registerHandlers() {
        // ===== Channel posts =====
        this.bot.on('channel_post', async (ctx) => {
            try {
                const post = ctx.channelPost as any;

                // Determine file type and file ID
                let fileId: string | undefined;
                let fileType: 'video' | 'photo' | 'document' | undefined;

                if (post.video) {
                    fileId = post.video.file_id;
                    fileType = 'video';
                } else if (post.photo?.length) {
                    // Get highest resolution photo
                    fileId = post.photo[post.photo.length - 1].file_id;
                    fileType = 'photo';
                } else if (post.document) {
                    fileId = post.document.file_id;
                    fileType = 'document';
                } else {
                    return; // No valid file
                }

                const caption: string = post.caption || '';
                if (!caption) return;

                const parsed = this.parseCaption(caption);
                if (!parsed) {
                    await this.notifyOwner('⚠️ Sarlavha formati noto‘g‘ri');
                    return;
                }

                const exists = await this.moviesService.findByCode(parsed.code);
                if (exists) {
                    await this.notifyOwner(`⚠️ Kod ${parsed.code} mavjud. Kino saqlanmadi.`);
                    return;
                }

                await this.moviesService.createStrict({
                    code: parsed.code,
                    title: parsed.title,
                    category: parsed.category,
                    description: parsed.description,
                    fileId,
                    fileType,
                });

                await this.notifyOwner(`✅ Saqlandi #${parsed.code} — ${parsed.title}`);
            } catch (err: any) {
                console.error('channel_post error:', err);
                await this.notifyOwner(`❌ Xato: ${err?.message || 'nomaʼlum'}`);
            }
        });


        // ===== Broadcast =====
        this.bot.command('broadcast', async (ctx) => {
            if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
                return ctx.reply('❌ Sizda ruxsat yo‘q');
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (!args.length) {
                return ctx.reply('⚠️ Foydalanish:\n' +
                    '/broadcast <matn>\n' +
                    '/broadcast <kod>\n' +
                    '/broadcast <kod> <maxsus caption>');
            }

            const firstArg = args[0];

            // agar birinchi argument raqam bo‘lsa → movie code
            if (/^\d+$/.test(firstArg)) {
                const code = firstArg;
                const movie = await this.moviesService.findByCode(code);

                if (!movie || movie.isDeleted) {
                    return ctx.reply(`❌ Kino ${code} topilmadi yoki o‘chirildi`);
                }

                // caption → qolgan argumentlarni birlashtiramiz
                const caption = args.slice(1).join(' ') ||
                    `🎬 ${movie.title}\n🏷 ${movie.category ?? 'Nomaʼlum'}\n${movie.description ?? ''}`;

                ctx.reply(`📢 Kino #${code} yuborilmoqda...`);

                await this.broadcast([
                    { fileId: movie.fileId, fileType: movie.fileType, text: caption }
                ], "HTML");  // << parse_mode ni uzatamiz

                return ctx.reply(`✅ Kino #${code} yuborildi!`);
            }

            // oddiy matn broadcast
            const message = args.join(' ');
            await this.broadcast([{ text: message }], "HTML");
            return ctx.reply('✅ Tayyor!');
        });



        // ===== Movie by code =====
        this.bot.hears(/^\d+$/, async (ctx) => {
            if (!(await this.forceJoinCheck(ctx))) return;

            const code = ctx.message.text.trim();
            const movie = await this.moviesService.findByCode(code);

            if (!movie || movie.isDeleted)
                return ctx.reply('❌ Kino topilmadi yoki o‘chirildi');

            try {
                switch (movie.fileType) {
                    case 'photo':
                        await ctx.replyWithPhoto(movie.fileId, {
                            caption: `🎬 ${movie.title}\n🏷 ${movie.category ?? 'Nomaʼlum'}\n${movie.description ?? ''}`,
                        });
                        break;
                    case 'video':
                        await ctx.replyWithVideo(movie.fileId, {
                            caption: `🎬 ${movie.title}\n🏷 ${movie.category ?? 'Nomaʼlum'}\n${movie.description ?? ''}`,
                        });
                        break;
                    case 'document':
                    default:
                        await ctx.replyWithDocument(movie.fileId, {
                            caption: `🎬 ${movie.title}\n🏷 ${movie.category ?? 'Nomaʼlum'}\n${movie.description ?? ''}`,
                        });
                        break;
                }
            } catch (err: any) {
                console.error(`❌ Kino ${code} yuborilmadi:`, err.message);
                return ctx.reply('⚠️ Kino faylini yuborishda xato');
            }
        });


        // ===== Watchlist =====
        this.bot.command('save', async (ctx) => {
            if (!(await this.forceJoinCheck(ctx))) return;

            const [_, code] = ctx.message.text.split(/\s+/);
            if (!code) return ctx.reply('⚠️ Foydalanish: /save <kod>');

            try {
                const movie = await this.moviesService.findByCode(code);
                if (!movie || movie.isDeleted)
                    return ctx.reply('❌ Kino topilmadi yoki o‘chirildi');

                const msg = await this.watchlistService.addToWatchlist(
                    String(ctx.from.id),
                    code,
                );
                return ctx.reply(msg);
            } catch (e: any) {
                return ctx.reply(`❌ ${e?.message || 'Saqlashda xato yuz berdi'}`);
            }
        });

        this.bot.command('watchlist', async (ctx) => {
            if (!(await this.forceJoinCheck(ctx))) return;
            const msg = await this.watchlistService.getWatchlist(String(ctx.from.id));
            return ctx.reply(msg);
        });

        this.bot.command('remove', async (ctx) => {
            if (!(await this.forceJoinCheck(ctx))) return;

            const [_, code] = ctx.message.text.split(/\s+/);
            if (!code) return ctx.reply('⚠️ Foydalanish: /remove <kod>');

            const msg = await this.watchlistService.removeFromWatchlist(
                String(ctx.from.id),
                code,
            );
            return ctx.reply(msg);
        });

        // helper: normalize channel names
        function normalizeChannel(input: string): string | null {
            if (!input) return null;

            let clean = input.trim().replace(/[,]+$/, ''); // remove spaces/commas

            if (!clean) return null;

            if (clean.startsWith('https://t.me/')) {
                clean = '@' + clean.replace('https://t.me/', '').replace('/', '');
            }

            if (!clean.startsWith('@')) {
                clean = '@' + clean;
            }

            return clean;
        }


        // ===== Force-join =====
        this.bot.command('forceon', async (ctx) => {
            if (!ctx.from || !ADMINS.includes(ctx.from.id))
                return ctx.reply('❌ Sizda ruxsat yo‘q');

            const args = ctx.message.text
                .split(' ')
                .slice(1)
                .map(normalizeChannel)
                .filter((ch): ch is string => ch !== null);

            if (!args.length)
                return ctx.reply('⚠️ Foydalanish: /forceon @channel1 @channel2 ...');

            let added: string[] = [];
            for (const ch of args) {
                if (!this.forceJoinChannels.includes(ch)) {
                    this.forceJoinChannels.push(ch);
                    added.push(ch);
                }
            }

            if (this.forceJoinChannels.length > 0) this.forceJoinActive = true;

            if (added.length) {
                ctx.reply(
                    `✅ Force-join kanallar qo‘shildi: ${added.join(', ')}\n` +
                    `📌 Hozirgi ro‘yxat: ${this.forceJoinChannels.join(', ')}`
                );
            } else {
                ctx.reply('⚠️ Yangi kanal qo‘shilmadi, barchasi allaqachon ro‘yxatda.');
            }
        });

        this.bot.command('forceoff', async (ctx) => {
            if (!ctx.from || !ADMINS.includes(ctx.from.id))
                return ctx.reply('❌ Sizda ruxsat yo‘q');

            const args = ctx.message.text
                .split(' ')
                .slice(1)
                .map(normalizeChannel)
                .filter((ch): ch is string => ch !== null);

            // if no args → disable everything
            if (!args.length) {
                this.forceJoinChannels = [];
                this.forceJoinActive = false;
                return ctx.reply('✅ Force-join butunlay o‘chirildi.');
            }

            let removed: string[] = [];
            let notFound: string[] = [];

            for (const ch of args) {
                if (this.forceJoinChannels.includes(ch)) {
                    this.forceJoinChannels = this.forceJoinChannels.filter(c => c !== ch);
                    removed.push(ch);
                } else {
                    notFound.push(ch);
                }
            }

            if (this.forceJoinChannels.length === 0) {
                this.forceJoinActive = false;
            }

            let reply = '';
            if (removed.length) reply += `🗑️ O‘chirildi: ${removed.join(', ')}\n`;
            if (notFound.length) reply += `⚠️ Topilmadi (oldin qo‘shilmagan): ${notFound.join(', ')}\n`;
            if (this.forceJoinChannels.length)
                reply += `📌 Qolgan kanallar: ${this.forceJoinChannels.join(', ')}`;
            else
                reply += `⚠️ Hozircha hech qaysi kanal majburiy emas.`;

            ctx.reply(reply);
        });





        // ===== Enable/Disable movies =====
        this.bot.command('disable', async (ctx) => {
            if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
                return ctx.reply('❌ Sizda ruxsat yo‘q');
            }

            const [_, code] = ctx.message.text.split(/\s+/);
            if (!code) return ctx.reply('⚠️ Foydalanish: /disable <kod>');

            try {
                const movie = await this.moviesService.findByCode(code);
                if (!movie) {
                    return ctx.reply(`❌ Kino ${code} topilmadi`);
                }

                movie.isDeleted = true;
                await this.moviesService.update(movie);

                return ctx.reply(`🚫 Kino #${code} o‘chirildi`);
            } catch (err: any) {
                console.error('disable error:', err);
                return ctx.reply(`⚠️ Xato: ${err?.message || 'nomaʼlum xato'}`);
            }
        });

        this.bot.command('enable', async (ctx) => {
            if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
                return ctx.reply('❌ Sizda ruxsat yo‘q');
            }

            const parts = ctx.message.text.trim().split(/\s+/);
            const raw = parts[1];
            if (!raw) return ctx.reply('⚠️ Foydalanish: /enable <kod>');

            const code = raw.replace(/^#/, '').trim();

            try {
                await this.moviesService.setDeleted(code, false);
                return ctx.reply(`✅ Kino #${code} qayta yoqildi`);
            } catch (err: any) {
                console.error('enable error:', err);
                return ctx.reply(`⚠️ Xato: ${err?.message || 'nomaʼlum xato'}`);
            }
        });


        // ===== Stats with pagination =====
        this.bot.command('stats', async (ctx) => {
            const userId = ctx.from?.id;
            const totalUsers = await this.userService.countUsers();

            if (!userId || !ADMINS.includes(userId)) {
                return ctx.reply(`👥 Bot foydalanuvchilari soni: ${totalUsers}`);
            }

            const users = await this.userService.findAll();
            if (!users.length) {
                return ctx.reply('⚠️ Hali foydalanuvchilar yo‘q');
            }

            const pageSize = 10;
            const page = 1;
            const totalPages = Math.ceil(users.length / pageSize);

            const slice = users.slice(0, pageSize);
            const text = slice
                .map((u, i) => `${i + 1}. @${u.username ?? u.telegramId}`)
                .join('\n');

            await ctx.reply(
                `📊 Jami foydalanuvchilar: ${users.length} (Page ${page}/${totalPages})\n\n${text}`,
                {
                    reply_markup: {
                        inline_keyboard: totalPages > 1 ? [
                            [{ text: '➡️ Next', callback_data: `stats_page_${page + 1}` }]
                        ] : []
                    }
                }
            );
        });

        this.bot.action(/stats_page_(\d+)/, async (ctx) => {
            if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

            const page = Number(ctx.match[1]);
            const users = await this.userService.findAll();
            const pageSize = 10;
            const totalPages = Math.ceil(users.length / pageSize);

            const start = (page - 1) * pageSize;
            const slice = users.slice(start, start + pageSize);

            const text = slice
                .map((u, i) => `${start + i + 1}. @${u.username ?? u.telegramId}`)
                .join('\n');

            const buttons: any[] = [];
            if (page > 1) buttons.push({ text: '⬅️ Prev', callback_data: `stats_page_${page - 1}` });
            if (page < totalPages) buttons.push({ text: '➡️ Next', callback_data: `stats_page_${page + 1}` });

            await ctx.editMessageText(
                `📊 Jami foydalanuvchilar: ${users.length} (Page ${page}/${totalPages})\n\n${text}`,
                {
                    reply_markup: { inline_keyboard: [buttons] }
                }
            );

            // call answerCbQuery without awaiting (keeps compatibility)
            ctx.answerCbQuery();
        });

        // ===== Help =====
        this.bot.command('help', async (ctx) => {
            return ctx.reply(
                "Ushbu bot orqali istalgan filmingizni tomosha qilishingiz mumkin. \n" +
                "Film kodini yozing va tomosha qiling! \n" +
                "Kod namunasi: 915 \n\n" +
                "Buyruqlar ustiga biroz bosib turing, \nbuyruq kommandasi ekranga chiqgach kino kodini kiritishingiz mumkin va saqlash, o`chirish yoki boshqa operatsiyalar uchun foydalaning. \n" +
                "📬 Savollar yoki muammolar bo‘lsa, admin bilan bog‘laning 👇",
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "📩 Admin bilan bog‘lanish", url: "https://t.me/OnLastBreath" }
                            ]
                        ]
                    }
                }
            );
        });

        // ===== Track new users =====
        this.bot.use(async (ctx, next) => {
            if (ctx.from?.id) {
                const id = ctx.from.id.toString();
                if (!this.knownUsers.has(id)) {
                    await this.userService.saveIfNotExists(id, ctx.from.username);
                    this.knownUsers.add(id);
                }
            }
            return next();
        });

        // ===== Start command =====
        this.bot.start(async (ctx) => {
            if (!(await this.forceJoinCheck(ctx))) return; // ⬅️ check subscription first
            await ctx.reply('👋 Xush kelibsiz! Kino kodini yuboring yoki /help buyrug‘idan foydalaning.');
        });
    }

    private async forceJoinCheck(ctx: any): Promise<boolean> {
        if (!this.forceJoinActive || !ctx.from) return true;

        const userId = ctx.from.id;
        let notJoined: string[] = [];

        for (const ch of this.forceJoinChannels) {
            try {
                const member = await this.bot.telegram.getChatMember(ch, userId);
                if (!['member', 'administrator', 'creator'].includes(member.status)) {
                    notJoined.push(ch);
                }
            } catch {
                notJoined.push(ch);
            }
        }

        if (notJoined.length) {
            await ctx.reply(
                `❌ Siz hali quyidagi kanallarga qo‘shilmadingiz: ${notJoined.join(', ')}\n` +
                `✅ Iltimos, kanallarga qo‘shiling va keyin yana urinib ko‘ring.`
            );
            return false;
        }

        return true;
    }

    private async sendToUser(user: { telegramId: string }, content: any) {
        try {
            if (content.type === "text") {
                await this.bot.telegram.sendMessage(user.telegramId, content.text, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                } as any);
            }

            if (content.type === "photo") {
                await this.bot.telegram.sendPhoto(user.telegramId, content.fileIdOrUrl, {
                    caption: content.caption || "",
                    parse_mode: "HTML",
                });
            }

            if (content.type === "video") {
                await this.bot.telegram.sendVideo(user.telegramId, content.fileIdOrUrl, {
                    caption: content.caption || "",
                    parse_mode: "HTML",
                    supports_streaming: true,
                });
            }

            if (content.type === "document") {
                await this.bot.telegram.sendDocument(user.telegramId, content.fileIdOrUrl, {
                    caption: content.caption || "",
                    parse_mode: "HTML",
                });
            }

            if (content.type === "animation") {
                await this.bot.telegram.sendAnimation(user.telegramId, content.fileIdOrUrl, {
                    caption: content.caption || "",
                    parse_mode: "HTML",
                });
            }

            return true;
        } catch (err: any) {
            if (err?.response?.error_code === 403 || err?.response?.error_code === 400) {
                // User blocked bot or deactivated account
                await this.userService.remove(user.telegramId);
            }
            return false;
        }
    }


    private async broadcast(
        items: Array<{ text?: string; fileId?: string; fileType?: 'photo' | 'video' | 'document' | 'animation' }>,
        parseMode: "HTML" | "MarkdownV2" | undefined = undefined
    ) {
        const users = await this.userService.findAll();
        console.log('📌 Foydalanuvchilar soni:', users.length);

        // split into chunks of 25 users (Telegram safe rate)
        const chunks = this.chunkArray(users, 25);

        for (const chunk of chunks) {
            await Promise.allSettled(chunk.map(async (user) => {
                if (!user.telegramId) return;

                for (const item of items) {
                    const options: any = {};
                    if (item.text) options.caption = item.text;
                    if (parseMode) options.parse_mode = parseMode;

                    try {
                        switch (item.fileType) {
                            case 'photo':
                                await this.bot.telegram.sendPhoto(user.telegramId, item.fileId!, options);
                                break;
                            case 'video':
                                await this.bot.telegram.sendVideo(user.telegramId, item.fileId!, options);
                                break;
                            case 'document':
                                await this.bot.telegram.sendDocument(user.telegramId, item.fileId!, options);
                                break;
                            case 'animation':
                                await this.bot.telegram.sendAnimation(user.telegramId, item.fileId!, options);
                                break;
                            default:
                                if (item.text) {
                                    await this.bot.telegram.sendMessage(user.telegramId, item.text, { parse_mode: parseMode });
                                }
                                break;
                        }
                    } catch (err: any) {
                        const msg = err?.message || 'nomaʼlum xato';
                        console.error(`❌ ${user.telegramId} ga yuborilmadi: ${msg}`);

                        if (msg.includes('Forbidden') || msg.includes('user is deactivated')) {
                            try {
                                await this.userService.remove(user.telegramId);
                                console.log(`🗑️ ${user.telegramId} bazadan o‘chirildi`);
                            } catch (removeErr: any) {
                                console.error(`❌ ${user.telegramId} ni bazadan o‘chirishda xato:`, removeErr.message);
                            }
                        }
                    }
                }
            }));

            // wait 1 second before next batch (to respect Telegram flood limits)
            await new Promise(res => setTimeout(res, 1000));
        }
    }



    private chunkArray<T>(arr: T[], size: number): T[][] {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }



    private async notifyOwner(msg: string) {
        if (owner) {
            try {
                await this.bot.telegram.sendMessage(owner, msg);
            } catch (e) {
                console.error('❌ Egaga xabar yuborilmadi:', e);
            }
        }
    }

    private async cacheUsers() {
        const users = await this.userService.findAll();
        users.forEach(u => this.knownUsers.add(String(u.telegramId)));
        console.log(`📥 ${this.knownUsers.size} foydalanuvchi keshlandi`);
    }

    private parseCaption(caption: string): ParsedCaption | null {
        const lines = caption.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return null;

        const first = lines[0];
        const m = first.match(/^\s*#?(\d+)\s*[-:–]*\s*(.+)$/);
        if (!m) return null;

        const code = m[1];
        const title = (m[2] || '').trim();
        if (!code || !title) return null;

        let category: string | undefined;
        let description: string | undefined;

        for (let i = 1; i < lines.length; i++) {
            const l = lines[i];
            const cat = l.match(/^Category:\s*(.+)$/i);
            if (cat) {
                category = cat[1].trim();
                continue;
            }
            const desc = l.match(/^Description:\s*(.+)$/i);
            if (desc) {
                description = [desc[1], ...lines.slice(i + 1)].join('\n').trim();
                break;
            }
        }

        return { code, title, category, description };
    }
}
