// We use qrcode-terminal via the whatsapp package
// This is a wrapper for displaying QR codes in the terminal

export function displayQRMessage(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║                                              ║');
  console.log('║   📱 SCAN QR CODE DI BAWAH INI              ║');
  console.log('║                                              ║');
  console.log('║   Buka WhatsApp > Linked Devices             ║');
  console.log('║   > Link a Device                           ║');
  console.log('║                                              ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}
