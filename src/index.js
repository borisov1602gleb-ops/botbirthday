require('dotenv').config();
const { Telegraf } = require('telegraf');
const db = require('./db');
const { parseDate, formatDate } = require('./dates');
const { startScheduler, checkAndSendReminders } = require('./scheduler');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Не задан BOT_TOKEN. Скопируйте .env.example в .env и укажите токен бота.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const HELP_TEXT = `Я напоминаю о днях рождения сотрудников: за 3 дня и в сам день.

Команды:
/add Имя Фамилия ДД.ММ.ГГГГ — добавить сотрудника (год можно не указывать: ДД.ММ)
/list — список всех сохранённых дней рождения
/remove ID — удалить запись (ID смотрите в /list)
/today — у кого сегодня день рождения
/help — эта справка

Добавляйте бота в общий чат команды — напоминания будут приходить туда же.`;

bot.start((ctx) => ctx.reply(HELP_TEXT));
bot.help((ctx) => ctx.reply(HELP_TEXT));

bot.command('add', (ctx) => {
  const text = ctx.message.text.replace(/^\/add(@\w+)?\s*/, '').trim();
  if (!text) {
    return ctx.reply('Формат: /add Имя Фамилия ДД.ММ.ГГГГ\nПример: /add Иван Петров 15.03.1990');
  }

  const tokens = text.split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  const parsed = parseDate(lastToken);

  if (!parsed) {
    return ctx.reply(
      'Не удалось распознать дату. Укажите её последним значением в формате ДД.ММ или ДД.ММ.ГГГГ.\nПример: /add Иван Петров 15.03.1990'
    );
  }

  const name = tokens.slice(0, -1).join(' ').trim();
  if (!name) {
    return ctx.reply('Укажите имя сотрудника перед датой.\nПример: /add Иван Петров 15.03.1990');
  }

  const id = db.addBirthday(ctx.chat.id, name, parsed.day, parsed.month, parsed.year);
  ctx.reply(
    `Добавлено: ${name} — ${formatDate(parsed.day, parsed.month, parsed.year)} (ID ${id})`
  );
});

bot.command('list', (ctx) => {
  const birthdays = db.listBirthdays(ctx.chat.id);
  if (birthdays.length === 0) {
    return ctx.reply('Список пуст. Добавьте сотрудника командой /add.');
  }

  const lines = birthdays.map(
    (b) => `#${b.id} — ${b.name} — ${formatDate(b.day, b.month, b.year)}`
  );
  ctx.reply(lines.join('\n'));
});

bot.command('remove', (ctx) => {
  const arg = ctx.message.text.replace(/^\/remove(@\w+)?\s*/, '').trim();
  const id = Number(arg);
  if (!arg || Number.isNaN(id)) {
    return ctx.reply('Формат: /remove ID (номер записи из /list)');
  }

  const removed = db.removeBirthday(ctx.chat.id, id);
  ctx.reply(removed ? `Запись #${id} удалена.` : `Запись #${id} не найдена.`);
});

bot.command('today', (ctx) => {
  const { todayInTZ } = require('./dates');
  const today = todayInTZ(process.env.TZ || 'Europe/Moscow');
  const matches = db
    .listBirthdays(ctx.chat.id)
    .filter((b) => b.day === today.day && b.month === today.month);

  if (matches.length === 0) {
    return ctx.reply('Сегодня дней рождения нет.');
  }

  ctx.reply('Сегодня день рождения у: ' + matches.map((b) => b.name).join(', '));
});

bot.launch().then(() => {
  console.log('Бот запущен.');
  startScheduler(bot);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { bot, checkAndSendReminders };
