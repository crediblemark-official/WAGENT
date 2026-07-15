import color from 'picocolors';
import { loadConfig, EscalationService } from '@wagent/core';

export async function testEscalation(options: { message: string }): Promise<void> {
  const config = await loadConfig();

  if (!config.telegramBotToken) {
    console.log(color.red('\n✗ TELEGRAM_BOT_TOKEN tidak dikonfigurasi.'));
    console.log(color.dim('  Set environment variable:'));
    console.log(color.dim('  export TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234...'));
    console.log('');
    return;
  }

  if (!config.telegramChatId) {
    console.log(color.red('\n✗ TELEGRAM_CHAT_ID tidak dikonfigurasi.'));
    console.log(color.dim('  Set environment variable:'));
    console.log(color.dim('  export TELEGRAM_CHAT_ID=-123456789'));
    console.log('');
    return;
  }

  const escalation = new EscalationService(config);

  console.log('');
  console.log(color.bold('🚨 Mengirim test escalation ke Telegram...'));
  console.log('');
  console.log(color.cyan(`  Chat ID: ${config.telegramChatId}`));
  console.log(color.cyan(`  Token  : ${config.telegramBotToken.substring(0, 10)}...`));
  console.log('');

  const sent = await escalation.escalate({
    contactId: '62812xxxxxxx@s.whatsapp.net',
    contactName: 'Test Customer',
    customerMessage: options.message,
    reason: 'ai_explicit_escalation',
    details: 'Test escalation dari CLI',
  });

  if (sent) {
    console.log(color.green('✅ Escalation berhasil dikirim ke Telegram!'));
    console.log(color.dim('  Cek grup Telegram untuk melihat pesan test.'));
  } else {
    console.log(color.red('✗ Gagal mengirim escalation.'));
    console.log(color.dim('  Periksa:'));
    console.log(color.dim('  1. Token bot valid? (buat di @BotFather)'));
    console.log(color.dim('  2. Bot sudah ditambahkan ke grup?'));
    console.log(color.dim('  3. Chat ID benar? (gunakan @getidsbot untuk cek)'));
  }
  console.log('');
}
