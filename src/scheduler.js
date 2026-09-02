const cron = require('node-cron');
const db = require('./db');
const { todayInTZ, addDays, isoDate, formatDate, age } = require('./dates');
const { randomGreeting } = require('./greetings');

const TZ = process.env.TZ || 'Europe/Moscow';

async function checkAndSendReminders(bot) {
  const today = todayInTZ(TZ);
  const in3Days = addDays(today, 3);
  const sentOn = isoDate(today);

  for (const chatId of db.getAllChats()) {
    const birthdays = db.listBirthdays(chatId);

    for (const b of birthdays) {
      const isToday = b.day === today.day && b.month === today.month;
      const isIn3Days = b.day === in3Days.day && b.month === in3Days.month;

      if (isToday && !db.wasReminderSent(b.id, 'today', sentOn)) {
        const years = age(b.year, today.year);
        await bot.telegram.sendMessage(chatId, randomGreeting(b.name, years));
        db.markReminderSent(chatId, b.id, 'today', sentOn);
      }

      if (isIn3Days && !db.wasReminderSent(b.id, 'soon', sentOn)) {
        await bot.telegram.sendMessage(
          chatId,
          `📅 Через 3 дня (${formatDate(b.day, b.month)}) день рождения у ${b.name}.`
        );
        db.markReminderSent(chatId, b.id, 'soon', sentOn);
      }
    }
  }
}

function startScheduler(bot) {
  const reminderTime = process.env.REMINDER_TIME || '09:00';
  const [hour, minute] = reminderTime.split(':').map(Number);

  cron.schedule(`${minute} ${hour} * * *`, () => {
    checkAndSendReminders(bot).catch((err) =>
      console.error('Ошибка при отправке напоминаний:', err)
    );
  }, { timezone: TZ });

  console.log(`Планировщик запущен: проверка ДР ежедневно в ${reminderTime} (${TZ})`);
}

module.exports = { startScheduler, checkAndSendReminders };
