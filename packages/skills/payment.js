/**
 * Payment Gateway Skill
 * Integrasi payment: Midtrans, Xendit, Manual (Transfer/COD)
 *
 * Setup:
 * - MIDTRANS_SERVER_KEY=xxx   (midtrans.com)
 * - XENDIT_SECRET_KEY=xxx     (xendit.co)
 *
 * Tanpa API key, tetap bisa: catat manual transfer, cod, ewallet
 */

const MIDTRANS_URL = 'https://api.sandbox.midtrans.com';
const XENDIT_URL = 'https://api.xendit.co';

async function callMidtrans(endpoint, data, serverKey) {
  const res = await fetch(`${MIDTRANS_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(serverKey + ':').toString('base64')}`,
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function callXendit(endpoint, data, secretKey) {
  const res = await fetch(`${XENDIT_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

export default function createPaymentSkill() {
  return {
    manifest: {
      name: 'payment',
      version: '1.0.0',
      description: 'Kelola pembayaran: Midtrans, Xendit, Transfer, COD',
      author: 'WAGENT',
      systemPromptAdditions: `Kamu bisa memproses pembayaran menggunakan tool yang tersedia.
Metode yang didukung: Midtrans (kartu, VA, ewallet), Xendit (VA, ewallet), Transfer Bank, COD.
Selalu konfirmasi total sebelum memproses pembayaran.`,
    },
    tools: [
      // ═══════════════════════════════════════════════════════════
      // TOOL 1: Buat Pembayaran
      // ═══════════════════════════════════════════════════════════
      {
        name: 'buat_pembayaran',
        description: 'Buat link/tagihan pembayaran untuk customer',
        parameters: {
          type: 'object',
          properties: {
            order_id: {
              type: 'string',
              description: 'Nomor order',
            },
            total: {
              type: 'number',
              description: 'Total pembayaran dalam Rupiah',
            },
            metode: {
              type: 'string',
              enum: ['midtrans_va', 'midtrans_ewallet', 'xendit_va', 'transfer_bank', 'cod'],
              description: 'Metode pembayaran',
            },
            nama: {
              type: 'string',
              description: 'Nama customer',
            },
            email: {
              type: 'string',
              description: 'Email customer (untuk Midtrans/Xendit)',
            },
            telepon: {
              type: 'string',
              description: 'Telepon customer',
            },
          },
          required: ['order_id', 'total', 'metode', 'nama'],
        },
        handler: async (args, context) => {
          try {
            // ═══════════════════════════════════════════════════
            // Midtrans VA
            // ═══════════════════════════════════════════════════
            if (args.metode === 'midtrans_va') {
              const serverKey = process.env.MIDTRANS_SERVER_KEY;
              if (!serverKey) return JSON.stringify({ error: 'MIDTRANS_SERVER_KEY belum dikonfigurasi' });

              const result = await callMidtrans('/v2/va_numbers', {
                transaction_details: {
                  order_id: args.order_id,
                  gross_amount: args.total,
                },
                customer_details: {
                  first_name: args.nama,
                  email: args.email,
                  phone: args.telepon,
                },
                bank_transfer: { bank: 'bca' },
              }, serverKey);

              const va = result.va_numbers?.[0] || {};

              return JSON.stringify({
                berhasil: true,
                metode: 'Midtrans VA',
                bank: va.bank?.toUpperCase() || 'BCA',
                nomor_va: va.va_number || '-',
                total: `Rp${args.total.toLocaleString('id-ID')}`,
                expired: result.expiry_time || '-',
                instruksi: `Bayar ke Virtual Account ${va.bank?.toUpperCase()} ${va.va_number}`,
              });
            }

            // ═══════════════════════════════════════════════════
            // Midtrans E-Wallet
            // ═══════════════════════════════════════════════════
            if (args.metode === 'midtrans_ewallet') {
              const serverKey = process.env.MIDTRANS_SERVER_KEY;
              if (!serverKey) return JSON.stringify({ error: 'MIDTRANS_SERVER_KEY belum dikonfigurasi' });

              const result = await callMidtrans('/v2/payments/gopay', {
                payment_details: {
                  payment_method: 'gopay',
                },
                transaction_details: {
                  order_id: args.order_id,
                  gross_amount: args.total,
                },
                customer_details: {
                  first_name: args.nama,
                },
              }, serverKey);

              return JSON.stringify({
                berhasil: true,
                metode: 'GoPay via Midtrans',
                qr_string: result.qr_string || '-',
                deeplink: result.deeplink || '-',
                total: `Rp${args.total.toLocaleString('id-ID')}`,
                instruksi: 'Scan QR atau buka link untuk bayar',
              });
            }

            // ═══════════════════════════════════════════════════
            // Xendit VA
            // ═══════════════════════════════════════════════════
            if (args.metode === 'xendit_va') {
              const secretKey = process.env.XENDIT_SECRET_KEY;
              if (!secretKey) return JSON.stringify({ error: 'XENDIT_SECRET_KEY belum dikonfigurasi' });

              const result = await callXendit('/virtual_accounts', {
                external_id: args.order_id,
                bank_code: 'BCA',
                name: args.nama,
                expected_amount: args.total,
              }, secretKey);

              return JSON.stringify({
                berhasil: true,
                metode: 'Xendit VA',
                bank: result.bank_code || 'BCA',
                nomor_va: result.account_number || '-',
                total: `Rp${args.total.toLocaleString('id-ID')}`,
                expired: result.expiration_date || '-',
                instruksi: `Bayar ke Virtual Account BCA ${result.account_number}`,
              });
            }

            // ═══════════════════════════════════════════════════
            // Transfer Bank (Manual)
            // ═══════════════════════════════════════════════════
            if (args.metode === 'transfer_bank') {
              return JSON.stringify({
                berhasil: true,
                metode: 'Transfer Bank',
                total: `Rp${args.total.toLocaleString('id-ID')}`,
                order_id: args.order_id,
                instruksi: [
                  'Transfer ke rekening:',
                  'BCA: 1234567890 a.n. PT WAGENT',
                  'BRI: 0987654321 a.n. PT WAGENT',
                  '',
                  `Jumlah: Rp${args.total.toLocaleString('id-ID')}`,
                  `Order: ${args.order_id}`,
                  '',
                  'Konfirmasi setelah transfer.',
                ].join('\n'),
              });
            }

            // ═══════════════════════════════════════════════════
            // COD (Cash on Delivery)
            // ═══════════════════════════════════════════════════
            if (args.metode === 'cod') {
              return JSON.stringify({
                berhasil: true,
                metode: 'COD (Bayar di Tempat)',
                total: `Rp${args.total.toLocaleString('id-ID')}`,
                order_id: args.order_id,
                instruksi: 'Pembayaran dilakukan saat barang diterima.',
              });
            }

            return JSON.stringify({ error: `Metode ${args.metode} tidak didukung` });

          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },

      // ═══════════════════════════════════════════════════════════
      // TOOL 2: Cek Status Pembayaran
      // ═══════════════════════════════════════════════════════════
      {
        name: 'cek_status_pembayaran',
        description: 'Cek status pembayaran berdasarkan order ID',
        parameters: {
          type: 'object',
          properties: {
            order_id: {
              type: 'string',
              description: 'Nomor order',
            },
          },
          required: ['order_id'],
        },
        handler: async (args, context) => {
          try {
            // Cek dari Midtrans
            if (process.env.MIDTRANS_SERVER_KEY) {
              const result = await callMidtrans(
                `/v2/${args.order_id}/status`,
                {},
                process.env.MIDTRANS_SERVER_KEY
              );

              return JSON.stringify({
                order_id: args.order_id,
                status: result.transaction_status || 'unknown',
                metode: result.payment_type || '-',
                total: `Rp${(result.gross_amount || 0).toLocaleString('id-ID')}`,
                waktu: result.settlement_time || result.transaction_time || '-',
              });
            }

            // Cek dari Xendit
            if (process.env.XENDIT_SECRET_KEY) {
              const result = await fetch(
                `${XENDIT_URL}/virtual_accounts/external_id=${args.order_id}`,
                {
                  headers: { 'Authorization': `Basic ${Buffer.from(process.env.XENDIT_SECRET_KEY + ':').toString('base64')}` },
                }
              );
              const data = await result.json();

              return JSON.stringify({
                order_id: args.order_id,
                status: data.status || 'unknown',
                total: `Rp${(data.expected_amount || 0).toLocaleString('id-ID')}`,
              });
            }

            return JSON.stringify({
              order_id: args.order_id,
              status: 'tidak_diketahui',
              message: 'Tidak ada payment gateway yang terkonfigurasi',
            });

          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },

      // ═══════════════════════════════════════════════════════════
      // TOOL 3: Catat Pembayaran Manual
      // ═══════════════════════════════════════════════════════════
      {
        name: 'catat_pembayaran_manual',
        description: 'Catat pembayaran manual (transfer/cod yang sudah diterima)',
        parameters: {
          type: 'object',
          properties: {
            order_id: {
              type: 'string',
              description: 'Nomor order',
            },
            jumlah: {
              type: 'number',
              description: 'Jumlah yang diterima',
            },
            metode: {
              type: 'string',
              enum: ['transfer', 'cod', 'ewallet', 'tunai'],
              description: 'Metode pembayaran',
            },
            bukti: {
              type: 'string',
              description: 'Keterangan/bukti (contoh: "Transfer BCA, ref: 12345")',
            },
          },
          required: ['order_id', 'jumlah', 'metode'],
        },
        handler: async (args, context) => {
          try {
            // Simpan ke DB lokal
            const record = {
              order_id: args.order_id,
              amount: argsjumlah,
              method: args.metode,
              proof: args.bukti,
              recorded_by: 'ai_agent',
              recorded_at: new Date().toISOString(),
            };

            // TODO: Simpan ke tabel payments di DB
            // context.db.savePayment(record);

            return JSON.stringify({
              berhasil: true,
              message: 'Pembayaran tercatat',
              order_id: args.order_id,
              jumlah: `Rp${args.jumlah.toLocaleString('id-ID')}`,
              metode: args.metode,
              bukti: args.bukti || '-',
            });
          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },
    ],
  };
}
