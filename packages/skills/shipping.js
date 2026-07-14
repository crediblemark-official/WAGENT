/**
 * Shipping Skill - Multi Provider
 * Mendukung semua shipping aggregator & kurir di Indonesia
 *
 * Setup:
 * 1. Pilih provider yang ingin digunakan
 * 2. Daftar API key di provider tersebut
 * 3. Set env variable sesuai provider
 *
 * Supported providers (Aggregator):
 * - RAJAONGKIR_API_KEY  → rajaongkir.com
 * - SHIPPER_API_KEY     → shipper.id
 * - BITESHIP_API_KEY    → biteship.com
 * - KIRIMINAJA_API_KEY  → kiriminaja.com
 * - POPAKET_API_KEY     → popaket.com
 * - AUTOKIRIM_API_KEY   → autokirim.com
 * - APIKURIR_API_KEY    → apikurir.id
 * - APICO_ID_API_KEY    → api.co.id
 *
 * Supported kurir (direct):
 * - JNE_API_KEY         → jne.co.id
 * - JNT_API_KEY         → j&texpress.co.id
 * - SICEPAT_API_KEY     → sicepat.com
 * - ANTERAJA_API_KEY    → anteraja.com
 * - TIKI_API_KEY        → tiki.id
 * - POS_API_KEY         → posindonesia.co.id
 * - LION_API_KEY        → lionparcel.com
 * - NINJA_API_KEY       → ninjavan.co
 * - GRAB_API_KEY        → grab.com (GoSend/GrabExpress)
 */

const PROVIDERS = {
  // ═══════════════════════════════════════════════════════════════
  // AGGREGATORS (multi-kurir)
  // ═══════════════════════════════════════════════════════════════
  rajaongkir: {
    name: 'RajaOngkir',
    baseUrl: 'https://api.rajaongkir.com/starter',
    envKey: 'RAJAONGKIR_API_KEY',
    couriers: ['jne', 'jnt', 'tiki', 'pos', 'antine', 'lion', 'sicepat', 'anteraja'],
    docs: 'https://rajaongkir.com/dokumentasi',
  },
  shipper: {
    name: 'Shipper',
    baseUrl: 'https://api.shipper.id/v3',
    envKey: 'SHIPPER_API_KEY',
    couriers: ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki', 'pos', 'lion', 'ninja'],
    docs: 'https://docs.shipper.id',
  },
  biteship: {
    name: 'Biteship',
    baseUrl: 'https://api.biteship.com/v1',
    envKey: 'BITESHIP_API_KEY',
    couriers: ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki', 'pos', 'lion', 'ninja'],
    docs: 'https://docs.biteship.com',
  },
  kiriminaja: {
    name: 'KiriminAja',
    baseUrl: 'https://api.kiriminaja.com/v1',
    envKey: 'KIRIMINAJA_API_KEY',
    couriers: ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki'],
    docs: 'https://docs.kiriminaja.com',
  },
  popaket: {
    name: 'Popaket',
    baseUrl: 'https://api.popaket.com/v1',
    envKey: 'POPAKET_API_KEY',
    couriers: ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki', 'pos'],
    docs: 'https://popaket.com/api-docs',
  },
  autokirim: {
    name: 'Autokirim',
    baseUrl: 'https://api.autokirim.com/v1',
    envKey: 'AUTOKIRIM_API_KEY',
    couriers: ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki'],
    docs: 'https://autokirim.com/api',
  },
  apikurir: {
    name: 'APIKurir',
    baseUrl: 'https://api.apikurir.id/v1',
    envKey: 'APIKURIR_API_KEY',
    couriers: ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki', 'pos'],
    docs: 'https://apikurir.id/docs',
  },
  apico: {
    name: 'API.co.id',
    baseUrl: 'https://api.co.id/v1',
    envKey: 'APICO_ID_API_KEY',
    couriers: ['jne', 'jnt', 'sicepat', 'tiki'],
    docs: 'https://api.co.id/documentation',
  },

  // ═══════════════════════════════════════════════════════════════
  // DIRECT KURIR
  // ═══════════════════════════════════════════════════════════════
  jne: {
    name: 'JNE',
    baseUrl: 'https://apiv2.jne.co.id/v1',
    envKey: 'JNE_API_KEY',
    couriers: ['jne'],
    docs: 'https://developer.jne.co.id',
  },
  jnt: {
    name: 'J&T Express',
    baseUrl: 'https://api.jntexpress.co.id/v2',
    envKey: 'JNT_API_KEY',
    couriers: ['jnt'],
    docs: 'https://developer.jntexpress.co.id',
  },
  sicepat: {
    name: 'SiCepat',
    baseUrl: 'https://api.sicepat.com/v1',
    envKey: 'SICEPAT_API_KEY',
    couriers: ['sicepat'],
    docs: 'https://sicepat.com/api',
  },
  anteraja: {
    name: 'AnterAja',
    baseUrl: 'https://api.anteraja.com/v1',
    envKey: 'ANTERAJA_API_KEY',
    couriers: ['anteraja'],
    docs: 'https://anteraja.com/api',
  },
  tiki: {
    name: 'TIKI',
    baseUrl: 'https://api.tiki.id/v1',
    envKey: 'TIKI_API_KEY',
    couriers: ['tiki'],
    docs: 'https://tiki.id/api',
  },
  pos: {
    name: 'POS Indonesia',
    baseUrl: 'https://api.posindonesia.co.id/v1',
    envKey: 'POS_API_KEY',
    couriers: ['pos'],
    docs: 'https://posindonesia.co.id/api',
  },
  lion: {
    name: 'Lion Parcel',
    baseUrl: 'https://api.lionparcel.com/v1',
    envKey: 'LION_API_KEY',
    couriers: ['lion'],
    docs: 'https://lionparcel.com/api',
  },
  ninja: {
    name: 'Ninja Van',
    baseUrl: 'https://api.ninjavan.co/v1',
    envKey: 'NINJA_API_KEY',
    couriers: ['ninja'],
    docs: 'https://docs.ninjavan.co',
  },
  grab: {
    name: 'Grab Express',
    baseUrl: 'https://partner.grab.com/v1',
    envKey: 'GRAB_API_KEY',
    couriers: ['grab'],
    docs: 'https://partner.grab.com',
  },
};

