/**
 * Setup Prompt Wizard
 * 
 * AI-guided setup untuk generate prompt files:
 * - system.toon
 * - personality.toon
 * - messages.toon
 * - skills.toon
 * 
 * Supports: Business, Personal Assistant, Hybrid
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import color from 'picocolors';
import * as clack from '@clack/prompts';

interface PromptAnswers {
  // Use Case
  useCase: 'business' | 'personal' | 'hybrid';
  
  // Business Info (optional for personal)
  businessName?: string;
  businessType?: string;
  businessDescription?: string;
  targetCustomer?: string;
  
  // Personal Info (optional for business)
  personalName?: string;
  personalContext?: string;
  
  // Personality
  tone: string;
  emojiUsage: string;
  language: string;
  greeting?: string;
  
  // Common Topics
  frequentQuestions: string[];
  
  // Business-specific (optional)
  orderProcess?: string;
  paymentMethods?: string;
  shippingTime?: string;
  returnPolicy?: string;
  
  // Rules
  forbiddenActions: string[];
  escalationTriggers: string[];
  workingHours: string;
  
  // Features
  features: string[];
  
  // Messages
  welcomeMessage?: string;
  errorMessage?: string;
  offlineMessage?: string;
}

export async function setupPromptWizard(): Promise<void> {
  console.log('');
  console.log(color.bold(color.cyan('╔══════════════════════════════════════╗')));
  console.log(color.bold(color.cyan('║   🤖 WAGENT Prompt Setup Wizard     ║')));
  console.log(color.bold(color.cyan('║   AI Assistant for WhatsApp          ║')));
  console.log(color.bold(color.cyan('╚══════════════════════════════════════╝')));
  console.log('');
  console.log(color.dim('  Wizard ini akan membantu kamu membuat prompt untuk AI assistant.'));
  console.log(color.dim('  Jawaban kamu akan digunakan untuk generate 4 file prompt.'));
  console.log('');

  const s = clack.spinner();

  try {
    // ── Step 1: Use Case ──────────────────────────────────────────
    const useCaseResult = await clack.select({
      message: 'Mau pakai WAGENT untuk apa?',
      options: [
        { value: 'business', label: '🏢 Bisnis / Customer Service', hint: 'Untuk toko, restoran, layanan, dll' },
        { value: 'personal', label: '👤 Personal Assistant', hint: 'Untuk kebutuhan pribadi sehari-hari' },
        { value: 'hybrid', label: '🔄 Hybrid', hint: 'Bisnis + Personal' },
      ],
    });

    if (clack.isCancel(useCaseResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const useCase = useCaseResult as 'business' | 'personal' | 'hybrid';

    // ── Step 2: Identity ──────────────────────────────────────────
    let businessName: string | undefined;
    let businessType: string | undefined;
    let businessDescription: string | undefined;
    let targetCustomer: string | undefined;
    let personalName: string | undefined;
    let personalContext: string | undefined;

    if (useCase === 'business' || useCase === 'hybrid') {
      // Business info
      const businessNameResult = await clack.text({
        message: 'Apa nama bisnis/usaha kamu?',
        placeholder: 'contoh: Toko Baju Fashion',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Nama bisnis harus diisi';
          }
          return undefined;
        },
      });

      if (clack.isCancel(businessNameResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }
      
      businessName = businessNameResult as string;

      const businessTypeResult = await clack.select({
        message: 'Jenis bisnis apa?',
        options: [
          { value: 'toko-online', label: 'Toko Online / E-Commerce' },
          { value: 'retail', label: 'Retail / Toko Fisik' },
          { value: 'food-beverage', label: 'Food & Beverage / Restoran' },
          { value: 'services', label: 'Jasa / Layanan' },
          { value: 'healthcare', label: 'Kesehatan / Klinik' },
          { value: 'education', label: 'Pendidikan / Kursus' },
          { value: 'salon-beauty', label: 'Salon / Kecantikan' },
          { value: 'automotive', label: 'Otomotif / Bengkel' },
          { value: 'travel', label: 'Travel / Pariwisata' },
          { value: 'real-estate', label: 'Properti / Real Estate' },
          { value: 'other', label: 'Lainnya' },
        ],
      });

      if (clack.isCancel(businessTypeResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }
      
      businessType = businessTypeResult as string;

      const businessDescResult = await clack.text({
        message: 'Jelaskan produk/jasa yang ditawarkan (1-2 kalimat):',
        placeholder: 'contoh: Kami menjual baju fashion branded original dengan harga terjangkau',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Deskripsi harus diisi';
          }
          return undefined;
        },
      });

      if (clack.isCancel(businessDescResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }
      
      businessDescription = businessDescResult as string;

      const targetCustResult = await clack.text({
        message: 'Siapa target customer kamu?',
        placeholder: 'contoh: Anak muda usia 18-35 tahun yang suka fashion',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Target customer harus diisi';
          }
          return undefined;
        },
      });

      if (clack.isCancel(targetCustResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }
      
      targetCustomer = targetCustResult as string;
    }

    if (useCase === 'personal' || useCase === 'hybrid') {
      // Personal info
      const personalNameResult = await clack.text({
        message: 'Nama kamu (atau nama AI assistant)?',
        placeholder: 'contoh: Budi atau AI Assistant',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Nama harus diisi';
          }
          return undefined;
        },
      });

      if (clack.isCancel(personalNameResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }
      
      personalName = personalNameResult as string;

      const personalCtxResult = await clack.text({
        message: 'Konteks penggunaan sehari-hari?',
        placeholder: 'contoh: Untuk bantu kerjaan kantor, atur jadwal, reminder',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Konteks harus diisi';
          }
          return undefined;
        },
      });

      if (clack.isCancel(personalCtxResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }
      
      personalContext = personalCtxResult as string;
    }

    // ── Step 3: Personality ────────────────────────────────────────
    const toneResult = await clack.select({
      message: 'Gaya bicara AI seperti apa?',
      options: [
        { value: 'casual', label: 'Santai & Natural' },
        { value: 'formal', label: 'Formal & Sopan' },
        { value: 'professional', label: 'Profesional & Ramah' },
        { value: 'friendly', label: 'Ramah & Hangat' },
      ],
    });

    if (clack.isCancel(toneResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const tone = toneResult as string;

    const emojiResult = await clack.select({
      message: 'Apakah boleh pakai emoji?',
      options: [
        { value: 'rare', label: 'Tidak pernah' },
        { value: 'moderate', label: 'Sesekali' },
        { value: 'frequent', label: 'Sering' },
      ],
    });

    if (clack.isCancel(emojiResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const emojiUsage = emojiResult as string;

    const languageResult = await clack.select({
      message: 'Bahasa yang digunakan?',
      options: [
        { value: 'id', label: 'Indonesia' },
        { value: 'en', label: 'English' },
        { value: 'mixed', label: 'Campuran (ID + EN)' },
      ],
    });

    if (clack.isCancel(languageResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const language = languageResult as string;

    const greetingResult = await clack.text({
      message: 'Ada ungkapan/sapaan khusus? (atau skip untuk default)',
      placeholder: 'contoh: Halo Kak, Selamat Pagi, atau Hai Bos',
    });

    if (clack.isCancel(greetingResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const greeting = greetingResult as string;

    // ── Step 4: Common Topics ──────────────────────────────────────
    const topicLabel = useCase === 'business' ? 'customer' : 'kamu';
    clack.note(`Sekarang kita akan mengisi pertanyaan/info yang sering ditanyakan ${topicLabel}.`, '📋 Common Topics');

    const frequentQuestions: string[] = [];
    let addMore = true;
    
    while (addMore) {
      const questionResult = await clack.text({
        message: `Pertanyaan/topik ke-${frequentQuestions.length + 1}:`,
        placeholder: useCase === 'business' 
          ? 'contoh: Berapa ongkir ke Jakarta?' 
          : 'contoh: Jam berapa meeting besok?',
      });

      if (clack.isCancel(questionResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }

      const question = questionResult as string;
      if (question && question.trim().length > 0) {
        frequentQuestions.push(question);
      }

      const continueAdding = await clack.confirm({
        message: 'Tambah lagi?',
        initialValue: true,
      });

      if (clack.isCancel(continueAdding)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }

      addMore = continueAdding;
    }

    // Business-specific questions
    let orderProcess: string | undefined;
    let paymentMethods: string | undefined;
    let shippingTime: string | undefined;
    let returnPolicy: string | undefined;

    if (useCase === 'business' || useCase === 'hybrid') {
      const addBusinessDetails = await clack.confirm({
        message: 'Tambah detail bisnis (pembayaran, pengiriman, retur)?',
        initialValue: true,
      });

      if (clack.isCancel(addBusinessDetails)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }

      if (addBusinessDetails) {
        const orderProcessResult = await clack.text({
          message: 'Bagaimana cara pesan/beli produk?',
          placeholder: 'contoh: Chat langsung, pilih barang, konfirmasi, bayar, kirim',
        });

        if (clack.isCancel(orderProcessResult)) {
          clack.cancel('Setup dibatalkan.');
          process.exit(0);
        }
        
        orderProcess = orderProcessResult as string;

        const paymentMethodsResult = await clack.text({
          message: 'Apa saja metode pembayaran yang diterima?',
          placeholder: 'contoh: Transfer Bank, e-wallet (GoPay, OVO, Dana), COD',
        });

        if (clack.isCancel(paymentMethodsResult)) {
          clack.cancel('Setup dibatalkan.');
          process.exit(0);
        }
        
        paymentMethods = paymentMethodsResult as string;

        const shippingTimeResult = await clack.text({
          message: 'Berapa lama proses pengiriman?',
          placeholder: 'contoh: 1-3 hari kerja untuk pulau Jawa',
        });

        if (clack.isCancel(shippingTimeResult)) {
          clack.cancel('Setup dibatalkan.');
          process.exit(0);
        }
        
        shippingTime = shippingTimeResult as string;

        const returnPolicyResult = await clack.text({
          message: 'Apa kebijakan retur/garansi?',
          placeholder: 'contoh: Retur 7 hari jika barang cacat',
        });

        if (clack.isCancel(returnPolicyResult)) {
          clack.cancel('Setup dibatalkan.');
          process.exit(0);
        }
        
        returnPolicy = returnPolicyResult as string;
      }
    }

    // ── Step 5: Rules & Boundaries ─────────────────────────────────
    clack.note('Sekarang kita akan mengisi aturan dan batasan untuk AI.', '⚠️ Rules');

    const forbiddenActions: string[] = [];
    let addMoreForbidden = true;
    
    while (addMoreForbidden) {
      const actionResult = await clack.text({
        message: `Larangan ke-${forbiddenActions.length + 1}:`,
        placeholder: useCase === 'business' 
          ? 'contoh: Memberikan diskon' 
          : 'contoh: Memberikan nomor rekening',
      });

      if (clack.isCancel(actionResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }

      const action = actionResult as string;
      if (action && action.trim().length > 0) {
        forbiddenActions.push(action);
      }

      const continueAdding = await clack.confirm({
        message: 'Tambah larangan lagi?',
        initialValue: true,
      });

      if (clack.isCancel(continueAdding)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }

      addMoreForbidden = continueAdding;
    }

    const escalationTriggers: string[] = [];
    let addMoreEscalation = true;
    
    while (addMoreEscalation) {
      const triggerResult = await clack.text({
        message: `Eskalasi ke-${escalationTriggers.length + 1}:`,
        placeholder: useCase === 'business' 
          ? 'contoh: Komplain, pertanyaan teknis' 
          : 'contoh: Urgent, emergency, butuh keputusan',
      });

      if (clack.isCancel(triggerResult)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }

      const trigger = triggerResult as string;
      if (trigger && trigger.trim().length > 0) {
        escalationTriggers.push(trigger);
      }

      const continueAdding = await clack.confirm({
        message: 'Tambah eskalasi lagi?',
        initialValue: true,
      });

      if (clack.isCancel(continueAdding)) {
        clack.cancel('Setup dibatalkan.');
        process.exit(0);
      }

      addMoreEscalation = continueAdding;
    }

    const workingHoursResult = await clack.text({
      message: 'Jam operasional (atau ketersediaan)?',
      placeholder: useCase === 'business' 
        ? 'contoh: 08:00-17:00 WIB, Senin-Sabtu' 
        : 'contoh: 24 jam, atau 07:00-23:00',
    });

    if (clack.isCancel(workingHoursResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const workingHours = workingHoursResult as string;

    // ── Step 6: Features ───────────────────────────────────────────
    const featureOptions = useCase === 'business' || useCase === 'hybrid'
      ? [
          { value: 'hitung_ongkir', label: 'Hitung Ongkos Kirim', hint: 'API RajaOngkir/Biteship' },
          { value: 'bayar', label: 'Proses Pembayaran', hint: 'Payment gateway' },
          { value: 'cek_pesanan', label: 'Cek Status Pesanan', hint: 'Database pesanan' },
          { value: 'buat_pesanan', label: 'Buat Pesanan Baru', hint: 'Input pesanan' },
          { value: 'jadwal', label: 'Booking / Appointment', hint: 'Jadwal online' },
          { value: 'inventori', label: 'Cek Stok Barang', hint: 'Manajemen inventori' },
          { value: 'web_search', label: 'Web Search', hint: 'Cari informasi online' },
          { value: 'reminder', label: 'Reminder / Alarm', hint: 'Pengingat otomatis' },
        ]
      : [
          { value: 'web_search', label: 'Web Search', hint: 'Cari informasi online' },
          { value: 'reminder', label: 'Reminder / Alarm', hint: 'Pengingat otomatis' },
          { value: 'calendar', label: 'Calendar', hint: 'Atur jadwal' },
          { value: 'notes', label: 'Notes / Catatan', hint: 'Buat catatan' },
          { value: 'calculator', label: 'Kalkulator', hint: 'Hitung angka' },
          { value: 'translate', label: 'Translate', hint: 'Terjemahkan teks' },
        ];

    const featuresResult = await clack.multiselect({
      message: 'Fitur apa yang dibutuhkan?',
      options: featureOptions,
      required: true,
    });

    if (clack.isCancel(featuresResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const features = featuresResult as string[];

    // ── Step 7: Messages ───────────────────────────────────────────
    clack.note('Sekarang kita akan mengisi pesan-pesan default. Tekan Enter untuk menggunakan default.', '💬 Messages');

    const welcomeMessageResult = await clack.text({
      message: 'Pesan sambutan?',
      placeholder: 'Tekan Enter untuk default',
    });

    if (clack.isCancel(welcomeMessageResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const welcomeMessage = welcomeMessageResult as string;

    const errorMessageResult = await clack.text({
      message: 'Pesan saat AI tidak bisa menjawab?',
      placeholder: 'Tekan Enter untuk default',
    });

    if (clack.isCancel(errorMessageResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const errorMessage = errorMessageResult as string;

    const offlineMessageResult = await clack.text({
      message: 'Pesan saat di luar jam operasional?',
      placeholder: 'Tekan Enter untuk default',
    });

    if (clack.isCancel(offlineMessageResult)) {
      clack.cancel('Setup dibatalkan.');
      process.exit(0);
    }
    
    const offlineMessage = offlineMessageResult as string;

    // ── Generate Prompts ───────────────────────────────────────────
    s.start('Generating prompt files...');

    const answers: PromptAnswers = {
      useCase,
      businessName,
      businessType,
      businessDescription,
      targetCustomer,
      personalName,
      personalContext,
      tone,
      emojiUsage,
      language,
      greeting,
      frequentQuestions,
      orderProcess,
      paymentMethods,
      shippingTime,
      returnPolicy,
      forbiddenActions,
      escalationTriggers,
      workingHours,
      features,
      welcomeMessage,
      errorMessage,
      offlineMessage,
    };

    // Create prompts directory
    const promptsDir = join(process.cwd(), 'prompts');
    if (!existsSync(promptsDir)) {
      mkdirSync(promptsDir, { recursive: true });
    }

    // Generate each file
    const systemPrompt = generateSystemPrompt(answers);
    const personalityPrompt = generatePersonalityPrompt(answers);
    const messagesPrompt = generateMessagesPrompt(answers);
    const skillsPrompt = generateSkillsPrompt(answers);

    // Write files
    writeFileSync(join(promptsDir, 'system.toon'), systemPrompt, 'utf-8');
    writeFileSync(join(promptsDir, 'personality.toon'), personalityPrompt, 'utf-8');
    writeFileSync(join(promptsDir, 'messages.toon'), messagesPrompt, 'utf-8');
    writeFileSync(join(promptsDir, 'skills.toon'), skillsPrompt, 'utf-8');

    s.stop('Prompt files generated!');

    // Show summary
    const identityName = useCase === 'business' ? businessName : personalName;
    const useCaseLabel = useCase === 'business' ? 'Bisnis/CS' : useCase === 'personal' ? 'Personal Assistant' : 'Hybrid';

    console.log('');
    console.log(color.bold(color.green('✅ Prompt files berhasil dibuat!')));
    console.log('');
    console.log(color.bold('📂 Generated Files:'));
    console.log('────────────────────────────────────────────────────────');
    console.log(`  ${color.cyan('system.toon')}     - Persona AI untuk ${identityName}`);
    console.log(`  ${color.cyan('personality.toon')} - Gaya bicara ${tone}`);
    console.log(`  ${color.cyan('messages.toon')}   - Pesan default`);
    console.log(`  ${color.cyan('skills.toon')}     - Fitur: ${features.join(', ')}`);
    console.log('');
    console.log(color.dim(`  Use Case: ${useCaseLabel}`));
    console.log(color.dim('  Edit file di folder prompts/ untuk customize lebih lanjut.'));
    console.log(color.dim('  Jalankan "wagent start" untuk mengaktifkan prompt baru.'));
    console.log('');

  } catch (err: any) {
    s.stop('Setup failed');
    console.error(color.red(`\n✗ Error: ${err.message}`));
    process.exit(1);
  }
}

// ── Generate Functions ──────────────────────────────────────────────

function generateSystemPrompt(answers: PromptAnswers): string {
  const lines: string[] = [];

  const isBusiness = answers.useCase === 'business' || answers.useCase === 'hybrid';
  const isPersonal = answers.useCase === 'personal' || answers.useCase === 'hybrid';
  
  const identityName = isBusiness ? answers.businessName : answers.personalName;
  const identityType = isBusiness ? (answers.businessType || 'assistant') : 'personal-assistant';

  // Role
  lines.push(`role: ${identityType}-ai`);
  lines.push(`language: ${answers.language}`);
  lines.push(`style: ${answers.tone}`);
  lines.push('');

  // Personality
  lines.push('personality[5]:');
  lines.push(`  - Kamu adalah AI assistant untuk ${identityName}`);
  
  if (isBusiness && answers.businessDescription) {
    lines.push(`  - ${answers.businessDescription}`);
  }
  if (isPersonal && answers.personalContext) {
    lines.push(`  - ${answers.personalContext}`);
  }
  if (isBusiness && answers.targetCustomer) {
    lines.push(`  - Target customer: ${answers.targetCustomer}`);
  }
  
  lines.push('  - Ramah, profesional, dan membantu');
  lines.push('  - Selalu prioritaskan kepuasan pengguna');
  lines.push('');

  // Speaking Style
  lines.push('speaking-style[6]:');
  lines.push(`  - Gunakan bahasa ${answers.language} yang alami`);
  if (answers.greeting) {
    lines.push(`  - Sapaan khusus: "${answers.greeting}"`);
  }
  lines.push('  - Variasikan gaya balasan sesuai konteks');
  lines.push('  - Jangan terlalu kaku dan jangan terlalu panjang');
  lines.push('  - Gunakan emoji secukupnya untuk kesan ramah');
  lines.push('  - Hindari frasa kaku dan formalitas berlebihan');
  lines.push('  - Akhiri dengan tawaran bantuan lebih lanjut');
  lines.push('');

  // Rules
  lines.push('rules[6]:');
  lines.push('  - Jangan sebut diri sendiri AI kecuali ditanya');
  lines.push('  - Jika tidak tahu jawabannya akui dengan jujur');
  
  if (answers.forbiddenActions.length > 0) {
    for (const action of answers.forbiddenActions) {
      lines.push(`  - Jangan ${action.toLowerCase()}`);
    }
  } else {
    lines.push('  - Jangan membuat informasi palsu');
    lines.push('  - Jangan meminta data sensitif');
  }
  
  if (answers.escalationTriggers.length > 0) {
    lines.push(`  - Eskalasi ke manusia jika: ${answers.escalationTriggers.join(', ')}`);
  }
  lines.push('  - Jika ada pertanyaan di luar konteks, arahkan dengan sopan');
  lines.push('');

  // Format
  lines.push('format[4]:');
  lines.push('  - Balasan singkat untuk pertanyaan sederhana');
  lines.push('  - Balasan lebih panjang jika perlu menjelaskan');
  lines.push('  - Gunakan poin-poin jika ada beberapa informasi');
  lines.push('  - Akhiri dengan tawaran bantuan lebih lanjut');
  lines.push('');

  // Reminder
  lines.push('reminder: Kamu adalah assistant yang alami dan menyenangkan diajak bicara');

  return lines.join('\n');
}

function generatePersonalityPrompt(answers: PromptAnswers): string {
  const lines: string[] = [];

  lines.push('tones:');
  lines.push('  casual:');
  lines.push('    description: santai dan natural');
  lines.push('    instruction: Gunakan bahasa yang santai dan natural. Boleh pakai slang dan bahasa sehari-hari.');
  lines.push('');
  lines.push('  formal:');
  lines.push('    description: formal dan sopan');
  lines.push('    instruction: Gunakan bahasa yang formal dan sopan. Hindari slang dan singkatan.');
  lines.push('');
  lines.push('  professional:');
  lines.push('    description: profesional dan ramah');
  lines.push('    instruction: Gunakan bahasa profesional namun tetap ramah. Seimbang antara formal dan santai.');
  lines.push('');
  lines.push('  friendly:');
  lines.push('    description: ramah dan hangat');
  lines.push('    instruction: Gunakan bahasa yang ramah dan hangat. Gunakan emoji secukupnya.');
  lines.push('');
  lines.push('  mixed:');
  lines.push('    description: adaptif mengikuti lawan bicara');
  lines.push('    instruction: Sesuaikan gaya dengan konteks percakapan. Ikuti gaya dari lawan bicara.');
  lines.push('');

  lines.push('emoji:');
  lines.push('  rare: Hindari emoji.');
  lines.push('  moderate: Gunakan emoji sesekali.');
  lines.push('  frequent: Boleh sering menggunakan emoji.');
  lines.push('');

  lines.push('context:');
  lines.push('  urgent: Konteks: URGEN. Respons harus langsung, efisien, dan to the point. Hindari basa-basi.');
  lines.push('  business: Konteks: BISNIS. Gunakan bahasa yang profesional, informatif, dan terstruktur.');
  lines.push('  default: Gunakan gaya yang ramah dan profesional. Sesuaikan dengan konteks percakapan.');
  lines.push('  urgent_default: Konteks URGEN. Respons langsung dan efisien tanpa basa-basi. Bantu sesegera mungkin.');
  lines.push('  business_default: Konteks BISNIS. Gunakan bahasa profesional, informatif, dan terstruktur dengan baik.');

  return lines.join('\n');
}

function generateMessagesPrompt(answers: PromptAnswers): string {
  const lines: string[] = [];

  const isBusiness = answers.useCase === 'business' || answers.useCase === 'hybrid';
  const identityName = isBusiness ? answers.businessName : answers.personalName;

  const welcome = answers.welcomeMessage || `Halo! ${answers.greeting || 'Ada yang bisa saya bantu hari ini?'}`;
  const error = answers.errorMessage || 'Maaf, saya mengalami kendala teknis. Silakan coba lagi nanti.';
  const offline = answers.offlineMessage || 'Mohon maaf, saat ini di luar jam operasional.';

  lines.push(`welcome: ${welcome}`);
  lines.push('rate_limit: Mohon tunggu sebentar ya.');
  lines.push(`offline: ${offline}`);
  lines.push(`error_technical: ${error}`);

  return lines.join('\n');
}

function generateSkillsPrompt(answers: PromptAnswers): string {
  const lines: string[] = [];

  if (answers.features.includes('hitung_ongkir')) {
    lines.push('shipping:');
    lines.push('  name: shipping');
    lines.push('  prompt: Kamu bisa menghitung ongkos kirim menggunakan tool hitung_ongkir. Untuk menghitung ongkir, kamu perlu: kota asal, kota tujuan, berat (gram), dan kurir. Selalu tanyakan berat barang dan kota tujuan sebelum menghitung.');
    lines.push('');
  }

  if (answers.features.includes('bayar')) {
    lines.push('payment:');
    lines.push('  name: payment');
    lines.push('  prompt: Kamu bisa memproses pembayaran menggunakan tool yang tersedia. Selalu konfirmasi total sebelum memproses pembayaran.');
    lines.push('');
  }

  if (answers.features.includes('cek_pesanan')) {
    lines.push('order:');
    lines.push('  name: order');
    lines.push('  prompt: Kamu bisa mengecek status pesanan menggunakan tool yang tersedia. Tanyakan nomor pesanan atau nama customer.');
    lines.push('');
  }

  if (answers.features.includes('jadwal')) {
    lines.push('appointment:');
    lines.push('  name: appointment');
    lines.push('  prompt: Kamu bisa mengelola jadwal appointment menggunakan tool yang tersedia. Tanyakan tanggal, waktu, dan jenis layanan.');
    lines.push('');
  }

  if (answers.features.includes('inventori')) {
    lines.push('inventory:');
    lines.push('  name: inventory');
    lines.push('  prompt: Kamu bisa mengecek stok barang menggunakan tool yang tersedia. Tanyakan nama atau kode barang.');
    lines.push('');
  }

  if (answers.features.includes('web_search')) {
    lines.push('search:');
    lines.push('  name: search');
    lines.push('  prompt: Kamu bisa mencari informasi online menggunakan tool web_search. Cocok untuk pertanyaan tentang berita, cuaca, harga, atau informasi terkini.');
    lines.push('');
  }

  if (answers.features.includes('reminder')) {
    lines.push('reminder:');
    lines.push('  name: reminder');
    lines.push('  prompt: Kamu bisa mengatur reminder/ alarm menggunakan tool yang tersedia. Tanyakan waktu dan detail pengingat.');
    lines.push('');
  }

  if (answers.features.includes('calendar')) {
    lines.push('calendar:');
    lines.push('  name: calendar');
    lines.push('  prompt: Kamu bisa mengelola kalender menggunakan tool yang tersedia. Untuk melihat, membuat, atau mengubah jadwal.');
    lines.push('');
  }

  if (answers.features.includes('notes')) {
    lines.push('notes:');
    lines.push('  name: notes');
    lines.push('  prompt: Kamu bisa membuat dan mengelola catatan menggunakan tool yang tersedia.');
    lines.push('');
  }

  if (answers.features.includes('calculator')) {
    lines.push('calculator:');
    lines.push('  name: calculator');
    lines.push('  prompt: Kamu bisa menghitung angka menggunakan tool kalkulator.');
    lines.push('');
  }

  if (answers.features.includes('translate')) {
    lines.push('translate:');
    lines.push('  name: translate');
    lines.push('  prompt: Kamu bisa menerjemahkan teks menggunakan tool translate.');
    lines.push('');
  }

  if (answers.frequentQuestions.length > 0) {
    lines.push('knowledge:');
    lines.push('  name: knowledge');
    lines.push(`  prompt: Pertanyaan/topik yang sering ditanyakan: ${answers.frequentQuestions.join('; ')}`);
    lines.push('');
  }

  return lines.join('\n');
}