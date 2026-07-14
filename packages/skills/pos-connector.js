/**
 * POS Connector Skill - Template
 * Integrasi dengan POS/E-commerce system yang sudah ada
 *
 * Cara pakai:
 * 1. Copy template ini
 * 2. Ganti API endpoint dan auth sesuai POS kamu
 * 3. Implementasi handler sesuai kebutuhan
 *
 * Supported platforms (contoh integrasi):
 * - Shopee Open Platform
 * - Tokopedia Open API
 * - Lazada Open Platform
 * - Custom POS (REST API)
 * - WooCommerce (WordPress)
 * - Shopify
 */

async function callAPI(url, options = {}) {
  const apiKey = process.env.POS_API_KEY;
  const apiSecret = process.env.POS_API_SECRET;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`POS API error: ${res.status} - ${error}`);
  }

  return res.json();
}

export default function createPOSConnectorSkill() {
  return {
    manifest: {
      name: 'pos-connector',
      version: '1.0.0',
      description: 'Koneksi ke POS/E-commerce system yang sudah ada',
      author: 'WAGENT',
      systemPromptAdditions: `Kamu terhubung ke sistem POS/e-commerce.
Kamu bisa: melihat produk, cek stok, lihat pesanan, buat pesanan baru.
Gunakan tools yang tersedia untuk mengelola data.`,
    },
    tools: [
      // ═══════════════════════════════════════════════════════════
      // TOOL 1: Cari Produk
      // ═══════════════════════════════════════════════════════════
      {
        name: 'cari_produk',
        description: 'Cari produk berdasarkan nama atau SKU',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Nama produk atau SKU',
            },
            limit: {
              type: 'number',
              description: 'Banyak hasil (default: 5)',
            },
          },
          required: ['query'],
        },
        handler: async (args, context) => {
          try {
            // ═══════════════════════════════════════════════════════
            // GANTI: Sesuaikan dengan API POS kamu
            // ═══════════════════════════════════════════════════════
            const result = await callAPI(
              `${process.env.POS_API_URL}/products?search=${args.query}&limit=${args.limit || 5}`
            );

            const products = result.data || result.products || [];

            return JSON.stringify({
              jumlah: products.length,
              produk: products.map(p => ({
                id: p.id,
                nama: p.name || p.nama,
                sku: p.sku,
                harga: `Rp${(p.price || p.harga || 0).toLocaleString('id-ID')}`,
                stok: p.stock || p.stok || 0,
                kategori: p.category || p.kategori,
                status: (p.stock || p.stok || 0) > 0 ? 'Tersedia' : 'Habis',
              })),
            });
          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },

      // ═══════════════════════════════════════════════════════════
      // TOOL 2: Cek Stok Produk
      // ═══════════════════════════════════════════════════════════
      {
        name: 'cek_stok',
        description: 'Cek ketersediaan stok produk',
        parameters: {
          type: 'object',
          properties: {
            produk_id: {
              type: 'string',
              description: 'ID produk',
            },
            nama_produk: {
              type: 'string',
              description: 'Nama produk (alternatif jika tidak ada ID)',
            },
          },
        },
        handler: async (args, context) => {
          try {
            const identifier = args.produk_id || args.nama_produk;
            const result = await callAPI(
              `${process.env.POS_API_URL}/products/${identifier}`
            );

            const product = result.data || result;

            return JSON.stringify({
              id: product.id,
              nama: product.name || product.nama,
              stok: product.stock || product.stok || 0,
              status: (product.stock || product.stok || 0) > 0 ? 'Tersedia' : 'Habis',
              gudang: product.warehouse || product.gudang || '-',
            });
          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },

      // ═══════════════════════════════════════════════════════════
      // TOOL 3: Lihat Pesanan
      // ═══════════════════════════════════════════════════════════
      {
        name: 'lihat_pesanan',
        description: 'Lihat detail pesanan berdasarkan nomor order',
        parameters: {
          type: 'object',
          properties: {
            nomor_order: {
              type: 'string',
              description: 'Nomor order/pesanan',
            },
          },
          required: ['nomor_order'],
        },
        handler: async (args, context) => {
          try {
            const result = await callAPI(
              `${process.env.POS_API_URL}/orders/${args.nomor_order}`
            );

            const order = result.data || result;

            return JSON.stringify({
              nomor: order.order_number || order.nomor,
              status: order.status,
              pelanggan: order.customer?.name || order.pelanggan?.nama || '-',
              items: (order.items || order.item || []).map(i => ({
                produk: i.product_name || i.nama_produk,
                qty: i.quantity || i.qty,
                harga: `Rp${(i.price || i.harga || 0).toLocaleString('id-ID')}`,
              })),
              total: `Rp${(order.total || order.total_amount || 0).toLocaleString('id-ID')}`,
              alamat: order.shipping_address || order.alamat || '-',
              catatan: order.notes || order.catatan || '-',
            });
          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },

      // ═══════════════════════════════════════════════════════════
      // TOOL 4: Buat Pesanan Baru
      // ═══════════════════════════════════════════════════════════
      {
        name: 'buat_pesanan',
        description: 'Buat pesanan baru di POS',
        parameters: {
          type: 'object',
          properties: {
            pelanggan: {
              type: 'object',
              properties: {
                nama: { type: 'string' },
                telepon: { type: 'string' },
                email: { type: 'string' },
              },
              required: ['nama', 'telepon'],
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  produk_id: { type: 'string' },
                  nama: { type: 'string' },
                  qty: { type: 'number' },
                  harga: { type: 'number' },
                },
              },
              description: 'Item yang dipesan',
            },
            alamat_pengiriman: {
              type: 'string',
              description: 'Alamat pengiriman lengkap',
            },
            catatan: {
              type: 'string',
              description: 'Catatan pesanan',
            },
            metode_bayar: {
              type: 'string',
              enum: ['cod', 'transfer', 'ewallet', 'cc'],
              description: 'Metode pembayaran',
            },
          },
          required: ['pelanggan', 'items', 'alamat_pengiriman'],
        },
        handler: async (args, context) => {
          try {
            // Hitung total
            const total = args.items.reduce((sum, i) => sum + (i.harga * i.qty), 0);

            const orderData = {
              customer: {
                name: args.pelanggan.nama,
                phone: args.pelanggan.telepon,
                email: args.pelanggan.email,
              },
              items: args.items.map(i => ({
                product_id: i.produk_id,
                name: i.nama,
                quantity: i.qty,
                price: i.harga,
              })),
              total_amount: total,
              shipping_address: args.alamat_pengiriman,
              notes: args.catatan,
              payment_method: args.metode_bayar || 'cod',
              status: 'pending',
            };

            const result = await callAPI(
              `${process.env.POS_API_URL}/orders`,
              {
                method: 'POST',
                body: JSON.stringify(orderData),
              }
            );

            const order = result.data || result;

            return JSON.stringify({
              berhasil: true,
              nomor_order: order.order_number || order.nomor || `ORD-${Date.now()}`,
              total: `Rp${total.toLocaleString('id-ID')}`,
              status: 'pending',
              catatan: 'Pesanan dibuat. Menunggu konfirmasi.',
            });
          } catch (err) {
            return JSON.stringify({ error: err.message, berhasil: false });
          }
        },
      },

      // ═══════════════════════════════════════════════════════════
      // TOOL 5: Update Status Pesanan
      // ═══════════════════════════════════════════════════════════
      {
        name: 'update_status_pesanan',
        description: 'Update status pesanan',
        parameters: {
          type: 'object',
          properties: {
            nomor_order: {
              type: 'string',
              description: 'Nomor order',
            },
            status: {
              type: 'string',
              enum: ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
              description: 'Status baru',
            },
            resi: {
              type: 'string',
              description: 'Nomor resi (jika status: shipped)',
            },
          },
          required: ['nomor_order', 'status'],
        },
        handler: async (args, context) => {
          try {
            const updateData: any = { status: args.status };
            if (args.resi) updateData.tracking_number = args.resi;

            await callAPI(
              `${process.env.POS_API_URL}/orders/${args.nomor_order}/status`,
              {
                method: 'PATCH',
                body: JSON.stringify(updateData),
              }
            );

            return JSON.stringify({
              berhasil: true,
              nomor_order: args.nomor_order,
              status_baru: args.status,
            });
          } catch (err) {
            return JSON.stringify({ error: err.message, berhasil: false });
          }
        },
      },
    ],
  };
}