async function callProvider(provider, endpoint, params = {}) {
  const config = PROVIDERS[provider];
  const apiKey = process.env[config.envKey];

  if (!apiKey) {
    return { error: `${config.envKey} belum dikonfigurasi` };
  }

  const url = new URL(`${config.baseUrl}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { 'key': apiKey, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`${config.name} API error: ${res.status}`);
  }

  return res.json();
}

function formatCurrency(amount) {
  return `Rp${(amount || 0).toLocaleString('id-ID')}`;
}

function getActiveProvider() {
  for (const [key, config] of Object.entries(PROVIDERS)) {
    if (process.env[config.envKey]) return key;
  }
  return null;
}

export default function createShippingSkill() {
  const providerNames = Object.values(PROVIDERS).map(p => p.name).join(', ');
  
  return {
    manifest: {
      name: 'shipping',
      version: '1.0.0',
      description: `Hitung ongkos kirim multi-provider: ${providerNames}`,
      author: 'WAGENT',
      systemPromptAdditions: `Kamu bisa menghitung ongkos kirim menggunakan tool hitung_ongkir.
Provider yang tersedia: ${providerNames}.
Untuk menghitung ongkir, kamu perlu: kota asal, kota tujuan, berat (gram), dan kurir.
Selalu tanyakan berat barang dan kota tujuan sebelum menghitung.`,
    },
    tools: [
      {
        name: 'hitung_ongkir',
        description: 'Hitung ongkos kirim dari kota asal ke kota tujuan',
        parameters: {
          type: 'object',
          properties: {
            kota_asal: {
              type: 'string',
              description: 'ID atau nama kota asal',
            },
            kota_tujuan: {
              type: 'string',
              description: 'ID atau nama kota tujuan',
            },
            berat: {
              type: 'number',
              description: 'Berat barang dalam gram',
            },
            kurir: {
              type: 'string',
              enum: ['jne', 'jnt', 'tiki', 'sicepat', 'anteraja', 'pos'],
              description: 'Kurir pengiriman',
            },
            provider: {
              type: 'string',
              enum: ['rajaongkir', 'shipper', 'auto'],
              description: 'API provider (default: auto-detect)',
            },
          },
          required: ['kota_asal', 'kota_tujuan', 'berat', 'kurir'],
        },
        handler: async (args, context) => {
          const provider = args.provider === 'auto' ? getActiveProvider() : (args.provider || getActiveProvider());

          if (!provider) {
            return JSON.stringify({
              error: 'Tidak ada shipping API yang dikonfigurasi',
              help: 'Set salah satu env: RAJAONGKIR_API_KEY atau SHIPPER_API_KEY',
            });
          }

          try {
            let result;

            if (provider === 'rajaongkir') {
              result = await callProvider('rajaongkir', '/cost', {
                origin: args.kota_asal,
                destination: args.kota_tujuan,
                weight: args.berat,
                courier: args.kurir,
              });

              const costs = result.rajaongkir?.results?.[0]?.costs || [];
              const formatted = costs.map(c => ({
                layanan: c.service,
                estimasi: c.cost?.[0]?.etd || '-',
                harga: formatCurrency(c.cost?.[0]?.value),
                deskripsi: c.description,
              }));

              return JSON.stringify({
                provider: 'RajaOngkir',
                kurir: args.kurir.toUpperCase(),
                asal: result.rajaongkir?.origin_details?.city_name || args.kota_asal,
                tujuan: result.rajaongkir?.destination_details?.city_name || args.kota_tujuan,
                berat: `${args.berat} gram`,
                pilihan: formatted,
              });

            } else if (provider === 'shipper') {
              result = await callProvider('shipper', '/rate/courier', {
                origin_id: args.kota_asal,
                destination_id: args.kota_tujuan,
                weight: args.berat,
                courier_code: args.kurir,
              });

              const rates = result?.data || [];
              const formatted = rates.map(r => ({
                layanan: r.service_name || r.courier_code,
                estimasi: r.etd || '-',
                harga: formatCurrency(r.price),
              }));

              return JSON.stringify({
                provider: 'Shipper',
                kurir: args.kurir.toUpperCase(),
                pilihan: formatted,
              });
            }

            return JSON.stringify({ error: `Provider ${provider} belum terimplementasi` });

          } catch (err) {
            return JSON.stringify({ error: err.message, provider });
          }
        },
      },
      {
        name: 'cari_kota',
        description: 'Cari ID kota untuk digunakan di hitung_ongkir',
        parameters: {
          type: 'object',
          properties: {
            nama_kota: {
              type: 'string',
              description: 'Nama kota yang dicari',
            },
            provider: {
              type: 'string',
              enum: ['rajaongkir', 'shipper', 'auto'],
              description: 'API provider',
            },
          },
          required: ['nama_kota'],
        },
        handler: async (args, context) => {
          const provider = args.provider === 'auto' ? getActiveProvider() : (args.provider || getActiveProvider());

          if (!provider) {
            return JSON.stringify({ error: 'Tidak ada shipping API yang dikonfigurasi' });
          }

          try {
            if (provider === 'rajaongkir') {
              const result = await callProvider('rajaongkir', '/city');
              const cities = result.rajaongkir?.results || [];
              const search = args.nama_kota.toLowerCase();

              const matches = cities
                .filter(c => c.city_name?.toLowerCase().includes(search))
                .slice(0, 5)
                .map(c => ({
                  id: c.city_id,
                  kota: c.city_name,
                  provinsi: c.province,
                  tipe: c.type,
                  postal: c.postal_code,
                }));

              return JSON.stringify({ provider: 'RajaOngkir', hasil: matches });
            }

            return JSON.stringify({ error: `Provider ${provider} belum terimplementasi untuk cari_kota` });
          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },
      {
        name: 'cek_status_pengiriman',
        description: 'Cek status pengiriman berdasarkan nomor resi',
        parameters: {
          type: 'object',
          properties: {
            resi: {
              type: 'string',
              description: 'Nomor resi / tracking number',
            },
            kurir: {
              type: 'string',
              enum: ['jne', 'jnt', 'tiki', 'sicepat', 'anteraja', 'pos'],
              description: 'Kurir pengiriman',
            },
          },
          required: ['resi', 'kurir'],
        },
        handler: async (args, context) => {
          const provider = getActiveProvider();

          if (!provider) {
            return JSON.stringify({ error: 'Tidak ada shipping API yang dikonfigurasi' });
          }

          try {
            if (provider === 'rajaongkir') {
              const result = await callProvider('rajaongkir', '/waybill', {
                waybill: args.resi,
                courier: args.kurir,
              });

              const details = result.rajaongkir?.result || {};
              const history = details.manifest || [];

              return JSON.stringify({
                resi: args.resi,
                kurir: args.kurir.toUpperCase(),
                status: details.summary?.status || 'Unknown',
                detail: {
                  pengirim: details.summary?.origin,
                  penerima: details.summary?.destination,
                  berat: details.summary?.weight,
                  layanan: details.summary?.service,
                },
                riwayat: history.slice(0, 5).map(h => ({
                  waktu: h.manifest_date + ' ' + h.manifest_time,
                  lokasi: h.manifest_location,
                  keterangan: h.manifest_description,
                  kota: h.city_name,
                })),
              });
            }

            return JSON.stringify({ error: `Provider ${provider} belum terimplementasi untuk cek_resi` });
          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },
    ],
  };
}
