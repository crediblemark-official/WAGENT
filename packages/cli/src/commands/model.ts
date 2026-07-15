import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import color from 'picocolors';

export async function resolveModelCommand(modelId: string): Promise<void> {
  const { resolveModel } = await import('@wagent/core');
  const resolved = await resolveModel(modelId);

  console.log('');
  console.log(color.bold(`🔍 Resolve: ${modelId}`));
  console.log('──────────────────────────');

  console.log(`  ${color.cyan('Model ID:')} ${resolved.input}`);
  console.log(`  ${color.cyan('Provider:')} ${resolved.provider}`);
  console.log(`  ${color.cyan('Model:')} ${resolved.model}`);
  if (resolved.envKey) {
    console.log(`  ${color.cyan('API Key Env:')} ${resolved.envKey}`);
  }
  if (resolved.baseUrl) {
    console.log(`  ${color.cyan('Base URL:')} ${resolved.baseUrl}`);
  }
  if (resolved.npm) {
    console.log(`  ${color.cyan('SDK Package:')} ${resolved.npm}`);
  }
  if (resolved.name) {
    console.log(`  ${color.cyan('Provider Name:')} ${resolved.name}`);
  }

  console.log('');
}

export async function listModels(): Promise<void> {
  const { refreshModelCatalog } = await import('@wagent/core');
  await refreshModelCatalog();

  const cacheFile = join(process.env.HOME || '~', '.wagent', 'models.json');
  
  if (!existsSync(cacheFile)) {
    console.log(color.red('  Cache tidak ditemukan.'));
    return;
  }

  const cache = JSON.parse(readFileSync(cacheFile, 'utf-8'));
  const providers = Object.values(cache.providers) as any[];

  console.log('');
  console.log(color.bold('🧠 WAGENT Model Catalog'));
  console.log('──────────────────────────');
  console.log(`  ${color.green(String(providers.length))} providers tersedia`);
  console.log('');

  for (const provider of providers) {
    const envStr = provider.env?.length ? color.dim(` [${provider.env.join(', ')}]`) : '';
    console.log(`  ${color.cyan(provider.id)} - ${provider.name}${envStr}`);
  }

  console.log('');
}

export async function refreshModels(): Promise<void> {
  const { refreshModelCatalog } = await import('@wagent/core');
  
  console.log('');
  console.log(color.bold('🔄 Refreshing model catalog...'));
  await refreshModelCatalog();
  console.log(color.green('  ✓ Catalog updated'));
  console.log('');
}
